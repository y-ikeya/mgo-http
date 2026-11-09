import { canAct } from './lifecycle'
import type { MatchPlayer } from './player'

/**
 * **敬礼で繋がる** (MGO2 の SOP に当たる)。
 *
 * 味方の位置はサーバーが配っているが、既定では映さない。**互いに手を挙げて初めて繋がる。**
 * 繋がった相手は壁越しに光り、暴いた情報 (EE の輪郭・TA / E LOCATOR の気配・AWARENESS) を
 * 分け合う (player.ts の leakReaches)。誰と組むかが自分で選んだものになる。
 *
 * 結ぶのも切るのもサーバー (server/link.ts)。画面が自分で結んでいた頃は、暴いた情報を
 * 誰に配るかをサーバーが決められなかった (2026-11-09)。
 *
 * **どちらかが倒れたら切れる** (本人 2026-11-09「buddy が先に死んだら自分の画面から buddy の
 * 発光が消える、自分が先に死んだら buddy の画面から自分が消える、リスポーン後も光っていない」)。
 * 眠らされただけでは切れない
 */

/** 敬礼を交わして繋がる距離 (m) */
export const LINK_RANGE = 5
/** 高さの差がこれより大きければ繋がらない (別の階) */
const LINK_RISE = 2

/** 手を挙げたままか。敬礼の型 (立ち・しゃがみ) で、手を保っている */
export function holdingSalute(player: Pick<MatchPlayer, 'locomotion' | 'saluteHeld'>): boolean {
  return (player.locomotion === 'salute' || player.locomotion === 'crouch_salute') && player.saluteHeld
}

/**
 * 2 人がいま繋がれるか。**味方かどうかは呼ぶ側** (部屋のルールで決まる、room.ts の isHostile)
 */
export function canLink(a: MatchPlayer, b: MatchPlayer): boolean {
  if (a.id === b.id || a.bot || b.bot) return false
  if (!canAct(a.life) || !canAct(b.life)) return false
  if (!holdingSalute(a) || !holdingSalute(b)) return false
  if (Math.abs(a.y - b.y) > LINK_RISE) return false
  return Math.hypot(a.x - b.x, a.z - b.z) <= LINK_RANGE
}
