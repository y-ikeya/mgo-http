import { describe, expect, test } from 'bun:test'
import {
  canHold,
  chooseLoadout,
  chooseSkills,
  fitLoadout,
  isPrimaryChoice,
  isSupportChoice,
} from './equip'
import { newMatchPlayer, refill } from './player'

/**
 * **申告を鵜呑みにしない。**
 *
 * 手にある物も選んだ装備も、決めているのはクライアント。サーバーはそれを
 * 受け取るだけなので、「持てない物を持っている」と言われたときに気づく必要が
 * ある。以前は素通りで書き込んでいて、選んでいない銃を名乗って撃つのが形の上
 * では通っていた。
 */
function fresh() {
  return newMatchPlayer({ id: 'a', name: 'A', team: 'blue', slot: 0, now: 0 })
}

describe('何を持てるか', () => {
  test('ナイフ・ダンボール・拳銃は最初から持っている', () => {
    const p = fresh()
    expect(canHold(p, 'knife')).toBe(true)
    expect(canHold(p, 'box')).toBe(true)
    expect(canHold(p, 'm9')).toBe(true)
  })

  test('選んだ主武器は持てる。**選んでいない銃は持てない**', () => {
    const p = fresh()
    chooseLoadout(p, 'sniper', 'grenade', true)
    refill(p)
    expect(canHold(p, 'sniper')).toBe(true)
    expect(canHold(p, 'rifle')).toBe(false)
    expect(canHold(p, 'smg')).toBe(false)
  })

  test('拾えば持てる。**置けばまた持てなくなる**', () => {
    const p = fresh()
    chooseLoadout(p, 'sniper', 'grenade', true)
    refill(p)
    p.inventory.pick({ id: 'rifle', ammo: 30, reserve: 90 })
    expect(canHold(p, 'rifle')).toBe(true)
    p.inventory.drop('rifle')
    expect(canHold(p, 'rifle')).toBe(false)
  })

  test('拾った物は次の命へ持ち越さない', () => {
    const p = fresh()
    refill(p)
    p.inventory.pick({ id: 'smg', ammo: 50, reserve: 100 })
    refill(p)
    expect(canHold(p, 'smg')).toBe(false)
  })

  /**
   * **置いた銃はもう自分の物ではない。**
   *
   * 主武器を特例で通していた頃は、地面に置いても名乗り続けられた — 置いた銃を
   * 他人に拾わせながら、自分もその銃として撃てる。弾数を見ていないので複製に
   * なる (server/damage.ts は magazine を参照しない)。
   */
  test('**主武器も、置けば持てなくなる**', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    refill(p)
    expect(canHold(p, 'rifle')).toBe(true)
    p.inventory.drop('rifle')
    expect(canHold(p, 'rifle')).toBe(false)
  })

  test('**支援も同じ。** 手榴弾を置いたら名乗れない', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    refill(p)
    p.inventory.drop('grenade')
    expect(canHold(p, 'grenade')).toBe(false)
  })

  test('選んだ支援だけ。クレイモアを選んで手榴弾は持てない', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'claymore', true)
    refill(p)
    expect(canHold(p, 'claymore')).toBe(true)
    expect(canHold(p, 'grenade')).toBe(false)
  })

  test('表に無い名前は弾く', () => {
    const p = fresh()
    expect(canHold(p, 'railgun' as never)).toBe(false)
  })
})

describe('装備を選ぶ', () => {
  test('表に無い名前は通さない。**選ぶ前の装備が残る**', () => {
    const p = fresh()
    const before = p.primary
    expect(chooseLoadout(p, 'railgun', 'grenade', true)).toBe(false)
    expect(p.primary).toBe(before)
  })

  test('主武器の枠に拳銃は入らない', () => {
    const p = fresh()
    expect(chooseLoadout(p, 'm9', 'grenade', true)).toBe(false)
  })

  test('支度中なら投げ物もすぐ配り直す', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'claymore', true)
    expect(p.grenades).toBe(2)
  })

  test('**生きている間に選び直しても、いま手にある数は変わらない。** 次の湧きから', () => {
    const p = fresh()
    p.grenades = 1
    chooseLoadout(p, 'rifle', 'claymore', false)
    expect(p.grenades).toBe(1)
    expect(p.support).toBe('claymore')
  })

  test('名前の検査そのもの', () => {
    expect(isPrimaryChoice('rifle')).toBe(true)
    expect(isPrimaryChoice('knife')).toBe(false)
    expect(isSupportChoice('claymore')).toBe(true)
    expect(isSupportChoice('rifle')).toBe(false)
  })
})

/**
 * スキルの選び直し。**装備とは粒度が違う。**
 *
 *     装備    1 つの命ごと
 *     スキル  1 試合に 1 度。始まったら固定
 *
 * 倒されるたびに組み替えられると、相手を見てから後出しするゲームになる。
 */
