/**
 * 持ち物と、いま手にある物。
 *
 * --- なぜ切り出すか ---
 * 弾数が Game.ts (2500 行) に散っていた。銃ごとの装填と予備、手榴弾の残り、
 * 投げられる弾倉の数が別々のフィールドで、読み書きが各所にある。持ち物の考え方を
 * 変えるたびに全部を追いかけることになる。
 *
 * ここが持つのは**状態と遷移**だけ。何が持てるか・何が撃てるか・並び順といった
 * 規則は held.ts の表にある。
 *
 * three にも DOM にも依存しない。サーバーが同じ物を読める形にしてある
 * (いまサーバーは自前で数えているが、移すときにここへ寄せる)。
 */

import {
  BROWSE_HOLD, HELD, SWITCH_TIME, buildCarried, canDrop, cycle as cycleId, dropEmpty, dropFrom,
  find, firstOf, listOf, pickUp, toggle as toggleId,
  type Carried, type Family, type GunId, type HeldId, type Loadout,
} from './held'
import type { Intent } from '../player/intent'
import { WEAPONS } from './weapons'

/** 銃の初期弾数。表から引く */
function fullAmmo(id: GunId): { ammo: number; reserve: number } {
  return { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }
}

/** 系統は 2 つ。並びを 1 か所に置いて、増えたときに数え漏らさないようにする */
const FAMILIES: readonly Family[] = ['weapon', 'tool']

/** 開いている一覧。どの系統の、何番目を指しているか */
export interface Browsing {
  family: Family
  at: number
}

/**
 * 持ち替えを許すかどうかを決める、外から来る事実。
 *
 * **意思 (Intent) ではない。** どれも「押しているか」ではなく「いまどうなって
 * いるか」で、構えは特にそう — 箱を被っていたり敬礼中は押しても構わないので、
 * 押していることと構えていることは別物。
 */
export interface HandContext {
  /** 動ける状態か (Life から) */
  canAct: boolean
  /** 支度の画面を開いているか。戦場に居ない */
  choosing: boolean
  /** **実際に**構えているか。押しているかではない */
  aiming: boolean
  /** ボルトを送っている最中か */
  cocking: boolean
  /**
   * いま箱を被れる体勢か。
   *
   * **転がり中・空中・刺突中・倒れている間は被れない。** 体の側で弾いていた
   * だけだと、持ち物は箱に切り替わったのに体は被らない — **HUD が「被って
   * いる」と言っているのに、画面の中では被っていない**という食い違いになる。
   * 手にする所で断れば、両方が同じことを言う。
   */
  canWearBox: boolean
}

/** 手にある物が動いた結果、呼ぶ側にやってもらうこと */
export type HandEvent =
  /** 足元の物を拾いたい。誰の何を拾うかはサーバーが決める */
  | { kind: 'pickup' }
  /** 手放した。地面に置くのはサーバーなので、残弾ごと知らせる */
  | { kind: 'dropped'; item: Carried }
  /** 一覧の中で選び直した。音を鳴らすのに使う */
  | { kind: 'selected' }

export class Inventory {
  private items: Carried[] = []
  /** 箱を被れる体勢か。hand() が毎フレーム書き込む (既定は被れる) */
  private wearable = true
  private current: HeldId = 'rifle'
  /** 直前に持っていた物。押すだけのトグルはこの 2 つを往復する */
  private last: HeldId | null = null
  /** 持ち替えが終わるまでの残り (秒)。0 なら手に馴染んでいる */
  private switchLeft = 0

  constructor(loadout: Loadout) {
    this.refill(loadout)
  }

  /** 湧いたとき。持ち物を選択から組み直す */
  refill(loadout: Loadout): void {
    this.items = buildCarried(loadout, fullAmmo)
    this.current = loadout.primary
    this.last = loadout.secondary
    this.previousWeapon = loadout.secondary
    this.lastWeapon = loadout.primary
    this.lastTool = 'none'
    this.switchLeft = 0
    this.queued = null
  }

  /**
   * いま手にある物。
   *
   * **`none` を選んでいるときは武器を返す。** あれは「道具を使っていない」という
   * 選択で、手ぶらという意味ではない。そのまま返すと、道具を降ろした瞬間に
   * 撃てなくなる。
   */
  get held(): HeldId {
    return this.current === 'none' ? this.lastWeapon : this.current
  }

  /** 一覧で指している物。`none` もそのまま返る */
  get selected(): HeldId {
    return this.current
  }

