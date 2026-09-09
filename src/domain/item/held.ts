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

/*
 * 撃てる物は weapons.ts の `WeaponId`。**ここで別名を建てない。**
 *
 * 以前は同じ 6 つを `GunId` としてここに書き直していて、`primary: WeaponId` /
 * `secondary: GunId` のように**同じ物へ 2 つの名前**が付いていた。中身が一字
 * 一句同じなので型検査は何も言わず、読む側だけが「違う物か」と迷う。
 */
import type { WeaponId } from './weapons'
export type { WeaponId }

/** 投げる物・置く物。support の枠に入る */
export type ThrowId = 'grenade' | 'claymore' | 'magazine' | 'decoy'

/**
 * 手に持てる物すべて。
 *
 * `none` は**道具を何も使っていない**という選択。手ぶらという意味ではない —
 * 道具の枠が空なだけで、手には武器がある (Inventory.held を参照)。
 */
export type HeldId = WeaponId | ThrowId | 'knife' | 'box' | 'none'

/**
 * 系統。持ち替えの操作が別々に割り当たる (MGO2 の十字左右)。
 *
 * 分かれていないと、箱を出したいだけなのに武器を何度も送ることになる。
 */
export type Family = 'weapon' | 'tool'

/**
 * それが銃か。**id を並べて書かないための述語。**
 *
 * 「rifle か sniper か pistol なら」と書いた所が 3 箇所あって、P90 を足した
 * ときに 3 つとも直す必要があった。表に聞けば足し忘れが起きない。
 */
/**
 * 両手で構える物か。走り方 (と構えの型) がこれで変わる。
 *
 * 銃でも拳銃は片手。手榴弾・弾倉・ナイフ・クレイモアも片手で、**身軽に走る**。
 */
export function isTwoHanded(id: HeldId): boolean {
  return HELD[id].twoHanded
}

export function isGun(id: HeldId): id is WeaponId {
  return HELD[id].shoots
}

/**
 * かがんで地面に置く物か。**投げる物とは手順が違う。**
 *
 * 投げる物は振りかぶって放す。置く物はかがんで置く — 型も、置ける場所の
 * 判定も、置き切るまで動けないことも共通なので、**そこを分けない**ために
 * 述語で聞く。並べて書くと、3 つ目を足したときに直し漏れる。
 */
export function isPlaceable(id: HeldId): id is 'claymore' | 'decoy' {
  return id === 'claymore' || id === 'decoy'
}

/**
 * 投げる物・置く物か。**銃のように構えない。**
 *
 * 構えの型 (照準へ体を向け、背骨を上下へ曲げる) は銃のためのもので、投げ物に
 * 載せると腕が二重に動く。並べて書いていたので**囮を足したときに漏れて**、
 * 置く動作の上に構えが乗った。
 */
export function isThrowable(id: HeldId): id is ThrowId {
  return id === 'grenade' || id === 'claymore' || id === 'magazine' || id === 'decoy'
}

/**
 * 支援の枠から出た物か。**残りの数を数える対象。**
 *
 * 銃は弾数を持つが、こちらは「あと何個」で数える。並べて書くと 4 つ目を
 * 足したときに数え漏れて、**持っているのに残数が出ない**になる (囮でそう
 * なった)。述語で聞く。
 */
export function isSupport(id: HeldId): id is SupportKind {
  return id === 'grenade' || id === 'claymore' || id === 'decoy'
}

/**
 * 1 人が場に置いておける数。**持てる数 (3) とは別。**
 *
 * --- なぜ要るか ---
 * 置いた物は**本人が死んでも残る** (置いて離れる道具なので)。一方、湧き直すと
 * 手元は満タンに戻る (refill)。数えないと死ぬたびに増えて、通り道を全部
 * 塞げるし、人形を並べ放題になる。
 *
 * --- なぜ持てる数より多いか ---
 * 同じにすると「置き切ったら死ぬまで増やせない」で終わってしまう。1 つ多い
 * だけで、**死んで湧いた後にもう 1 つ足せる**余地が残る — 置いて離れる道具の
 * 性格を消さずに、無限には増えない。
 *
 * --- 溢れたらどうするか ---
 * **古いほうから黙って消す。起爆も破裂もさせない。** 置いた瞬間にマップの
 * 反対側で誰かが死ぬのは理不尽だし、**遠隔起爆装置**として使える (相手の
 * 近くに置いてきた物を、遠くで 1 つ置いて起爆させる)。囮なら破裂音が
 * 「誰かが撃った」という**嘘の情報**になる。
 */
export const PLACED_LIMIT = 4

/**
 * 置いた物のうち、押し出される物。**古いほうから。**
 *
 * 新しく 1 つ置く前に呼ぶ。返ってきた物を場から外してから足すと、上限を
 * 超えない。クレイモアも囮も同じ規則を通す — 別々に書くと、片方だけ
 * 「起爆させてしまう」ような穴が開く。
 *
 * **押し出す物は黙って消すこと。** ここは何を消すかだけを決める。
 *
 * @param placed 場に在る物。**置いた順** (古い物が先)
 */
