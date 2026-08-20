import { describe, expect, test } from 'bun:test'
import {
  levelOf,
  levelProgress,
  pointsForLevel,
  pointsOf,
  KILL_POINTS,
  DEATH_POINTS,
  SUICIDE_POINTS,
} from './scoring'

/**
 * 点と Lv。
 *
 * 陣営の勝敗 (残機) とは別で、こちらは**個人に積む経験値**。
 * DB に持つのは生の数だけで、点も Lv もここで出す — SQL 側にも式を書くと
 * 2 箇所になり、片方を直し忘れた日に画面ごとに違う Lv が出る。
 */

describe('点', () => {
  test('倒した数と倒された数から出る', () => {
    expect(pointsOf({ kills: 10, deaths: 8, suicides: 0 })).toBe(10 * 3 + 8 * -2)
  })

  test('自死は倒されるより重い', () => {
    // 倒されると自分 -2 / 相手 +3 で差が 5。自死も -5 にして差を揃える。
    // 揃えないと「Lv を上げる上では自死のほうが得」が成り立つ
    const killed = pointsOf({ kills: 0, deaths: 1, suicides: 0 })
    const suicide = pointsOf({ kills: 0, deaths: 1, suicides: 1 })
    expect(killed).toBe(DEATH_POINTS)
    expect(suicide).toBe(SUICIDE_POINTS)
    expect(killed - suicide).toBe(KILL_POINTS)
  })

  test('自死は二重に引かない', () => {
    // deaths には自死も含まれている。引き算を忘れると -2 と -5 の両方が乗る
    expect(pointsOf({ kills: 0, deaths: 2, suicides: 2 })).toBe(SUICIDE_POINTS * 2)
  })

  test('負け続ければマイナスになる', () => {
    expect(pointsOf({ kills: 0, deaths: 5, suicides: 0 })).toBeLessThan(0)
  })
})

describe('Lv', () => {
  test.each([
    [0, 1],
    [49, 1],
    [50, 2],
    [149, 2],
    [150, 3],
    [300, 4],
    [2250, 10],
  ])('通算 %i 点なら Lv %i', (points, level) => {
    expect(levelOf(points)).toBe(level)
  })

  test('マイナスでも Lv 1 で止まる', () => {
    // 「マイナス Lv」に意味を持たせようがないし、始めたばかりの人と区別も付かない
    expect(levelOf(-1)).toBe(1)
    expect(levelOf(-9999)).toBe(1)
  })

  test('上がるほど必要な点が増える', () => {
    const need = (level: number) => pointsForLevel(level + 1) - pointsForLevel(level)
    expect(need(2)).toBeGreaterThan(need(1))
    expect(need(9)).toBeGreaterThan(need(2))
  })

  test('境目と逆算が食い違わない', () => {
    // levelOf と pointsForLevel は同じ式の表と裏。片方だけ直すとずれる
    for (let level = 1; level <= 30; level++) {
      expect(levelOf(pointsForLevel(level))).toBe(level)
      expect(levelOf(pointsForLevel(level) - 1)).toBe(Math.max(1, level - 1))
    }
  })

  test('帯は 0 から 1 の間を動く', () => {
    expect(levelProgress(-100)).toBe(0)
    expect(levelProgress(pointsForLevel(3))).toBe(0)
    expect(levelProgress(pointsForLevel(4) - 1)).toBeGreaterThan(0.9)
    expect(levelProgress(pointsForLevel(4) - 1)).toBeLessThan(1)
  })
})