  /**
   * 武器系でいま選んでいる物。
   *
   * **道具を手にしていても変わらない。** ダンボールを被っている間も「抜けば
   * 構える銃」は決まっているので、武器のカードにはそれが出続ける。手にある物を
   * そのまま出すと、箱を被った瞬間にカードが C.BOX になってしまう。
   */
  get weapon(): HeldId {
    return HELD[this.current].family === 'weapon' ? this.current : this.lastWeapon
  }

  /** 道具を手にしているか。`none` を選んでいれば false */
  get usingTool(): boolean {
    return HELD[this.current].family === 'tool' && this.current !== 'none'
  }

  /** 道具系でいま選んでいる物。持っていなければ null */
  get tool(): HeldId {
    if (HELD[this.current].family === 'tool') return this.current
    return this.lastTool ?? 'none'
  }

  private lastWeapon: HeldId = 'rifle'
  private lastTool: HeldId = 'none'
  /** 直前に持っていた**武器**。道具を挟んでも変わらない (トグルの行き先) */
  private previousWeapon: HeldId | null = null

  /** 持ち替えの最中か。**この間は撃てないし投げられない** */
  get switching(): boolean {
    return this.switchLeft > 0
  }

  /** 持ち替えの進み具合 (0..1)。モーションの繋ぎに使う */
  get switchProgress(): number {
    return SWITCH_TIME <= 0 ? 1 : 1 - this.switchLeft / SWITCH_TIME
  }

  /**
   * 引き金が効くか。
   *
   * 撃てる物を持っていて、かつ持ち替えが終わっていること。**投げると決めた
   * 瞬間に撃つ手段を手放す**、が持ち替えの代償なので、ここが要になる。
   */
  get canShoot(): boolean {
    return HELD[this.held].shoots && !this.switching
  }

  /** いま手にある物の中身 (弾数など)。持っていなければ undefined */
  get item(): Carried | undefined {
    return find(this.items, this.held)
  }

  /**
   * 持ち物を 1 つ引く。持っていなければ undefined。
   *
   * **手にある物とは限らない。** ダンボールを被っていても銃の残弾は表示に要る
   * (被った瞬間に弾数が 0 に見えると、抜いたときに撃てるのか分からない)
   */
  of(id: HeldId): Carried | undefined {
    return find(this.items, id)
  }

  /** 指定した銃の装填弾。銃でなければ 0 */
  ammoOf(id: HeldId): number {
    const item = this.of(id)
    return item && 'ammo' in item ? item.ammo : 0
  }

  /** 指定した銃の予備弾。銃でなければ 0 */
  reserveOf(id: HeldId): number {
    const item = this.of(id)
    return item && 'reserve' in item ? item.reserve : 0
  }

  /** 装填されている弾。銃でなければ 0 */
  get ammo(): number {
    const item = this.item
    return item && 'ammo' in item ? item.ammo : 0
  }

  /** 予備弾。銃でなければ 0 */
  get reserve(): number {
    const item = this.item
    return item && 'reserve' in item ? item.reserve : 0
  }

  /** 投げ物の残り。投げ物でなければ 0 */
  get count(): number {
    const item = this.item
    return item && 'count' in item ? item.count : 0
  }

  /** その物を持っているか */
  has(id: HeldId): boolean {
    return find(this.items, id) !== undefined
  }

  /** その物の残り。持っていなければ 0 */
  countOf(id: HeldId): number {
    const item = find(this.items, id)
    if (!item) return 0
    if ('count' in item) return item.count
    if ('ammo' in item) return item.ammo
    return 1
  }

  /**
   * 手にしていない物を 1 つ使う。
   *
   * 投げた瞬間はまだ手に持っているので普通は spend() を使う。これが要るのは、
   * 手に持たずに数だけ減らす場面 (いまの実装が持ち替えを経ずに投げているため)。
   * 持ち替えを入れ切ったら消える。
   */
  spendOf(id: HeldId): void {
    const item = find(this.items, id)
    if (!item || !('count' in item)) return
    item.count = Math.max(0, item.count - 1)
    if (item.count === 0 && item.id !== this.current) dropEmpty(this.items, item.id)
  }

  /**
   * 持っている投げ物 (弾倉を除く) の残り。
   *
   * **選択ではなく持ち物を見る。** 「選んだ support の数」を数えると、選択と
   * 実際の持ち物が食い違ったときに 0 に見える。実際に持っている物を数えれば
   * 食い違いようがない。
   */
  get supportCount(): number {
    const item = this.items.find(
      (c) => 'count' in c && c.id !== 'magazine',
    ) as { count: number } | undefined
    return item?.count ?? 0
  }

