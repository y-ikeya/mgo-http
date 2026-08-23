import { describe, expect, test } from 'bun:test'
import { canHold, chooseLoadout, isPrimaryChoice, isSupportChoice } from './equip'
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
