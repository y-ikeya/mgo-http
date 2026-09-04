/**
 * 名簿のレプリカ。**部屋に誰が居て、いまどうなっているか。**
 *
 * --- なぜレプリカが要るか ---
 * これまで名簿は**体 (three のオブジェクト) が持っていた**。名前も陣営も体力も
 * 状態も `RemoteSoldier` の中で、位置が届く前に来た報せは `pending` に溜めて
 * いた。**体が無い相手のことは、体のクラスに聞くしかない**という形。
 *
 * 名簿はサーバーが持っている状態そのものなので、レプリカの側に置く。体はレプリカを見て
 * 姿を合わせるだけになる。
 *
 * three も音も知らない。**やることは返り値で返す** (RosterEffect)。
 */

import { isDowned } from '../../domain/player/lifecycle'
// 人の核は遊びの語彙 (domain)。ここはそれを追うだけ
import type { Player } from '../../domain/player/player'
import type { ServerMessage } from '../protocol/types'

export type Roster = Map<string, Player>

export function newRoster(): Roster {
  return new Map()
}

/**
 * レプリカが変わった結果、呼ぶ側にやってもらうこと。
 *
 * **体を触るのは呼ぶ側。** 誰の姿を直すか (sync)、誰を消すか (left)、
 * どこで叫ぶか (died) だけを渡す。
 */
export type RosterEffect =
  /** その人の姿をレプリカに合わせる。まだ体が無ければ、届いたときに合わせる */
  | { kind: 'sync'; id: string; entry: Player }
  /** 部屋を出た。体ごと消す */
  | { kind: 'left'; id: string }
  /** 倒れた。**倒れた場所で叫ぶ** — 撃った側には手応え、遠くの人には合図 */
  | { kind: 'died'; id: string }

const UNKNOWN: Omit<Player, 'name'> = { team: 'blue', health: 100, life: 'joining' }

/** 居なければ作る。名簿より先に位置が届くことがある */
function entryOf(roster: Roster, id: string, name = ''): Player {
  const found = roster.get(id)
  if (found) return found
  const fresh: Player = { name, ...UNKNOWN }
  roster.set(id, fresh)
  return fresh
}

/**
 * 報せを 1 つ受けて、名簿を進める。
 *
 * **自分は名簿に入れない。** 自分の体力も状態も別の道で届く (health / life) し、
 * 自分の体は remotes ではなく player が持っている。
 */
export function applyRoster(
  roster: Roster,
  message: ServerMessage,
  selfId: string,
): RosterEffect[] {
  switch (message.type) {
    case 'roster': {
      const effects: RosterEffect[] = []
      for (const player of message.players) {
        if (player.id === selfId) continue
        const entry = entryOf(roster, player.id, player.name)
        entry.name = player.name
        entry.team = player.team
        entry.health = player.health
        // **状態を先に入れる。** 無いと既定の joining のまま = 戦場に居ない扱いで、
        // 位置が届いていても一度も描かれない
        if (player.life) entry.life = player.life
        effects.push({ kind: 'sync', id: player.id, entry })
      }
      return effects
    }

    case 'join': {
      if (message.id === selfId) return []
      const entry = entryOf(roster, message.id, message.name)
      entry.name = message.name
      if (message.team) entry.team = message.team
      return [{ kind: 'sync', id: message.id, entry }]
    }

    case 'health': {
      if (message.id === selfId) return []
      const entry = entryOf(roster, message.id)
      entry.health = message.health
      return [{ kind: 'sync', id: message.id, entry }]
    }

    case 'life': {
      if (message.id === selfId) return []
      const entry = entryOf(roster, message.id)
      const died = !isDowned(entry.life) && isDowned(message.state)
      entry.life = message.state
      const effects: RosterEffect[] = [{ kind: 'sync', id: message.id, entry }]
      if (died) effects.push({ kind: 'died', id: message.id })
      return effects
    }

    case 'leave':
      roster.delete(message.id)
      return [{ kind: 'left', id: message.id }]

    default:
      return []
  }
}