  /** 持っている投げ物の種類。持っていなければ null */
  get supportId(): HeldId | null {
    const item = this.items.find((c) => 'count' in c && c.id !== 'magazine')
    return item?.id ?? null
  }

  /** その系統の並び。一覧に出す順 */
  list(family: Family): Carried[] {
    return listOf(this.items, family)
  }

  /**
   * 持っている銃だけ。
   *
   * **持ち替えを入れ切るまでの繋ぎ。** いまの操作は銃どうしの往復しかできないので、
   * 手榴弾やナイフに移らないようここで絞る。一覧 (長押し) を入れたら消える。
   */
  guns(): GunId[] {
    return this.items
      .filter((item): item is { id: GunId; ammo: number; reserve: number } => 'ammo' in item)
      .map((item) => item.id)
  }

  /** 持っている物すべて。画面に出すときだけ使う */
  get all(): readonly Carried[] {
    return this.items
  }

  // --- 一覧を開いて選ぶ ---

  /** 開いている一覧。閉じていれば null。画面に出すのに読む */
  get browsing(): Browsing | null {
    return this.browse
  }

  private browse: Browsing | null = null
  /** 系統ごとに、送りのキーを押し続けている長さ (秒)。0 なら押していない */
  private heldFor: Record<Family, number> = { weapon: 0, tool: 0 }

  /**
   * 手にある物を、押されている物から決める。
   *
   * --- ここが規則である理由 ---
   * 「構えたままでは持ち替えられない」「ボルトを送り終えるまで持ち替えない」は
   * どちらも**代償の置き方**であって、見た目の都合ではない。銃を下ろす一手間が
   * あって初めて「どちらで待つか」が選択になるし、撃って即座に隠れる、を塞ぐ。
   *
   * Game.ts に置いていた頃は、この判断がキーコードと three の間に挟まっていた。
   * ここに来たので**サーバーも同じ規則を読める** — いまサーバーは「持ち替えの
   * 最中か」を知らないので、持ち替え中に撃つが通っている。
   *
   * @param dt 前のフレームからの秒。**時計は持ち込まない** (Date.now を使うと
   *           試験が実時間に縛られるし、サーバーが読むときに噛み合わない)
   * @returns 呼ぶ側にやってもらうこと。通信と音は presentation の仕事
   */
  hand(intent: Intent, ctx: HandContext, dt: number): HandEvent[] {
    // 体勢は毎フレーム変わる。持ち替えの入口 (switchTo) が見るので控えておく
    this.wearable = ctx.canWearBox
    // 行動できない / 支度中は、押していたことごと忘れる。
    // 覚えていると、湧いた瞬間に一覧が開いていたり持ち替えが走ったりする
    if (!ctx.canAct || ctx.choosing) {
      this.browse = null
      this.heldFor.weapon = 0
      this.heldFor.tool = 0
      return []
    }
    // ボルトを送り終えるまでは持ち替えない。**押していた長さは消さない** —
    // 送り終えた瞬間に、押しっぱなしだったぶんが効く
    if (ctx.cocking) return []
    // 構えたままは持ち替えられない。銃を下ろす一手間があって初めて、
    // どちらで待つかの選択になる
    if (ctx.aiming) {
      this.browse = null
      return []
    }

    const events: HandEvent[] = []

    /*
     * 置く / 拾う。**一覧を開いていれば置く、開いていなければ拾う。**
     *
     * 同じ 1 つの動詞にしてあるのは、どちらも「地面と手の間で物を動かす」から。
     * 押し分けが要るのは置きたい物の上に立っているときだけで、そのときは
     * 一覧を開いているかどうかで意図がはっきりしている。
     */
    if (intent.drop) {
      const gone = this.browse ? this.dropSelected() : null
      if (gone) events.push({ kind: 'dropped', item: gone })
      else if (!this.browse) events.push({ kind: 'pickup' })
    }

    for (const family of FAMILIES) {
      if (intent.browse[family]) {
        this.heldFor[family] += dt
        // 一覧はすぐには出さない。単押しのつもりで出ると、往復するたびに
        // 画面が騒がしくなる
        if (this.heldFor[family] >= BROWSE_HOLD && !this.browse) {
          this.browse = { family, at: this.startOf(family) }
        }
        if (this.browse?.family === family && intent.select !== 0) {
          this.browse.at = this.moveBy(this.browse, -intent.select)
          events.push({ kind: 'selected' })
        }
        continue
      }
      if (this.heldFor[family] === 0) continue
      // 離した。開いていたなら選んだ物へ、開いていなければトグル
      const opened = this.browse?.family === family
      const pick = opened ? this.list(family)[this.browse!.at]?.id : undefined
      this.heldFor[family] = 0
      if (opened) this.browse = null
      if (pick) this.switchTo(pick)
      else this.toggle(family)
    }

    // 名指しの持ち替え。一覧を開かずに行き先が決まっているとき
    if (intent.toSupport) {
      const support = this.supportId
      if (support) this.switchTo(support)
    }
    if (intent.toKnife) this.switchTo('knife')

    return events
  }

