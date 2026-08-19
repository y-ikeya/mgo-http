/**
 * 手に持てる物。
 *
 * --- なぜ 1 枚の表にするか ---
 * 「いま手に何があるか」が 4 か所に分かれていた。武器 ID、通信のフラグ
 * (boxed / holdingGrenade)、モーション名 (stab / claymore_windup)、そして
 * 「投擲の枠に何を入れたか」。**同じ 1 つの事実**が別々の形で載っていたので、
 * 持ち物の考え方を変えるたびに 4 か所を書き直すことになっていた。
 *
 * --- 枠ではなく物を型にする ---
 * 以前は `SupportId` という**枠**を型にしていて、2 回作り直した。枠は選ぶときの
 * 概念で、使うときの概念ではない。ここでは**物そのもの**を型にする。
 *
 *   選ぶとき (湧く瞬間)   枠。主武器は突撃銃か狙撃銃、support は 1 つ
 *   使うとき (試合中)     並び。上下で送る 1 本のリスト
 *
 * --- 持ち替えて使う ---
 * 手にあるのは常に 1 つ。銃を構えたまま手榴弾を投げることはできない。
 * 投げると決めた瞬間に撃つ手段を手放す代わりに、軽い物を持っている間は速く動ける。
 * 詳しくは docs/design.md の 5。
 *
 * three にも DOM にも依存しない。サーバーが同じ表を読む。
 */

/** 撃てる物 */
export type GunId = 'rifle' | 'sniper' | 'pistol'

/** 投げる物・置く物。support の枠に入る */
export type ThrowId = 'grenade' | 'claymore' | 'magazine'

/** 手に持てる物すべて */
export type HeldId = GunId | ThrowId | 'knife' | 'box'

/**
 * 系統。持ち替えの操作が別々に割り当たる (MGO2 の十字左右)。
 *
 * 分かれていないと、箱を出したいだけなのに武器を何度も送ることになる。
 */
export type Family = 'weapon' | 'tool'

/** 湧くときに選ぶ枠。並びの順もこれで決まる */
export type Slot = 'primary' | 'secondary' | 'support' | 'knife' | 'tool'

export interface HeldSpec {
  id: HeldId
  /** HUD と装備画面に出す名前 */
  label: string
  family: Family
  slot: Slot
  /**
   * 重さ (kg)。移動の速さがここから決まる。
   *
   * **持っている物の重さ**で決まるので、手榴弾に持ち替えれば速くなる。
   * 「軽い物を持って走る」が戦い方の 1 つになる。
   */
  weight: number
  /** 撃てるか。false の物を持っている間は引き金が効かない */
  shoots: boolean
}

/**
 * 並びの順。武器系は 主 → 副 → support → ナイフ。
 *
 * **support は 1 枠だが中身は 1 つとは限らない。** 湧くときに選ぶのは手榴弾か
 * クレイモアのどちらかだが、弾倉 (囮) は撃った弾が溜まって増えるので、持って
 * いれば並びに現れる。だから武器系は 4 つのときも 5 つのときもある。
 */
const SLOT_ORDER: Record<Slot, number> = {
  primary: 0,
  secondary: 1,
  support: 2,
  knife: 3,
  tool: 0,
}

export const HELD: Record<HeldId, HeldSpec> = {
  rifle: { id: 'rifle', label: 'AK47', family: 'weapon', slot: 'primary', weight: 3.5, shoots: true },
  sniper: { id: 'sniper', label: 'XM2010', family: 'weapon', slot: 'primary', weight: 5.5, shoots: true },
  pistol: { id: 'pistol', label: 'M9', family: 'weapon', slot: 'secondary', weight: 0.95, shoots: true },

  // 投げる物は軽い。**持ち替えると速くなる**のがそのまま戦い方になる
  grenade: { id: 'grenade', label: 'GRENADE', family: 'weapon', slot: 'support', weight: 0.4, shoots: false },
  claymore: { id: 'claymore', label: 'CLAYMORE', family: 'weapon', slot: 'support', weight: 1.6, shoots: false },
  magazine: { id: 'magazine', label: 'MAG', family: 'weapon', slot: 'support', weight: 0.3, shoots: false },

  // 刺されば即死。代償は**銃をしまってから近づく**こと (docs/weapons.md)
  knife: { id: 'knife', label: 'KNIFE', family: 'weapon', slot: 'knife', weight: 0.3, shoots: false },

  // 被っている間は動けるが撃てない。速さは別の倍率で決めている (player.ts)
  box: { id: 'box', label: 'C.BOX', family: 'tool', slot: 'tool', weight: 2.0, shoots: false },
}

/**
 * いま持っている 1 つ。
 *
 * **個体ごとに変わるものだけ持つ** = 弾数。名前・重さ・射程はその種類の性質なので
 * 表から引く。持たせると二重になって、片方だけ直したときに静かにずれる。
 */
export type Carried =
  | { id: GunId; ammo: number; reserve: number }
  | { id: ThrowId; count: number }
  | { id: 'knife' }
  | { id: 'box' }

export function specOf(id: HeldId): HeldSpec {
  return HELD[id]
}

/** その物を持っている間の移動の速さ (倍率) */
export function carrySpeed(id: HeldId): number {
  return 1 + (REFERENCE_WEIGHT - HELD[id].weight) * WEIGHT_EFFECT
}

/**
 * 重さの基準 (kg)。突撃銃をここに置く。
 *
 * これより軽ければ速く、重ければ遅い。実在の銃を基準にしておくと、
 * 新しい物を足すときに「AK より重いか軽いか」だけで速さが決まる。
 */
export const REFERENCE_WEIGHT = 3.5

/** 1kg あたり何割速さが変わるか */
export const WEIGHT_EFFECT = 0.06