export function overflowing<T extends { owner: string }>(
  placed: readonly T[],
  owner: string,
  limit = PLACED_LIMIT,
): T[] {
  const mine = placed.filter((item) => item.owner === owner)
  // これから 1 つ足すので、いま limit 個在るなら 1 つ押し出す
  const over = mine.length - limit + 1
  return over > 0 ? mine.slice(0, over) : []
}

/** 湧くときに選ぶ枠。並びの順もこれで決まる */
type Slot = 'primary' | 'secondary' | 'support' | 'knife' | 'tool'

interface HeldSpec {
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
  /**
   * 両手で構えるか。
   *
   * **走り方が変わる。** 両手の物は銃を抱えて走り、片手の物は身軽に走る
   * (副武器と同じ型)。手榴弾を抱えて突撃銃の走り方をしていると、軽い物に
   * 持ち替えて速く動く、という選択が見た目に出ない。
   */
  twoHanded: boolean
}

/**
 * 並びの順。武器系は 主 → 副 → support → ナイフ。
 *
 * **support は 1 枠だが中身は 1 つとは限らない。** 湧くときに選ぶのは手榴弾か
 * クレイモアのどちらかだが、弾倉 (囮) は撃った弾が溜まって増えるので、持って
 * いれば並びに現れる。だから武器系は 4 つのときも 5 つのときもある。
 */
const TOOL_ORDER: Partial<Record<HeldId, number>> = { box: 0, none: 1 }

const SLOT_ORDER: Record<Slot, number> = {
  primary: 0,
  secondary: 1,
  support: 2,
  knife: 3,
  tool: 0,
}

export const HELD: Record<HeldId, HeldSpec> = {
  smg: { id: 'smg', label: 'P90', family: 'weapon', slot: 'primary', weight: 2.6, shoots: true, twoHanded: true },
  rifle: { id: 'rifle', label: 'AK47', family: 'weapon', slot: 'primary', weight: 3.5, shoots: true, twoHanded: true },
  sniper: { id: 'sniper', label: 'XM2010', family: 'weapon', slot: 'primary', weight: 5.5, shoots: true, twoHanded: true },
  shotgun: { id: 'shotgun', label: 'M870', family: 'weapon', slot: 'primary', weight: 3.6, shoots: true, twoHanded: true },
  m9: { id: 'm9', label: 'M9', family: 'weapon', slot: 'secondary', weight: 0.95, shoots: true, twoHanded: false },
  m1911: { id: 'm1911', label: 'M1911', family: 'weapon', slot: 'secondary', weight: 1.05, shoots: true, twoHanded: false },

  // 投げる物は軽い。**持ち替えると速くなる**のがそのまま戦い方になる
  grenade: { id: 'grenade', label: 'GRENADE', family: 'weapon', slot: 'support', weight: 0.4, shoots: false, twoHanded: false },
  claymore: { id: 'claymore', label: 'CLAYMORE', family: 'weapon', slot: 'support', weight: 1.6, shoots: false, twoHanded: false },
  magazine: { id: 'magazine', label: 'MAG', family: 'weapon', slot: 'support', weight: 0.3, shoots: false, twoHanded: false },
  // 空気を入れる前の人形。**畳んであるので軽い**
  decoy: { id: 'decoy', label: 'DECOY', family: 'weapon', slot: 'support', weight: 0.5, shoots: false, twoHanded: false },

  // 刺されば即死。代償は**銃をしまってから近づく**こと (docs/weapons.md)
  knife: { id: 'knife', label: 'KNIFE', family: 'weapon', slot: 'knife', weight: 0.3, shoots: false, twoHanded: false },

  // 被っている間は動けるが撃てない。速さは別の倍率で決めている (player.ts)
  box: { id: 'box', label: 'C.BOX', family: 'tool', slot: 'tool', weight: 2.0, shoots: false, twoHanded: false },

  /*
   * 道具を使っていない状態。
   *
   * **一覧に並ぶ選択肢として置く。** 「箱を降ろす」を別の操作にすると、道具が
   * 増えたときに降ろし方が分からなくなる。一覧の中に「何も使わない」があれば、
   * 送るだけで戻れる (MGO2 の道具一覧にも NONE が並んでいた)。
   *
   * 重さは 0 だが、これを手にしている間も**武器を持っている**ので速さには効かない。
   */
  none: { id: 'none', label: 'NONE', family: 'tool', slot: 'tool', weight: 0, shoots: false, twoHanded: false },
}

/**
 * いま持っている 1 つ。
 *
 * **個体ごとに変わるものだけ持つ** = 弾数。名前・重さ・射程はその種類の性質なので
 * 表から引く。持たせると二重になって、片方だけ直したときに静かにずれる。
 */
