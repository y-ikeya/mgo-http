/**
 * 見えているかどうかの判定。
 *
 * サーバーが「見えている相手だけ配る」ために使う。ブラウザの JS は読めるので、
 * 位置を送ってしまえば壁の向こうの相手が読める。接敵するまでステルスという
 * 前提のゲームで、そこが抜けていると設計そのものが成り立たない。
 *
 * three.js に依存しない。サーバー (bun) がこのファイルをそのまま読む。
 * 同じ判定を 2 か所に書くと、必ずどちらかがずれる。
 */

import type { SurfaceFlags } from '../domain/flags'
import { HEAD_HEIGHT } from '../domain/rule/stance'

/** 遮蔽になる箱。ステージの書き出しが作る stage.json の中身 */
export interface StageBox {
  name: string
  min: [number, number, number]
  max: [number, number, number]
  /** 何を止めるか。無ければ全部止める面として扱う */
  flags?: SurfaceFlags
  /**
   * 上面の平面。min の角における高さ h と、x / z 方向の傾き。
   *
   * 傾いていれば、箱は「上を斜めに切り落とした楔」になる。これを見ないと、
   * 坂の上の空いている空間まで遮蔽として扱ってしまい、坂の上に立った相手が
   * 誰からも見えなくなる。
   */
  top?: { h: number; dx: number; dz: number }
}

/**
 * その姿勢での頭の高さ (m)。
 *
 * 値そのものは stance.ts が持つ。遮蔽の判定に使う数字とモーションの表が
 * 別々にあると、クリップを差し替えたときに判定だけ黙って古くなる。
 */
export function headHeight(crouching: boolean, boxed: boolean): number {
  return HEAD_HEIGHT[boxed ? 'box' : crouching ? 'crouch' : 'stand']
}

/**
 * 体のどこを見るか。足元からの高さの比率。
 *
 * 頭だけで判定すると、頭を隠して足を出している相手が完全に消える。
 * 見えている部分があるのに映らないのは、隠れられるより困る。
 */
export const SAMPLE_RATIOS = [1, 0.55, 0.15]

/**
 * 体の幅の半分 (m)。中心線から左右へこれだけ離した点も見る。
 *
 * 中心線だけを見ていると、**角から覗いている相手が丸ごと消える**。
 * 肩と頭が壁の端から出ていても、体の中心が壁の裏にあれば通らないため。
 * 見えているのに映らないので、覗く側が一方的に得をする。
 */
const SHOULDER = 0.22

/** 線分と箱の交差 (slab 法)。当たれば true */
export function segmentHitsBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: StageBox,
): boolean {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az

  let near = 0
  let far = 1

  // 軸ごとに「線分がその軸の範囲に入っている区間」を求め、重なりを詰めていく。
  // 3 軸すべてで重なりが残れば、線分は箱の中を通っている。
  for (let axis = 0; axis < 3; axis++) {
    const origin = axis === 0 ? ax : axis === 1 ? ay : az
    const delta = axis === 0 ? dx : axis === 1 ? dy : dz
    const lo = box.min[axis]
    const hi = box.max[axis]

    if (Math.abs(delta) < 1e-9) {
      // その軸に進んでいない。始点が範囲の外なら永遠に入らない
      if (origin < lo || origin > hi) return false
      continue
    }

    let t0 = (lo - origin) / delta
    let t1 = (hi - origin) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]

    if (t0 > near) near = t0
    if (t1 < far) far = t1
    if (near > far) return false
  }

  // 上面が傾いていれば、箱は上を斜めに切り落とした楔になる。
  // 平面より上は空いているので、そこを通る線は遮られない。
  const top = box.top
  if (top && (top.dx !== 0 || top.dz !== 0)) {
    // 線上の各点で「上面からの高さ」も t の一次式になる。もう一枚の板として詰める
    const at0 = ay - (top.h + top.dx * (ax - box.min[0]) + top.dz * (az - box.min[2]))
    const rate = dy - (top.dx * dx + top.dz * dz)

    if (Math.abs(rate) < 1e-9) {
      // 上面と平行に進んでいる。始点が上なら、ずっと上
      if (at0 > 0) return false
    } else {
      const cross = -at0 / rate
      // rate > 0 なら進むほど上へ抜ける → cross より手前だけが中身
      if (rate > 0) {
        if (cross < far) far = cross
      } else if (cross > near) {
        near = cross
      }
      if (near > far) return false
    }
  }

  return true
}

/**
 * a から b が見えるか。
 *
 * 目の位置から相手の体の数点へ線を引き、1 本でも通れば見えているとする。
 *
 * @param boxes 遮蔽になる箱。ステージ全体を毎回なめる素朴な実装だが、
 *   1 回あたり 53 箱で、まず線分の AABB で弾くので実測 0.01ms 以下だった。
 *   人数が増えて足りなくなったら、そのとき空間分割を入れる。
 */