  /** 一覧を開いた時点の位置。いま手にある物に合わせる */
  private startOf(family: Family): number {
    const at = this.list(family).findIndex((item) => item.id === this.held)
    return at < 0 ? 0 : at
  }

  /** 一覧の中を送る。端で止めず回す — 短い並びなので行き止まりが煩わしい */
  private moveBy(state: Browsing, step: number): number {
    const list = this.list(state.family)
    if (list.length === 0) return 0
    return (state.at + step + list.length) % list.length
  }

  /**
   * 一覧で選んでいる物を手放す。
   *
   * **持ち物から外すのはここ、地面に置くのはサーバー。** 位置を持っているのが
   * あちらなので、置き場所はあちらが決める (足元)。
   */
  private dropSelected(): Carried | null {
    if (!this.browse) return null
    const id = this.list(this.browse.family)[this.browse.at]?.id
    if (!id || !canDrop(id)) return null
    const gone = this.drop(id)
    if (!gone) return null
    // 一覧は閉じる。置いた物を指したまま残ると、次に離した瞬間に
    // 「持っていない物へ持ち替える」になる
    this.browse = null
    this.heldFor.weapon = 0
    this.heldFor.tool = 0
    return gone
  }

  /** 時計を進める。持ち替えが終わったら、溜めていた行き先へ続けて移る */
  update(dt: number): void {
    if (this.switchLeft <= 0) return
    this.switchLeft = Math.max(0, this.switchLeft - dt)
    if (this.switchLeft > 0) return
    const next = this.queued
    this.queued = null
    if (next) this.switchTo(next)
  }

  /**
   * 指した物へ持ち替える。
   *
   * **持ち替え中の入力は捨てずに溜める。** 代償 (時間) は残したいが、押した
   * ことが無かったことになるのは操作として良くない — 連打しても反応が無いと、
   * 効いていないのか間に合っていないのか分からない。
   *
   * 溜めるのは 1 つだけ。連打したぶんだけ順に持ち替わると、指を離した後も
   * 勝手に動き続ける。
   */
  switchTo(id: HeldId): boolean {
    if (!find(this.items, id)) return false
    // 被れない体勢なら箱には持ち替えない。**手にした形だけ作らない**
    if (id === 'box' && !this.wearable) return false
    if (this.switching) {
      this.queued = id === this.current ? null : id
      return false
    }
    if (id === this.current) return false
    const from = this.current
    this.last = from
    /*
     * **「直前の武器」は武器から武器へ移ったときだけ覚える。**
     *
     * ダンボールを被って戻ってくると、直前が箱になる。そのまま武器のトグルに
     * 使うと**同じ系統に居ないので往復にならず、一覧を送ってしまう** —
     * P90 → M9 → 箱 → M9 → Q で、P90 ではなくナイフが出ていた。
     */
    if (HELD[from].family === 'weapon' && HELD[id].family === 'weapon') {
      this.previousWeapon = from
    }
    // 系統ごとに「最後に選んだ物」を覚える。武器のカードと道具の表示が
    // 手にある物に引きずられないようにするため
    if (HELD[from].family === 'weapon') this.lastWeapon = from
    else this.lastTool = from
    this.current = id
    if (HELD[id].family === 'weapon') this.lastWeapon = id
    else this.lastTool = id
    this.switchLeft = SWITCH_TIME
    return true
  }

  /** 持ち替え中に押された行き先。1 つだけ溜める */
  private queued: HeldId | null = null

  /**
   * 押すだけの持ち替え。
   *
   * **系統に入る / 出る**が先で、同じ系統の中に居るときだけ往復になる。
   *
   *   別の系統に居る … その系統で**最後に選んでいた物**へ移る。先頭ではない —
   *                    拳銃を持っていた人が箱を脱いだら拳銃に戻ってほしい
   *   道具に居る     … 武器へ戻る。道具は「被る / 降ろす」の 2 択で、送るものが
   *                    無い (いま持っているのはダンボールだけ)
   *   武器に居る     … 直前に持っていた武器と往復
   */
  toggle(family: Family): boolean {
    if (HELD[this.current].family !== family) {
      const target = family === 'weapon' ? this.weapon : this.tool
      // 道具の枠が none のまま入っても意味が無いので、そのときは箱へ
      const enter = family === 'tool' && target === 'none' ? 'box' : target
      return this.switchTo(enter)
    }
    // 道具は一覧を送る。箱 → none → 箱 …。「降ろす」を別の操作にしない
    if (family === 'tool') return this.switchTo(cycleId(this.items, this.current, 1))
    // 武器は「直前の武器」と往復する。箱を挟んでも P90 ⇄ M9 が続く
    return this.switchTo(toggleId(this.items, this.current, this.previousWeapon))
  }

