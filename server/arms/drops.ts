/**
 * 落ちている武器 (サーバー側)。
 */

import { canDrop, isGun, type Carried } from '../../src/domain/item/held'
import { canAct } from '../../src/domain/player/lifecycle'
import type { Player } from '../../src/domain/player/player'
import type { ClientMessage } from '../../src/protocol/types'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast } from '../world'

import type { HeldId } from '../../src/domain/item/held'
import type { ServerMessage } from '../../src/protocol/types'

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


/** 落ちている物を、持ち物の形へ。**弾数を持つ物と、数だけの物がある** */
function carriedOf(item: Dropped): Carried {
  if (isGun(item.weapon)) {
    return { id: item.weapon, ammo: item.ammo, reserve: item.reserve }
  }
  if (item.weapon === 'grenade' || item.weapon === 'claymore' || item.weapon === 'magazine') {
    return { id: item.weapon, count: item.count }
  }
  return { id: item.weapon } as Carried
}

/**
 * 武器を地面へ置く。
 *
 * **持ち物を持っているのはクライアント側**なので、何を置いたかは申告して
 * もらう。こちらは「その銃のレプリカを捨てる」だけ — 繋ぎ直したときに、置いた
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
  // 手放したら持ち物から外れる。**選んだ主武器でも同じ** — 置いた銃を他人に
  // 拾わせながら自分も撃てる、が無くなる。
  //
  // 弾数も一緒に消える (持ち物が弾を抱えているので)。以前は kit と ammo を
  // 別々に消していて、**片方だけ消し忘れる余地**があった
  player.inventory.drop(message.weapon)
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
  // **拾えば持ち物に入る。** 選んでいない銃を持てるのはこれがあるから。
  // 弾も一緒に入る — 地面に落ちていた残弾をそのまま引き継ぐ
  player.inventory.pick(carriedOf(best))
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
