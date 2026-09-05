import { describe, expect, test } from 'bun:test'
import { Inventory, type HandContext } from './inventory'
import { BROWSE_HOLD, SWITCH_TIME, type Family } from './held'
import { NO_INTENT, type Intent } from '../player/intent'

/**
 * 持ち物の状態と遷移。
 *
 * ここで守りたいのは**持ち替えに代償があること**。撃てる物を持っていないと
 * 撃てないし、持ち替えている最中も撃てない。それが投げること・刺すことの値段に
 * なっている (docs/design.md の 5)。
 */

const loadout = { primary: 'rifle', secondary: 'm9', support: 'grenade' } as const
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
    expect(make().handReady).toBe(true)
  })
})

describe('持ち替えの代償', () => {
  test('持ち替えた直後は撃てない', () => {
    const inv = make()
    inv.switchTo('grenade')
    expect(inv.switching).toBe(true)
    expect(inv.handReady).toBe(false)
  })

  test('時間が経つと持ち替えが終わる', () => {
    const inv = make()
    inv.switchTo('m9')
    settle(inv)
    expect(inv.switching).toBe(false)
    expect(inv.handReady).toBe(true)
  })

  test('**撃てない物を持っている間は、持ち替えが終わっても撃てない**', () => {
    const inv = make()
    inv.switchTo('grenade')
    settle(inv)
    expect(inv.switching).toBe(false)
    expect(inv.handReady).toBe(false)
  })

  test('ナイフも撃てない。刺しに行くと決めた時点で撃つ手段を手放す', () => {
    const inv = make()
    inv.switchTo('knife')
    settle(inv)
    expect(inv.handReady).toBe(false)
  })

  test('持ち替えの最中に更に持ち替えられない。代償を踏み倒せてしまう', () => {
    const inv = make()
    inv.switchTo('grenade')
    expect(inv.switchTo('m9')).toBe(false)
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
    inv.switchTo('m9')
    settle(inv)
    expect(inv.held).toBe('m9')
    settle(inv)
    expect(inv.held).toBe('m9')
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
    expect(inv.handReady).toBe(true)
  })

  test('NONE から戻るのは持っていた武器。主武器ではない', () => {
    const inv = make()
    inv.switchTo('m9'); settle(inv)
    inv.toggle('tool'); settle(inv)   // box
    inv.toggle('tool'); settle(inv)   // none
    expect(inv.held).toBe('m9')
  })

  test('箱を被っている間も武器の選択は覚えている', () => {
    const inv = make()
    inv.switchTo('grenade'); settle(inv)
    inv.toggle('tool'); settle(inv)
    expect(inv.weapon).toBe('grenade')
    expect(inv.handReady).toBe(false)
  })

  test('道具の一覧は 箱 → NONE の順', () => {
    expect(make().list('tool').map((c) => c.id)).toEqual(['box', 'none'])
  })
})

/**
 * 取り上げられる。**選んで降ろしたのではない。**
 *
 * ダンボールで敵にぶつかると箱が落ちる。持ち替えで武器へ移るだけだと道具の
 * 枠には箱が残り、一覧には C.BOX が出たまま — 落とされたのにそう見えない。
 */
describe('道具を取り上げられる', () => {
  test('枠ごと NONE に戻る', () => {
    const inv = make()
    inv.toggle('tool'); settle(inv)
    expect(inv.tool).toBe('box')
    inv.dropTool()
    expect(inv.tool).toBe('none')
    expect(inv.selected).toBe('rifle')
    expect(inv.usingTool).toBe(false)
  })

  test('手には持っていた武器が戻る。**手ぶらにはならない**', () => {
    const inv = make()
    inv.switchTo('m9'); settle(inv)
    inv.toggle('tool'); settle(inv)
    inv.dropTool()
    expect(inv.held).toBe('m9')
  })

  test('**持ち替えの時間は取らない。** 取り上げられている間は他ができない', () => {
    const inv = make()
    inv.toggle('tool'); settle(inv)
    inv.dropTool()
    expect(inv.switching).toBe(false)
    expect(inv.handReady).toBe(true)
  })

  test('道具を手にしていなければ何も起きない', () => {
    const inv = make()
    inv.dropTool()
    expect(inv.selected).toBe('rifle')
    expect(inv.tool).toBe('none')
  })

  test('取り上げられた後も、C を押せばまた被れる', () => {
    const inv = make()
    inv.toggle('tool'); settle(inv)
    inv.dropTool()
    inv.toggle('tool'); settle(inv)
    expect(inv.selected).toBe('box')
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
    expect(inv.handReady || inv.held === 'knife').toBe(true)
  })

  test('**ナイフは置けない。** 全部置いても手ぶらにはならない', () => {
    const inv = make()
    expect(inv.drop('knife')).toBe(null)
    for (const id of ['rifle', 'm9', 'grenade'] as const) inv.drop(id)
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
    const inv = new Inventory({ primary: 'rifle', secondary: 'm9', support: 'grenade' })
    // サーバーが「選んでいたのは P90」と返してくる
    inv.refill({ primary: 'smg', secondary: 'm9', support: 'grenade' })
    inv.restore({ smg: 20 }, { smg: 60 }, 2)

    expect(inv.held).toBe('smg')
    expect(inv.ammo).toBe(20)
    expect(inv.reserve).toBe(60)
    expect(inv.list('weapon').map((c) => c.id)).toContain('smg')
    expect(inv.list('weapon').map((c) => c.id)).not.toContain('rifle')
  })

  test('組み直す前に弾を当てると、当てる先が無い', () => {
    const inv = new Inventory({ primary: 'rifle', secondary: 'm9', support: 'grenade' })
    // 順番を逆にした場合。**P90 を持っていないので弾は捨てられる**
    inv.restore({ smg: 20 }, { smg: 60 }, 2)
    inv.refill({ primary: 'smg', secondary: 'm9', support: 'grenade' })
    expect(inv.ammo).toBe(50)
  })
})

