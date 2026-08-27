/**
 * 試合のレプリカ。**サーバーが持っている状態を、こちら側で追従するだけ。**
 *
 * --- なぜ層を分けるか ---
 * `server/` と同じことをしている — 状態を持ち、報せを受けて更新する。違うのは
 * **決めるか従うか**だけ。同じ語彙で書いておくと、「サーバーが持っている状態」と
 * 「クライアントが思っている状態」の食い違いが型で見える。この repo で見つけた
 * 穴はほぼ全部その食い違いだった (段差 0.25m のレプリカ、装備の申告、全部の銃が
 * 420 m/s、主武器を置いても名乗れる)。
 *
 * --- 何を持たないか ---
 * three も音もエフェクトも持たない。**出すことは返り値で渡す** (Effect)。
 * おかげで GL 無しで試せる — いままでここは 218 秒の統合試験でしか触れなかった。
 *
 * 不変にはしない。domain がすでに書き換える流儀 (hurt / enterLife) で、
 * サーバーも同じオブジェクトを持ち回っている。レプリカだけ別の流儀にすると、
 * 同じ状態を 2 通りで書くことになる。
 */

import { MODES, type Mode } from '../../domain/match/room'
import { DEATH_POINTS, KILL_POINTS, SUICIDE_POINTS } from '../../domain/match/scoring'
import type { Team } from '../../domain/player/player'
import type { KillEvent, MatchMessage, ServerMessage } from '../../protocol/types'

/** キルログに残す数。古いものから落ちる */
const KILL_FEED_MAX = 5
/** 点の表示に残す数 */
const POINT_FEED_MAX = 4

/** キルログの 1 行。届いた時刻を添えて、出す側が古いものを間引く */
export interface KillEntry {
  event: KillEvent
  at: number
}

/** 点が動いたこと。右下に出す */
export interface PointEntry {
  label: 'KILL' | 'DEATH' | 'SUICIDE'
  delta: number
  at: number
}

export interface MatchReplica {
  /** 部屋のルール。**入った時点では分からない** — 最初の match で決まる */
  mode: Mode
  /** 直近の試合の報せ。段階・残機・得点 */
  match: MatchMessage | null
  /** 自分の所属。roster で分かる */
  team: Team
  /** 自分が光っているか (個人戦の 1 位) */
  leaking: boolean
  /** 自分を倒した相手。死んだあと映す先。**自爆なら空** */
  killedBy: string
  killFeed: KillEntry[]
  pointFeed: PointEntry[]
}

export function newMatchReplica(): MatchReplica {
  return {
    mode: 'TDM',
    match: null,
    team: 'blue',
    leaking: false,
    killedBy: '',
    killFeed: [],
    pointFeed: [],
  }
}

/**
 * レプリカが変わった結果、**呼ぶ側にやってもらうこと**。
 *
 * ここで音を鳴らしたり three を触ったりしない。何をどう出すかは presentation の
 * 領分で、レプリカは「何が起きたか」だけを渡す。
 */
export type MatchEffect =
  /** 試合の段階が変わった。飛んでいる物を捨てる / 成績表を開く・畳む */
  | { kind: 'phase'; to: MatchMessage['phase']; teams: boolean }
  /** 自分の所属が分かった。湧き地点がこれで決まる */
  | { kind: 'team'; team: Team }

/**
 * 報せを 1 つ受けて、レプリカを進める。
 *
 * @param selfId 自分の id。**自分に関わる報せだけ別に扱う**ため
 * @param now 届いた時刻。表示を間引くのに使う (時計は持ち込まない)
 */
export function applyMatch(
  replica: MatchReplica,
  message: ServerMessage,
  selfId: string,
  now: number,
): MatchEffect[] {
  switch (message.type) {
    case 'match': {
      replica.mode = message.mode
      replica.leaking = message.leader === selfId
      const changed = replica.match?.phase !== message.phase
      replica.match = message
      return changed ? [{ kind: 'phase', to: message.phase, teams: MODES[message.mode].teams }] : []
    }

    case 'roster': {
      const me = message.players.find((player) => player.id === selfId)
      if (!me) return []
      replica.team = me.team
      return [{ kind: 'team', team: me.team }]
    }

    case 'kill': {
      replica.killFeed.unshift({ event: message, at: now })
      replica.killFeed.length = Math.min(replica.killFeed.length, KILL_FEED_MAX)
      // 倒された。この後しばらくはこの人を映す。**自爆なら映すものが無い**
      if (message.victim === selfId) {
        replica.killedBy = message.killer === selfId ? '' : message.killer
      }
      score(replica, message, selfId, now)
      return []
    }

    default:
      return []
  }
}

/**
 * 自分が絡んだキルだけ点にする。
 *
 * **量を決めるのは domain** (match/scoring.ts)。ここでやるのは、自分の話かどうかを
 * 見分けて並べることだけ。
 */
function score(replica: MatchReplica, event: KillEvent, selfId: string, now: number): void {
  const mine = event.killer === selfId
  const died = event.victim === selfId
  if (!mine && !died) return

  const suicide = mine && died
  const label = suicide ? 'SUICIDE' : mine ? 'KILL' : 'DEATH'
  const delta = suicide ? SUICIDE_POINTS : mine ? KILL_POINTS : DEATH_POINTS
  replica.pointFeed.unshift({ label, delta, at: now })
  replica.pointFeed.length = Math.min(replica.pointFeed.length, POINT_FEED_MAX)
}
