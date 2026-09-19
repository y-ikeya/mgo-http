/**
 * AWARENESS。**近くの敵の置き物・投げ物の気配を知らせる。**
 *
 * 誰に何を知らせるかを決めるのはここ (サーバー)。クライアントは物の持ち主を
 * 一様には持っていないし、クレイモアは視線が通るまで届いていない。
 * 「そこに何かある」を知ってよいのは AWARENESS を持つ人だけなので、
 * 知らせる側で絞る。
 *
 * --- 知らせるのは位置だけ ---
 * 種類も向きも送らない。クレイモアなら向きが分かった瞬間に安全な側が読めて、
 * 隠して置く意味が消える。霧として「その辺に何かある」まで。
 *
 * --- 出し入れ ---
 * 席ごとに知らせた札を持つ。半径に入ったら sensed、出たか消えたら sensedGone。
 * 手榴弾は動くので、知らせた位置から離れたら送り直す。
 */

import { connected } from '../src/domain/match/match'
import { onBattlefield } from '../src/domain/player/lifecycle'
import { leakReaches, leakTag, type MatchPlayer } from '../src/domain/player/player'
import { AWARENESS_RADIUS, hasAwareness } from '../src/domain/player/skill'
import type { ServerMessage } from '../src/application/protocol/types'
import type { Team } from '../src/domain/player/player'
import { sessionOf } from './session'
import { friendlyTeam, type RoomWorld } from './world'

/** 動く物を送り直す距離 (m)。霧の大きさより小さければ、途切れて見えない */
const RESEND_DISTANCE = 0.75

interface Sensible {
  key: string
  owner: string
  team: Team
  x: number
  y: number
  z: number
}

/** いま部屋に在る、気配になりうる物 */
function sensibles(room: RoomWorld): Sensible[] {
  const out: Sensible[] = []
  for (const c of room.claymores) out.push({ key: `claymore:${c.id}`, owner: c.owner, team: c.team, x: c.x, y: c.y, z: c.z })
  for (const d of room.decoys) out.push({ key: `decoy:${d.id}`, owner: d.owner, team: d.team, x: d.x, y: d.y, z: d.z })
  for (const l of room.locators) {
    if (!l.body.resting) continue
    out.push({ key: `locator:${l.id}`, owner: l.owner, team: l.team, x: l.body.x, y: l.body.y, z: l.body.z })
  }
  for (const g of room.grenades) out.push({ key: `grenade:${g.id}`, owner: g.owner, team: g.team, x: g.body.x, y: g.body.y, z: g.body.z })
  return out
}

/** 自分の物でも味方の物でもない */
function hostileItem(room: RoomWorld, viewer: MatchPlayer, item: Sensible): boolean {
  if (item.owner === viewer.id) return false
  return !friendlyTeam(room, viewer, item.team)
}

/** 人の気配で、霧の中心にする高さ (足元から)。胸のあたり */
const PERSON_LIFT = 0.3

/**
 * 暴かれた人の気配を知らせる (E LOCATOR)。
 *
 * **物の気配と同じ霧。** 輪郭 (exposeTo) だと向きも姿勢も読めて、壁越しに
 * 撃つ準備まで済む。覗く道具は「どの辺に居るか」までにする。
 *
 * 宛先は exposeTo と同じ規則 (leakTag)。陣営のある部屋は陣営ぜんぶ、
 * 無い部屋は本人だけ。暴かれた本人には送らない。
 *
 * 位置は**この瞬間の物**。次の走査まで動かない。
 */
export function revealTo(room: RoomWorld, subject: MatchPlayer, toward: MatchPlayer, seconds: number): void {
  const tag = leakTag(toward, room.mode.teams)
  const key = `player:${subject.id}`
  const at: [number, number, number] = [subject.x, subject.y + PERSON_LIFT, subject.z]
  const until = Date.now() + seconds * 1000
  for (const viewer of connected(room)) {
    if (viewer.id === subject.id) continue
    if (!leakReaches(tag, viewer)) continue
    const revealed = sessionOf(viewer).revealed
    revealed.set(key, Math.max(until, revealed.get(key) ?? 0))
    sessionOf(viewer).socket.send(JSON.stringify({ type: 'sensed', key, at } satisfies ServerMessage))
  }
}

export function relayAwareness(room: RoomWorld, now: number): void {
  let items: Sensible[] | null = null
  for (const viewer of connected(room)) {
    // 時間で消える気配 (暴かれた人)。切れた分を畳む
    const revealed = sessionOf(viewer).revealed
    for (const [key, until] of revealed) {
      if (now < until) continue
      revealed.delete(key)
      sessionOf(viewer).socket.send(JSON.stringify({ type: 'sensedGone', key } satisfies ServerMessage))
    }

    const sensed = sessionOf(viewer).sensed
    // 取っていない人・戦場に居ない人には何も無い。知らせていた分は畳む
    const able = hasAwareness(viewer.skills) && onBattlefield(viewer.life)
    if (!able) {
      for (const key of sensed.keys()) gone(viewer, key)
      continue
    }
    items ??= sensibles(room)
    const near = new Set<string>()
    for (const item of items) {
      if (!hostileItem(room, viewer, item)) continue
      const dx = item.x - viewer.x
      const dy = item.y - viewer.y
      const dz = item.z - viewer.z
      if (dx * dx + dy * dy + dz * dz > AWARENESS_RADIUS * AWARENESS_RADIUS) continue
      near.add(item.key)
      const told = sensed.get(item.key)
      if (told && Math.hypot(told[0] - item.x, told[1] - item.y, told[2] - item.z) < RESEND_DISTANCE) continue
      const at: [number, number, number] = [item.x, item.y, item.z]
      sensed.set(item.key, at)
      sessionOf(viewer).socket.send(
        JSON.stringify({ type: 'sensed', key: item.key, at } satisfies ServerMessage),
      )
    }
    for (const key of [...sensed.keys()]) if (!near.has(key)) gone(viewer, key)
  }
}

function gone(viewer: MatchPlayer, key: string): void {
  sessionOf(viewer).sensed.delete(key)
  sessionOf(viewer).socket.send(JSON.stringify({ type: 'sensedGone', key } satisfies ServerMessage))
}