describe('箱を挟んだ持ち替え', () => {
  test('**箱を被って戻っても、武器の往復は続く。** ナイフが出てこない', () => {
    const inv = new Inventory({ primary: 'smg', secondary: 'm9', support: 'grenade' })
    // P90 → M9
    inv.toggle('weapon'); settle(inv)
    expect(inv.held).toBe('m9')

    // ダンボールを被って、また武器へ戻る
    inv.toggle('tool'); settle(inv)
    expect(inv.held).toBe('box')
    inv.toggle('weapon'); settle(inv)
    expect(inv.held).toBe('m9')

    // **ここが P90 に戻ってほしい所** (直前の武器)
    inv.toggle('weapon'); settle(inv)
    expect(inv.held).toBe('smg')
  })

  test('投げ物を挟んでも往復の相手は変わらない', () => {
    const inv = new Inventory({ primary: 'smg', secondary: 'm9', support: 'grenade' })
    inv.switchTo('grenade'); settle(inv)
    inv.toggle('weapon'); settle(inv)
    // 手榴弾 → 直前の武器 (P90)
    expect(inv.held).toBe('smg')
  })
})

/**
 * 押されている物から、手にある物を決める。
 *
 * Game.ts (2900 行) の中でキーコードと three に挟まれていた判断。**代償の
 * 置き方がここにある** — 構えたままでは持ち替えられないし、選ぶのはタダだが
 * 抜くのには時間がかかる。掘り出したので、three 無しで確かめられる。
 */
const FREE: HandContext = {
  canAct: true,
  choosing: false,
  aiming: false,
  cocking: false,
  canWearBox: true,
}

/** 何も押していない Intent に、渡した分だけ足す */
function press(over: Partial<Intent> = {}): Intent {
  return { ...NO_INTENT, ...over, browse: { ...NO_INTENT.browse, ...over.browse } }
}

/** 系統のキーを押し続ける。返るのは最後の呼びで出た出来事 */
function hold(inv: Inventory, family: Family, seconds: number, over: Partial<Intent> = {}) {
  return inv.hand(press({ ...over, browse: { [family]: true } as never }), FREE, seconds)
}

describe('一覧を開く', () => {
  test('短く押して離すとトグル。一覧は出ない', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD / 2)
    expect(inv.browsing).toBeNull()
    inv.hand(press(), FREE, 0.016)
    // 主武器 ⇄ 副武器の往復
    expect(inv.held).toBe('m9')
  })

  test('押さえ続けると一覧が出る', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    expect(inv.browsing?.family).toBe('weapon')
    // **開いただけでは持ち替えていない。** 選ぶのはタダ
    expect(inv.held).toBe('rifle')
    expect(inv.switching).toBe(false)
  })

  /**
   * **出た瞬間を 1 回だけ知らせる。**
   *
   * 押さえている間ずっと知らせると、鳴らす側が毎フレーム音を重ねる。開くのは
   * 一度きりの出来事なので、出来事として 1 回出す。
   */
  test('出た瞬間だけ知らせる。押さえ続けても増えない', () => {
    const inv = make()
    expect(hold(inv, 'weapon', BROWSE_HOLD)).toContainEqual({ kind: 'opened' })
    // 開いたまま押さえ続ける
    expect(hold(inv, 'weapon', 0.016)).not.toContainEqual({ kind: 'opened' })
  })

  test('出る前は知らせない', () => {
    const inv = make()
    expect(hold(inv, 'weapon', BROWSE_HOLD / 2)).not.toContainEqual({ kind: 'opened' })
  })

  test('道具の一覧でも知らせる', () => {
    const inv = make()
    expect(hold(inv, 'tool', BROWSE_HOLD)).toContainEqual({ kind: 'opened' })
  })

  test('一覧は手にある物を指して開く', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    const at = inv.browsing!.at
    expect(inv.list('weapon')[at]?.id).toBe('rifle')
  })

  test('送って離すと、選んだ物へ移る', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    const before = inv.browsing!.at
    hold(inv, 'weapon', 0.016, { select: 1 })
    expect(inv.browsing!.at).not.toBe(before)
    const picked = inv.list('weapon')[inv.browsing!.at]!.id
    inv.hand(press(), FREE, 0.016)
    expect(inv.browsing).toBeNull()
    expect(inv.held).toBe(picked)
  })

  test('端で止めず回る', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    const n = inv.list('weapon').length
    const start = inv.browsing!.at
    for (let i = 0; i < n; i++) hold(inv, 'weapon', 0.016, { select: 1 })
    expect(inv.browsing!.at).toBe(start)
  })
})

