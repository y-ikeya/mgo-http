/**
 * 散布と反動。**狙った所に飛ばない量。**
 *
 * 撃ち合いの手触りはここで決まる — 走りながら撃てば散り、連射すれば跳ね上がる。
 * どちらも「**止まって撃つほうが当たる**」を作るためにあり、それが MGO2 の
 * 「接敵したら撃ち合い、動かない側が有利」という形に繋がっている。
 *
 * --- なぜ規則なのか ---
 * ここに在る数字は、変えれば**プレイヤーの判断が変わる**。連射のパターンを
 * 変えれば押さえ方が変わり、落ち着く速さを変えれば遮蔽に入る意味が変わる。
 * 壊れたときに「バグ」ではなく「ルール変更」と呼ぶ側なので domain。
 *
 * --- なぜ three を知らないのか ---
 * **サーバーが同じ計算をできるようにするため。** 乱数を種から引いているのも、
 * 反動を表で持っているのも、撃った本人とサーバーが独立に同じ弾を再現できる
 * ようにするためで、three に触っているとその道が塞がる。
 *
 * 向きを実際にずらす幾何は sim (space/aim.ts)。**こちらは「何度散るか」と
 * 「円のどこへ散るか」までを決めて、傾ける手続きには渡すだけ。**
 */

import { randomSigned, randomUnit, RandomStream } from '../rule/random'
import {
  masteryJitterScale,
  masterySpreadScale,
  masterySwayScale,
  type Skills,
} from '../player/skill'
import type { WeaponSpec } from './weapons'

/**
 * 反動のパターン (度)。[上方向, 右方向] を 1 発ごとに並べたもの。
 *
 * 乱数を使わないのは意図的で、理由が 2 つある。
 *  - **覚えれば押さえ戻せる**ので、技量が結果に反映される
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
]

/**
 * これだけ撃たない時間が続いたらパターンを頭に戻す (秒)。
 *
 * **バースト射撃が意味を持つのはこのため。** 押しっぱなしより、区切って撃つ
 * ほうが当たる、という選択が生まれる。
 */
const BURST_RESET_TIME = 0.35

/**
 * 反動に乗せる乱れ。
 *
 * 完全に固定だと**マウスマクロで打ち消せてしまう**ため、大枠は覚えられるが
 * 完全な再現はできない程度に散らす。
 */
const RECOIL_PITCH_JITTER = 0.15

/** 左右の乱れ (度)。パターン値が 0 の弾もあるので倍率ではなく加算 */
const RECOIL_YAW_JITTER = 0.08

/**
 * 姿勢由来の散布が落ち着く速さ。
 *
 * 即座に 0 に戻ると「**止まった瞬間に撃つ**」だけで精度が得られてしまう。
 * 一拍置く必要があることで、遮蔽に入って落ち着ける動作に意味が出る。
 */
const SPREAD_SETTLE_LAMBDA = 5

const DEG_TO_RAD = Math.PI / 180

/**
 * フレームレート非依存の指数補間。
 *
 * presentation の util から借りずに置いてあるのは、**下の層は上を読めない**ため。
 * 1 行なので写しの管理費より安い。
 */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/** 散布に効く体の状態。**意思ではなく、いまどうなっているか** */
export interface Posture {
  /** 水平の速さ (m/s) */
  speed: number
  /** 姿勢が変わっている速さ。しゃがみ連打を只にしないために要る */
  stanceRate: number
  crouching: boolean
  grounded: boolean
}

/** 円錐の中のどこへ散らすか。**幾何 (sim/space/aim.ts) へ渡す** */
export interface Cone {
  /** 散布界の半角 (度) */
  degrees: number
  /** 円周のどこか (0..1) */
  angle01: number
  /** 中心からの遠さ (0..1) */
  radius01: number
}

