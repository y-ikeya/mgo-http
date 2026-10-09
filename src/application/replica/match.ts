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
import type { VoiceId } from '../../domain/player/voice'
import { DEATH_POINTS, KILL_POINTS, STUN_POINTS, SUICIDE_POINTS } from '../../domain/match/scoring'
import type { Team } from '../../domain/player/player'
import type { KillEvent, MatchMessage, ServerMessage } from '../protocol/types'

/** キルログに残す数。古いものから落ちる */
const KILL_FEED_MAX = 5
/** 点の表示に残す数 */
const POINT_FEED_MAX = 4

/** キルログの 1 行。届いた時刻を添えて、出す側が古いものを間引く */
export interface KillEntry {
  event: KillEvent
  at: number
  /** 倒したのではなく眠らせた。**残機は減っていない** */
  stun?: boolean
}

/** 点が動いたこと。右下に出す */
export interface PointEntry {
  label: 'KILL' | 'DEATH' | 'SUICIDE' | 'STUN'
  delta: number
  at: number
}

/** ボイスの 1 行。キルログと同じ欄に「名前：セリフ」で出す */
export interface VoiceEntry {
  id: string
  name: string
  team: Team
  line: VoiceId
  at: number
}

/**
 * 誰かが抜けた / 戻りを待っている。キルログと同じ欄に出す (2026-10-09 本人)。
 *
 *   away  🫥 名前       … 接続が切れて席が空いている (30 秒は戻りを待つ)
 *   left  🏃‍♀️🚪 名前   … 出た。待っても戻らなかった時もこちらに変わる
 */
export interface PresenceEntry {
  id: string
  name: string
  team: Team
  state: 'away' | 'left'
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
  voiceFeed: VoiceEntry[]
  pointFeed: PointEntry[]
  presenceFeed: PresenceEntry[]
}

export function newMatchReplica(): MatchReplica {
  return {
    mode: 'TDM',
    match: null,
    team: 'blue',
    leaking: false,
    killedBy: '',
    killFeed: [],
    voiceFeed: [],
    pointFeed: [],
    presenceFeed: [],
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
   * 自分の弾が頭に入って、倒した / 眠らせた。**音で報いる。**
   *
   * キルログの 💀 だけだと視線を外さないと分からない。撃った瞬間に耳で
   * 分かる (熱中の条件 1: 行動に応えが返る)。他人の HS には出さない。
   */
  | { kind: 'headshot' }
  /** 誰かがボイスを言った。音を鳴らす (出す欄はレプリカが持っている) */
  | { kind: 'voice'; line: VoiceId }

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
      notePresence(replica, replica.match, message, selfId, now)
      replica.match = message
      return changed ? [{ kind: 'phase', to: message.phase, teams: MODES[message.mode].teams }] : []
    }

    case 'roster': {
      const me = message.players.find((player) => player.id === selfId)
      if (!me) return []
      replica.team = me.team
      return [{ kind: 'team', team: me.team }]
    }

    /*
     * 誰かが眠らされた。**キルログに並べるが、倒したのとは別の行。**
     *
     * 同じ流れに載せるのは、見る側にとって「誰が誰に何をしたか」は同じ
     * 種類の知らせだから。ただし残機は減っていないので、倒したのと同じ
     * 文言にはしない (出す側が stun を見て書き分ける)。
     */
    case 'stun': {
      replica.killFeed.unshift({
        event: {
          type: 'kill',
          killer: message.by,
          killerName: message.byName,
          killerTeam: message.byTeam,
          victim: message.target,
          victimName: message.targetName,
          victimTeam: message.targetTeam,
          weapon: message.weapon,
          headshot: message.head,
        },
        at: now,
        stun: true,
      })
      replica.killFeed.length = Math.min(replica.killFeed.length, KILL_FEED_MAX)
      if (message.by === selfId) {
        replica.pointFeed.unshift({ label: 'STUN', delta: STUN_POINTS, at: now })
        replica.pointFeed.length = Math.min(replica.pointFeed.length, POINT_FEED_MAX)
        if (message.head) return [{ kind: 'headshot' }]
      }
      return []
    }

    case 'voice': {
      replica.voiceFeed.unshift({ id: message.id, name: message.name ?? '', team: message.team ?? 'blue', line: message.line, at: now })
      replica.voiceFeed.length = Math.min(replica.voiceFeed.length, KILL_FEED_MAX)
      return [{ kind: 'voice', line: message.line }]
    }

    case 'kill': {
      replica.killFeed.unshift({ event: message, at: now })
      replica.killFeed.length = Math.min(replica.killFeed.length, KILL_FEED_MAX)
      // 倒された。この後しばらくはこの人を映す。**自爆なら映すものが無い**
      if (message.victim === selfId) {
        replica.killedBy = message.killer === selfId ? '' : message.killer
      }
      score(replica, message, selfId, now)
      // 自爆は頭に入らない。倒したのが自分で、相手が別人のときだけ
      if (message.headshot && message.killer === selfId && message.victim !== selfId) {
        return [{ kind: 'headshot' }]
      }
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

/**
 * 前の match と見比べて、**抜けた人・戻りを待っている人**を欄へ積む。
 *
 * 名簿から消えたら抜けた (自分から出た / 30 秒戻らなかった)。away が立ったら
 * 戻りを待っている。戻ってきたら 🫥 の行を下げる。自分のことは出さない
 */
function notePresence(
  replica: MatchReplica,
  before: MatchMessage | null,
  after: MatchMessage,
  selfId: string,
  now: number,
): void {
  if (!before?.players || !after.players) return
  const next = new Map(after.players.map((player) => [player.id, player]))
  const dropAway = (id: string) => {
    replica.presenceFeed = replica.presenceFeed.filter((entry) => !(entry.id === id && entry.state === 'away'))
  }
  for (const was of before.players) {
    if (was.id === selfId) continue
    const is = next.get(was.id)
    if (!is) {
      dropAway(was.id)
      replica.presenceFeed.unshift({ id: was.id, name: was.name, team: was.team, state: 'left', at: now })
    } else if (is.away && !was.away) {
      replica.presenceFeed.unshift({ id: is.id, name: is.name, team: is.team, state: 'away', at: now })
    } else if (!is.away && was.away) {
      dropAway(is.id)
    }
  }
  replica.presenceFeed.length = Math.min(replica.presenceFeed.length, KILL_FEED_MAX)
}
