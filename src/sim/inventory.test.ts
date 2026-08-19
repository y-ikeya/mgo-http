import { describe, expect, test } from 'bun:test'
import { Inventory } from './inventory'
import { SWITCH_TIME } from './held'

/**
 * 持ち物の状態と遷移。
 *
 * ここで守りたいのは**持ち替えに代償があること**。撃てる物を持っていないと
 * 撃てないし、持ち替えている最中も撃てない。それが投げること・刺すことの値段に
 * なっている (docs/design.md の 5)。
 */

const loadout = { primary: 'rifle', secondary: 'pistol', support: 'grenade' } as const
const make = () => new Inventory(loadout)

/** 持ち替えが終わるまで進める */
function settle(inv: Inventory) {
  inv.update(SWITCH_TIME)
}

describe('湧いた直後', () => {
  test('主武器を手にしている', () => {
    expect(make().held).toBe('rifle')
  })

  test('装填されている', () => {
    const inv = make()
    expect(inv.ammo).toBeGreaterThan(0)
    expect(inv.reserve).toBeGreaterThan(0)
  })

  test('すぐ撃てる。湧いた瞬間に持ち替えの待ちは無い', () => {
    expect(make().canShoot).toBe(true)
  })
})

describe('持ち替えの代償', () => {
  test('持ち替えた直後は撃てない', () => {
    const inv = make()
    inv.switchTo('grenade')
    expect(inv.switching).toBe(true)
    expect(inv.canShoot).toBe(false)
  })

  test('時間が経つと持ち替えが終わる', () => {
    const inv = make()
    inv.switchTo('pistol')
    settle(inv)
    expect(inv.switching).toBe(false)
    expect(inv.canShoot).toBe(true)
  })

  test('**撃てない物を持っている間は、持ち替えが終わっても撃てない**', () => {
    const inv = make()
    inv.switchTo('grenade')
    settle(inv)
    expect(inv.switching).toBe(false)
    expect(inv.canShoot).toBe(false)
  })

  test('ナイフも撃てない。刺しに行くと決めた時点で撃つ手段を手放す', () => {
    const inv = make()
    inv.switchTo('knife')
    settle(inv)
    expect(inv.canShoot).toBe(false)
  })

  test('持ち替えの最中に更に持ち替えられない。代償を踏み倒せてしまう', () => {
    const inv = make()
    inv.switchTo('grenade')
    expect(inv.switchTo('pistol')).toBe(false)
    expect(inv.held).toBe('grenade')
  })
})

describe('押すだけのトグル', () => {
  test('直前に持っていた物と往復する', () => {
    const inv = make()
    inv.switchTo('grenade'); settle(inv)
    inv.toggle('weapon'); settle(inv)
    expect(inv.held).toBe('rifle')
    inv.toggle('weapon'); settle(inv)
    expect(inv.held).toBe('grenade')
  })

  test('系統が違えば、その系統の先頭へ行く', () => {
    const inv = make()
    inv.toggle('tool'); settle(inv)
    expect(inv.held).toBe('box')
    // 戻るときは武器系の直前ではなく先頭 (箱から見た「直前」は武器系なので戻れる)
    inv.toggle('weapon'); settle(inv)
    expect(inv.held).toBe('rifle')
  })
})

describe('使う', () => {
  test('撃つと装填が減る', () => {
    const inv = make()
    const before = inv.ammo
    inv.spend()
    expect(inv.ammo).toBe(before - 1)
  })

  test('装填。予備から入るぶんだけ移す', () => {
    const inv = make()
    for (let i = 0; i < 5; i++) inv.spend()
    const reserve = inv.reserve
    expect(inv.reload()).toBe(true)
    expect(inv.ammo).toBe(30)
    expect(inv.reserve).toBe(reserve - 5)
  })

  test('満タンなら装填しない', () => {
    expect(make().reload()).toBe(false)
  })

  test('投げ物を投げ切ると持ち物から消えて、手が別の物に移る', () => {
    const inv = make()
    inv.switchTo('grenade'); settle(inv)
    for (let i = 0; i < 3; i++) inv.spend()
    // 空の手榴弾を握ったままだと、撃てない状態から抜けられない
    expect(inv.held).not.toBe('grenade')
    expect(inv.list('weapon').map((c) => c.id)).not.toContain('grenade')
  })

  test('銃は弾が尽きても手元に残る', () => {
    const inv = make()
    for (let i = 0; i < 30; i++) inv.spend()
    expect(inv.held).toBe('rifle')
    expect(inv.ammo).toBe(0)
  })
})

describe('拾う', () => {
  test('持っていない銃は持ち物に加わる。主武器 2 丁になる', () => {
    const inv = make()
    expect(inv.pick({ id: 'sniper', ammo: 5, reserve: 15 })).toBe(true)
    expect(inv.list('weapon').map((c) => c.id)).toContain('sniper')
  })

  test('拾っても手の中は変わらない。撃ち合いの最中に握る物が変わると困る', () => {
    const inv = make()
    inv.pick({ id: 'sniper', ammo: 5, reserve: 15 })
    expect(inv.held).toBe('rifle')
  })

  test('撃った弾が溜まると投げられる弾倉が増える', () => {
    const inv = make()
    inv.gainMagazine()
    expect(inv.list('weapon').map((c) => c.id)).toContain('magazine')
  })
})

describe('連打', () => {
  test('持ち替え中の入力は捨てずに溜める。終わったら続けて移る', () => {
    const inv = make()
    inv.switchTo('grenade')
    // まだ切り替え中。ここで押した分が消えない
    inv.switchTo('knife')
    expect(inv.held).toBe('grenade')
    settle(inv)
    expect(inv.held).toBe('knife')
  })

  test('溜めるのは 1 つだけ。指を離した後も動き続けない', () => {
    const inv = make()
    inv.switchTo('grenade')
    inv.switchTo('knife')
    inv.switchTo('pistol')
    settle(inv)
    expect(inv.held).toBe('pistol')
    settle(inv)
    expect(inv.held).toBe('pistol')
  })

  test('いま持っている物を指し直したら溜めない', () => {
    const inv = make()
    inv.switchTo('grenade')
    inv.switchTo('grenade')
    settle(inv)
    expect(inv.held).toBe('grenade')
  })

  test('代償は残る。連打しても 1 回ぶんの時間は必ずかかる', () => {
    const inv = make()
    inv.switchTo('grenade')
    inv.switchTo('knife')
    inv.update(SWITCH_TIME / 2)
    expect(inv.switching).toBe(true)
    expect(inv.held).toBe('grenade')
  })
})
