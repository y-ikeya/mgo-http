import { describe, expect, test } from 'bun:test'
import { CAP_COUNT_MS, captureWinner, countDown, inGoal, newCapture } from './capture'
import { DOWN_DURATION, DOWN_MAX, downSeconds } from '../player/lifecycle'

const goal = { x: 10, y: 4, z: -5, halfX: 2, halfZ: 2 }

describe('設置ポイント', () => {
  test('4m 四方の中に立っていれば中', () => {
    expect(inGoal(goal, 11.9, 4, -3.1)).toBe(true)
    expect(inGoal(goal, 12.1, 4, -5)).toBe(false)
  })

  test('**上の階・下の階からは数えない**', () => {
    expect(inGoal(goal, 10, 0.1, -5)).toBe(false)
    expect(inGoal(goal, 10, 8, -5)).toBe(false)
    // 跳んでいても中
    expect(inGoal(goal, 10, 5.2, -5)).toBe(true)
  })
})

describe('カウント', () => {
  test('**持っている陣営だけ減る**', () => {
    const next = countDown(newCapture(), 'red', 1000)
    expect(next.count.red).toBe(CAP_COUNT_MS - 1000)
    expect(next.count.blue).toBe(CAP_COUNT_MS)
    expect(next.holding).toBe('red')
  })

  test('誰も持っていなければ止まる', () => {
    const held = countDown(newCapture(), 'blue', 500)
    const idle = countDown(held, null, 5000)
    expect(idle.count.blue).toBe(CAP_COUNT_MS - 500)
    expect(idle.holding).toBeNull()
  })

  test('0 で止まる', () => {
    expect(countDown(newCapture(), 'blue', CAP_COUNT_MS * 2).count.blue).toBe(0)
  })
})

describe('勝ち負け', () => {
  test('**先に 0 にした側の勝ち**。時間を待たない', () => {
    expect(captureWinner(countDown(newCapture(), 'red', CAP_COUNT_MS), false)).toBe('red')
  })

  test('時間内で 0 でなければ続ける', () => {
    expect(captureWinner(countDown(newCapture(), 'red', 1000), false)).toBeNull()
  })

  test('時間切れは**多く減らした側**の勝ち', () => {
    const capture = countDown(countDown(newCapture(), 'red', 3000), 'blue', 1000)
    expect(captureWinner(capture, true)).toBe('red')
  })

  test('時間切れで並んだら続ける (サドンデス)。**先に進めた側の勝ち**', () => {
    const even = newCapture()
    expect(captureWinner(even, true)).toBeNull()
    const sudden = { ...even, suddenDeath: true }
    expect(captureWinner(sudden, false)).toBeNull()
    expect(captureWinner(countDown(sudden, 'blue', 16), false)).toBe('blue')
  })
})

describe('倒れたままの時間', () => {
  test('**倒されるたびに延びる** (5 秒から 3 秒ずつ、20 秒まで)', () => {
    expect(downSeconds(1, true)).toBe(5)
    expect(downSeconds(2, true)).toBe(8)
    expect(downSeconds(3, true)).toBe(11)
    expect(downSeconds(6, true)).toBe(DOWN_MAX)
    expect(downSeconds(30, true)).toBe(DOWN_MAX)
  })

  test('延びない部屋は何度倒されても同じ', () => {
    expect(downSeconds(9, false)).toBe(DOWN_DURATION)
  })
})
