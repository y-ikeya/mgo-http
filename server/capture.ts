import { captureWinner, countDown, inGoal, newCapture } from '../src/domain/match/capture'
import type { Team } from '../src/domain/player/player'
import type { RoomWorld } from './world'

/**
 * CAP のカウントを進める (決まりは domain/match/capture.ts)。**サーバーだけが持つ。**
 *
 * target を誰が持っているか・どこにあるかは server/target.ts が動かす。ここはそれを見て、
 * 持った人が自陣の設置ポイントに居る間だけその陣営のカウントを減らす
 */

/** 部屋ごとの、最後にカウントを進めた時刻 */
const countedAt = new WeakMap<RoomWorld, number>()

/** 試合の始まりに 60 秒ずつで置く。CAP でない部屋は null */
export function placeCapture(room: RoomWorld, now: number): void {
  room.capture = room.mode.capture ? newCapture() : null
  countedAt.set(room, now)
}

/** いまカウントを進めている陣営 (target を持った人が自陣の設置ポイントに居る)。居なければ null */
function holdingTeam(room: RoomWorld): Team | null {
  const carrier = room.target?.carrier ? room.players.get(room.target.carrier) : undefined
  if (!carrier) return null
  const goal = room.stage.capGoals[carrier.team]
  return goal && inGoal(goal, carrier.x, carrier.y, carrier.z) ? carrier.team : null
}

/**
 * 1 刻みぶん進める。**決着したら勝った陣営** (呼ぶ側が試合を終える)、まだなら null。
 * 時間切れで並んだらサドンデスに入れて続ける。持つ陣営が替わった時は changed を立てる (すぐ配る)
 */
export function updateCapture(room: RoomWorld, now: number): { winner: Team | null; changed: boolean } {
  const capture = room.capture
  if (!capture || room.phase !== 'playing') return { winner: null, changed: false }
  const dt = Math.max(0, now - (countedAt.get(room) ?? now))
  countedAt.set(room, now)
  const holding = holdingTeam(room)
  const next = countDown(capture, holding, dt)
  let changed = next.holding !== capture.holding
  room.capture = next
  const timeUp = now >= room.endsAt
  const winner = captureWinner(next, timeUp)
  if (!winner && timeUp && !next.suddenDeath) {
    room.capture = { ...next, suddenDeath: true }
    changed = true
  }
  return { winner, changed }
}

/** 配る形。**秒**で (小数 1 桁) */
export function captureView(room: RoomWorld) {
  const capture = room.capture
  if (!capture) return undefined
  return {
    blue: Math.round(capture.count.blue / 100) / 10,
    red: Math.round(capture.count.red / 100) / 10,
    suddenDeath: capture.suddenDeath,
    holding: capture.holding,
  }
}
