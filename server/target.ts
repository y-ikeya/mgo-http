import { STAGES, type Spot } from '../src/domain/stage'
import type { MatchPlayer, Team } from '../src/domain/player/player'
import { canAct } from '../src/domain/player/lifecycle'
import { isAsleep } from '../src/domain/player/stamina'
import { atBase } from '../src/domain/rule/resupply'
import { carryTo, drop, placeTarget, returnIfIdle, take, targetHomeFor, touches } from '../src/domain/match/target'
import { broadcast, type RoomWorld } from './world'

/**
 * TSNE のターゲットを動かす (決まりは domain/match/target.ts)。**サーバーだけが持つ。**
 *
 * 誰が取ったか・どこにあるかを決めるのはここ。画面は配られた位置に置き、運ばれていれば
 * 運ぶ人の頭の上に浮かせるだけ (取った瞬間を画面に決めさせると、2 人が同時に取れる)
 */

/** 運ばれているターゲットの位置を配る間隔 (ms) */
const CARRIED_SEND_MS = 100
/** 部屋ごとの、最後に運ばれている位置を配った時刻 */
const carriedSentAt = new WeakMap<RoomWorld, number>()

function baseOf(room: RoomWorld, team: Team): Spot {
  return room.stage.bases[team] ?? STAGES[room.stage.name].bases[team]
}

function defenceOf(room: RoomWorld): Team {
  return room.attack === 'blue' ? 'red' : 'blue'
}

/** ラウンドの始まりに置く。**守る側の基地に近いほうの置き場所** */
export function placeTsneTarget(room: RoomWorld): void {
  room.targetDelivered = false
  room.target = null
  if (!room.mode.sides) return
  const home = targetHomeFor(room.stage.tsneTargets, baseOf(room, defenceOf(room)))
  if (home) room.target = placeTarget(home)
}

/** ラウンドの終わり・試合の合間。片付ける */
export function clearTsneTarget(room: RoomWorld): void {
  room.target = null
  room.targetDelivered = false
}

/** 運べる人か (攻める側で、立っていて、眠っていない) */
function canCarry(room: RoomWorld, player: MatchPlayer, now: number): boolean {
  return player.team === room.attack && canAct(player.life) && !isAsleep(player.sleepUntil, now)
}

/**
 * 1 刻みぶん進める。**変わったら true** (すぐ配り直す)。
 *
 *   運ぶ人が倒れた / 眠った / 抜けた → その場に落ちる
 *   運ぶ人が自陣の枠に入った         → 運び込んだ (targetDelivered)
 *   落ちたまま 30 秒                → 置き場所へ戻る
 *   攻める側が触れた                → 取る (守る側に知らせる)
 */
export function updateTsneTarget(room: RoomWorld, now: number): boolean {
  const target = room.target
  if (!target || room.phase !== 'playing') return false

  if (target.carrier) {
    const carrier = room.players.get(target.carrier)
    if (!carrier || !canCarry(room, carrier, now)) {
      room.target = drop(target, carrier?.x ?? target.x, carrier?.y ?? target.y, carrier?.z ?? target.z, now)
      if (carrier) announceDropped(room, carrier)
      return true
    }
    room.target = carryTo(target, carrier.x, carrier.y, carrier.z)
    if (atBase(carrier.x, carrier.y, carrier.z, baseOf(room, room.attack))) {
      room.targetDelivered = true
      return true
    }
    // 運ばれている位置を 1 秒に 10 回配る (人の姿は見えている相手の分しか届かないので別便)
    if (now - (carriedSentAt.get(room) ?? 0) >= CARRIED_SEND_MS) {
      carriedSentAt.set(room, now)
      broadcast(room, { type: 'targetAt', x: carrier.x, y: carrier.y, z: carrier.z, carrier: carrier.id })
    }
    return false
  }

  const back = returnIfIdle(target, now)
  if (back !== target) {
    room.target = back
    return true
  }

  for (const player of room.players.values()) {
    if (!canCarry(room, player, now) || !touches(target, player.id, player.x, player.y, player.z, now)) continue
    room.target = take(target, player.id)
    // 全員に知らせる (始まりの指令と同じ帯)
    broadcast(room, { type: 'targetTaken', by: player.id, byName: player.name, byTeam: player.team })
    return true
  }
  return false
}

/** 運んでいる人が持ち物の一覧から選んで落とした。**その人の足元に落ちる** */
export function dropTsneTarget(room: RoomWorld, player: MatchPlayer, now: number): boolean {
  const target = room.target
  if (!target || target.carrier !== player.id || room.phase !== 'playing') return false
  room.target = drop(target, player.x, player.y, player.z, now)
  announceDropped(room, player)
  return true
}

/** 「{名前}がターゲットを手放した」を全員へ */
function announceDropped(room: RoomWorld, player: MatchPlayer): void {
  broadcast(room, { type: 'targetDropped', by: player.id, byName: player.name, byTeam: player.team })
}
