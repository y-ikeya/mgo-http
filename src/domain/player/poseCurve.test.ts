import { describe, expect, test } from 'bun:test'
import { ROLL_TIME_SCALE, zoneAt } from './poseCurve'

/**
 * 測った表 (poseCurves.ts) を引く。値そのものではなく、**型の流れどおりの形か**を見る
 */
describe('型の途中の部位の位置', () => {
  test('眠った直後は立った頭の高さ、倒れきると地面', () => {
    expect(zoneAt('sleep', 0, 'HEAD')!.up).toBeGreaterThan(1.3)
    expect(zoneAt('sleep', 3.5, 'HEAD')!.up).toBeLessThan(0.2)
    // 倒れる向きは前
    expect(zoneAt('sleep', 3.5, 'HEAD')!.forward).toBeGreaterThan(0.3)
  })

  test('型の終わりを過ぎたら終わりの姿のまま', () => {
    expect(zoneAt('sleep', 60, 'BODY')).toEqual(zoneAt('sleep', 3.7, 'BODY'))
  })

  test('転がりは画面と同じ速さで流す。真ん中で頭が一番低い', () => {
    const mid = zoneAt('roll', 0.6 / ROLL_TIME_SCALE, 'HEAD')!.up
    expect(mid).toBeLessThan(0.4)
    expect(zoneAt('roll', 0, 'HEAD')!.up).toBeGreaterThan(mid)
    expect(zoneAt('roll', 1.5 / ROLL_TIME_SCALE, 'HEAD')!.up).toBeGreaterThan(1.2)
  })

  test('間は線で繋ぐ', () => {
    const a = zoneAt('sleep', 1.8, 'HEAD')!.up
    const b = zoneAt('sleep', 1.9, 'HEAD')!.up
    const half = zoneAt('sleep', 1.85, 'HEAD')!.up
    expect(half).toBeCloseTo((a + b) / 2, 5)
  })

  test('胴と脚は縦の筒。中心は筒の中', () => {
    for (const age of [0, 1.5, 3]) {
      const body = zoneAt('sleep', age, 'BODY')!
      expect(body.low).toBeLessThanOrEqual(body.up + 1e-6)
      expect(body.high).toBeGreaterThanOrEqual(body.up - 1e-6)
    }
  })

  test('表の無い型は null', () => {
    expect(zoneAt('idle', 0, 'HEAD')).toBeNull()
  })
})
