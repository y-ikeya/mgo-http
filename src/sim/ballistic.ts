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
  /** 跳ねた瞬間、面に沿う速度がどれだけ残るか */
  friction: number
  /**
   * 転がっている間に速さが落ちる割合 (1 秒あたり)。
   *
   * 跳ねるときの摩擦とは別に持つ。同じ値を使うと、接地した途端に
   * 止まるか、いつまでも滑り続けるかのどちらかにしかならない。
   */
  rollFriction: number
  /** これ以下の速さで止まったとみなす (m/s) */
  restSpeed: number
  /**
   * 跳ね返りをやめて転がりに移る垂直方向の速さ (m/s)。
   *
   * これを入れないと、跳ねる高さが 0 に近づくにつれて 1 フレームに何度も
   * 接触するようになり、計算が細かくなるだけで見た目は震えて見える。
   */
  contactSpeed: number
}

/**
 * 投げた物の跳ね方。
 *
 * **跳ねるより転がる。** 手榴弾は「そこへ置きに行く」道具なので、着いた先から
 * 大きく跳ねると狙って落とす意味が薄くなる。落下点の印を見て放しているのに、
 * そこから 0.4m 跳ねて 2 秒転がっていた。
 *
 *     restitution 0.36 → 0.18   1 回目の跳ねが 0.39m → 0.11m
 *     friction    0.72 → 0.55   接地で横の勢いも削る
 *     rollFriction   7 → 11     止まるまで 2.18s → 1.05s
 *
 * 転がりを完全に殺さないのは、**階段や坂から落ちてくる**動きを残したいため。
 * 上の階へ投げ上げたつもりが縁で止まらずに戻ってくる、が起きるくらいが良い。
 */
export const DEFAULT_THROW: ThrowTuning = {
  restitution: 0.18,
  friction: 0.55,
  rollFriction: 11,
  restSpeed: 0.35,
  contactSpeed: 0.9,
}

/**
 * 投げ出す速さ (m/s)。
 *
 * サーバーが上限として使い、予測線もこれで引く。申告された速さは信じない。
 */
export const THROW_SPEED = 12

/**
 * 狙った向きより何度上へ投げるか。
 *
 * 狙いの向きそのままだと、水平に狙ったとき水平に飛ぶ。速いぶん低く伸びて、
 * 野球の送球のような射線になる。手榴弾は放物線で置きに行く物なので、
 * 常に上へ下駄を履かせて山なりにする。
 *
 * 狙う側は落下点の印を見て決めるので、向きと着地点がずれても困らない。
 */
const LOFT = (28 * Math.PI) / 180

/**
 * 狙った向きから初速を作る。
 *
 * **サーバーと予測線が同じ式を使う。** 別々に書くと、見えている軌道と
 * 実際に飛ぶ軌道が食い違う。
 *
 * @param dx 狙いの向き (正規化済み)
 */
export function throwVelocity(
  dx: number,
  dy: number,
  dz: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const flat = Math.hypot(dx, dz)
  // 真上か真下を向いている。下駄の履かせようが無いのでそのまま
  if (flat < 1e-6) {
    out.x = 0
    out.y = Math.sign(dy) * THROW_SPEED
    out.z = 0
    return out
  }

  // 真上を越えて後ろへ回らないよう頭打ちにする
  const pitch = Math.min(Math.atan2(dy, flat) + LOFT, (80 * Math.PI) / 180)
  const cos = Math.cos(pitch)
  out.x = (dx / flat) * cos * THROW_SPEED
  out.y = Math.sin(pitch) * THROW_SPEED
  out.z = (dz / flat) * cos * THROW_SPEED
  return out
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
  /** 面に接して転がっているか。跳ね返りが小さくなったらここへ移る */
  rolling?: boolean
}

