import { describe, expect, test } from 'bun:test'
import { offsetInCone, type Aim } from './aim'

/**
 * **本物の武器の数字を持ち出さない。** 半角を自分で決めて、幾何として
 * 正しいかだけを見る。散布のバランスを変えてもこの試験は動かない。
 */
const forward = (): Aim => ({ x: 0, y: 0, z: -1 })

/** ずれた角度 (度) */
function angleFrom(dir: Aim, base: Aim): number {
  const dot = dir.x * base.x + dir.y * base.y + dir.z * base.z
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
}

function length(dir: Aim): number {
  return Math.hypot(dir.x, dir.y, dir.z)
}

describe('円錐の中へ散らす', () => {
  test('散布が 0 なら動かさない', () => {
    const dir = forward()
    offsetInCone(dir, 0, 0.3, 0.9)
    expect(dir).toEqual({ x: 0, y: 0, z: -1 })
  })

  test('半角を超えて散らない', () => {
    const base = forward()
    for (let i = 0; i < 200; i++) {
      const dir = forward()
      offsetInCone(dir, 10, i / 200, ((i * 7) % 200) / 200)
      expect(angleFrom(dir, base)).toBeLessThanOrEqual(10.001)
    }
  })

  test('正規化されたまま返る', () => {
    const dir = forward()
    offsetInCone(dir, 30, 0.7, 0.4)
    expect(length(dir)).toBeCloseTo(1, 6)
  })

  /**
   * **中心に偏らせない。** 半径をそのまま一様に引くと、面積が半径の 2 乗で
   * 増えるぶん外周が薄くなり、散布界の縁がほとんど当たらなくなる。
   * 平方根を掛けた分布の平均は半角の 2/3 に寄る。
   */
  test('円の中で一様。縁が薄くならない', () => {
    const base = forward()
    const n = 400
    let total = 0
    for (let i = 0; i < n; i++) {
      const dir = forward()
      offsetInCone(dir, 10, i / n, (i + 0.5) / n)
      total += angleFrom(dir, base)
    }
    // 一様なら 2/3 ≒ 6.67 度。中心寄り (半径を一様に引く) なら 5 度になる
    expect(total / n).toBeGreaterThan(6.2)
    expect(total / n).toBeLessThan(7.0)
  })

  /**
   * 真上を向いていると、上を基準にした外積が 0 に潰れて軸が作れない。
   * **その姿勢でだけ散布が消える**、という稀な食い違いを塞いである。
   */
  test('真上を向いていても散る', () => {
    const up: Aim = { x: 0, y: 1, z: 0 }
    const dir: Aim = { ...up }
    offsetInCone(dir, 10, 0.25, 0.8)
    expect(angleFrom(dir, up)).toBeGreaterThan(1)
    expect(length(dir)).toBeCloseTo(1, 6)
  })
})
