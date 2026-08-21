/**
 * クレイモアの判定。**置けるか / 反応するか / 誰に届くか。**
 *
 * 検知する距離と角度、爆風の量は遊びの数字なので domain/item/claymore.ts。
 * ここに在るのは、それを世界に当てはめる側 — 壁に埋まっていないか、
 * 縁から浮いていないか、扇の中に居るか。
 *
 * three にも DOM にも依存しない。サーバーが起爆を決める。
 */

import { TRIGGER_COS, TRIGGER_RANGE } from '../../domain/item/claymore'

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
export function triggeredBy(mine: Placed, target: Target): boolean {
  const dx = target.x - mine.x
  const dz = target.z - mine.z
  const distance = Math.hypot(dx, dz)
  if (distance > TRIGGER_RANGE || distance < 1e-4) return false

  const [fx, fz] = forwardOf(mine.yaw)
  return (dx / distance) * fx + (dz / distance) * fz >= TRIGGER_COS
}

/**
 * 爆心から相手までの距離 (m)。**量はここで決めない** (domain/item/claymore.ts)。
 *
 * **全方位に測る。** 向きが意味を持つのは「いつ起爆するか」(triggeredBy) まで。
 * 爆ぜてしまえば火薬は前も後ろも無い — 真後ろに立っていた人だけ無傷、は
 * 物として嘘になる。置く側から見ても、**背後を通られたら起爆しない**という
 * 時点で向きの代償は払っている。
 *
 * 高さは見ない (足元の平面で測る)。上の階に居る人を巻き込む問題は、階の概念が
 * 入ってから。
 */
export function blastReach(mine: Placed, target: Target): number {
  return Math.hypot(target.x - mine.x, target.z - mine.z)
}
