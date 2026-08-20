/**
 * クレイモア。置いて、前を通った敵で起爆する。
 *
 * --- 手榴弾と何が違うか ---
 * 手榴弾は「相手を動かす」道具で、投げた本人が結果を見る。クレイモアは
 * **置いて離れる**道具で、置いた場所に相手が来るかどうかは相手が決める。
 * 「そこは通らせない」を作る物なので、当たるかどうかより**通り道を潰す**ことに
 * 意味がある。
 *
 * --- なぜ向きがあるか ---
 * 前だけに飛ぶ。全方位なら「置いた場所が危ない」だけで済むが、向きがあると
 * 「どちらから来ると危ないか」になる。置く側は通り道を読んで向きを決め、
 * 通る側は背後から回れば無事。**読み合いが 1 段増える。**
 *
 * three にも DOM にも依存しない。サーバーが起爆を決める。
 */

/** 反応する距離 (m)。これより遠い敵には反応しない */
export const TRIGGER_RANGE = 4

/**
 * 反応する角度の余弦。正面から左右 60 度まで。
 *
 * 広げると「置いた場所が危ない」に近づき、狭めると避けやすくなりすぎる。
 * 正面 120 度は、通路を塞ぐには足りて、横を抜けるには広すぎない辺り。
 */
export const TRIGGER_COS = Math.cos((60 * Math.PI) / 180)

/** 爆風が届く距離 (m)。反応する距離より少し広い — 反応した時点で逃げ切れない */
export const BLAST_RANGE = 6

/**
 * 至近で与える量。
 *
 * **単体では死なない** (体力 100 に対して 75)。手榴弾の爆風と同じ考え方で、
 * 置いただけで一発というのは強すぎる — 踏んだ相手は瀕死で逃げるか、
 * 追撃されて死ぬ。**置いた側がその場に居るかどうか**が結果を分ける。
 *
 * 置いた本人も巻き込まれるので、自分で踏むと 75 削れる。満身なら死なないが、
 * 撃ち合いのあとに戻ってきて踏むと死ぬ。
 */
export const BLAST_MAX = 75

/** 端で与える量。掠めれば死なない */
export const BLAST_MIN = 25

/** 置く位置。本人の足元から前へ何 m か */
export const PLACE_FORWARD = 0.9

/**
 * 置ける場所か。
 *
 * 弾く形は 2 つ:
 *
 *   **埋まる** … その点が箱の中に入っている。壁際で前を向くとこうなる
 *   **浮く**   … 足元と地面の高さが離れている。縁の外へはみ出すとこうなる
 *
 * **クライアントも同じ式を読む。** サーバーだけに入れると、置く型が 3.6 秒
 * 流れきってから何も起きない、という形で出る (刺さらない相手にナイフの当たり
 * 表示だけ出した件と同じ穴)。
 *
 * @param feetY 置く人の足元の高さ
 * @param ground その XZ の地面の高さ (groundUnder が返す top)
 */
export function canPlaceAt(
  x: number,
  z: number,
  feetY: number,
  ground: number,
  solid: { min: readonly number[]; max: readonly number[] }[],
): boolean {
  // 浮き。段差の縁からはみ出すと、地面が足元よりずっと下になる
  if (Math.abs(ground - feetY) > PLACE_DROP) return false

  // 埋まり。本体の高さの真ん中あたりで見る。地面すれすれで見ると、
  // 床の箱そのものに当たって常に弾かれる
  const y = ground + PLACE_PROBE_HEIGHT
  for (const box of solid) {
    if (x < box.min[0] - PLACE_CLEARANCE || x > box.max[0] + PLACE_CLEARANCE) continue
    if (z < box.min[2] - PLACE_CLEARANCE || z > box.max[2] + PLACE_CLEARANCE) continue
    if (y < box.min[1] || y > box.max[1]) continue
    return false
  }
  return true
}

/** 足元と地面がこれ以上離れていたら浮く (m) */
export const PLACE_DROP = 0.35

