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
  HELD, SWITCH_TIME, buildCarried, cycle as cycleId, dropEmpty, find, firstOf,
  listOf, pickUp, toggle as toggleId,
  type Carried, type Family, type GunId, type HeldId, type Loadout,
} from './held'
import { WEAPONS } from './weapons'

/** 銃の初期弾数。表から引く */
function fullAmmo(id: GunId): { ammo: number; reserve: number } {
  return { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }
}

export class Inventory {
  private items: Carried[] = []
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
    this.switchLeft = 0
  }

  /** いま手にある物 */
  get held(): HeldId {
    return this.current
  }

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
    return HELD[this.current].shoots && !this.switching
  }

  /** いま手にある物の中身 (弾数など)。持っていなければ undefined */
  get item(): Carried | undefined {
    return find(this.items, this.current)
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

  /** その系統の並び。一覧に出す順 */
  list(family: Family): Carried[] {
    return listOf(this.items, family)
  }

  /** 持っている物すべて。画面に出すときだけ使う */
  get all(): readonly Carried[] {
    return this.items
  }

  /** 時計を進める */
  update(dt: number): void {
    if (this.switchLeft > 0) this.switchLeft = Math.max(0, this.switchLeft - dt)
  }

  /**
   * 指した物へ持ち替える。
   *
   * 持っていない物、いま持っている物、持ち替えの最中は何もしない。
   * **持ち替え中に更に持ち替えられると、代償を払わずに済んでしまう。**
   */
  switchTo(id: HeldId): boolean {
    if (this.switching || id === this.current) return false
    if (!find(this.items, id)) return false
    this.last = this.current
    this.current = id
    this.switchLeft = SWITCH_TIME
    return true
  }

  /** 押すだけの持ち替え。直前に持っていた物との往復 */
  toggle(family: Family): boolean {
    if (HELD[this.current].family !== family) {
      const first = firstOf(this.items, family)
      return first !== null && this.switchTo(first)
    }
    return this.switchTo(toggleId(this.items, this.current, this.last))
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
}
