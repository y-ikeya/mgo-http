/**
 * 攻める側と守る側 (TSNE)。**どちらの側か・まだ戦えるか・ステルスが効いているか。**
 *
 * 決まりごと (2026-10-17 本人):
 *
 *     攻守       **1 試合 = 先攻と後攻の 2 ラウンド。** ラウンドの間で入れ替わり、間に支度
 *                (スキル選び) は挟まない (2026-10-17 本人)。勝ったラウンドが多い側の勝ち、1 対 1 は引き分け
 *     復活       1 人が復活できる回数を部屋で決める (room.ts の lives、0 なら復活なし)
 *     勝ち負け   相手の側が**全員倒れたか眠った**ら勝ち。時間切れは守る側の勝ち
 *     ステルス   攻める側の体だけが見えなくなる (武器・影・置いた物は見える)。
 *                攻める側の誰かに敵の攻撃が当たると、**攻める側全員**のステルスが
 *                STEALTH_BREAK_MS だけ解ける。解けている間に当たればまた頭から数える。
 *                解けている間が CAUTION (全員の画面に同じ秒数で出る)
 *
 * 色 (Team) とは別の問いにしてある。入れ替えると同じ色が攻めも守りもするので、
 * 「青は攻める」と書くと 1 試合おきに嘘になる。
 */
import { canAct, canBeHurt, onBattlefield } from '../player/lifecycle'
import type { MatchPlayer, Team } from '../player/player'
import { isAsleep } from '../player/stamina'
import type { Match } from './match'
import type { Side } from './room'

/** 当たってからステルスが戻るまで (ms) */
export const STEALTH_BREAK_MS = 5000

/**
 * **CAUTION** (MGO2)。守る側の攻撃や CQC が攻める側に当たって、攻める側全員の STEALTH が
 * 解けている間 (2026-10-17 本人)。全員の画面に同じ秒数で出る。切れる時刻は revealedUntil
 */
export function cautionUntil(room: Match, now: number): number | null {
  return room.mode.sides && room.revealedUntil > now ? room.revealedUntil : null
}

/** その色の側。**側に分かれない部屋では null** */
export function sideOf(room: Match, team: Team): Side | null {
  if (!room.mode.sides) return null
  return team === room.attack ? 'attack' : 'defence'
}

/** 攻守を入れ替える。**試合の頭で必ず 1 回** */
export function swapSides(room: Match): void {
  room.attack = room.attack === 'blue' ? 'red' : 'blue'
}

/**
 * まだ復活できるか。
 *
 * このラウンドで倒れた回数 (roundDeaths) が復活の回数を超えたら終わり。0 なら 1 度倒れたら終わり。
 * **null (部屋が決めていない) は何度でも。**
 */
export function canRespawn(player: MatchPlayer, lives: number | null): boolean {
  return lives === null || player.roundDeaths <= lives
}

/**
 * もう戦えないか。**倒れて復活できないか、眠っている。**
 *
 * 眠っているだけの人も数える — 全員眠らされたら、起きるのを待たずに負け
 * (本人「全員 stun されたら終わりってこともある」)。倒れたが復活を待っている人は
 * まだ戦える。
 */
export function isOut(player: MatchPlayer, lives: number | null, now: number): boolean {
  if (canBeHurt(player.life) && isAsleep(player.sleepUntil, now)) return true
  // 戦場に立っていなくて (倒れている・支度中)、もう湧けない。リロードで入り直した人も支度に居る
  return !canAct(player.life) && !canRespawn(player, lives)
}

/** その色でまだ戦える人数。**数えるのは席を持っている人** (切れている人も体は残る) */
export function standing(seats: readonly MatchPlayer[], team: Team, lives: number | null, now: number): number {
  return seats.filter((p) => p.team === team && !p.bot && !isOut(p, lives, now)).length
}

/**
 * 攻める側のステルスがいま効いているか (人ごとではなく側で 1 つ)。
 *
 * **試合の段階を問わない。** 待機中も効く — 1 人で入って着て、消えるかを確かめられる
 * ように (2026-10-17 本人)。勝ち負けに関わらない段階なので、効いても困らない
 */
export function stealthActive(room: Match, now: number): boolean {
  return room.mode.sides && now >= room.revealedUntil
}

/** STEALTH が効いてよいか。**攻める側で、戦場に立っている間だけ** (着ているかは問わない。位置の通で消す時に使う) */
export function isStealthed(room: Match, player: MatchPlayer, now: number): boolean {
  return stealthActive(room, now) && sideOf(room, player.team) === 'attack' && onBattlefield(player.life)
}

/** いま実際に体が消えているか。**効いてよくて、着ている** */
export function isInvisible(room: Match, player: MatchPlayer, now: number): boolean {
  return isStealthed(room, player, now) && player.wearingStealth
}

/**
 * 当たった。**攻める側の誰かに敵の攻撃が当たったら、攻める側全員のステルスを解く。**
 *
 * 自分で落ちた・味方の爆風は数えない (attacker が居ないか味方)。
 * 解けている間に当たったら、そこから数え直す。
 */
export function disturbStealth(room: Match, victim: MatchPlayer, attacker: MatchPlayer | null, now: number): void {
  if (!room.mode.sides) return
  if (!attacker || attacker.team === victim.team) return
  if (sideOf(room, victim.team) !== 'attack') return
  room.revealedUntil = now + STEALTH_BREAK_MS
}
