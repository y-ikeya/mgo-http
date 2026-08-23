/**
 * その人が何を持てるか。**申告を鵜呑みにしないための規則。**
 *
 * 持ち物を並べて選ぶのも、いま手に何があるかを決めるのもクライアントで、
 * サーバーはそれを**受け取る**側。そのまま書き込むと「ナイフを選んだことに
 * して狙撃銃を撃つ」が形の上では通ってしまう。
 *
 * ここに置くのは「持てるか」の規則だけ。**持ち替えに時間がかかる**
 * (item/held.ts の SWITCH_TIME) の管理はまだクライアントにしかない。
 */

import { HELD, type HeldId } from '../item/held'
import { SUPPORT_SPECS, WEAPONS, type SupportId, type WeaponId } from '../item/weapons'
import type { Player } from './player'

/** 支度で選べる主武器か。**受け取った文字列を信じない** */
export function isPrimaryChoice(id: string): id is WeaponId {
  return WEAPONS[id as WeaponId]?.slot === 'primary'
}

/** 支度で選べる支援か */
export function isSupportChoice(id: string): id is SupportId {
  return SUPPORT_SPECS[id as SupportId] !== undefined
}

/**
 * 誰でも最初から持っている物。
 *
 * ナイフとダンボールは選ばない。拳銃も枠が 1 つしか無いので固定
 * (item/held.ts の Loadout)。
 */
const ALWAYS: ReadonlySet<HeldId> = new Set<HeldId>(['none', 'knife', 'box', 'pistol'])

/**
 * その物を手にできるか。
 *
 * 選んだ主武器と支援、最初から持っている物、そして**拾った物**。落ちている
 * 銃は誰でも拾えるので、選んでいない銃を持っていること自体はおかしくない —
 * 拾ったという記録がサーバー側にあるかどうかで見分ける。
 *
 * 弾倉の囮 (magazine) は撃っているうちに増える物なので通す。数はクライアント
 * が数えている。
 */
export function canHold(player: Player, id: HeldId): boolean {
  if (HELD[id] === undefined) return false
  if (ALWAYS.has(id)) return true
  if (id === 'magazine') return true
  if (id === 'grenade' || id === 'claymore') return player.support === id
  if (id === player.primary) return true
  return player.carried.includes(id)
}

/**
 * 支度で選び直す。**通ったら true。**
 *
 * 生きている間に選び直すのは通す。効くのは次に湧いたときで、いま手にある物は
 * 変わらない (Player の primary は「繋ぎ直したときに返すため」の控え)。
 * **支度中だけはすぐ効かせる** — 次の湧きを待つと、選び直した分が 1 つ遅れる。
 */
export function chooseLoadout(
  player: Player,
  primary: string,
  support: string,
  choosing: boolean,
): boolean {
  if (!isPrimaryChoice(primary) || !isSupportChoice(support)) return false
  player.primary = primary
  player.support = support
  if (choosing) player.grenades = SUPPORT_SPECS[support].count
  return true
}
