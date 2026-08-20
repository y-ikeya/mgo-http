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

describe('道具の枠と NONE', () => {
  test('C で被り、もう一度 C で NONE に戻る', () => {
    const inv = make()
    inv.toggle('tool'); settle(inv)
    expect(inv.selected).toBe('box')
    expect(inv.usingTool).toBe(true)
    inv.toggle('tool'); settle(inv)
    expect(inv.selected).toBe('none')
    expect(inv.usingTool).toBe(false)
  })

  test('**NONE を選んでいる間も手には武器がある。** 撃てなくなってはいけない', () => {
    const inv = make()
    inv.toggle('tool'); settle(inv)   // box
    inv.toggle('tool'); settle(inv)   // none
    expect(inv.held).toBe('rifle')
    expect(inv.canShoot).toBe(true)
  })

  test('NONE から戻るのは持っていた武器。主武器ではない', () => {
    const inv = make()
    inv.switchTo('pistol'); settle(inv)
    inv.toggle('tool'); settle(inv)   // box
    inv.toggle('tool'); settle(inv)   // none
    expect(inv.held).toBe('pistol')
  })

  test('箱を被っている間も武器の選択は覚えている', () => {
    const inv = make()
    inv.switchTo('grenade'); settle(inv)
    inv.toggle('tool'); settle(inv)
    expect(inv.weapon).toBe('grenade')
    expect(inv.canShoot).toBe(false)
  })

  test('道具の一覧は 箱 → NONE の順', () => {
    expect(make().list('tool').map((c) => c.id)).toEqual(['box', 'none'])
  })
})

describe('地面へ置く', () => {
  test('外した物が弾ごと返る。持ち物からは消える', () => {
    const inv = make()
    inv.switchTo('rifle'); settle(inv)
    const gone = inv.drop('rifle')
    expect(gone).toEqual({ id: 'rifle', ammo: 30, reserve: 90 })
    expect(inv.list('weapon').map((c) => c.id)).not.toContain('rifle')
  })

  test('手にしていた物を外したら、次の武器へ持ち替える', () => {
    const inv = make()
    inv.switchTo('rifle'); settle(inv)
    inv.drop('rifle'); settle(inv)
    expect(inv.held).not.toBe('rifle')
    expect(inv.canShoot || inv.held === 'knife').toBe(true)
  })

  test('**ナイフは置けない。** 全部置いても手ぶらにはならない', () => {
    const inv = make()
    expect(inv.drop('knife')).toBe(null)
    for (const id of ['rifle', 'pistol', 'grenade'] as const) inv.drop(id)
    settle(inv)
    expect(inv.held).toBe('knife')
  })

  test('持っていない物は置けない', () => {
    const inv = make()
    inv.drop('rifle')
    expect(inv.drop('rifle')).toBe(null)
  })

  test('置いた物は拾い直せる', () => {
    const inv = make()
    const gone = inv.drop('rifle')
    expect(gone).not.toBe(null)
    expect(inv.pick(gone!)).toBe(true)
    expect(inv.list('weapon').map((c) => c.id)).toContain('rifle')
  })
})

describe('画面を読み直したとき', () => {
  test('**選んでいた主武器のまま戻る。** 既定の AK47 に戻らない', () => {
    // 画面を読み直すと持ち物は既定 (AK47) で作られる
    const inv = new Inventory({ primary: 'rifle', secondary: 'pistol', support: 'grenade' })
    // サーバーが「選んでいたのは P90」と返してくる
    inv.refill({ primary: 'smg', secondary: 'pistol', support: 'grenade' })
    inv.restore({ smg: 20 }, { smg: 60 }, 2)

    expect(inv.held).toBe('smg')
    expect(inv.ammo).toBe(20)
    expect(inv.reserve).toBe(60)
    expect(inv.list('weapon').map((c) => c.id)).toContain('smg')
    expect(inv.list('weapon').map((c) => c.id)).not.toContain('rifle')
  })

  test('組み直す前に弾を当てると、当てる先が無い', () => {
    const inv = new Inventory({ primary: 'rifle', secondary: 'pistol', support: 'grenade' })
    // 順番を逆にした場合。**P90 を持っていないので弾は捨てられる**
    inv.restore({ smg: 20 }, { smg: 60 }, 2)
    inv.refill({ primary: 'smg', secondary: 'pistol', support: 'grenade' })
    expect(inv.ammo).toBe(50)
  })
})