export class Spread {
  /** 連射の何発目か。撃たない時間が続けば頭に戻る */
  private burst = 0
  /** 最後に撃ってからの時間 (秒) */
  private sinceShot = BURST_RESET_TIME
  /** 姿勢由来の散布 (度)。移動と立ち座りで上がる */
  private posture = 0
  /** 構えてからの通算時間 (秒)。手ブレの位相をここから出す */
  private age = 0

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
  update(dt: number, weapon: WeaponSpec, posture: Posture): void {
    this.age += dt
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

  /**
   * 現在の散布界 (度)。連射で広がる分と、姿勢で広がる分の合計。
   *
   * **極めた銃だけ締まる。** 倍率は合計に掛ける — 手ブレにも連射の広がりにも
   * 同じだけ効く。動きながらの乱れだけ、あるいは連射の開きだけを締めると、
   * 「極めた人はこの撃ち方が得」という偏りが生まれて、銃の性格が人によって
   * 変わってしまう。**速くなるのではなく、同じ銃が素直になる。**
   *
   * 上限 (spreadMax) を掛けたあとに当てるのは、極めても銃の限界は動かないため。
   */
  degrees(weapon: WeaponSpec, skills: Skills): number {
    const raw = this.burst * weapon.spreadPerShot + this.posture
    return Math.min(raw * masterySpreadScale(skills, weapon.id), weapon.spreadMax)
  }

  /**
   * いまの手ブレ。**照準そのものをどれだけ動かすか** (度)。
   *
   * @returns [右へ, 上へ]。符号つき
   *
   * --- なぜ乱数を使わないか ---
   * 乱数で毎フレーム跳ばすと、照準が震えるだけで**次にどちらへ行くか読めない**。
   * 読めなければ待つ意味が無く、結局は運になる。周期の違う波を重ねると、
   * 滑らかに泳ぎながら同じ形を繰り返さない — **見ていれば折り返しが読める**ので、
   * 落ち着いた瞬間に撃つという手が成立する。
   *
   * 周期は 2 つの軸で揃えていない (0.9/2.3 と 0.7/1.9)。揃えると斜めの直線を
   * 往復するだけになって、円を描かない。
   *
   * --- 何で縮むか ---
   * しゃがみ (spreadCrouchScale) と、その銃の MASTERY。**Lv3 なら完全に止まる**
   * (masterySwayScale)。極めた銃は構えれば止まる、というのがこのスキルの
   * 手触りになる。
   *
   * **動いていても増えない。** 走りながらの乱れは散布 (degrees) が持っていて、
   * 二重に掛ける理由が無い。
   */
  sway(weapon: WeaponSpec, skills: Skills, posture: Posture): [number, number] {
    const amplitude =
      weapon.sway *
      masterySwayScale(skills, weapon.id) *
      (posture.crouching ? weapon.spreadCrouchScale : 1)
    if (amplitude <= 0) return [0, 0]
    const t = this.age
    const right = Math.sin(t * 0.9) * 0.62 + Math.sin(t * 2.3 + 1.7) * 0.28
    const up = Math.sin(t * 0.7 + 2.1) * 0.62 + Math.sin(t * 1.9 + 0.4) * 0.28
    return [right * amplitude, up * amplitude]
  }

  /**
   * その弾がどこへ散るか。
   *
   * **種から引く。** 同じ通し番号なら同じ所へ散るので、サーバーが独立に
   * 再現できる (rule/random.ts)。
   */
  coneFor(weapon: WeaponSpec, seed: number, skills: Skills): Cone {
    return {
      degrees: this.degrees(weapon, skills),
      angle01: randomUnit(seed, RandomStream.spreadAngle),
      radius01: randomUnit(seed, RandomStream.spreadRadius),
    }
  }

  /**
   * 撃った。**反動は撃った「後」に加える** — この一発はまだ狙った向きへ飛ぶ。
   *
   * --- 極めても反動そのものは減らない ---
   * 動かすのは**乱れ** (JITTER) だけで、パターン (RECOIL_PATTERN) には触らない。
   * 跳ね上がる量が同じまま予測できるようになる = **表を覚えて押さえ戻せる度合い**
   * が上がる。反動自体を弱めると「上手くなくても当たる」ほうへ倒れて、
   * 技量が効く余地を潰すことになる。
   *
   * 0 にはしないので (MASTERY_JITTER の Lv3 が 0.4)、極めてもマクロでは
   * 打ち消せない。
   *
   * @returns 視点へ加える跳ね上がり (rad)。[上, 右]
   */
  fired(seed: number, weapon: WeaponSpec, skills: Skills): [number, number] {
    const [pitch, yaw] = RECOIL_PATTERN[Math.min(this.burst, RECOIL_PATTERN.length - 1)]
    const jitter = masteryJitterScale(skills, weapon.id)
    const kickPitch =
      pitch * (1 + RECOIL_PITCH_JITTER * jitter * randomSigned(seed, RandomStream.recoilPitch))
    const kickYaw = yaw + RECOIL_YAW_JITTER * jitter * randomSigned(seed, RandomStream.recoilYaw)
    this.burst++
    this.sinceShot = 0
    return [kickPitch * DEG_TO_RAD, kickYaw * DEG_TO_RAD]
  }
}