/**
 * 持ち替えにかかる時間 (秒)。
 *
 * **重さでは変えない。** 重い銃をしまうのが遅い、はやらない — 重さは既に移動の
 * 速さで効いているので、二重に効かせると狙撃銃が使えなくなる。
 *
 * 値は仮。0.6 秒は「撃ち合いの最中に持ち替えるのは無謀」くらいを狙った長さだが、
 * 実際に触って決める所。**押した入力は捨てずに溜める**ので、連打しても反応が
 * 無いようには感じないはず (Inventory.switchTo)。
 */
export const SWITCH_TIME = 0.3

/**
 * 持ち物を並べる。系統ごとに、枠の順で。
 *
 * 持ち替えの一覧 (長押し) と、押すだけのトグルが、この並びを送る。
 */
export function listOf(carried: readonly Carried[], family: Family): Carried[] {
  return carried
    .filter((item) => HELD[item.id].family === family)
    .sort((a, b) => SLOT_ORDER[HELD[a.id].slot] - SLOT_ORDER[HELD[b.id].slot])
}

/**
 * 拾う。
 *
 * **既に持っている種類なら弾を補充するだけ**、持っていなければ持ち物に加わる。
 * だから主武器を 2 丁持つこともある。上限は置かない — 上限で縛る代わりに
 * 「奪ってこないと増えない」で縛る。
 *
 * @returns 加わったなら true、補充だけなら false
 */
export function pickUp(carried: Carried[], found: Carried): boolean {
  const have = carried.find((item) => item.id === found.id)
  if (!have) {
    carried.push(found)
    return true
  }
  if ('ammo' in have && 'ammo' in found) {
    have.ammo = Math.max(have.ammo, found.ammo)
    have.reserve += found.reserve
  } else if ('count' in have && 'count' in found) {
    have.count += found.count
  }
  return false
}

/**
 * 湧くときの選択。
 *
 * **これは「枠」の概念。** 使うときの並び (Carried[]) とは別物で、湧く瞬間にしか
 * 出てこない。混ぜたのが以前の失敗。
 */
export interface Loadout {
  primary: GunId
  secondary: GunId
  support: 'grenade' | 'claymore'
}

/** 1 つの命で持てる投げ物の数 */
export const SUPPORT_COUNT: Record<'grenade' | 'claymore', number> = {
  grenade: 3,
  // 置きっぱなしで効き続けるので、手榴弾と同じ数を配ると通り道を全部塞げる
  claymore: 2,
}

/**
 * 選択から持ち物を組む。湧くたびに呼ぶ。
 *
 * ナイフとダンボールは選ばない。**最初から持っている**。
 *
 * 弾倉 (囮) は入れない。撃った弾が 1 弾倉ぶん溜まって初めて増える物なので、
 * 湧いた時点では持っていない。
 */
export function buildCarried(loadout: Loadout, ammoOf: (id: GunId) => { ammo: number; reserve: number }): Carried[] {
  return [
    { id: loadout.primary, ...ammoOf(loadout.primary) },
    { id: loadout.secondary, ...ammoOf(loadout.secondary) },
    { id: loadout.support, count: SUPPORT_COUNT[loadout.support] },
    { id: 'knife' },
    { id: 'box' },
  ]
}

/** その物を持っているか */
export function find(carried: readonly Carried[], id: HeldId): Carried | undefined {
  return carried.find((item) => item.id === id)
}

/**
 * 押すだけの持ち替え。**直前に持っていた物との往復**。
 *
 * 一覧を開かずに 2 つを行き来できることが、1 枠でも操作が成立する理由。
 * 大抵は主武器と投擲、あるいは主武器と副武器を往復する。
 *
 * 直前の物を持っていない (投げ切った・拾う前) なら、並びの次へ送る。
 */
export function toggle(
  carried: readonly Carried[],
  held: HeldId,
  previous: HeldId | null,
): HeldId {
  // **同じ系統の中だけ。** 直前に持っていた物が別の系統だと、武器のトグルで
  // 箱に戻ってしまう (箱 → Q で銃 → Q でまた箱、になった)。
  // 系統をまたぐのは専用のキー (C など) の仕事。
  const sameFamily =
    previous !== null &&
    previous !== held &&
    HELD[previous].family === HELD[held].family &&
    find(carried, previous) !== undefined
  if (sameFamily) return previous as HeldId
  return cycle(carried, held, 1)
}

/**
 * 一覧を送る。長押し中の上下がこれ。
 *
 * **同じ系統の中だけ**を回る。武器を送っているときに箱が出てきたりしない。
 *
 * @param step 1 で次、-1 で前
 */
export function cycle(carried: readonly Carried[], held: HeldId, step: number): HeldId {
  const family = HELD[held].family
  const list = listOf(carried, family)
  if (list.length === 0) return held
  const at = list.findIndex((item) => item.id === held)
  const next = (at + step + list.length) % list.length
  return list[next].id
}

/**
 * その系統の先頭。系統を切り替えるとき (武器 ⇄ 道具) の行き先。
 *
 * 何も持っていなければ null。道具を 1 つも持っていない場面がありうる。
 */
export function firstOf(carried: readonly Carried[], family: Family): HeldId | null {
  return listOf(carried, family)[0]?.id ?? null
}

/**
 * 投げ切った物を持ち物から外す。
 *
 * **銃は外さない。** 弾が尽きても銃は手元に残る (拾って補充できる)。
 * 投げ物は無くなれば持っていることにならない。
 */
export function dropEmpty(carried: Carried[], id: HeldId): boolean {
  const at = carried.findIndex((item) => item.id === id)
  if (at < 0) return false
  const item = carried[at]
  if (!('count' in item) || item.count > 0) return false
  carried.splice(at, 1)
  return true
}
