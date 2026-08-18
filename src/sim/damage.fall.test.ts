import { describe, expect, test } from 'bun:test'
import { fallDamage, FALL_SAFE_SPEED, MAX_HEALTH } from './damage'

/**
 * 落下ダメージ。
 *
 * 速さは重力から出す。重力 9.8 に下降の倍率 1.8 が掛かるので、h m 落ちると
 * sqrt(2 * 9.8 * 1.8 * h) m/s で着く。**階の高さを入れて確かめる** —
 * 数字そのものより「1 層は無傷、2 層は痛い」が保たれているかを見たい。
 */
const speedFrom = (height: number) => Math.sqrt(2 * 9.8 * 1.8 * height)

/** 立体駐車場の階の高さ (tools/make_garage.py の LEVEL) */
const LEVEL = 4.0

describe('階の高さと受ける量', () => {
  test('1 層は無傷。降りるのがタダでないと下りもスロープを回らされる', () => {
    expect(fallDamage(speedFrom(LEVEL))).toBe(0)
  })

  test('2 層は痛いが死なない', () => {
    const amount = fallDamage(speedFrom(LEVEL * 2))
    expect(amount).toBeGreaterThan(30)
    expect(amount).toBeLessThan(MAX_HEALTH)
  })

  test('高い所からは死ぬ。自分でやったことなので上限を置かない', () => {
    expect(fallDamage(speedFrom(14))).toBeGreaterThanOrEqual(MAX_HEALTH)
  })
})

describe('境目', () => {
  test('無傷の速さちょうどでは受けない', () => {
    expect(fallDamage(FALL_SAFE_SPEED)).toBe(0)
  })

  test('止まっていれば受けない', () => {
    expect(fallDamage(0)).toBe(0)
  })

  test('速いほど痛い', () => {
    expect(fallDamage(18)).toBeGreaterThan(fallDamage(16))
  })
})
