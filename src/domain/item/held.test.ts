import { describe, expect, test } from 'bun:test'
import { SUPPORT_SPECS } from './weapons'
import {
  HELD, buildCarried, carrySpeed, cycle, dropEmpty, find, firstOf, isTwoHanded, listOf, pickUp, toggle,
  type Carried, type HeldId,
  overflowing,
  PLACED_LIMIT,
} from './held'

/**
 * 持ち物。
 *
 * ここで守りたいのは**枠ではなく物を型にした**という判断。以前は「投擲の枠」を
 * 型にしていて 2 回作り直した。並びは枠の順で決まるが、中身は枠と 1 対 1 ではない
 * (support に手榴弾と弾倉が同時に並ぶ)。
 */

const gun = (id: 'rifle' | 'sniper' | 'm9', ammo = 30, reserve = 90): Carried =>
  ({ id, ammo, reserve })

describe('並び', () => {
  test('武器系は 主 → 副 → support → ナイフ の順', () => {
    const carried: Carried[] = [
      { id: 'knife' },
      { id: 'grenade', count: 3 },
      { id: 'm9', ammo: 12, reserve: 48 },
      gun('rifle'),
    ]
    expect(listOf(carried, 'weapon').map((c) => c.id)).toEqual([
      'rifle', 'm9', 'grenade', 'knife',
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
    expect(carrySpeed('grenade')).toBeGreaterThan(carrySpeed('m9'))
    expect(carrySpeed('m9')).toBeGreaterThan(carrySpeed('rifle'))
  })

  test('狙撃銃は遅い', () => {
    expect(carrySpeed('sniper')).toBeLessThan(1)
  })
})

describe('撃てるかどうか', () => {
  test.each<[HeldId, boolean]>([
    ['rifle', true],
    ['sniper', true],
    ['m9', true],
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
  const carried = buildCarried({ primary: 'rifle', secondary: 'm9', support: 'grenade' }, ammo)

  test('ナイフとダンボールは選ばない。最初から持っている', () => {
    expect(carried.map((c) => c.id)).toContain('knife')
    expect(carried.map((c) => c.id)).toContain('box')
  })

  test('弾倉は持っていない。撃って初めて増える', () => {
    expect(carried.map((c) => c.id)).not.toContain('magazine')
  })

  /**
   * **選んだ枠の物だけを、その数だけ持つ。**
   *
   * 「クレイモアは手榴弾より少ない」で押さえていたが、置く物は場に出せる数の
   * ほうで抑えるようにしたので (PLACED_LIMIT)、持つ数は揃った。数そのものより
   * **選んだ物しか入っていないこと**のほうが大事なので、そちらを見る。
   */
  test('選んだ支援だけを、その数だけ持つ', () => {
    for (const support of ['grenade', 'claymore', 'decoy'] as const) {
      const built = buildCarried({ primary: 'rifle', secondary: 'm9', support }, ammo)
      const mine = built.find((c) => c.id === support) as { count: number }
      expect(mine.count).toBe(SUPPORT_SPECS[support].count)
      // 選ばなかった支援は入っていない
      for (const other of ['grenade', 'claymore', 'decoy'] as const) {
        if (other === support) continue
        expect(built.map((c) => c.id)).not.toContain(other)
      }
    }
  })
})

describe('持ち替え', () => {
  const carried: Carried[] = [
    { id: 'rifle', ammo: 30, reserve: 90 },
    { id: 'm9', ammo: 12, reserve: 48 },
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
    expect(toggle(empty, 'rifle', 'grenade')).toBe('m9')
  })

  test('一覧は同じ系統の中だけを回る。武器を送って箱は出ない', () => {
    let at: HeldId = 'rifle'
    const seen: HeldId[] = []
    for (let i = 0; i < 4; i++) {
      at = cycle(carried, at, 1)
      seen.push(at)
    }
    expect(seen).toEqual(['m9', 'grenade', 'knife', 'rifle'])
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
    { id: 'm9', ammo: 12, reserve: 48 },
    { id: 'box' },
  ]

  test('直前に持っていた物が別の系統なら、そちらへは戻らない', () => {
    // 箱から銃へ移った直後。previous は 'box'
    expect(toggle(carried, 'rifle', 'box')).not.toBe('box')
    expect(toggle(carried, 'rifle', 'box')).toBe('m9')
  })

  test('同じ系統なら往復する', () => {
    expect(toggle(carried, 'rifle', 'm9')).toBe('m9')
  })
})

describe('両手か片手か', () => {
  test('主武器は両手、副武器と投げ物は片手', () => {
    expect(isTwoHanded('rifle')).toBe(true)
    expect(isTwoHanded('sniper')).toBe(true)
    expect(isTwoHanded('smg')).toBe(true)
    expect(isTwoHanded('m9')).toBe(false)
  })

  test('**手榴弾は片手。** 身軽に走れる', () => {
    expect(isTwoHanded('grenade')).toBe(false)
    expect(isTwoHanded('claymore')).toBe(false)
    expect(isTwoHanded('magazine')).toBe(false)
    expect(isTwoHanded('knife')).toBe(false)
  })

  test('重い物ほど両手。**重さと矛盾しない**', () => {
    for (const [id, spec] of Object.entries(HELD)) {
      if (spec.twoHanded) expect(spec.weight, id).toBeGreaterThan(2)
    }
  })
})

/**
 * 副武器を持たない部屋。
 *
 * 拳銃まで取り上げると、詰められた時に**ナイフしか残らない**。狙撃銃の部屋で
 * 「間合いへ入られたら終わり」を成立させるのはこれ。
 */
describe('副武器なし', () => {
  const full = () => ({ ammo: 30, reserve: 90 })
  const carried = buildCarried({ primary: 'sniper', secondary: null, support: 'grenade' }, full)

  test('拳銃が持ち物に入らない', () => {
    expect(find(carried, 'm9')).toBeUndefined()
  })

  test('**ナイフは残る。** 何も残らないのとは違う', () => {
    expect(find(carried, 'knife')).toBeDefined()
  })

  test('主武器と投げ物とダンボールはそのまま', () => {
    expect(find(carried, 'sniper')).toBeDefined()
    expect(find(carried, 'grenade')).toBeDefined()
    expect(find(carried, 'box')).toBeDefined()
  })
})

/**
 * 置いた物は**本人が死んでも場に残る**のに、湧き直すと手元は満タンに戻る。
 * 数えないと死ぬたびに増えて、通り道を全部塞げる / 人形を並べ放題になる。
 *
 * **死ななければ効かない規則**なので、端から端まで試すと重い割に脆い
 * (倒れて・支度して・湧いてから、もう一度置く)。決めているのは規則なので
 * ここで直に見る。
 */
describe('場に置ける数', () => {
  const of = (owner: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ owner, id: `${owner}${i}` }))

  test('上限に届いていなければ、何も押し出さない', () => {
    expect(overflowing(of('a', PLACED_LIMIT - 1), 'a')).toEqual([])
  })

  /** これから 1 つ足すので、いま上限ぶん在るなら 1 つ押し出す */
  test('上限ぶん在れば、古いほうを 1 つ押し出す', () => {
    const mine = of('a', PLACED_LIMIT)
    expect(overflowing(mine, 'a')).toEqual([mine[0]!])
  })

  test('溢れているぶんだけ押し出す', () => {
    const mine = of('a', PLACED_LIMIT + 2)
    expect(overflowing(mine, 'a')).toEqual(mine.slice(0, 3))
  })

  /**
   * **数えるのは自分の物だけ。** 全体で数えると、味方が置いた物のせいで
   * 自分の罠が消える。
   */
  test('他人の物は数えない', () => {
    const field = [...of('b', PLACED_LIMIT), ...of('a', 1)]
    expect(overflowing(field, 'a')).toEqual([])
  })

  test('持てる数より場の上限のほうが多い。**死んで湧いた後に 1 つ足せる**', () => {
    expect(PLACED_LIMIT).toBeGreaterThan(SUPPORT_SPECS.claymore.count)
    expect(PLACED_LIMIT).toBeGreaterThan(SUPPORT_SPECS.decoy.count)
  })
})
