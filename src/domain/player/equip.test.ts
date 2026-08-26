import { describe, expect, test } from 'bun:test'
import { canHold, chooseLoadout, chooseSkills, isPrimaryChoice, isSupportChoice } from './equip'
import { newPlayer, refill } from './player'

/**
 * **申告を鵜呑みにしない。**
 *
 * 手にある物も選んだ装備も、決めているのはクライアント。サーバーはそれを
 * 受け取るだけなので、「持てない物を持っている」と言われたときに気づく必要が
 * ある。以前は素通りで書き込んでいて、選んでいない銃を名乗って撃つのが形の上
 * では通っていた。
 */
function fresh() {
  return newPlayer({ id: 'a', name: 'A', team: 'blue', slot: 0, now: 0 })
}

describe('何を持てるか', () => {
  test('ナイフ・ダンボール・拳銃は最初から持っている', () => {
    const p = fresh()
    expect(canHold(p, 'knife')).toBe(true)
    expect(canHold(p, 'box')).toBe(true)
    expect(canHold(p, 'pistol')).toBe(true)
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
    p.kit.push('rifle')
    expect(canHold(p, 'rifle')).toBe(true)
    p.kit = p.kit.filter((id) => id !== 'rifle')
    expect(canHold(p, 'rifle')).toBe(false)
  })

  test('拾った物は次の命へ持ち越さない', () => {
    const p = fresh()
    refill(p)
    p.kit.push('smg')
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
    p.kit = p.kit.filter((id) => id !== 'rifle')
    expect(canHold(p, 'rifle')).toBe(false)
  })

  test('**支援も同じ。** 手榴弾を置いたら名乗れない', () => {
    const p = fresh()
    chooseLoadout(p, 'rifle', 'grenade', true)
    refill(p)
    p.kit = p.kit.filter((id) => id !== 'grenade')
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
    expect(chooseLoadout(p, 'pistol', 'grenade', true)).toBe(false)
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
