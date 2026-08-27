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
import { canChooseSkills, isAffordable, type Skills } from './skill'
import type { Phase } from '../match/match'

/** 支度で選べる主武器か。**受け取った文字列を信じない** */
export function isPrimaryChoice(id: string): id is WeaponId {
  return WEAPONS[id as WeaponId]?.slot === 'primary'
}

/** 支度で選べる支援か */
export function isSupportChoice(id: string): id is SupportId {
  return SUPPORT_SPECS[id as SupportId] !== undefined
}

/**
 * その物を手にできるか。**持ち物に在るかどうか、それだけ。**
 *
 * 選んだ物にも拾った物にも特例を作らない。特例を作っていた頃は、**主武器を
 * 地面に置いても「持っている」ままだった** — 置いた銃を他人に拾わせながら、
 * 自分もその銃として撃てる (複製)。捨てる = 一覧から外れる、を一様にする。
 *
 * 手ぶら (none) と弾倉の囮 (magazine) だけは通す。囮は撃っているうちに増える
 * 物で、数はクライアントが数えている。
 */
export function canHold(player: Player, id: HeldId): boolean {
  if (HELD[id] === undefined) return false
  if (id === 'none' || id === 'magazine') return true
  return player.inventory.has(id)
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
  if (choosing) {
    player.grenades = SUPPORT_SPECS[support].count
    // 支度中は持ち物も選び直したものに揃える。湧いてからは refill が組み直す
    player.inventory.refill({
      primary: player.primary,
      secondary: 'pistol',
      support: player.support,
    })
  }
  return true
}

/**
 * スキルを選び直す。**通ったら true。**
 *
 * --- 装備とは粒度が違う ---
 *
 *     装備    1 つの命ごと (chooseLoadout)
 *     スキル  **1 試合に 1 度。** 始まったら固定
 *
 * 倒されるたびに組み替えられると、相手を見てから後出しするゲームになる
 * (skill.ts の canChooseSkills に理由)。
 *
 * --- 2 つとも弾く ---
 *
 *     窓が閉じている        走っている試合の最中
 *     予算を超えている      知らない名前・段の外れた値も含む
 *
 * どちらも**黙って一部だけ通さない**。半分だけ効いた状態を本人に説明できない。
 */
export function chooseSkills(player: Player, skills: unknown, phase: Phase): boolean {
  if (!canChooseSkills(phase)) return false
  if (skills === null || typeof skills !== 'object') return false
  if (!isAffordable(skills as Skills)) return false
  player.skills = skills as Skills
  return true
}
