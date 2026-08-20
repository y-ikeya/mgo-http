/**
 * 試合。**部屋 1 つ分の状態と、そこに座っている人たち。**
 *
 * server/index.ts から出したもう半分 (もう半分は player.ts)。ここに在るのは
 * 「誰が席に着いているか」「残機はいくつか」「いまどの段階か」で、
 * **誰にどう配るかは接続の話**なので入れない。
 *
 * 置き場所の規則は docs/design.md の 7。
 */
import { isSeated } from './lifecycle'
import type { Player, Team } from './player'

/**
 * 試合の段階。
 *
 *     waiting     人を待っている
 *     countdown   全員を湧き地点へ戻してから数える
 *     playing     走っている
 *     over        決着。結果を読む時間
 */
export type Phase = 'waiting' | 'countdown' | 'playing' | 'over'

/**
 * 試合を始めるのに要る人数。
 *
 * 各陣営に 1 人。片方しか居ない状態で時計を回すと、誰も居ない相手に対して
 * 勝ったことになる。
 */
export const MIN_PLAYERS = 2

/**
 * 席を空けて待つ時間 (ms)。
 *
 * リロードや一瞬の電波切れで戻ってこられる長さ。長くすると、抜けた相手を
 * 待って試合が始まらない時間も伸びるので、ほどほどに。
 */
export const RECONNECT_GRACE = 30_000

export interface Match {
  players: Map<string, Player>
  /** 残機。0 にされた側が負け */
  blue: number
  red: number
  endsAt: number
  phase: Phase
  winner?: Team | 'draw'
  /** 最後に状態を配った時刻。1 秒ごとに配る */
  lastBroadcast: number
  /** 最後に「切れた人の体」を配り直した時刻 */
  lastLimbo: number
  /**
   * いま走っている試合の身元。記録に要る。
   *
   * 始まった時に発番して、終わるまで変えない。**離脱した人はその場で書く**ので、
   * 試合が終わってから採番したのでは間に合わない。
   */
  matchId: string | null
  startedAt: number
}

export function newMatch(): Match {
  return {
    players: new Map(),
    blue: 0,
    red: 0,
    endsAt: 0,
    phase: 'waiting',
    lastBroadcast: 0,
    lastLimbo: 0,
    matchId: null,
    startedAt: 0,
  }
}

/** 席番号を配る。抜けた番号は空くまで使い回さない (取り違えを避ける) */
export function nextSlot(room: Match): number {
  const used = new Set([...room.players.values()].map((p) => p.slot))
  for (let i = 0; i < 0xffff; i++) if (!used.has(i)) return i
  return 0
}

/** 今つながっている人だけ。離脱中の席は配信に入れない */
export function connected(room: Match): Player[] {
  return [...room.players.values()].filter((p) => isSeated(p.life))
}

/**
 * 席を持っている人。**一瞬の離脱を数に入れる。**
 *
 * 試合を続けるかどうかはこちらで数える。繋がっている人だけで数えていた頃は、
 * 片方がリロードした瞬間に人数が割れて待ちへ戻り、戻ってきたときに
 * countdown からやり直しになっていた — 得点も試合の時計も最初から。
 *
 * 席は RECONNECT_GRACE の間だけ空けて待つ、と決めてある。人数もその間は
 * 空けて待つのが筋で、そうでないと「席を残す」という仕掛けが試合の側から
 * 台無しにされる。戻ってこなければ席ごと消えて、そこで初めて人数が割れる。
 */
export function holdingSeats(room: Match, now: number): Player[] {
  return [...room.players.values()].filter(
    (p) => isSeated(p.life) || now - p.lifeAt < RECONNECT_GRACE,
  )
}

/**
 * 少ないほうへ入れる。同数なら青。
 *
 * 本人に選ばせない。人数が偏ったまま始まると、腕前より頭数で決まってしまう。
 */
export function assignTeam(room: Match): Team {
  let blue = 0
  let red = 0
  for (const player of connected(room)) {
    if (player.team === 'blue') blue++
    else red++
  }
  return blue <= red ? 'blue' : 'red'
}

/**
 * 残機を 1 減らす。**残機が動く道はここ 1 本だけ**にする。
 *
 * 以前は点を 2 箇所 (銃と手榴弾) で別々に動かしていた。片方に足し忘れても
 * 試合はそれらしく進むので気づけない。
 *
 * **死因を問わない。** 撃たれても自爆しても自陣の残機が 1 減り、倒した側には
 * 何も入らない。これで「殺されるくらいなら自死する」が成り立たなくなる —
 * どちらで死んでも自陣の損は同じで、敵の得も同じ (ゼロ)。
 */
export function loseTicket(room: Match, team: Team): void {
  if (team === 'blue') room.blue = Math.max(0, room.blue - 1)
  else room.red = Math.max(0, room.red - 1)
}

/**
 * 残っているのが片側だけならその陣営。両方居るか、誰も居なければ null。
 *
 * 不戦勝を出すかどうかの判断に使う。
 */
export function soleTeam(seats: Player[]): Team | null {
  const blue = seats.some((p) => p.team === 'blue')
  const red = seats.some((p) => p.team === 'red')
  if (blue === red) return null
  return blue ? 'blue' : 'red'
}