  /** 一覧を送る。長押し中の上下 */
  cycle(family: Family, step: number): boolean {
    if (HELD[this.current].family !== family) {
      const first = firstOf(this.items, family)
      return first !== null && this.switchTo(first)
    }
    return this.switchTo(cycleId(this.items, this.current, step))
  }

  /**
   * 1 つ使う。撃った 1 発、投げた 1 個。
   *
   * 投げ物が尽きたら持ち物から外して、**手を空けずに次の物へ移す**。
   * 空の手榴弾を握ったままにすると、撃てない状態から抜けられない。
   */
  spend(): void {
    const item = this.item
    if (!item) return
    if ('ammo' in item) {
      item.ammo = Math.max(0, item.ammo - 1)
      return
    }
    if ('count' in item) {
      item.count = Math.max(0, item.count - 1)
      if (item.count === 0) {
        const family = HELD[item.id].family
        dropEmpty(this.items, item.id)
        const next = this.last && find(this.items, this.last) ? this.last : firstOf(this.items, family)
        if (next) {
          this.last = null
          this.current = next
          this.switchLeft = SWITCH_TIME
        }
      }
    }
  }

  /** 装填。予備から弾倉へ、入るぶんだけ移す */
  reload(): boolean {
    const item = this.item
    if (!item || !('ammo' in item)) return false
    const spec = WEAPONS[item.id]
    const room = spec.magazine - item.ammo
    if (room <= 0 || item.reserve <= 0) return false
    const moved = Math.min(room, item.reserve)
    item.ammo += moved
    item.reserve -= moved
    return true
  }

  /**
   * 繋ぎ直したときに、サーバーが持っていた数を書き戻す。
   *
   * **持っている物にだけ当てる。** サーバーはまだ銃ごとの表で返してくるが、
   * こちらは持っている物しか持たない。持っていない銃の弾は捨てる。
   */
  restore(
    magazine: Partial<Record<GunId, number>>,
    reserve: Partial<Record<GunId, number>>,
    support: number,
  ): void {
    for (const item of this.items) {
      if ('ammo' in item) {
        item.ammo = magazine[item.id] ?? item.ammo
        item.reserve = reserve[item.id] ?? item.reserve
      } else if ('count' in item && item.id !== 'magazine') {
        if (support === 0 && item.count > 0) {
          console.warn(
            `[持ち物] ${item.id} を ${item.count} から 0 に戻した。` +
              'サーバーが 0 を返している — 前の命の残りを引き継いでいる可能性',
          )
        }
        item.count = support
      }
    }
  }

  /** 投げられる弾倉が 1 個増える。撃った弾が 1 弾倉ぶん溜まったとき */
  gainMagazine(): void {
    pickUp(this.items, { id: 'magazine', count: 1 })
  }

  /**
   * 拾う。
   *
   * 既に持っている種類なら弾だけ補充、持っていなければ持ち物に加わる。
   * **持ち替えはしない** — 拾った瞬間に手の中が変わると、撃ち合いの最中に
   * 意図しない物を握ることになる。
   */
  pick(found: Carried): boolean {
    return pickUp(this.items, found)
  }

  /**
   * 持ち物から外して地面へ。**外した物を返す** (弾の残りごと置くため)。
   *
   * 手にしていた物を外したら、次の武器へ持ち替える。**ナイフは必ず残る**ので
   * 行き先が無くなることはない (canDrop)。
   */
  drop(id: HeldId): Carried | null {
    const gone = dropFrom(this.items, id)
    if (!gone) return null
    if (this.lastWeapon === id) this.lastWeapon = firstOf(this.items, 'weapon') ?? 'knife'
    if (this.previousWeapon === id) this.previousWeapon = firstOf(this.items, 'weapon')
    if (this.last === id) this.last = this.lastWeapon
    if (this.current === id) {
      this.current = this.lastWeapon
      this.switchLeft = SWITCH_TIME
      this.queued = null
    }
    return gone
  }
}
