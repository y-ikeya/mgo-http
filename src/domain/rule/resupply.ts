import type { Spot } from '../stage'

/**
 * 補給。**自分の陣営の基地の上で、弾と支援を満タンに戻す。**
 *
 * 装備は替えられない (それは湧くときだけ)。戻すのは持っている物の弾と支援の数。
 * 基地まで戻る、という代償を払えば撃ち尽くしても続けられる — 弾を数える
 * 意味は残しつつ、切れたら死ぬしかない、にはしない。
 */

/** 基地の中心からこの距離 (m) の中に立っていれば補給できる。基地の天板は 6m 角 */
export const RESUPPLY_RADIUS = 3.5

/** 基地の床からこの高さ (m) の幅の中に居ること。天板の下 (水面) から届かないように */
export const RESUPPLY_HEIGHT = 2

/** 続けて補給できる間隔 (ms)。押しっぱなしで連打されないため */
export const RESUPPLY_COOLDOWN_MS = 1500

/** その場所が基地の上か */
export function atBase(x: number, y: number, z: number, base: Spot): boolean {
  const flat = Math.hypot(x - base.x, z - base.z)
  if (flat > RESUPPLY_RADIUS) return false
  return Math.abs(y - (base.y ?? 0)) <= RESUPPLY_HEIGHT
}
