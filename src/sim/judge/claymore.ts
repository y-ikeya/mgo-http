/**
 * クレイモアの判定。**置けるか / 反応するか / 誰に届くか。**
 *
 * 検知する距離と角度、爆風の量は遊びの数字なので domain/item/claymore.ts。
 * ここに在るのは、それを世界に当てはめる側 — 壁に埋まっていないか、
 * 縁から浮いていないか、扇の中に居るか。
 *
 * three にも DOM にも依存しない。サーバーが起爆を決める。
 */

import { type SightBlocker, type SolidWorld, type StageBox, groundUnder } from '../space/vision'

/** 置く位置。本人の足元から前へ何 m か (手が届く所) */
export const PLACE_FORWARD = 0.9
/**
 * 前が塞がっていた時、手前へ引ける限界 (m)。
 *
 * 壁に向いて立つと 0.9m 先は壁の中。そこで弾くと**壁際に置けない** — 角を
 * 曲がってきた相手で起爆させる置き方 (壁ぎりぎりに寄せる) ができなかった。
 * 本体が壁に埋まらない所まで手前へ引く。自分の体 (半径 0.35m) に重なる手前で止める
 */
export const PLACE_NEAREST = 0.4
/** 引く刻み (m) */
const PLACE_STEP = 0.05

export interface PlaceSpot {
  x: number
  /** 地面の高さ。置く物はここに乗る */
  y: number
  z: number
  /** 置けるか (canPlaceAt) */
  ok: boolean
}

/**
 * 置く場所と、そこに置けるか。**サーバーも客も同じ式を読む。**
 *
 * 前へ 0.9m、地面に乗せる、埋まる / 浮くを弾く — の 3 つを 1 か所に。
 * サーバーだけに在ると、客は置けない場所でも置く型を流し切ってから何も
 * 起きない、という形で出る (刺さらない相手にナイフの当たり表示だけ出した件と
 * 同じ穴)。客はこれを見て、置けない時は置く型に入らず、置ける時は
 * **どこに置かれるか**を描く。
 *
 * **前が塞がっていれば手前へ引く。** 0.9m 先が壁の中や縁の外なら、本体が
 * 収まる所まで 5cm ずつ自分の方へ寄せる (PLACE_NEAREST まで)。壁ぎりぎり・
 * 縁ぎりぎりに置けるのはこのため。どこまで引いても入らなければ、0.9m 先を
 * ok=false で返す (印を赤く出す場所として)。
 *
 * @param from 置く人。yaw は hitcheck と同じ規約 (前が -sin, -cos)
 */
export function placeSpot(
  from: { x: number; y: number; z: number; yaw: number },
  solid: StageBox[],
  stepUp: number,
  surfaces: SolidWorld | null,
  out: PlaceSpot = { x: 0, y: 0, z: 0, ok: false },
): PlaceSpot {
  const [fx, fz] = forwardOf(from.yaw)
  for (let d = PLACE_FORWARD; d >= PLACE_NEAREST - 1e-6; d -= PLACE_STEP) {
    const x = from.x + fx * d
    const z = from.z + fz * d
    // 地面に乗せる。足元をそのまま使うと、段差の上に置いたときに沈む
    const ground = surfaces
      ? groundOnMesh(x, z, from.y, stepUp, surfaces)
      : groundUnder(x, z, from.y, solid, stepUp).top
    const ok =
      ground !== null &&
      (surfaces
        ? canPlaceOnMesh(x, z, from, ground, from.yaw, surfaces)
        : canPlaceAt(x, z, from.y, ground, solid, from.yaw))
    if (ok) {
      out.x = x
      out.y = ground
      out.z = z
      out.ok = true
      return out
    }
    if (d === PLACE_FORWARD) {
      out.x = x
      out.y = ground ?? from.y
      out.z = z
    }
  }
  out.ok = false
  return out
}

/**
 * 面の網で見る地面。足元の少し上から真下へ線を落として、最初に当たる所。
 *
 * 箱 (groundUnder) だと、飾り (庇・窓枠) の外接が床に数えられたり、坂が段に
 * なったりする。審判が人を立たせている面そのもの (MESH_PLAYER) で測る。
 * 落ちる範囲は PLACE_DROP まで — それより下は「浮く」
 */
function groundOnMesh(x: number, z: number, feetY: number, stepUp: number, surfaces: SolidWorld): number | null {
  const top = feetY + stepUp
  const bottom = feetY - PLACE_DROP
  const hit = surfaces.hit(x, top, z, x, bottom, z)
  if (!hit) return null
  return top + (bottom - top) * hit.t
}