describe('持ち替えられない場面', () => {
  test('構えたままでは持ち替えられない。一覧も閉じる', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    expect(inv.browsing).not.toBeNull()

    inv.hand(press({ browse: { weapon: true, tool: false } }), { ...FREE, aiming: true }, 0.016)
    expect(inv.browsing).toBeNull()
    // 離しても持ち替わらない
    inv.hand(press(), { ...FREE, aiming: true }, 0.016)
    expect(inv.held).toBe('rifle')
  })

  test('ボルトを送っている間は何も起きない。**押していた長さは消えない**', () => {
    const inv = make()
    // 送っている間に押さえ込む
    inv.hand(press({ browse: { weapon: true, tool: false } }), { ...FREE, cocking: true }, BROWSE_HOLD)
    expect(inv.browsing).toBeNull()
    // 送り終えたら、押しっぱなしのぶんが効く
    hold(inv, 'weapon', BROWSE_HOLD)
    expect(inv.browsing?.family).toBe('weapon')
  })

  test('支度中は押していたことごと忘れる', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    inv.hand(press(), { ...FREE, choosing: true }, 0.016)
    expect(inv.browsing).toBeNull()
    // 離した扱いにならない = トグルも走らない
    expect(inv.held).toBe('rifle')
  })
})

describe('地面との出し入れ', () => {
  test('一覧を開いていなければ拾う', () => {
    const inv = make()
    expect(inv.hand(press({ drop: true }), FREE, 0.016)).toEqual([{ kind: 'pickup' }])
  })

  test('一覧を開いていれば、指している物を置く', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    const events = hold(inv, 'weapon', 0.016, { drop: true })
    const dropped = events.find((e) => e.kind === 'dropped')
    expect(dropped).toBeDefined()
    expect(inv.has('rifle')).toBe(false)
    // 置いた物を指したまま残すと、離した瞬間に「持っていない物へ持ち替える」になる
    expect(inv.browsing).toBeNull()
  })

  test('置けない物 (ナイフ) は置けない。拾いにも行かない', () => {
    const inv = make()
    hold(inv, 'weapon', BROWSE_HOLD)
    const knife = inv.list('weapon').findIndex((c) => c.id === 'knife')
    inv.browsing!.at = knife
    expect(hold(inv, 'weapon', 0.016, { drop: true })).toEqual([])
    expect(inv.has('knife')).toBe(true)
  })
})

describe('名指しの持ち替え', () => {
  test('支援装備へ直接移る', () => {
    const inv = make()
    inv.hand(press({ toSupport: true }), FREE, 0.016)
    expect(inv.held).toBe('grenade')
  })

  test('ナイフへ直接移る', () => {
    const inv = make()
    inv.hand(press({ toKnife: true }), FREE, 0.016)
    expect(inv.held).toBe('knife')
  })
})

/**
 * **転がりながらは被れない。**
 *
 * 体の側 (scene/actor/player.ts) だけで弾いていたので、持ち物は箱に切り替わる
 * のに体は被らなかった — 左下の HUD が「被っている」と言っているのに、画面の
 * 中では被っていない。手にする所で断れば、両方が同じことを言う。
 */
describe('被れない体勢', () => {
  const rolling: HandContext = { ...FREE, canWearBox: false }

  test('転がり中に道具へ持ち替えても、箱にはならない', () => {
    const inv = make()
    inv.hand(press({ browse: { weapon: false, tool: true } }), rolling, 0.016)
    inv.hand(press(), rolling, 0.016)
    expect(inv.held).not.toBe('box')
    expect(inv.usingTool).toBe(false)
  })

  test('体勢が戻れば被れる', () => {
    const inv = make()
    inv.hand(press({ browse: { weapon: false, tool: true } }), FREE, 0.016)
    inv.hand(press(), FREE, 0.016)
    expect(inv.held).toBe('box')
  })

  test('**名指しの持ち替えも同じ。** 抜け道を作らない', () => {
    const inv = make()
    inv.hand(press(), rolling, 0.016)
    expect(inv.switchTo('box')).toBe(false)
    expect(inv.held).not.toBe('box')
  })
})
