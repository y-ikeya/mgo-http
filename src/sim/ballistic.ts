/**
 * 投げた物の飛び方。
 *
 * 重力で落ちて、地形に当たったら跳ねて、やがて止まる。three.js に依存しないので
 * サーバーがそのまま読む。
 *
 * --- なぜ共有するか ---
 * 手榴弾は**サーバーが飛ばして、サーバーが爆発を決める**。それでいて飛んでいる姿は
 * 各クライアントが描く。位置を毎フレーム配らずに済ませるには、**同じ初速から
 * 同じ軌道が出る**ことが要る。
 *
 * これまでの `thrown.ts` は描画メッシュへ three の raycast を撃っていた。
 * サーバーは箱 (stage.json) しか持っていないので、そのままでは同じ道を通らない。
 * 見えている場所と爆発する場所がずれる。
 *
 * 刻みを固定してあるのも同じ理由。フレーム間隔で解くと端末ごとに軌道が食い違い、
 * 跳ねるたびに差が開いて別の場所へ落ちる。
 */

import type { StageBox } from './vision'
import { segmentHitsBox } from './vision'

/** 物理を進める刻み (秒)。誰が解いても同じ道を通るよう固定する */
export const FIXED_STEP = 1 / 60

/** 重力 (m/s²) */
const GRAVITY = 9.8

/** 面から浮かせる量 (m)。めり込んで見えないようにする */
const SURFACE_OFFSET = 0.02

/**
 * 地面の高さ (m)。
 *
 * 地面は stage.json の箱に入っていない (コード側で敷いている平面なので)。
 * 箱だけを見ていると、開けた場所へ投げた物が落ち続けて地面の下で爆発する。
 */
const GROUND_Y = 0

export interface ThrowTuning {
  /** 跳ね返りで面に垂直な速度がどれだけ残るか */
  restitution: number
  /** 面に沿う速度がどれだけ残るか。1 なら滑り続ける */
  friction: number
  /** これ以下の速さで止まったとみなす (m/s) */
  restSpeed: number
  /** 跳ねる回数の上限。無限に細かく跳ね続けるのを防ぐ */
  maxBounces: number
}

export const DEFAULT_THROW: ThrowTuning = {
  restitution: 0.36,
  friction: 0.72,
  restSpeed: 1.1,
  maxBounces: 3,
}

export interface Projectile {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  bounces: number
  /** 止まったか */
  resting: boolean
}

/** 1 刻み進める。当たったら跳ねる */
export function stepProjectile(
  p: Projectile,
  boxes: StageBox[],
  tuning: ThrowTuning = DEFAULT_THROW,
): void {
  if (p.resting) return

  p.vy -= GRAVITY * FIXED_STEP
  const nx = p.x + p.vx * FIXED_STEP
  const ny = p.y + p.vy * FIXED_STEP
  const nz = p.z + p.vz * FIXED_STEP

  let hit = sweep(p.x, p.y, p.z, nx, ny, nz, boxes)

  // 地面。箱より手前で跨ぐならそちらを採る
  if (ny < GROUND_Y && p.y >= GROUND_Y) {
    const t = (GROUND_Y - p.y) / (ny - p.y)
    if (!hit || t < hit.t) {
      hit = { t, x: p.x + (nx - p.x) * t, y: GROUND_Y, z: p.z + (nz - p.z) * t, nx: 0, ny: 1, nz: 0 }
    }
  }

  if (!hit) {
    p.x = nx
    p.y = ny
    p.z = nz
    return
  }

  // 当たった面の少し手前へ置く
  p.x = hit.x + hit.nx * SURFACE_OFFSET
  p.y = hit.y + hit.ny * SURFACE_OFFSET
  p.z = hit.z + hit.nz * SURFACE_OFFSET

  // 面に垂直な成分と、沿う成分に分ける
  const into = p.vx * hit.nx + p.vy * hit.ny + p.vz * hit.nz
  const tx = p.vx - hit.nx * into
  const ty = p.vy - hit.ny * into
  const tz = p.vz - hit.nz * into

  p.vx = tx * tuning.friction - hit.nx * into * tuning.restitution
  p.vy = ty * tuning.friction - hit.ny * into * tuning.restitution
  p.vz = tz * tuning.friction - hit.nz * into * tuning.restitution

  p.bounces++
  const speed = Math.hypot(p.vx, p.vy, p.vz)
  if (p.bounces >= tuning.maxBounces || speed < tuning.restSpeed) {
    p.resting = true
    p.vx = 0
    p.vy = 0
    p.vz = 0
  }
}

