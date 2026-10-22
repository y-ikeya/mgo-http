import { expect, test } from 'bun:test'
import { updateMatch } from '../server/match'
import { rooms, roomOf } from '../server/world'

/**
 * **試合の切れ目でステージを回す** (bravo / charlie は city と UU を交互に、2026-10-22 本人)。
 * 替わるのは結果を見せ終えた所 (over の終わり)。画面は配られた stage を見て組み直す (screens/Play.tsx)
 */
test('bravo は最初の試合が city、結果を見せ終えるたびに UU と入れ替わる', () => {
  const room = roomOf('bravo', 'rotate-test')
  try {
    expect(room.stage.name).toBe('city')
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      // 結果を見せ終えた (人が揃っていないので待ちへ戻る道。揃っていれば支度へ入る道で、どちらも同じ所で回す)
      room.phase = 'over'
      room.endsAt = 0
      updateMatch(room, Date.now())
      seen.push(room.stage.name)
    }
    expect(seen).toEqual(['uu', 'city', 'uu'])
  } finally {
    rooms.delete(room.key)
  }
})

test('結果を見せている間は替えない', () => {
  const room = roomOf('charlie', 'rotate-test-2')
  try {
    room.phase = 'over'
    room.endsAt = Date.now() + 10_000
    updateMatch(room, Date.now())
    expect(room.stage.name).toBe('city')
  } finally {
    rooms.delete(room.key)
  }
})

test('1 枚だけの部屋 (delta) は替わらない', () => {
  const room = roomOf('delta', 'rotate-test-3')
  try {
    room.phase = 'over'
    room.endsAt = 0
    updateMatch(room, Date.now())
    expect(room.stage.name).toBe('uu')
  } finally {
    rooms.delete(room.key)
  }
})
