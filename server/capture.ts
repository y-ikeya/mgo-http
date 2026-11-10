import { countDown, inGoal, newCapture } from '../src/domain/match/capture'
import { homeOf } from '../src/domain/match/sides'
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
  // 後半は陣地が入れ替わる (前後半の部屋)。自陣の設置ポイントも相手の色の物
  const goal = room.stage.capGoals[homeOf(room, carrier.team)]
  return goal && inGoal(goal, carrier.x, carrier.y, carrier.z) ? carrier.team : null
}

/**
 * 1 刻みぶん進める。**このラウンドが終わったら over** (呼ぶ側が endRound で決着を付ける)。
 *
 *     どちらかのカウントが 0           終わり
 *     前後半の前半で時間切れ           終わり (並んでいても。決着は後半と合わせて見る)
 *     それ以外で時間切れ・サドンデス中  合計 (前の半の残り + この半の残り) に差が付いたら終わり。
 *                                      並んだらサドンデスに入れて続ける
 *
 * 持つ陣営が替わった時は changed を立てる (すぐ配る)
 */
export function updateCapture(room: RoomWorld, now: number): { over: boolean; changed: boolean } {
  const capture = room.capture
  if (!capture || room.phase !== 'playing') return { over: false, changed: false }
  const dt = Math.max(0, now - (countedAt.get(room) ?? now))
  countedAt.set(room, now)
  const holding = holdingTeam(room)
  const next = countDown(capture, holding, dt)
  let changed = next.holding !== capture.holding
  room.capture = next
  const timeUp = now >= room.endsAt
  if (next.count.blue <= 0 || next.count.red <= 0) return { over: true, changed }
  if (!timeUp && !next.suddenDeath) return { over: false, changed }
  // 前後半の前半は時間で区切る。サドンデスは試合の最後だけ
  if (room.mode.halves && room.round < 2) return { over: timeUp, changed }
  const carried = room.mode.halves ? room.carried : { blue: 0, red: 0 }
  if (next.count.blue + carried.blue !== next.count.red + carried.red) return { over: true, changed }
  if (!next.suddenDeath) {
    room.capture = { ...next, suddenDeath: true }
    changed = true
  }
  return { over: false, changed }
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
