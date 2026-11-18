import { describe, expect, test } from 'bun:test'
import { AIM_RATIO, botGunOf, botShot, firstBodyHit, zoneOf } from './botGun'

/** 決まった数列 (線形合同法)。試験の結果を毎回同じにする */
function sequence(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** n 発撃って当たった割合 */
function hitRate(distance: number, moving: boolean, head = 1.47, n = 4000): number {
  const random = sequence(7)
  let hits = 0
  for (let i = 0; i < n; i++) if (botShot(distance, head, moving, random).zone) hits++
  return hits / n
}

describe('撃ち返す的の当たり', () => {
  test('照準の高さは胴、ずれなければ胴に当たる', () => {
    expect(zoneOf(1.47 * AIM_RATIO, 0, 1.47)).toBe('BODY')
    expect(zoneOf(1.47, 0.05, 1.47)).toBe('HEAD')
    expect(zoneOf(0.5, 0.1, 1.47)).toBe('LEGS')
    expect(zoneOf(1.0, 0.5, 1.47)).toBeNull()
    expect(zoneOf(2.0, 0, 1.47)).toBeNull()
  })

  test('近いほど当たり、動いている相手には当たりにくい', () => {
    const near = hitRate(10, false)
    const far = hitRate(35, false)
    const nearMoving = hitRate(10, true)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeGreaterThan(nearMoving)
    // 止まっていれば 10m でおおむね半分以上は当たる。外れてばかりの的は相手にならない
    expect(near).toBeGreaterThan(0.5)
    // 遠くで全部当てる的にはしない
    expect(far).toBeLessThan(0.5)
  })

  test('狙撃銃は 1 発ずつ、遠くまで、ライフルより当たる', () => {
    const sniper = botGunOf('sniper')
    const rifle = botGunOf('rifle')
    expect(sniper.burst).toBe(1)
    expect(sniper.range).toBeGreaterThan(rifle.range)
    const rate = (spec: typeof rifle) => {
      const random = sequence(11)
      let hits = 0
      for (let i = 0; i < 4000; i++) if (botShot(30, 1.47, false, random, spec).zone) hits++
      return hits / 4000
    }
    expect(rate(sniper)).toBeGreaterThan(rate(rifle))
  })

  test('しゃがんだ相手は立った相手より当たりにくい', () => {
    expect(hitRate(20, false, 0.95)).toBeLessThan(hitRate(20, false, 1.47))
  })

  /**
   * **手前の体で止まる。** 味方の後ろに隠れると、味方が撃たれる (2026-11-16 本人)。
   * 弾は (0, 1.4, 0) から 20m 先の胸へ。狙った相手は線の終わり (t = 1)
   */
  test('弾の線の手前に立っている体に当たる', () => {
    const from = [0, 1.4, 0] as const
    const to = [0, 1.47 * AIM_RATIO, -20] as const
    const ally = { x: 0.05, y: 0, z: -10, head: 1.47 }
    const hit = firstBodyHit(from, to, [ally])
    expect(hit?.index).toBe(0)
    expect(hit?.zone).toBe('BODY')
    // 体の手前の面 (10m から胴の半径ぶん手前)
    expect(hit!.t).toBeGreaterThan(0.48)
    expect(hit!.t).toBeLessThan(0.5)
  })

  test('線から外れた体・狙った相手より向こうの体・しゃがんだ頭の上は通る', () => {
    const from = [0, 1.4, 0] as const
    const to = [0, 1.47 * AIM_RATIO, -20] as const
    // 横に 50cm
    expect(firstBodyHit(from, to, [{ x: 0.5, y: 0, z: -10, head: 1.47 }])).toBeNull()
    // 線の向こう (until で切る)
    expect(firstBodyHit(from, to, [{ x: 0, y: 0, z: -25, head: 1.47 }], 1)).toBeNull()
    // しゃがんだ味方 (頭 0.95m) の上を胸の高さ (1.4 → 1.15m) で越える
    expect(firstBodyHit(from, to, [{ x: 0, y: 0, z: -3, head: 0.95 }])).toBeNull()
  })

  test('いくつも並んでいれば一番手前', () => {
    const from = [0, 1.4, 0] as const
    const to = [0, 1.2, -20] as const
    const hit = firstBodyHit(from, to, [
      { x: 0, y: 0, z: -12, head: 1.47 },
      { x: 0, y: 0, z: -6, head: 1.47 },
    ])
    expect(hit?.index).toBe(1)
  })
})
