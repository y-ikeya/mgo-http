import { CHOICES, SUPPORTS, type SupportId, type WeaponId } from '../../domain/item/weapons'
import { primariesOf, secondariesOf, secondaryOf, supportsOf, type RoomName, type Side } from '../../domain/match/room'

/**
 * **装備を選ぶ。** 次に湧く時の装備 (pending) と、いま持っている装備 (held)、その部屋・その側で
 * 持ち込める物 (armory)。
 *
 * --- なぜ外に出したか (2026-11-03 本人「1 やって」、装備フローの reducer 化) ---
 * Game.ts の中で、選ぶ・丸める・湧いた時に確定する・繋ぎ直しで戻す、を命令形で持っていた。
 * 描画器が無いと試せないクラスの中で、**選んだ物と配られる物が食い違う**不具合を何度も
 * 直してきた所 (M9 から印が動かない、P90 を選んだのに AK で戻る、狙撃銃の部屋で何も選ばれて
 * いない)。ここなら選んだ物を入れて状態を見るだけで試せる。
 *
 * three も通信も保存も知らない。**やること (LoadoutEffect) を返す**: 送る・持ち物を配り直す・
 * 画面へ知らせる・STEALTH を持つか。
 *
 * 決めるのはサーバー (domain/player/equip.ts の fitLoadout で同じ表で丸める)。ここは手元の見せ方を
 * それに合わせる
 */
export interface Loadout {
  /** 主武器。**銃を外した部屋では null** */
  primary: WeaponId | null
  /** 副武器。**部屋が外していれば null** */
  secondary: WeaponId | null
  support: SupportId
  /** STEALTH を持つか。**TSNE の攻める側だけ** */
  stealth: boolean
}

/** その部屋・その側で持ち込める物 (domain/match/room.ts) */
export interface Armory {
  primaries: readonly WeaponId[]
  /** 副武器の既定。**null ならこの部屋は副武器を持たせない** */
  secondary: WeaponId | null
  secondaries: readonly WeaponId[]
  supports: readonly SupportId[]
}

export interface LoadoutChoice {
  armory: Armory
  /** 次に湧いた時の装備。試合中に変えても、いま持っている物は変わらない */
  pending: Loadout
  /** 湧いた時に確定した装備 (いま持っている物) */
  held: Loadout
}

/** この端末に覚えている前回の選び (infra/prefs/loadout.ts)。読めなければ null */
export interface LastChoice {
  primary?: string | null
  secondary?: string | null
  support?: string
}

export type LoadoutSlot = 'primary' | 'secondary' | 'support'

export type LoadoutEffect =
  /** 選んだ物をサーバーへ知らせる (と、この端末に覚える)。**主武器も送る** — 繋ぎ直した時に返してもらうため */
  | { kind: 'send'; loadout: Loadout }
  /** いま持っている装備から持ち物を配り直す (支度の間に選び直した分をすぐ効かせる) */
  | { kind: 'refill' }
  /** 選んでいる物が変わった。画面へ知らせる */
  | { kind: 'chosen' }
  /** STEALTH を持つか (側が分かった) */
  | { kind: 'stealth'; owned: boolean }

/** 持ち込める物。部屋が分からない時 (練習の手元など) は全部 */
export function armoryOf(room: RoomName | null, side: Side | null): Armory {
  if (!room) return { primaries: CHOICES.primary, secondary: 'm9', secondaries: CHOICES.secondary, supports: SUPPORTS }
  return {
    primaries: primariesOf(room, side),
    secondary: secondaryOf(room, side),
    secondaries: secondariesOf(room, side),
    supports: supportsOf(room, side),
  }
}

/**
 * 部屋に入った時の選び。**前回選んだ物から始める。初めてなら一覧の先頭** (本人 2026-10-14)。
 * 部屋で持ち込めない物は先頭へ丸める。繋ぎ直した時はサーバーが覚えている物が後から届いて
 * 上書きする (resumeLoadout、そちらのほうが新しい)
 */
export function newLoadoutChoice(room: RoomName | null, last: LastChoice | null): LoadoutChoice {
  // 部屋に入った時点では攻守が分からない。側が分かったら fitArmory で丸め直す
  const armory = armoryOf(room, null)
  const lastPrimary = last?.primary as WeaponId | null | undefined
  const lastSecondary = last?.secondary as WeaponId | null | undefined
  const lastSupport = last?.support as SupportId | undefined
  const pending: Loadout = {
    primary: lastPrimary && armory.primaries.includes(lastPrimary) ? lastPrimary : (armory.primaries[0] ?? null),
    // 手元の装備も部屋に合わせる。**サーバーは外しているのにこちらだけ持つ**を防ぐ
    secondary:
      armory.secondary !== null && lastSecondary && armory.secondaries.includes(lastSecondary)
        ? lastSecondary
        : armory.secondary,
    support: lastSupport && armory.supports.includes(lastSupport) ? lastSupport : 'grenade',
    stealth: false,
  }
  return { armory, pending, held: { ...pending } }
}