describe('スキルを選び直す', () => {
  test('始まる前なら通る', () => {
    const p = fresh()
    expect(chooseSkills(p, { runner: 2, exposure: 1 }, 'waiting')).toBe(true)
    expect(p.skills).toEqual({ runner: 2, exposure: 1 })
  })

  test('**始まったら弾く。** いま効いている物はそのまま', () => {
    const p = fresh()
    chooseSkills(p, { runner: 2 }, 'countdown')
    expect(chooseSkills(p, { sniperMastery: 3 }, 'playing')).toBe(false)
    expect(p.skills).toEqual({ runner: 2 })
  })

  test('決着したら開く。試合をまたげば組み替えてよい', () => {
    const p = fresh()
    expect(chooseSkills(p, { boxMove: 3 }, 'over')).toBe(true)
  })

  test('予算を超えたら弾く', () => {
    const p = fresh()
    expect(chooseSkills(p, { runner: 3, boxMove: 3 }, 'waiting')).toBe(false)
    expect(p.skills).toEqual({})
  })

  test('知らない名前が混ざったら**丸ごと**弾く', () => {
    const p = fresh()
    expect(chooseSkills(p, { runner: 1, aimbot: 1 }, 'waiting')).toBe(false)
    expect(p.skills).toEqual({})
  })

  test('object でない物を送られても落ちない', () => {
    const p = fresh()
    expect(chooseSkills(p, null, 'waiting')).toBe(false)
    expect(chooseSkills(p, 'runner', 'waiting')).toBe(false)
    expect(chooseSkills(p, 3, 'waiting')).toBe(false)
  })

  test('空にするのは通る。**全部外すのも選択**', () => {
    const p = fresh()
    chooseSkills(p, { runner: 2 }, 'waiting')
    expect(chooseSkills(p, {}, 'waiting')).toBe(true)
    expect(p.skills).toEqual({})
  })
})

/**
 * 部屋が持ち込める銃を絞る。
 *
 * **画面から消すだけでは足りない。** 一覧に出さなくても送ってくる側は止まらず、
 * 狙撃銃だけの部屋に突撃銃で入られたら遊びが丸ごと壊れる。
 */
describe('部屋が絞る主武器', () => {
  const SNIPER_ONLY = ['sniper'] as const

  test('絞られていれば、その中からしか選べない', () => {
    const p = fresh()
    expect(chooseLoadout(p, 'sniper', 'grenade', true, SNIPER_ONLY)).toBe(true)
    expect(chooseLoadout(p, 'rifle', 'grenade', true, SNIPER_ONLY)).toBe(false)
  })

  test('**弾いたら前の装備が残る。** 半分だけ通さない', () => {
    const p = fresh()
    chooseLoadout(p, 'sniper', 'grenade', true, SNIPER_ONLY)
    chooseLoadout(p, 'rifle', 'claymore', true, SNIPER_ONLY)
    expect(p.primary).toBe('sniper')
    expect(p.support).toBe('grenade')
  })

  test('渡さなければ今まで通り。**絞っていない部屋は何でも**', () => {
    const p = fresh()
    expect(chooseLoadout(p, 'rifle', 'grenade', true)).toBe(true)
  })
})

/**
 * 部屋を移ったとき。**装備は席に付いて回る。**
 *
 * 突撃銃を選んだまま狙撃銃だけの部屋へ入れる。選び直さないまま湧くと、弾く
 * 仕掛け (chooseLoadout) を一度も通らずにその銃で戦場へ出てしまう。
 */
describe('部屋に合わせて丸める', () => {
  test('持ち込めない銃なら、持てるものへ替わる', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    fitLoadout(p, ['sniper'])
    expect(p.primary).toBe('sniper')
  })

  test('**持ち物も組み直す。** 名前だけ替えて手には突撃銃、にしない', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    fitLoadout(p, ['sniper'])
    expect(p.inventory.weapon).toBe('sniper')
  })

  test('持ち込めるならそのまま。**黙って替えない**', () => {
    const p = fresh()
    chooseLoadout(p, 'sniper', 'claymore', true)
    fitLoadout(p, ['sniper', 'rifle'])
    expect(p.primary).toBe('sniper')
    expect(p.support).toBe('claymore')
  })

  /**
   * **空の一覧は「銃を持たせない」。** 絞っていないことではない。
   *
   * 絞らない部屋は primaries を書かず、primariesOf が全部を返すので、空が
   * 届くのは「ナイフだけ」と宣言した部屋からだけ (domain/match/room.ts)。
   * 以前ここは「絞っていない部屋では何も起きない」と読んでいて、**同じ空配列に
   * 2 つの意味**が乗っていた。
   */
  test('**主武器を外した部屋では、拳銃に下がる**', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    fitLoadout(p, [])
    expect(p.primary).toBeNull()
    // 副武器は残っているので、手にあるのは拳銃
    expect(p.inventory.held).toBe('m9')
  })

  test('**銃を 1 挺も持たない部屋では、手にあるのはナイフ**', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    // 主武器も副武器も外す = ナイフ部屋
    fitLoadout(p, [], null)
    expect(p.primary).toBeNull()
    expect(p.secondary).toBeNull()
    // 手ぶらにはならない。ナイフと箱は誰でも持っている (buildCarried)
    expect(p.inventory.held).toBe('knife')
  })

  test('**銃のある部屋で丸腰は名乗れない。** 部屋の作りが決める', () => {
    const p = fresh()
    // 絞っていない部屋 (allowed を渡さない) でも通らない
    expect(chooseLoadout(p, null, 'grenade', true)).toBe(false)
    // 狙撃銃だけの部屋でも通らない
    expect(chooseLoadout(p, null, 'grenade', true, ['sniper'])).toBe(false)
  })

  test('銃を外した部屋でだけ、丸腰を名乗れる', () => {
    const p = fresh()
    expect(chooseLoadout(p, null, 'grenade', true, [])).toBe(true)
    expect(p.primary).toBeNull()
    // その部屋では銃を名乗っても入れない
    expect(chooseLoadout(p, 'rifle', 'grenade', true, [])).toBe(false)
    expect(p.primary).toBeNull()
  })
})