export function hasLineOfSight(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetFeetY: number,
  targetZ: number,
  targetHead: number,
  boxes: StageBox[],
): boolean {
  // 見る方向に対して横向きの単位ベクトル。肩の位置を出すのに使う
  const dx = targetX - eyeX
  const dz = targetZ - eyeZ
  const length = Math.hypot(dx, dz)
  const sideX = length > 1e-6 ? (-dz / length) * SHOULDER : SHOULDER
  const sideZ = length > 1e-6 ? (dx / length) * SHOULDER : 0

  // 中心線を先に見る。通れば即座に返るので、見えている相手の費用は 1 本のまま。
  // 増えた点の費用を払うのは、隠れている相手を確かめるときだけ
  for (const ratio of SAMPLE_RATIOS) {
    const ty = targetFeetY + targetHead * ratio
    if (isPathClear(eyeX, eyeY, eyeZ, targetX, ty, targetZ, boxes)) return true
  }

  // 左右の肩。頭と胸の高さだけ見る (足は幅が無い)
  for (const ratio of [1, 0.55]) {
    const ty = targetFeetY + targetHead * ratio
    if (isPathClear(eyeX, eyeY, eyeZ, targetX + sideX, ty, targetZ + sideZ, boxes)) return true
    if (isPathClear(eyeX, eyeY, eyeZ, targetX - sideX, ty, targetZ - sideZ, boxes)) return true
  }
  return false
}

/**
 * 線分が最初に箱へ入る位置 (0..1)。遮る物が無ければ null。
 *
 * isPathClear は「遮られたか」しか返さないが、カメラを壁の手前へ寄せるには
 * **どこで当たったか**が要る。
 */
export function firstBlockedAt(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: StageBox[],
): number | null {
  const origin = [ax, ay, az]
  const delta = [bx - ax, by - ay, bz - az]
  let best: number | null = null

  for (const box of boxes) {
    let near = 0
    let far = 1
    let miss = false
    for (let i = 0; i < 3; i++) {
      if (Math.abs(delta[i]) < 1e-9) {
        if (origin[i] < box.min[i] || origin[i] > box.max[i]) {
          miss = true
          break
        }
        continue
      }
      const inv = 1 / delta[i]
      let t0 = (box.min[i] - origin[i]) * inv
      let t1 = (box.max[i] - origin[i]) * inv
      if (t0 > t1) {
        const tmp = t0
        t0 = t1
        t1 = tmp
      }
      if (t0 > near) near = t0
      if (t1 < far) far = t1
      if (near > far) {
        miss = true
        break
      }
    }
    if (miss) continue
    if (best === null || near < best) best = near
  }
  return best
}

/** 2 点を結ぶ線分を遮る箱が 1 つも無いか */
export function isPathClear(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: StageBox[],
): boolean {
  // 線分自体の範囲。箱がここから外れていれば交差の計算に入らない
  const loX = Math.min(ax, bx)
  const hiX = Math.max(ax, bx)
  const loY = Math.min(ay, by)
  const hiY = Math.max(ay, by)
  const loZ = Math.min(az, bz)
  const hiZ = Math.max(az, bz)

  for (const box of boxes) {
    if (box.max[0] < loX || box.min[0] > hiX) continue
    if (box.max[1] < loY || box.min[1] > hiY) continue
    if (box.max[2] < loZ || box.min[2] > hiZ) continue
    if (segmentHitsBox(ax, ay, az, bx, by, bz, box)) return false
  }
  return true
}

/** 視線を止める面だけを残す。金網も茂みも見通せる面は数に入れない */
export function sightBlockers(boxes: StageBox[]): StageBox[] {
  return boxes.filter((box) => box.flags?.eye !== false)
}

/**
 * 物がぶつかる箱だけを残す。
 *
 * 遮蔽 (sightBlockers) とは別の集合になる。当たり判定専用のブロック (col_) は
 * 視線を止めないので遮蔽から外れるが、体も手榴弾もそこで止まる。
 * 逆に見えない壁 (vis_) は視線を止めるだけで、物は通り抜ける。
 *
 * 片方で済ませると、手榴弾が床を突き抜けて地面の下で爆発する。
 */
export function solidBlockers(boxes: StageBox[]): StageBox[] {
  return boxes.filter((box) => box.flags?.player !== false)
}

/**
 * その XZ 位置で足が乗っている面の高さと材質。
 *
 * サーバーが見えない相手の足音を配るのに要る。何の上を歩いているかは
 * 位置と地形から決まるので、こちらで出せる。申告させるものではない。
 *
 * @param feetY 足元の高さ。これより十分高い箱は「まだ登っていない」ので床に数えない
 */
export function groundUnder(
  x: number,
  z: number,
  feetY: number,
  boxes: StageBox[],
  stepUp: number,
): { top: number; name: string } {
  let best = 0
  let name = ''
  for (const box of boxes) {
    if (x < box.min[0] || x > box.max[0]) continue
    if (z < box.min[2] || z > box.max[2]) continue

    const top = box.top
    const height =
      top && (top.dx !== 0 || top.dz !== 0)
        ? top.h + top.dx * (x - box.min[0]) + top.dz * (z - box.min[2])
        : box.max[1]

    if (height > feetY + stepUp) continue
    if (height <= best) continue
    best = height
    name = box.name
  }
  return { top: best, name }
}
