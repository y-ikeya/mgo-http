import * as THREE from 'three'

/**
 * 弾道。まっすぐ飛ばず、距離に応じて落ちる。
 *
 * 遠距離で狙点より下に当たることで、「距離を読む」という判断が生まれる。
 * 近距離では効かない (実測で 25m なら 2cm) ので、撃ち合いの大半は今までと同じ。
 *
 * 実装は放物線を折れ線で近似して、区間ごとに交差を調べる方式。
 * 弾を実体として飛ばして毎フレーム進める方式もあるが、そちらは着弾までの時間が
 * 生まれる ぶん、撃った瞬間に結果が決まらない。ラグ補正をサーバー側に持つまでは、
 * 撃った側の画面で即座に決まるほうが食い違いが少ない。
 */

/**
 * 初速 (m/s)。
 *
 * 実銃の AK-47 は 715 m/s だが、それだと 80m で 6cm しか落ちず、
 * 落ちていることが読み取れない。ステージが 80m 四方であることに合わせて、
 * 端から端で 20cm ほど落ちる速さに寄せてある。
 * 現実の値より「距離が判断になる」ことを優先した。
 */
export const BULLET_SPEED = 420

/** 弾に掛かる重力 (m/s²)。落差を強調したいときはここを上げる */
export const BULLET_GRAVITY = 9.8

/**
 * 折れ線の分割数。
 *
 * 区間内で曲線とのずれは最大でも g·Δt²/8 で、200m を 12 分割なら 3mm。
 * 判定に影響しない一方、区間ごとに raycast するので費用は分割数に比例する。
 */
export const TRAJECTORY_STEPS = 12

/**
 * 発射から t 秒後の、銃口からの相対位置。
 *
 * @param dir 発射方向 (正規化済み)
 */
export function trajectoryOffset(
  dir: THREE.Vector3,
  t: number,
  gravity: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.copy(dir).multiplyScalar(BULLET_SPEED * t)
  out.y -= 0.5 * gravity * t * t
  return out
}

/** 指定の距離まで飛ぶのにかかる時間 (秒) */
export function flightTime(range: number): number {
  return range / BULLET_SPEED
}