/**
 * 1 つ選ぶ。**送って、組める場面ならすぐ効かせる。**
 *
 * 組めるのは湧く時だけなので、その場面 (canChoose) では待たずに反映する。次の湧きを待つと、
 * 支度の間に選び直した分が 1 試合ぶん遅れて効く。サーバーも同じルールで手榴弾を配っている
 * ので、揃えないと画面には 3 個あるのに投げられない、が起きる
 *
 * 副武器を持たせない部屋では副武器を選んでも何もしない
 */
export function chooseLoadout(
  choice: LoadoutChoice,
  slot: LoadoutSlot,
  id: WeaponId | SupportId | null,
  canChoose: boolean,
): LoadoutEffect[] {
  if (slot === 'secondary') {
    if (choice.armory.secondary === null) return []
    choice.pending.secondary = id as WeaponId
  } else if (slot === 'primary') {
    choice.pending.primary = id as WeaponId | null
  } else {
    choice.pending.support = id as SupportId
  }
  const effects: LoadoutEffect[] = [{ kind: 'send', loadout: { ...choice.pending } }]
  if (canChoose) {
    choice.held = { ...choice.pending }
    effects.push({ kind: 'refill' })
  }
  effects.push({ kind: 'chosen' })
  return effects
}

/**
 * 一覧の中を隣へ送った先 (パッドの左右)。**端では回る。** 選び直すのは送った先の物で、決定の
 * 一手間は無い — 挟むと、選んだのに効いていない状態が READY を押すまで気づけない
 *
 * @returns 送った先。一覧が空なら null
 */
export function stepChoice(
  choice: LoadoutChoice,
  slot: LoadoutSlot,
  step: number,
): WeaponId | SupportId | null {
  const list: readonly (WeaponId | SupportId)[] =
    slot === 'primary' ? choice.armory.primaries : slot === 'secondary' ? choice.armory.secondaries : choice.armory.supports
  const current = choice.pending[slot]
  if (list.length === 0) return null
  const at = current === null ? 0 : list.indexOf(current)
  const from = at < 0 ? 0 : at
  return list[(from + step + list.length) % list.length] ?? null
}

/**
 * 持ち込める物を、部屋と**いまの側**から引き直す (TSNE は攻める側と守る側で違う)。
 *
 * 選んでいる物が外れたら一覧の先頭へ丸める。サーバーも同じ表で丸める (server/match.ts の
 * fitToRoom) ので、ここは見せ方を合わせるだけ
 *
 * @param side 側が分からない (分かれない部屋・まだ届いていない) なら null
 */
export function fitArmory(choice: LoadoutChoice, room: RoomName | null, side: Side | null): LoadoutEffect[] {
  if (!room) return []
  const armory = armoryOf(room, side)
  choice.armory = armory
  const pending = choice.pending
  if (pending.primary === null ? armory.primaries.length > 0 : !armory.primaries.includes(pending.primary)) {
    pending.primary = armory.primaries[0] ?? null
  }
  if (pending.secondary === null ? armory.secondaries.length > 0 : !armory.secondaries.includes(pending.secondary)) {
    pending.secondary = armory.secondaries[0] ?? null
  }
  if (!armory.supports.includes(pending.support)) pending.support = armory.supports[0] ?? pending.support
  // STEALTH は攻める側だけが持つ
  pending.stealth = side === 'attack'
  // **いま持っている物にも反映する。** 側が分かる前に湧いていると入らないまま (待機中は湧き直さない)
  choice.held.stealth = pending.stealth
  return [{ kind: 'stealth', owned: pending.stealth }]
}

/** 戦場へ出た。**湧く時に装備が確定する** — 試合中に組み替えても、ここまで反映されない */
export function spawnLoadout(choice: LoadoutChoice): Loadout {
  choice.held = { ...choice.pending }
  return choice.held
}

/**
 * 繋ぎ直した。**サーバーが覚えている物に戻す。** 戻さないと、こちらだけ既定値の手榴弾に戻って、
 * 投げの型を出しているのにサーバーはクレイモアのまま、になる。
 *
 * 持っている物は主武器と support だけ戻す (副武器は湧き直すまで今のまま)。選びは 3 つとも
 */
export function resumeLoadout(
  choice: LoadoutChoice,
  server: { primary: WeaponId | null; secondary: WeaponId | null; support: SupportId },
): void {
  choice.held.support = server.support
  choice.held.primary = server.primary
  choice.pending.support = server.support
  choice.pending.primary = server.primary
  choice.pending.secondary = server.secondary
}
