/**
 * 落ちている武器 (サーバー側)。
 */

import { canDrop, isGun } from '../../src/domain/item/held'
import { canAct } from '../../src/domain/player/lifecycle'
import { type Player } from '../../src/domain/player/player'
import { type ClientMessage } from '../../src/net/types'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast } from '../world'

import { type HeldId } from '../../src/domain/item/held'
import { type ServerMessage } from '../../src/net/types'

/**
 * 地面に落ちている武器。
 *
 * **置いた本人の物ではなくなる。** 誰でも拾える — 敵の銃を奪って使うのが
 * この仕掛けの面白い所で、味方だけが拾えるなら「捨てる」に意味が無い。
 *
 * 位置はサーバーが持つ。置いた瞬間の足元で、以後は動かない (蹴って転がる、
 * のような話は無い)。
 */
export interface Dropped {
  id: number
  weapon: HeldId
  ammo: number
  reserve: number
  count: number
  x: number
  y: number
  z: number
  yaw: number
}

export let droppedId = 0

/**
 * 拾える距離 (m)。**落ちている物を中心とした半径 1m の円。**
 *
 * 近づいて押す、という手間を残す。広くすると「通りかかったら勝手に拾える」に
 * なって、置いてある物を避けて通ることができなくなる。
 */
export const PICKUP_RANGE = 1.0

/** 落ちている物を 1 つぶん配る形にする */
export function droppedMessage(item: Dropped): ServerMessage {
  return {
    type: 'dropped',
    id: item.id,
    weapon: item.weapon,
    ammo: item.ammo,
    reserve: item.reserve,
    count: item.count,
    at: [item.x, item.y, item.z],
    yaw: item.yaw,
  }
}


/**
 * 武器を地面へ置く。
 *
 * **持ち物を持っているのはクライアント側**なので、何を置いたかは申告して
 * もらう。こちらは「その銃の写しを捨てる」だけ — 繋ぎ直したときに、置いた
 * はずの銃が戻ってきては困る。
 */
export function dropWeapon(room: RoomWorld, player: Player, message: ClientMessage): void {
  if (message.type !== 'drop') return
  if (!canDrop(message.weapon)) return
  if (!canAct(player.life)) return
  const item: Dropped = {
    id: ++droppedId,
    weapon: message.weapon,
    ammo: message.ammo ?? 0,
    reserve: message.reserve ?? 0,
    count: message.count ?? 0,
    x: player.x,
    y: player.y,
    z: player.z,
    // 置いた向き。転がっている絵にするために、体の向きから 90 度倒す
    yaw: player.yaw + Math.PI / 2,
  }
  room.dropped.push(item)
  const put = message.weapon
  if (isGun(put)) {
    player.ammo.magazine[put] = 0
    player.ammo.reserve[put] = 0
  }
  broadcast(room, droppedMessage(item))
}

/**
 * 拾う。**どれを拾うかはこちらが決める** (一番近い物)。
 *
 * 位置を持っているのはサーバーなので、離れた所の物を指して「拾った」と
 * 言われても通らない。
 */
export function pickUp(room: RoomWorld, player: Player): void {
  if (!canAct(player.life)) return
  let best: Dropped | null = null
  let nearest = PICKUP_RANGE
  for (const item of room.dropped) {
    const distance = Math.hypot(item.x - player.x, item.z - player.z)
    if (distance > nearest) continue
    best = item
    nearest = distance
  }
  if (!best) return
  room.dropped.splice(room.dropped.indexOf(best), 1)
  const got = best.weapon
  if (isGun(got)) {
    player.ammo.magazine[got] = best.ammo
    player.ammo.reserve[got] = best.reserve
  }
  sessionOf(player).socket.send(
    JSON.stringify({
    type: 'picked',
    id: best.id,
    weapon: best.weapon,
    ammo: best.ammo,
    reserve: best.reserve,
    count: best.count,
    } satisfies ServerMessage),
  )
  broadcast(room, { type: 'droppedGone', id: best.id })
}
