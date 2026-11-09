/**
 * **敬礼で繋がる** (domain/player/link.ts)。結ぶのも切るのもここ。
 *
 * 繋がっている味方どうしは、暴いた情報を分け合う (player.ts の leakReaches)。
 * 宛先の判定は配るたびに問うので位置は自然に揃うが、**輪郭の光 (exposed) と気配の霧 (sensed) は
 * 知らせた時の 1 通**で画面に出る。繋がった・切れた瞬間に、その差分をここで送り直す
 * (繋がる前に抜いていた光も、繋がった時点から仲間の画面に出る。切れたら消える)
 */
import { connected } from '../src/domain/match/match'
import { isHostile } from '../src/domain/match/room'
import { canLink } from '../src/domain/player/link'
import { leakReaches, type MatchPlayer } from '../src/domain/player/player'
import type { ServerMessage } from '../src/application/protocol/types'
import { sessionFor, sessionOf } from './session'
import type { RoomWorld } from './world'

/** 手を挙げている味方どうしを結ぶ。毎刻み。陣営の無い部屋には味方が居ない */
export function updateLinks(room: RoomWorld, now: number): void {
  if (!room.mode.teams) return
  const here = connected(room).filter((p) => !p.bot)
  for (let i = 0; i < here.length; i++) {
    for (let j = i + 1; j < here.length; j++) {
      const a = here[i]!
      const b = here[j]!
      if (a.links.has(b.id) || isHostile(room.mode, a, b) || !canLink(a, b)) continue
      const before = [snapshotOf(room, a, now), snapshotOf(room, b, now)] as const
      a.links.add(b.id)
      b.links.add(a.id)
      sendLinks(a)
      sendLinks(b)
      refreshExposure(room, a, before[0], now)
      refreshExposure(room, b, before[1], now)
      shareFog(b, a, now)
      shareFog(a, b, now)
    }
  }
}

/**
 * その人の繋がりを全部切る。**倒れた・切れた・支度へ戻った・部屋を出た時** (world.ts の setLife、
 * match.ts の leaveRoom)。相手の側からも外し、分け合っていた輪郭の光を両方の画面から消す
 */
export function breakLinks(room: RoomWorld, player: MatchPlayer, now = Date.now()): void {
  if (player.links.size === 0) return
  const others = [...player.links].map((id) => room.players.get(id)).filter((p): p is MatchPlayer => !!p)
  const before = new Map([player, ...others].map((p) => [p, snapshotOf(room, p, now)] as const))
  for (const other of others) other.links.delete(player.id)
  player.links.clear()
  for (const [p, seen] of before) {
    sendLinks(p)
    refreshExposure(room, p, seen, now)
  }
}

/** 繋がっている相手を本人へ知らせる。画面はこれに合わせて光らせる */
function sendLinks(player: MatchPlayer): void {
  sessionFor(player)?.socket.send(JSON.stringify({ type: 'links', ids: [...player.links] } satisfies ServerMessage))
}

/** その人の画面で輪郭が光っている相手と、消える時刻 */
function snapshotOf(room: RoomWorld, viewer: MatchPlayer, now: number): Map<string, number> {
  const seen = new Map<string, number>()
  for (const target of room.players.values()) {
    if (target.id === viewer.id) continue
    let until = 0
    for (const [tag, at] of target.leaks) if (at > now && leakReaches(tag, viewer)) until = Math.max(until, at)
    if (until > 0) seen.set(target.id, until)
  }
  return seen
}

/** 繋がりが変わった後の輪郭の光を送り直す。**増えた・伸びた物は残りの秒で、消えた物は 0 秒で** */
function refreshExposure(room: RoomWorld, viewer: MatchPlayer, before: Map<string, number>, now: number): void {
  const session = sessionFor(viewer)
  if (!session) return
  const after = snapshotOf(room, viewer, now)
  for (const [id, until] of after) {
    if (before.get(id) === until) continue
    session.socket.send(JSON.stringify({ type: 'exposed', id, seconds: (until - now) / 1000 } satisfies ServerMessage))
  }
  for (const id of before.keys()) {
    if (after.has(id)) continue
    session.socket.send(JSON.stringify({ type: 'exposed', id, seconds: 0 } satisfies ServerMessage))
  }
}

/**
 * 繋がった相手へ、いま見えている人の気配 (霧) を渡す。霧はその瞬間の位置に置く物なので、
 * 位置ごと写す (aware.ts の revealTo が控えている)。消えるのは元と同じ時刻
 */
function shareFog(from: MatchPlayer, to: MatchPlayer, now: number): void {
  const source = sessionOf(from)
  const target = sessionFor(to)
  if (!target) return
  for (const [key, until] of source.revealed) {
    const at = source.revealedAt.get(key)
    if (until <= now || !at || key === `player:${to.id}`) continue
    if ((target.revealed.get(key) ?? 0) >= until) continue
    target.revealed.set(key, until)
    target.revealedAt.set(key, at)
    target.socket.send(JSON.stringify({ type: 'sensed', key, at } satisfies ServerMessage))
  }
}
