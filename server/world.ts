/**
 * 部屋の世界。**試合と、その中に在る物。**
 *
 * 配る相手を引くのもここ (broadcast)。
 */

import { type Match, connected, newMatch } from '../src/domain/match/match'
import { ROOM_MODE, type RoomName } from '../src/domain/match/room'
import { type Life } from '../src/domain/player/lifecycle'
import { type Player, type Team, enterLife } from '../src/domain/player/player'
import { type ServerMessage } from '../src/net/types'
import { type Claymore } from './arms/claymore'
import { type Dropped } from './arms/drops'
import { type Grenade } from './arms/grenade'
import { placeTargets } from './match'
import { sessionOf } from './session'

export interface Client {
  /** 発行元が保証した ID。名乗った値ではない (認証が有効なとき) */
  id: string
  /** 発行元が持っていた表示名 */
  name?: string
  /** 繋ぐ前に確かめてある (isRoomName)。以後は部屋の名前として扱ってよい */
  room: RoomName
}

/**
 * 部屋の世界。**試合 (Match) と、そこに在る物。**
 *
 * 語彙では「Match = 試合 = 部屋 1 つ」なのに、実装では手榴弾もクレイモアも
 * 落ちている武器も**モジュール全域の配列**に置いてあり、要素が
 * `room: RoomName` を持って自分がどの部屋の物かを申告していた。そのせいで
 *
 *   - 部屋の名前を 21 本の関数に引き回すことになり
 *   - 物を触るたびに「この部屋の物か」を確かめる行が要り
 *   - 部屋を畳んでも中身が残った (落ちた武器は拾われる以外に消える道が無い)
 *
 * 部屋が持てば全部消える。**Match に足せないのは domain が sim を知らない
 * ため** (手榴弾は Projectile を持つ)。だからサーバー側で包む。
 */
export interface RoomWorld extends Match {
  /** 部屋の名前。配る相手を引くのに要る */
  name: RoomName
  /** 飛んでいる手榴弾 */
  grenades: Grenade[]
  /** 置かれたクレイモア */
  claymores: Claymore[]
  /** 落ちている武器 */
  dropped: Dropped[]
}

export const rooms = new Map<RoomName, RoomWorld>()

/**
 * 投げた物・置いた物の持ち主から見て敵か。
 *
 * 弾と違って手元に Player が無い (飛んでいる物は陣営しか覚えていない) ので、
 * 陣営を渡して同じ規則に通す。DM では同じ色でも巻き込む。
 */
export function hostileToOwner(room: Match, owner: Team, victim: Player): boolean {
  if (room.mode.hostility === 'none') return false
  if (room.mode.hostility === 'all') return true
  return victim.team !== owner
}

/** 同じ側か。物の側に Player が無いとき用 */
export function friendlyTeam(room: Match, viewer: Player, owner: Team): boolean {
  if (room.mode.hostility === 'all') return false
  return viewer.team === owner
}

/** 1 部屋の上限。4 対 4 */
export const ROOM_CAPACITY = 8

export function roomOf(name: RoomName): RoomWorld {
  let room = rooms.get(name)
  if (!room) {
    room = { ...newMatch(ROOM_MODE[name]), name, grenades: [], claymores: [], dropped: [] }
    if (room.mode.id === 'PRACTICE') placeTargets(room)
    rooms.set(name, room)
  }
  return room
}

/** 部屋の全員へ。except を渡すとその 1 人を除く */
export function broadcast(room: RoomWorld, message: ServerMessage, except?: string): void {
  const payload = JSON.stringify(message)
  for (const player of connected(room)) {
    if (player.id !== except) sessionOf(player).socket.send(payload)
  }
}

/**
 * 状態を移す。**書き換えるのはここだけ。**
 *
 * 直に代入させないのは、遷移が飛ぶと辻褄が合わなくなるため。倒れた人を
 * 支度を経ずに湧かせると装備が配り直されないし、離脱中の席を生き返らせると
 * 誰も居ない場所に人が立つ。通ってよい道は lifecycle.ts の表が持っている。
 *
 * 変わったことは全員へ知らせる。知らせないと、受け取る側がまた
 * 「位置が来ないから倒れたのだろう」と推し量ることになる。
 */
export function setLife(room: RoomWorld, player: Player, next: Life, now = Date.now()): void {
  const before = player.life
  if (!enterLife(player, next, now)) {
    if (before !== next) console.warn(`[状態] ${player.name}: ${before} → ${next} は通れない`)
    return
  }
  broadcast(room, { type: 'life', id: player.id, state: next })
}