interface Hit {
  /** 線分のどこで当たったか (0..1) */
  t: number
  x: number
  y: number
  z: number
  /** 当たった面の法線 */
  nx: number
  ny: number
  nz: number
}

/**
 * 線分で箱を掃く。最初に当たった面を返す。
 *
 * 点の位置だけを見ると、速い物が薄い床をすり抜ける。1 刻みで進む距離のほうが
 * 床の厚みより長くなるため。線分で見れば通り抜けは起きない。
 */
function sweep(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: StageBox[],
): Hit | null {
  let best = Infinity
  let axis = -1
  let sign = 0

  for (const box of boxes) {
    // 移動を止めない面は通り抜ける (金網の上に乗らない、など)
    if (box.flags?.player === false) continue

    const enter = entryOf(ax, ay, az, bx, by, bz, box)
    if (!enter || enter.t >= best) continue
    // 上面が傾いていても、跳ねる向きは箱の面で決める。楔の斜面まで見ると
    // 転がりが読めなくなるので、そこは割り切る
    best = enter.t
    axis = enter.axis
    sign = enter.sign
  }

  if (axis < 0) return null
  return {
    t: best,
    x: ax + (bx - ax) * best,
    y: ay + (by - ay) * best,
    z: az + (bz - az) * best,
    nx: axis === 0 ? sign : 0,
    ny: axis === 1 ? sign : 0,
    nz: axis === 2 ? sign : 0,
  }
}

/** 線分が箱へ入る位置と、そのとき跨いだ面 */
function entryOf(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: StageBox,
): { t: number; axis: number; sign: number } | null {
  // 交差そのものは既存の判定を使う。細かい取り方が 2 つあると必ずずれる
  if (!segmentHitsBox(ax, ay, az, bx, by, bz, box)) return null

  // 始点が既に箱の中なら、この箱は無視する。
  //
  // 壁に密着して投げると、手を離れる位置が壁の内側に入ることがある。
  // そこで「当たった」ことにすると、中で跳ね続けて足元に落ちる。
  // 出るまで素通りさせるほうが、投げた本人の意図に近い。
  if (
    ax > box.min[0] && ax < box.max[0] &&
    ay > box.min[1] && ay < box.max[1] &&
    az > box.min[2] && az < box.max[2]
  ) {
    return null
  }

  const origin = [ax, ay, az]
  const delta = [bx - ax, by - ay, bz - az]
  // -Infinity から始める。0 から始めると、面にちょうど乗っている (t = 0 の) 軸が
  // 選ばれず、既定の軸の法線で跳ねる。実測した: 遮蔽の側面に触れた状態で投げると
  // 上向きの法線で跳ね返り、その場で 3 回跳ねて足元に落ちた
  let near = -Infinity
  let axis = -1
  let sign = 1

  for (let i = 0; i < 3; i++) {
    if (Math.abs(delta[i]) < 1e-9) continue
    const inv = 1 / delta[i]
    let t0 = (box.min[i] - origin[i]) * inv
    let t1 = (box.max[i] - origin[i]) * inv
    // t0 は min 側の面。その外向き法線は -1。入れ替えたら max 側になるので +1 になる。
    //
    // ここを delta の向きで決めると符号が逆になる。実測した: 箱の +z 面へ -z 方向から
    // 入ったとき法線が -z を向き、跳ね返りが箱の中へ押し込まれて同じ場所で
    // 跳ね続けた (3 回で力尽きて足元に落ちる)。
    let facing = -1
    if (t0 > t1) {
      const tmp = t0
      t0 = t1
      t1 = tmp
      facing = -facing
    }
    if (t0 > near) {
      near = t0
      axis = i
      sign = facing
    }
  }
  if (axis < 0) return null
  return { t: Math.max(0, Math.min(1, near)), axis, sign }
}