export type Carried =
  | { id: WeaponId; ammo: number; reserve: number }
  | { id: ThrowId; count: number }
  | { id: 'knife' }
  | { id: 'box' }
  | { id: 'none' }

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
 * 一覧が開くまでの長押し (秒)。
 *
 * **選ぶことと抜くことを分けるための境目。** 短く押せばトグル (即座に持ち替え)、
 * 押し続ければ一覧が出て、離した所へ移る。
 *
 * 一覧の中を動くのはタダで、時間がかかるのは決めた後の持ち替えだけ
 * (SWITCH_TIME) — **迷っている時間に代償を要らなくする**ため。トグルだけに
 * すると、連打したぶんが全部そのまま持ち替えになる。
 *
 * すぐには出さない。単押しのつもりで一覧が出ると、往復するたびに画面が騒がしく
 * なるし、一覧が出ること自体が「いま選んでいる」という状態なので、意図せず
 * 入るのは困る。
 *
 * 1 秒にしていたら遅かった。押してから出るまで待たされると、一覧を使うこと自体が
 * 億劫になる。**叩く (0.1 秒前後) と押さえる (0.3 秒以上) の間**を取る。
 */
export const BROWSE_HOLD = 0.35

/**
 * 持ち物を並べる。系統ごとに、枠の順で。
 *
 * 持ち替えの一覧 (長押し) と、押すだけのトグルが、この並びを送る。
 */
export function listOf(carried: readonly Carried[], family: Family): Carried[] {
  return carried
    .filter((item) => HELD[item.id].family === family)
    .sort((a, b) =>
      family === 'tool'
        ? (TOOL_ORDER[a.id] ?? 9) - (TOOL_ORDER[b.id] ?? 9)
        : SLOT_ORDER[HELD[a.id].slot] - SLOT_ORDER[HELD[b.id].slot],
    )
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
 * 置いていけるか。
 *
 * **ナイフと道具は置けない。** ナイフは最後の手段として必ず残す (全部置いた人が
 * 素手になると、そこから何もできない)。道具 (ダンボール・NONE) は持ち物の枠が
 * 別なので、落として拾う話に乗らない。
 */
export function canDrop(id: HeldId): boolean {
  return HELD[id].family === 'weapon' && id !== 'knife'
}

/**
 * 持ち物から外す。**外した物をそのまま返す** (弾の残りごと地面に置くため)。
 *
 * 置けない物や持っていない物なら null。
 */
export function dropFrom(carried: Carried[], id: HeldId): Carried | null {
  if (!canDrop(id)) return null
  const at = carried.findIndex((item) => item.id === id)
  if (at < 0) return null
  return carried.splice(at, 1)[0] ?? null
}

/**
 * 湧くときの選択。
 *
 * **これは「枠」の概念。** 使うときの並び (Carried[]) とは別物で、湧く瞬間にしか
 * 出てこない。混ぜたのが以前の失敗。
 */
export interface Loadout {
  /**
   * 主武器。**null なら持たない** (部屋が外している)。
   *
   * 副武器と同じ形。銃を 1 挺も持たない部屋 (ナイフだけ) がここに乗る —
   * `domain/match/room.ts` の primaries を空にすると、選べる銃が無くなる。
   *
   * **手ぶらにはならない。** ナイフと箱は誰でも持っているので (buildCarried)、
   * 銃が無ければ手にあるのはナイフになる。
   */
  primary: WeaponId | null
  /**
   * 副武器。**null なら持たない。**
   *
   * 部屋が外すことがある (domain/match/room.ts の secondary)。狙撃銃だけの
   * 部屋で拳銃まで取り上げると、詰められた時に**ナイフしか残らない** —
   * 間合いを詰める側と詰められる側の読み合いが、そこで初めて成立する。
   */
  secondary: WeaponId | null
  support: SupportKind
}

/**
 * support の枠に入る物。
 *
 * **weapons.ts の SupportId と同じ並び。** あちらは `held.ts` を読んでいる
 * ので、値をこちらへ持ってくると輪になる。型だけ写して、食い違ったら
 * 数の表 (SUPPORT_COUNT) が型検査で落ちるようにしてある。
 */
export type SupportKind = 'grenade' | 'claymore' | 'decoy'

/** 1 つの命で持てる投げ物の数 */
const SUPPORT_COUNT: Record<SupportKind, number> = {
  grenade: 3,
  claymore: 3,
  decoy: 3,
}

/**
 * 選択から持ち物を組む。湧くたびに呼ぶ。
 *
 * ナイフとダンボールは選ばない。**最初から持っている**。
 *
 * 弾倉 (囮) は入れない。撃った弾が 1 弾倉ぶん溜まって初めて増える物なので、
 * 湧いた時点では持っていない。
 */
export function buildCarried(loadout: Loadout, ammoOf: (id: WeaponId) => { ammo: number; reserve: number }): Carried[] {
  const secondary: Carried[] =
    loadout.secondary === null
      ? []
      : [{ id: loadout.secondary, ...ammoOf(loadout.secondary) }]
  const primary: Carried[] =
    loadout.primary === null
      ? []
      : [{ id: loadout.primary, ...ammoOf(loadout.primary) }]
  return [
    ...primary,
    ...secondary,
    { id: loadout.support, count: SUPPORT_COUNT[loadout.support] },
    { id: 'knife' },
    { id: 'box' },
    // 道具を使っていない状態。一覧に並べて、送るだけで戻れるようにする
    { id: 'none' },
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