/** 埋まりを見る高さ (m)。本体の真ん中あたり */
export const PLACE_PROBE_HEIGHT = 0.13

/**
 * 壁からこれだけ離す (m)。
 *
 * 箱の面ぴったりに置けると、モデルの厚み (16.6cm) のぶん壁へめり込む。
 * 本体の奥行きの半分より少し広く取る。
 */
export const PLACE_CLEARANCE = 0.12

export interface Placed {
  x: number
  y: number
  z: number
  /** 正面の向き (rad)。ローカル -Z が前、という規約 */
  yaw: number
}

/**
 * 撃たれたときの当たり (m)。中心から左右前後にこれだけ。
 *
 * 本体は 21.6 × 16.6cm しかないが、判定は少し広く取る。**壊せることに
 * 気づけないほうが困る** — 見つけて撃ったのに通らないと、壊せる物だと分からない。
 */
export const SHOT_HALF = 0.18

/** 撃たれる高さ (m)。脚を含めた全体 */
export const SHOT_TOP = 0.28

export interface Target {
  x: number
  y: number
  z: number
}

/** yaw から正面の向き (x, z)。hitcheck と同じ規約 */
function forwardOf(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)]
}

/**
 * その相手で起爆するか。
 *
 * **前を通ったときだけ。** 背後や真横は通す。高さは見ない — 起爆するのは
 * 足元を通ったときで、上の階に居る人で反応されると理不尽になる…
 * のだが、階の概念がまだ無いので今は平面で見る。
 */
/** 爆風の結果。damage 0 なら届いていない */
export interface BlastHit {
  damage: number
  knock: boolean
}

/**
 * 転ぶ距離。届く距離に対する割合。
 *
 * 手榴弾は 7m のうち 5m で転ぶ (blast.ts の near > 0.28) ので、それに揃える。
 * 道具ごとに別の勘で決めると、受けた側が「どこまで下がれば立っていられるか」を
 * 覚え直すことになる。
 */
const KNOCK_RATIO = 0.72

export function triggeredBy(mine: Placed, target: Target): boolean {
  const dx = target.x - mine.x
  const dz = target.z - mine.z
  const distance = Math.hypot(dx, dz)
  if (distance > TRIGGER_RANGE || distance < 1e-4) return false

  const [fx, fz] = forwardOf(mine.yaw)
  return (dx / distance) * fx + (dz / distance) * fz >= TRIGGER_COS
}

/**
 * その相手に与える量と、転ぶかどうか。届かなければ damage 0。
 *
 * **全方位に飛ぶ。** 向きが意味を持つのは「いつ起爆するか」(triggeredBy) まで。
 * 爆ぜてしまえば火薬は前も後ろも無い — 真後ろに立っていた人だけ無傷、は
 * 物として嘘になる。置く側から見ても、**背後を通られたら起爆しない**という
 * 時点で向きの代償は払っている。
 *
 * **置いた本人も例外にしない。** 自分の物で削れる (手榴弾を足元に落としたときと
 * 同じ規則)。置いた場所を覚えていないと自分が損をする、が置いて離れる道具の
 * 代償になる。
 *
 * 転倒は手榴弾と同じ扱い。**当たれば動きが止まる**のがこの手の道具の効き目で、
 * 削るだけなら置いて離れる意味が薄い。
 */
export function blastFrom(mine: Placed, target: Target): BlastHit {
  const dx = target.x - mine.x
  const dz = target.z - mine.z
  const distance = Math.hypot(dx, dz)
  if (distance > BLAST_RANGE) return { damage: 0, knock: false }
  if (distance < 1e-4) return { damage: BLAST_MAX, knock: true }

  const t = distance / BLAST_RANGE
  return {
    damage: BLAST_MAX - t * (BLAST_MAX - BLAST_MIN),
    // 手榴弾と同じ割合 (届く距離の 7 割) で転ぶ。端で掠っただけの相手は立っている
    knock: t < KNOCK_RATIO,
  }
}