/**
 * 本体が面に埋まらないか。**人が止まる面そのもの**で見る。
 *
 * 箱の外接で見ると、庇や窓枠の外接が壁の手前まで張り出していて、壁から
 * 1m 近く離れないと置けなかった。面で見れば、本体の足跡が面を跨がなければ
 * 置ける。
 *
 * 見る線は 7 本:
 *   - 置く人から置く所の真ん中へ (**人は空いている所に居る**ので、そこから
 *     線が通れば置く所も同じ空間にある。足跡の線だけだと壁の中にすっぽり
 *     入った時に何にも当たらず通ってしまう)
 *   - 足跡 (向きの付いた長方形) の 4 辺と対角 2 本。本体の高さの真ん中で
 */
function canPlaceOnMesh(
  x: number,
  z: number,
  from: { x: number; y: number; z: number },
  ground: number,
  yaw: number,
  surfaces: SolidWorld,
): boolean {
  if (Math.abs(ground - from.y) > PLACE_DROP) return false
  const y = ground + PLACE_PROBE_HEIGHT
  // 人の膝の高さから。足元からだと段の縁に擦る
  if (surfaces.hit(from.x, from.y + 0.6, from.z, x, y, z)) return false

  const [fx, fz] = forwardOf(yaw)
  const rx = -fz
  const rz = fx
  const hw = BODY_HALF_WIDTH + PLACE_CLEARANCE
  const hd = BODY_HALF_DEPTH + PLACE_CLEARANCE
  // 角: 前右・前左・後左・後右
  const cx = [x + fx * hd + rx * hw, x + fx * hd - rx * hw, x - fx * hd - rx * hw, x - fx * hd + rx * hw]
  const cz = [z + fz * hd + rz * hw, z + fz * hd - rz * hw, z - fz * hd - rz * hw, z - fz * hd + rz * hw]
  const pairs: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]]
  for (const [a, b] of pairs) {
    if (surfaces.hit(cx[a]!, y, cz[a]!, cx[b]!, y, cz[b]!)) return false
  }
  return true
}

/**
 * 置ける場所か (**箱で見る版**。面の網が無いステージ用)。
 *
 * 弾く形は 2 つ:
 *
 *   **埋まる** … 本体の足跡 (向きの付いた長方形) が箱と重なる
 *   **浮く**   … 足元と地面の高さが離れている。縁の外へはみ出すとこうなる
 *
 * 点に余白を足して見ていた頃は、どの向きでも 12cm 空けないと置けなかった。
 * 本体は横 21.6cm × 奥行 16.6cm なので、**向きで変わる**。壁に沿わせれば
 * 奥行きの半分 (8cm) で収まる。本体が埋まらなければ置ける、を文字通りに見る。
 *
 * 呼ぶのは placeSpot。客もそこから読む。
 *
 * @param feetY 置く人の足元の高さ
 * @param ground その XZ の地面の高さ (groundUnder が返す top)
 * @param yaw 本体の向き (前が -sin, -cos)
 */
export function canPlaceAt(
  x: number,
  z: number,
  feetY: number,
  ground: number,
  solid: { min: readonly number[]; max: readonly number[] }[],
  yaw = 0,
): boolean {
  // 浮き。段差の縁からはみ出すと、地面が足元よりずっと下になる
  if (Math.abs(ground - feetY) > PLACE_DROP) return false

  // 埋まり。本体の高さの真ん中あたりで見る。地面すれすれで見ると、
  // 床の箱そのものに当たって常に弾かれる
  const y = ground + PLACE_PROBE_HEIGHT
  const [fx, fz] = forwardOf(yaw)
  // 右 (前を -90 度回した向き)
  const rx = -fz
  const rz = fx
  const hw = BODY_HALF_WIDTH + PLACE_CLEARANCE
  const hd = BODY_HALF_DEPTH + PLACE_CLEARANCE
  for (const box of solid) {
    if (y < box.min[1]! || y > box.max[1]!) continue
    if (rectHitsBox(x, z, rx, rz, hw, fx, fz, hd, box)) return false
  }
  return true
}

/**
/**
 * 向きの付いた長方形と、軸に沿った箱が XZ で重なるか (分離軸)。
 *
 * 試す軸は 4 本 — 世界の X / Z と、長方形の 2 軸。どれか 1 本で離れていれば
 * 重なっていない。
 */
