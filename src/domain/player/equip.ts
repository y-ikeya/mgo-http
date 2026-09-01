/**
 * その人が何を持てるか。**申告を鵜呑みにしないためのドメインルール。**
 *
 * 持ち物を並べて選ぶのも、いま手に何があるかを決めるのもクライアントで、
 * サーバーはそれを**受け取る**側。そのまま書き込むと「ナイフを選んだことに
 * して狙撃銃を撃つ」が形の上では通ってしまう。
 *
 * ここに置くのは「持てるか」のドメインルールだけ。**持ち替えに時間がかかる**
 * (item/held.ts の SWITCH_TIME) の管理はまだクライアントにしかない。
 */

import { HELD, type GunId, type HeldId } from '../item/held'
import { SUPPORT_SPECS, WEAPONS, type SupportId, type WeaponId } from '../item/weapons'
import type { Player } from './player'
import { canChooseSkills, isAffordable, type Skills } from './skill'
import type { Phase } from '../match/match'
import type { ModeSpec } from '../match/room'

/** 支度で選べる主武器か。**受け取った文字列を信じない** */
export function isPrimaryChoice(id: string): id is WeaponId {
  return WEAPONS[id as WeaponId]?.slot === 'primary'
}

/**
 * 支度で選べる副武器か。
 *
 * **null も通す。** 副武器を持たせない部屋がある (砂部屋)。持たないことも
 * 選択の 1 つなので、弾くのではなく受け取る。
 */
export function isSecondaryChoice(id: string): id is WeaponId {
  return WEAPONS[id as WeaponId]?.slot === 'secondary'
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
/**
 * 持ち込めない銃を持っていたら、持てるものへ置き換える。
 *
 * **部屋を移ったときに要る。** 装備は席に付いて回るので、突撃銃を選んだまま
 * 狙撃銃だけの部屋へ入れる。選び直さないまま湧くと、弾く仕掛け
 * (chooseLoadout) を一度も通らずにその銃で戦場へ出る。
 *
 * 黙って替える。**入れないより入れて持ち替えさせるほうがよい** — 部屋の入口で
 * 「その装備では入れません」と止めても、直す場所が無い。
 */
export function fitLoadout(
  player: Player,
  allowed: readonly WeaponId[],
  secondary: GunId | null = 'm9',
): void {
  const fits = allowed.length === 0 || allowed.includes(player.primary)
  if (fits && player.secondary === secondary) return
  if (!fits) player.primary = allowed[0]
  player.secondary = secondary
  player.inventory.refill({
    primary: player.primary,
    secondary: player.secondary,
    support: player.support,
  })
}

export function chooseLoadout(
  player: Player,
  primary: string,
  support: string,
  choosing: boolean,
  allowed?: readonly WeaponId[],
  /**
   * 副武器。**省けば今のまま。**
   *
   * その部屋が副武器を認めていなければ (allowedSecondary が null) 何を
   * 名乗られても入れない。砂部屋で拳銃を持ち込まれたら、狙撃だけという
   * 部屋の作りが丸ごと崩れる。
   */
  secondary?: string,
  allowedSecondary?: GunId | null,
): boolean {
  if (!isPrimaryChoice(primary) || !isSupportChoice(support)) return false
  /*
   * その部屋に持ち込めるか。**画面に出さないだけでは足りない。**
   *
   * 一覧から消しても、送ってくる側は止まらない。狙撃銃だけの部屋に突撃銃で
   * 入られたら、その部屋の遊びが丸ごと壊れる (domain/match/room.ts の primaries)。
   */
  if (allowed && !allowed.includes(primary)) return false
  player.primary = primary
  player.support = support
  if (secondary !== undefined) {
    // **部屋が副武器を持たせない**なら、何を名乗られても入れない
    if (allowedSecondary === null) return false
    if (!isSecondaryChoice(secondary)) return false
    player.secondary = secondary
  }
  if (choosing) {
    player.grenades = SUPPORT_SPECS[support].count
    // 支度中は持ち物も選び直したものに揃える。湧いてからは refill が組み直す
    player.inventory.refill({
      primary: player.primary,
      secondary: player.secondary,
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
export function chooseSkills(
  player: Player,
  skills: unknown,
  phase: Phase,
  mode?: ModeSpec,
): boolean {
  if (!canChooseSkills(phase, mode)) return false
  if (skills === null || typeof skills !== 'object') return false
  if (!isAffordable(skills as Skills)) return false
  player.skills = skills as Skills
  return true
}
