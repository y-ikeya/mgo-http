import { describe, expect, test } from 'bun:test'
import {
  HELD, buildCarried, carrySpeed, cycle, dropEmpty, firstOf, listOf, pickUp, toggle,
  type Carried, type HeldId,
} from './held'

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


describe('湧いたときの持ち物', () => {
  const ammo = () => ({ ammo: 30, reserve: 90 })
  const carried = buildCarried({ primary: 'rifle', secondary: 'pistol', support: 'grenade' }, ammo)

  test('ナイフとダンボールは選ばない。最初から持っている', () => {
    expect(carried.map((c) => c.id)).toContain('knife')
    expect(carried.map((c) => c.id)).toContain('box')
  })

  test('弾倉 (囮) は持っていない。撃って初めて増える', () => {
    expect(carried.map((c) => c.id)).not.toContain('magazine')
  })

  test('投げ物の数は選んだ物で決まる。クレイモアは手榴弾より少ない', () => {
    const withClaymore = buildCarried(
      { primary: 'rifle', secondary: 'pistol', support: 'claymore' }, ammo)
    const g = carried.find((c) => c.id === 'grenade') as { count: number }
    const c = withClaymore.find((c) => c.id === 'claymore') as { count: number }
    expect(g.count).toBeGreaterThan(c.count)
  })
})

describe('持ち替え', () => {
  const carried: Carried[] = [
    { id: 'rifle', ammo: 30, reserve: 90 },
    { id: 'pistol', ammo: 12, reserve: 48 },
    { id: 'grenade', count: 3 },
    { id: 'knife' },
    { id: 'box' },
  ]

  test('押すだけなら直前に持っていた物へ戻る', () => {
    expect(toggle(carried, 'grenade', 'rifle')).toBe('rifle')
    expect(toggle(carried, 'rifle', 'grenade')).toBe('grenade')
  })

  test('直前の物を持っていなければ並びの次へ', () => {
    // 手榴弾を投げ切って持っていない
    const empty = carried.filter((c) => c.id !== 'grenade')
    expect(toggle(empty, 'rifle', 'grenade')).toBe('pistol')
  })

  test('一覧は同じ系統の中だけを回る。武器を送って箱は出ない', () => {
    let at: HeldId = 'rifle'
    const seen: HeldId[] = []
    for (let i = 0; i < 4; i++) {
      at = cycle(carried, at, 1)
      seen.push(at)
    }
    expect(seen).toEqual(['pistol', 'grenade', 'knife', 'rifle'])
    expect(seen).not.toContain('box')
  })

  test('逆にも送れる', () => {
    expect(cycle(carried, 'rifle', -1)).toBe('knife')
  })

  test('系統を切り替えると、その先頭へ行く', () => {
    expect(firstOf(carried, 'tool')).toBe('box')
    expect(firstOf(carried, 'weapon')).toBe('rifle')
  })

  test('道具を持っていなければ null', () => {
    expect(firstOf([{ id: 'knife' }], 'tool')).toBeNull()
  })
})

describe('投げ切る', () => {
  test('投げ物は 0 になったら持ち物から消える', () => {
    const carried: Carried[] = [{ id: 'grenade', count: 0 }, { id: 'knife' }]
    expect(dropEmpty(carried, 'grenade')).toBe(true)
    expect(carried.map((c) => c.id)).toEqual(['knife'])
  })

  test('まだ残っていれば消えない', () => {
    const carried: Carried[] = [{ id: 'grenade', count: 1 }]
    expect(dropEmpty(carried, 'grenade')).toBe(false)
  })

  test('銃は弾が尽きても手元に残る。拾って補充できるため', () => {
    const carried: Carried[] = [{ id: 'rifle', ammo: 0, reserve: 0 }]
    expect(dropEmpty(carried, 'rifle')).toBe(false)
    expect(carried).toHaveLength(1)
  })
})

describe('トグルは系統をまたがない', () => {
  const carried: Carried[] = [
    { id: 'rifle', ammo: 30, reserve: 90 },
    { id: 'pistol', ammo: 12, reserve: 48 },
    { id: 'box' },
  ]

  test('直前に持っていた物が別の系統なら、そちらへは戻らない', () => {
    // 箱から銃へ移った直後。previous は 'box'
    expect(toggle(carried, 'rifle', 'box')).not.toBe('box')
    expect(toggle(carried, 'rifle', 'box')).toBe('pistol')
  })

  test('同じ系統なら往復する', () => {
    expect(toggle(carried, 'rifle', 'pistol')).toBe('pistol')
  })
})