function rectHitsBox(
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  hu: number,
  vx: number,
  vz: number,
  hv: number,
  box: { min: readonly number[]; max: readonly number[] },
): boolean {
  const bx = (box.min[0]! + box.max[0]!) / 2
  const bz = (box.min[2]! + box.max[2]!) / 2
  const bhx = (box.max[0]! - box.min[0]!) / 2
  const bhz = (box.max[2]! - box.min[2]!) / 2
  const dx = bx - cx
  const dz = bz - cz
  // 世界の軸: 長方形の張り出しは |u·axis|·hu + |v·axis|·hv
  if (Math.abs(dx) > bhx + Math.abs(ux) * hu + Math.abs(vx) * hv) return false
  if (Math.abs(dz) > bhz + Math.abs(uz) * hu + Math.abs(vz) * hv) return false
  // 長方形の軸: 箱の張り出しは bhx·|axis.x| + bhz·|axis.z|
  if (Math.abs(dx * ux + dz * uz) > hu + bhx * Math.abs(ux) + bhz * Math.abs(uz)) return false
  if (Math.abs(dx * vx + dz * vz) > hv + bhx * Math.abs(vx) + bhz * Math.abs(vz)) return false
  return true
}

/** 足元と地面がこれ以上離れていたら浮く (m) */
export const PLACE_DROP = 0.35

/** 埋まりを見る高さ (m)。本体の真ん中あたり */
export const PLACE_PROBE_HEIGHT = 0.13

/** 本体の足跡 (m)。横 21.6cm、脚を含めた奥行 16.6cm の半分 */
export const BODY_HALF_WIDTH = 0.108
export const BODY_HALF_DEPTH = 0.083

/** 壁からこれだけ離す (m)。面ぴったりだと絵が壁と食い合う */
export const PLACE_CLEARANCE = 0.01

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
export function triggeredBy(
  mine: Placed,
  target: Target,
  range: number,
  cos: number,
): boolean {
  const dx = target.x - mine.x
  const dz = target.z - mine.z
  const distance = Math.hypot(dx, dz)
  if (distance > range || distance < 1e-4) return false

  const [fx, fz] = forwardOf(mine.yaw)
  return (dx / distance) * fx + (dz / distance) * fz >= cos
}

/** 見る点 (足元からの高さ、頭の高さに対する割合)。脛と腰。頭だけ出ていても床の上は通っていない */
const SENSE_RATIOS = [0.18, 0.5] as const

/**
 * その相手に反応するか。**扇の中で、同じ高さで、見えている時だけ。**
 *
 * 扇 (triggeredBy) は平面の形。それだけだと**壁の向こう・角の裏・上下の階**を
 * 通った人でも起爆していた。見張るのは目の前の床を通る人なので:
 *
 *   - 足元の高さが SENSE_HEIGHT より離れていれば別の階 (床越しに反応しない)
 *   - 本体の目 (SENSOR_HEIGHT) から相手の脛か腰へ線が通らなければ反応しない
 *     (壁・角・箱の裏を通っても反応しない)
 *
 * 線を見る面は審判の遮蔽 (sight)。弾が通らない所は見張れない、で揃う。
 *
 * @param head 相手の頭の高さ (m、足元から)。姿勢で変わるので呼ぶ側が渡す
 * @param senseHeight 反応する高さの幅 (m)
 * @param sensorHeight 本体の目の高さ (m)
 */
export function sensedBy(
  mine: Placed,
  target: Target,
  range: number,
  cos: number,
  head: number,
  senseHeight: number,
  sensorHeight: number,
  world: SightBlocker,
): boolean {
  if (!triggeredBy(mine, target, range, cos)) return false
  if (Math.abs(target.y - mine.y) > senseHeight) return false
  const ey = mine.y + sensorHeight
  for (const ratio of SENSE_RATIOS) {
    if (world.clear(mine.x, ey, mine.z, target.x, target.y + head * ratio, target.z)) return true
  }
  return false
}

/**
 * 爆心から相手までの平面の距離 (m)。**量はここで決めない** (domain/item/claymore.ts)。
 *
 * **全方位に測る。** 向きが意味を持つのは「いつ起爆するか」(sensedBy) まで。
 * 爆ぜてしまえば火薬は前も後ろも無い — 真後ろに立っていた人だけ無傷、は
 * 物として嘘になる。置く側から見ても、**背後を通られたら起爆しない**という
 * 時点で向きの代償は払っている。
 *
 * 審判の爆風は手榴弾と同じ blastExposure (judge/blast.ts) を通す — 距離に
 * 加えて**壁の裏なら減る**。ここは「向きが爆風に効かない」ことの表明として残す。
 */
export function blastReach(mine: Placed, target: Target): number {
  return Math.hypot(target.x - mine.x, target.z - mine.z)
}