/**
 * 1 刻み進める。
 *
 * 跳ねる → 転がる → 止まる、の 3 段。跳ね返りが小さくなったら転がりへ移り、
 * 転がっている間は重力を面に沿わせる。斜面に落とせば下る。
 */
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
    p.rolling = false
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

  // 面へ入る速さが小さければ、跳ねずに接している扱いにする。
  // ここを分けないと、跳ねる高さが 0 に近づくにつれて 1 フレームに何度も
  // 接触するようになり、震えて見えるだけで止まらない
  if (-into < tuning.contactSpeed) {
    // 跳ねた回数には数えない。**音を鳴らす回数**として使っているので、
    // 転がっている間の接触を数えると鳴りっぱなしになる。
    // (面から浮かせる 2cm ぶん、接地中も毎フレーム落ちて触れ直している)
    p.rolling = true

    // 重力から面に垂直な成分を抜く。残るのが面に沿う力。
    //
    // **ここが「坂を転がる」の中身**。水平な面なら全部が法線成分になって 0 に、
    // 斜面なら下り方向だけが残る。面の法線を見ていないと出てこない。
    const gDotN = -GRAVITY * hit.ny
    const vx = tx + (0 - hit.nx * gDotN) * FIXED_STEP
    const vy = ty + (-GRAVITY - hit.ny * gDotN) * FIXED_STEP
    const vz = tz + (0 - hit.nz * gDotN) * FIXED_STEP

    // 転がりの摩擦。速さに比例して落とす (指数減衰)。
    // 手榴弾は球ではないので、よく転がる物として扱わない
    const damping = Math.max(0, 1 - tuning.rollFriction * FIXED_STEP)
    p.vx = vx * damping
    p.vy = vy * damping
    p.vz = vz * damping

    if (Math.hypot(p.vx, p.vy, p.vz) < tuning.restSpeed) {
      p.resting = true
      p.vx = 0
      p.vy = 0
      p.vz = 0
    }
    return
  }

  // 跳ね返る
  p.rolling = false
  p.vx = tx * tuning.friction - hit.nx * into * tuning.restitution
  p.vy = ty * tuning.friction - hit.ny * into * tuning.restitution
  p.vz = tz * tuning.friction - hit.nz * into * tuning.restitution
  p.bounces++
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
  let best: Hit | null = null

  for (const box of boxes) {
    // 移動を止めない面は通り抜ける (金網の上に乗らない、など)
    if (box.flags?.player === false) continue

    const slope = box.top
    if (slope && (slope.dx !== 0 || slope.dz !== 0)) {
      // 上面が傾いている箱は**平面そのもの**で見る。
      //
      // AABB の出入りで見ると、坂の上に乗せた物が次の刻みで「箱の中から
      // 始まっている」ことになり、箱ごと無視されて地面まで落ちる。
      const hit = slopeEntry(ax, ay, az, bx, by, bz, box, slope)
      if (hit && (!best || hit.t < best.t)) best = hit
      continue
    }

    const enter = entryOf(ax, ay, az, bx, by, bz, box)
    if (!enter || (best && enter.t >= best.t)) continue
    best = {
      t: enter.t,
      x: ax + (bx - ax) * enter.t,
      y: ay + (by - ay) * enter.t,
      z: az + (bz - az) * enter.t,
      nx: enter.axis === 0 ? enter.sign : 0,
      ny: enter.axis === 1 ? enter.sign : 0,
      nz: enter.axis === 2 ? enter.sign : 0,
    }
  }

  return best
}

/**
 * 傾いた上面との交点。
 *
 * 上を斜めに切り落とした楔の、その斜面だけを見る。側面は見ない —
 * 坂は下から当たるものではなく、上に乗って転がるものなので。
 */
function slopeEntry(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: StageBox,
  slope: { h: number; dx: number; dz: number },
): Hit | null {
  const surfaceAt = (x: number, z: number) =>
    slope.h + slope.dx * (x - box.min[0]) + slope.dz * (z - box.min[2])

  // 面からの符号付き距離。上が +
  const above = ay - surfaceAt(ax, az)
  const below = by - surfaceAt(bx, bz)
  // 上から下へ跨いだときだけ当たり。下から上は通す (坂の裏側は素通り)
  if (above < 0 || below >= 0) return null

  const span = above - below
  const t = span > 1e-9 ? above / span : 0
  const x = ax + (bx - ax) * t
  const z = az + (bz - az) * t
  // 箱の外まで伸ばした平面に当たっても意味が無い
  if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) return null

  // 面 y = h + dx*(x-minX) + dz*(z-minZ) の法線は (-dx, 1, -dz)
  const length = Math.hypot(slope.dx, 1, slope.dz)
  return {
    t,
    x,
    y: surfaceAt(x, z),
    z,
    nx: -slope.dx / length,
    ny: 1 / length,
    nz: -slope.dz / length,
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
