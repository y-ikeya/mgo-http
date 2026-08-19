import { describe, expect, test } from 'bun:test'
import { HELD, carrySpeed, listOf, pickUp, type Carried, type HeldId } from './held'

/**
 * 持ち物。
 *
 * ここで守りたいのは**枠ではなく物を型にした**という判断。以前は「投擲の枠」を
 * 型にしていて 2 回作り直した。並びは枠の順で決まるが、中身は枠と 1 対 1 ではない
 * (support に手榴弾と弾倉が同時に並ぶ)。
 */

const gun = (id: 'rifle' | 'sniper' | 'pistol', ammo = 30, reserve = 90): Carried =>
  ({ id, ammo, reserve })

describe('並び', () => {
  test('武器系は 主 → 副 → support → ナイフ の順', () => {
    const carried: Carried[] = [
      { id: 'knife' },
      { id: 'grenade', count: 3 },
      { id: 'pistol', ammo: 12, reserve: 48 },
      gun('rifle'),
    ]
    expect(listOf(carried, 'weapon').map((c) => c.id)).toEqual([
      'rifle', 'pistol', 'grenade', 'knife',
    ])
  })

  test('support は 1 枠だが 2 つ並ぶことがある。弾倉は撃って増えるため', () => {
    const carried: Carried[] = [
      gun('rifle'),
      { id: 'magazine', count: 2 },
      { id: 'grenade', count: 3 },
      { id: 'knife' },
    ]
    const ids = listOf(carried, 'weapon').map((c) => c.id)
    expect(ids).toHaveLength(4)
    // 主武器が先、ナイフが最後。support の 2 つはその間
    expect(ids[0]).toBe('rifle')
    expect(ids[3]).toBe('knife')
  })

  test('道具系は別の並び。武器と混ざらない', () => {
    const carried: Carried[] = [gun('rifle'), { id: 'box' }, { id: 'knife' }]
    expect(listOf(carried, 'tool').map((c) => c.id)).toEqual(['box'])
    expect(listOf(carried, 'weapon').map((c) => c.id)).toEqual(['rifle', 'knife'])
  })
})

describe('重さと速さ', () => {
  test('突撃銃が基準。持っていると等倍', () => {
    expect(carrySpeed('rifle')).toBeCloseTo(1, 5)
  })

  test('手榴弾に持ち替えると速くなる。これが持ち替える動機のひとつ', () => {
    expect(carrySpeed('grenade')).toBeGreaterThan(carrySpeed('pistol'))
    expect(carrySpeed('pistol')).toBeGreaterThan(carrySpeed('rifle'))
  })

  test('狙撃銃は遅い', () => {
    expect(carrySpeed('sniper')).toBeLessThan(1)
  })
})

describe('撃てるかどうか', () => {
  test.each<[HeldId, boolean]>([
    ['rifle', true],
    ['sniper', true],
    ['pistol', true],
    // 持ち替えている間は撃てない。これが投げること・刺すことの代償になる
    ['grenade', false],
    ['claymore', false],
    ['magazine', false],
    ['knife', false],
    ['box', false],
  ])('%s → %s', (id, shoots) => {
    expect(HELD[id].shoots).toBe(shoots)
  })
})

describe('拾う', () => {
  test('持っていない種類は持ち物に加わる。主武器 2 丁もありうる', () => {
    const carried: Carried[] = [gun('rifle')]
    expect(pickUp(carried, gun('sniper', 5, 15))).toBe(true)
    expect(carried.map((c) => c.id)).toEqual(['rifle', 'sniper'])
  })

  test('持っている種類なら弾だけ増える', () => {
    const carried: Carried[] = [gun('rifle', 10, 20)]
    expect(pickUp(carried, gun('rifle', 30, 60))).toBe(false)
    expect(carried).toHaveLength(1)
    const rifle = carried[0] as { ammo: number; reserve: number }
    // 装填は多いほう、予備は足し合わせ
    expect(rifle.ammo).toBe(30)
    expect(rifle.reserve).toBe(80)
  })

  test('撃ち尽くした銃を拾っても空のまま', () => {
    const carried: Carried[] = []
    pickUp(carried, gun('sniper', 0, 0))
    expect(carried[0]).toEqual({ id: 'sniper', ammo: 0, reserve: 0 })
  })

  test('投げ物は数が足される', () => {
    const carried: Carried[] = [{ id: 'grenade', count: 1 }]
    pickUp(carried, { id: 'grenade', count: 2 })
    expect(carried[0]).toEqual({ id: 'grenade', count: 3 })
  })
})
