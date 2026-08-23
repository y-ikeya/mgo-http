import * as THREE from 'three'
import { damp } from '../util/math'
import { randomSigned, randomUnit, RandomStream } from '../util/random'
import type { WeaponSpec } from '../../../domain/item/weapons'

/** 上と前。散布の軸を作るのに使う (真上を向いたときの基準切り替え) */
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const WORLD_FORWARD = new THREE.Vector3(0, 0, -1)

/**
 * 散布と反動。**狙った所に飛ばない量。**
 *
 * 撃ち合いの手触りはここで決まる — 走りながら撃てば散り、連射すれば跳ね上がる。
 * どちらも「止まって撃つほうが当たる」を作るためにあり、それが MGO2 の
 * **動かない側が有利**という形に繋がっている。
 *
 * --- なぜ Game から出したか ---
 * 自分の状態 (何発目か / いつ撃ったか / 姿勢でどれだけ散っているか) を持つ
 * 小さな機械で、外から要るのは「いま何度散るか」と「向きをずらす」の 2 つだけ。
 * Game に置いておくと、3000 行の中に散らばった 4 つの値として読むことになる。
 *
 * 武器ごとの数字は domain (item/weapons.ts)。ここは受け取って使うだけ。
 */

/**
 * 反動のパターン (度)。[上方向, 右方向] を 1 発ごとに並べたもの。
 *
 * 乱数を使わないのは意図的で、理由が 2 つある。
 *  - 覚えれば押さえ戻せるので、技量が結果に反映される
 *  - 決定的なのでサーバー権威に移しても計算が一致する。乱数だと
 *    「クライアントが思っている弾道」と「サーバーの判定」がずれる
 *
 * 最初の 1 発が最も強く、以降は落ち着く。左右は交互に振れて一直線に登らせない。
 * 弾数がこの表を超えたら最後の値を使い続ける。
 */
const RECOIL_PATTERN: readonly (readonly [number, number])[] = [
  [0.95, 0.0],
  [0.85, -0.12],
  [0.75, 0.2],
  [0.68, -0.26],
  [0.6, 0.32],
  [0.55, 0.24],
  [0.5, -0.3],
  [0.48, -0.38],
  [0.45, 0.28],
  [0.44, 0.34],
  [0.42, -0.32],
  [0.4, -0.24],
];

/** これだけ撃たない時間が続いたらパターンを頭に戻す (秒) */
const BURST_RESET_TIME = 0.35;

/**
 * 反動に乗せる乱れ。完全に固定だとマウスマクロで打ち消せてしまうため、
 * 大枠は覚えられるが完全な再現はできない程度に散らす。
 */
const RECOIL_PITCH_JITTER = 0.15;

/** 左右の乱れ (度)。パターン値が 0 の弾もあるので倍率ではなく加算 */
const RECOIL_YAW_JITTER = 0.08;

/**
 * 姿勢由来の散布が落ち着く速さ。
 * 即座に 0 に戻ると「止まった瞬間に撃つ」だけで精度が得られてしまう。
 * 一拍置く必要があることで、遮蔽に入って落ち着ける動作に意味が出る。
 */
const SPREAD_SETTLE_LAMBDA = 5;

/** 撃った瞬間に渡すもの。乱数の種にする */
export interface Shot {
  /** 通し番号。**種が同じなら同じ散り方**になる (サーバーと合わせるため) */
  seed: number
}

export class Spread {
  /** 連射の何発目か。撃たない時間が続けば頭に戻る */
  private burst = 0
  /** 最後に撃ってからの時間 (秒) */
  private sinceShot = BURST_RESET_TIME
  /** 姿勢由来の散布 (度)。移動と立ち座りで上がる */
  private posture = 0

  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()

  /** 連射を頭に戻す。持ち替えや湧き直しで呼ぶ */
  reset(): void {
    this.burst = 0
  }

  /**
   * 姿勢由来の散布を進める。
   *
   * **上がるのは即座、戻るのは遅い。** 狙いが乱れるのは動いた瞬間であって、
   * 一拍置いてからではない。両方を均すと、立ち座りのような一瞬の乱れが
   * 平らに均されて何も起きなくなる (実測で 0.83 度が 0.23 度まで潰れていた)。
   */
  update(
    dt: number,
    weapon: WeaponSpec,
    posture: { speed: number; stanceRate: number; crouching: boolean; grounded: boolean },
  ): void {
    this.sinceShot += dt
    if (this.sinceShot >= BURST_RESET_TIME) this.burst = 0

    const moving = posture.speed * weapon.spreadPerSpeed
    // 姿勢を変えている間も散る。頭の高さが変わることは、このゲームでは
    // 移動と同じ重みを持つ (遮蔽を越えるかがそれで決まる)。ここが只だと、
    // 止まったまましゃがみ連打で頭だけ上下させるのが一番安い覗き方になる。
    const changing = posture.stanceRate * weapon.spreadPerStance
    const target = posture.grounded
      ? moving * (posture.crouching ? weapon.spreadCrouchScale : 1) + changing
      : weapon.spreadAirborne
    this.posture = Math.max(target, damp(this.posture, target, SPREAD_SETTLE_LAMBDA, dt))
  }

  /** 現在の散布界 (度)。連射で広がる分と、姿勢で広がる分の合計 */
  degrees(weapon: WeaponSpec): number {
    return Math.min(this.burst * weapon.spreadPerShot + this.posture, weapon.spreadMax)
  }

  /** 照準方向を散布界の円錐内へずらす。dir は正規化済みで、破壊的に書き換える */
  apply(dir: THREE.Vector3, weapon: WeaponSpec, shot: Shot): void {
    const spread = this.degrees(weapon)
    if (spread <= 0) return

    // 円内に一様分布させる。半径に sqrt を掛けないと中心に偏る
    const angle = randomUnit(shot.seed, RandomStream.spreadAngle) * Math.PI * 2
    const radius =
      Math.sqrt(randomUnit(shot.seed, RandomStream.spreadRadius)) *
      Math.tan(THREE.MathUtils.degToRad(spread))

    // 照準方向に直交する 2 軸を作る。真上を向いているときは基準を切り替える
    const up = Math.abs(dir.y) > 0.99 ? WORLD_FORWARD : WORLD_UP
    this.right.crossVectors(dir, up).normalize()
    this.up.crossVectors(this.right, dir)

    dir
      .addScaledVector(this.right, Math.cos(angle) * radius)
      .addScaledVector(this.up, Math.sin(angle) * radius)
      .normalize()
  }

  /**
   * 撃った。**反動は撃った「後」に加える** — この一発はまだ狙った向きへ飛ぶ。
   *
   * @returns カメラへ加える跳ね上がり (rad)。[上, 右]
   */
  fired(shot: Shot): [number, number] {
    const [pitch, yaw] = RECOIL_PATTERN[Math.min(this.burst, RECOIL_PATTERN.length - 1)]
    const kickPitch =
      pitch * (1 + RECOIL_PITCH_JITTER * randomSigned(shot.seed, RandomStream.recoilPitch))
    const kickYaw = yaw + RECOIL_YAW_JITTER * randomSigned(shot.seed, RandomStream.recoilYaw)
    this.burst++
    this.sinceShot = 0
    return [THREE.MathUtils.degToRad(kickPitch), THREE.MathUtils.degToRad(kickYaw)]
  }
}
