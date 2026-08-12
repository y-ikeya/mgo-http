/**
 * 体を動かす規則。
 *
 * 速度・重力・接地・押し戻しをここに集める。three.js に依存しないので、
 * サーバー (bun) がこのファイルをそのまま読める。
 *
 * --- なぜ切り出すか ---
 * いま移動を持っているのはクライアントだけで、サーバーは送られてきた座標を
 * そのまま信じている。速度の上限も壁抜けの検査も無い。
 *
 * サーバーが自分で動かせるようにするには、**同じ規則が両側で同じ結果を出す**
 * 必要がある。移植して 2 か所に書くと必ずどちらかがずれるので、1 本にして
 * 両方が読む。damage / vision / footsteps と同じ扱い。
 */

import type { Vec3 } from './collision'

/**
 * 世界の側。障害物の表現をここで隠す。
 *
 * いまは XZ の AABB だが、三角形メッシュに変わってもこの口は変わらない。
 * サーバーは stage.json から、クライアントは glb から、それぞれ同じ形で用意する。
 */
export interface MoveWorld {
  /** 位置を障害物の外へ押し戻す */
  resolveHorizontal(position: Vec3, radius: number, feetY: number): void
  /** その位置で足が着く高さ */
  groundHeight(position: Vec3, radius: number, feetY: number): number
}

/** 移動する体。呼ぶ側が持ち、この関数が書き換える */
export interface Mover {
  position: Vec3
  /** 上下の速度 (m/s)。落下と着地に使う */
  velocityY: number
  /** 地面に足が着いているか */
  onGround: boolean
  /** 地面を離れた瞬間の水平の勢い。空中はこれで進む */
  airX: number
  airZ: number
}

/** そのフレームに何をするか */
export interface MoveCommand {
  /** ワールド基準の移動方向 (正規化済み)。止まっているなら 0 */
  dirX: number
  dirZ: number
  /** 今フレームの水平速度 (m/s)。姿勢や構えの倍率は掛けた後の値を渡す */
  speed: number
  /**
   * 速度を外から与える (m/s)。ローリングのようにクリップの移動を辿る動作用。
   *
   * 入力からではなく再生中のクリップから決まるので、ここへ渡してもらう。
   * 移動の規則そのものは同じものを通す。
   */
  overrideX?: number
  overrideZ?: number
}

export interface MoveTuning {
  radius: number
  gravity: number
  /** 下降中に重力へ掛ける倍率。上りは素、落ちるのは速く */
  fallGravityScale: number
  /** 空中で入力が効く割合 (0..1) */
  airControl: number
}

export interface MoveResult {
  /** このフレームで着地したか */
  landed: boolean
  /** 着地したときの落下速度 (m/s)。着地音や着地モーションの判断に使う */
  impactSpeed: number
  /** 実際に進んだ水平距離を dt で割ったもの (m/s) */
  actualSpeed: number
}

/**
 * 1 フレーム進める。
 *
 * 判定の基準は**このフレームを始めた時点の足元の高さ**で統一する。
 * 移動後の高さを使うと、壁に触れた瞬間に上へ吸い上げられる。
 */
export function stepMovement(
  mover: Mover,
  command: MoveCommand,
  world: MoveWorld,
  tuning: MoveTuning,
  dt: number,
): MoveResult {
  const position = mover.position
  const feetY = position.y
  const startX = position.x
  const startZ = position.z
  const wasGrounded = mover.onGround

  // --- 水平 ---
  let vx: number
  let vz: number
  if (command.overrideX !== undefined || command.overrideZ !== undefined) {
    vx = command.overrideX ?? 0
    vz = command.overrideZ ?? 0
  } else if (wasGrounded) {
    vx = command.dirX * command.speed
    vz = command.dirZ * command.speed
  } else {
    // 空中は踏み切った時点の勢いで進む
    vx = mover.airX
    vz = mover.airZ
    if (tuning.airControl > 0) {
      vx += (command.dirX * command.speed - vx) * tuning.airControl
      vz += (command.dirZ * command.speed - vz) * tuning.airControl
    }
  }

  position.x += vx * dt
  position.z += vz * dt
  world.resolveHorizontal(position, tuning.radius, feetY)

  // --- 上下 ---
  // 上昇中は素の重力、下降中は倍率を掛ける
  mover.velocityY -=
    tuning.gravity * (mover.velocityY <= 0 ? tuning.fallGravityScale : 1) * dt
  position.y += mover.velocityY * dt

  const ground = world.groundHeight(position, tuning.radius, feetY)
  const wasAirborne = !mover.onGround
  let landed = false
  let impactSpeed = 0

  if (position.y <= ground) {
    position.y = ground
    // 速度を消す前に衝撃の大きさを控える
    impactSpeed = -mover.velocityY
    mover.velocityY = 0
    mover.onGround = true
    landed = wasAirborne
  } else {
    mover.onGround = false
    // 地面を離れたフレームの速度を空中の勢いとして持ち込む。
    // ジャンプでも段差から歩いて落ちた場合でも同じ扱いになる。
    if (wasGrounded) {
      mover.airX = vx
      mover.airZ = vz
    }
  }

  // 速度は水平成分だけを見る。落下中に「移動している」と判定されないように
  const actualSpeed =
    dt > 0 ? Math.hypot(position.x - startX, position.z - startZ) / dt : 0

  return { landed, impactSpeed, actualSpeed }
}
