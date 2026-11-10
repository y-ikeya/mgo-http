import { expect, test } from 'bun:test'
import { roomOf } from '../server/world'
import { placeCapture, updateCapture } from '../server/capture'

/**
 * CAP の前後半 (2026-11-09 本人「陣地を変えた前後半戦で 1 match」「勝ち負けは合計の残り」)。
 *
 *     前半の時間切れ            並んでいても半を終える (サドンデスは試合の最後だけ)
 *     後半の時間切れ            前半の残りを足した合計に差があれば終わる
 *     後半の時間切れで合計が並ぶ  サドンデスに入れて続ける
 */
function capRoom(key: string, round: number, carried: { blue: number; red: number }) {
  const room = roomOf('echo', key)
  expect(room.mode.capture && room.mode.halves).toBe(true)
  const now = Date.now()
  room.phase = 'playing'
  room.target = null
  room.round = round
  room.carried = carried
  placeCapture(room, now)
  // 時間切れ
  room.endsAt = now - 1
  return { room, now }
}

test('前半は時間切れで、並んでいても終わる', () => {
  const { room, now } = capRoom('caph-1', 1, { blue: 0, red: 0 })
  expect(updateCapture(room, now).over).toBe(true)
  expect(room.capture?.suddenDeath).toBe(false)
})

test('後半は前半の残りを足して見る。合計に差があれば終わる', () => {
  // この半は並んでいる (60 秒ずつ) が、前半の残りが違う
  const { room, now } = capRoom('caph-2', 2, { blue: 30_000, red: 60_000 })
  expect(updateCapture(room, now).over).toBe(true)
})

test('後半の時間切れで合計が並んだらサドンデスで続ける', () => {
  const { room, now } = capRoom('caph-3', 2, { blue: 45_000, red: 45_000 })
  expect(updateCapture(room, now).over).toBe(false)
  expect(room.capture?.suddenDeath).toBe(true)
})
