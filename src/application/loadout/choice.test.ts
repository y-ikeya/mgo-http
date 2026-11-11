import { describe, expect, test } from 'bun:test'
import { CHOICES, isTranquilizer } from '../../domain/item/weapons'
import { chooseLoadout, fitArmory, newLoadoutChoice, resumeLoadout, spawnLoadout, stepChoice } from './choice'

/**
 * **選んだ物と配られる物が食い違わない。** Game.ts の中にあった頃は描画器が無いと試せず、
 * 食い違いは遊んでから見つかっていた (M9 から印が動かない、P90 を選んだのに AK で戻る)
 */
describe('部屋に入った時', () => {
  test('**前回選んだ物から始める。** 初めてなら一覧の先頭', () => {
    expect(newLoadoutChoice('bravo', { primary: 'shotgun', support: 'claymore' }).pending).toMatchObject({
      primary: 'shotgun',
      support: 'claymore',
    })
    expect(newLoadoutChoice('bravo', null).pending.primary).toBe(CHOICES.primary[0]!)
  })

  test('**部屋で持ち込めない物は先頭へ丸める。** 狙撃銃の部屋で何も選ばれていない、にしない', () => {
    const delta = newLoadoutChoice('delta', { primary: 'smg', secondary: 'm1911' })
    expect(delta.pending.primary).toBe('sniper')
    // 副武器を持たせない部屋では、前回の拳銃を持ち込まない
    expect(delta.pending.secondary).toBeNull()
    expect(delta.held).toEqual(delta.pending)
  })
})

describe('選ぶ', () => {
  test('**送って、画面へ知らせる。** 支度の間なら持ち物もすぐ配り直す', () => {
    const choice = newLoadoutChoice('bravo', null)
    expect(chooseLoadout(choice, 'support', 'claymore', true).map((e) => e.kind)).toEqual(['send', 'refill', 'chosen'])
    expect(choice.held.support).toBe('claymore')
  })

  test('**戦場に居る間に選んでも、いま持っている物は変わらない**', () => {
    const choice = newLoadoutChoice('bravo', { primary: 'rifle' })
    expect(chooseLoadout(choice, 'primary', 'shotgun', false).map((e) => e.kind)).toEqual(['send', 'chosen'])
    expect(choice.pending.primary).toBe('shotgun')
    expect(choice.held.primary).toBe('rifle')
    // 湧いた時に確定する
    expect(spawnLoadout(choice).primary).toBe('shotgun')
  })

  test('**副武器を選んだら印もそれに動く** (M9 から動かなかった)。持たせない部屋では何もしない', () => {
    const choice = newLoadoutChoice('bravo', null)
    chooseLoadout(choice, 'secondary', 'm1911', true)
    expect(choice.pending.secondary).toBe('m1911')
    expect(chooseLoadout(newLoadoutChoice('delta', null), 'secondary', 'm1911', true)).toEqual([])
  })

  test('パッドの左右は一覧の隣へ。端では回る', () => {
    const choice = newLoadoutChoice('delta', null)
    expect(stepChoice(choice, 'primary', 1)).toBe('mosin')
    expect(stepChoice(choice, 'primary', -1)).toBe('mosin')
    choice.pending.primary = 'mosin'
    expect(stepChoice(choice, 'primary', 1)).toBe('sniper')
  })
})

describe('側が分かった時 (TSNE)', () => {
  test('**攻める側は麻酔の銃だけ、STEALTH を持つ。** 選んでいた物が外れたら先頭へ', () => {
    const choice = newLoadoutChoice('charlie', { primary: 'rifle' })
    expect(fitArmory(choice, 'charlie', 'attack')).toEqual([{ kind: 'stealth', owned: true }])
    expect(isTranquilizer(choice.pending.primary!)).toBe(true)
    expect(choice.pending.secondary).toBe('m9')
    // 湧いた後に側が分かっても、持っている物に STEALTH が入る
    expect(choice.held.stealth).toBe(true)
  })

  test('守る側は STEALTH を持たない', () => {
    const choice = newLoadoutChoice('charlie', null)
    fitArmory(choice, 'charlie', 'defence')
    expect(choice.pending.stealth).toBe(false)
    expect(choice.armory.supports).toEqual(['grenade', 'claymore'])
  })
})

describe('繋ぎ直した時', () => {
  test('**サーバーが覚えている物に戻す。** 持っている物は主武器と support だけ', () => {
    const choice = newLoadoutChoice('bravo', null)
    resumeLoadout(choice, { primary: 'smg', secondary: 'm1911', support: 'decoy' })
    expect(choice.pending).toMatchObject({ primary: 'smg', secondary: 'm1911', support: 'decoy' })
    expect(choice.held).toMatchObject({ primary: 'smg', support: 'decoy', secondary: 'm9' })
  })

  test('**持っている銃はサーバーの持ち物に合わせる。** 選びと持ち物がずれていても、持っていない銃を組まない', () => {
    // 手元の前回の選びは M1911。サーバーの持ち物は AK と M9 (選びは M1911 へ変えたが、まだ湧き直していない)
    const choice = newLoadoutChoice('bravo', { primary: 'smg', secondary: 'm1911', support: 'grenade' })
    resumeLoadout(choice, { primary: 'smg', secondary: 'm1911', support: 'grenade', carried: ['rifle', 'm9'] })
    expect(choice.held).toMatchObject({ primary: 'rifle', secondary: 'm9' })
    // 次に湧く時の選びはサーバーの選びのまま
    expect(choice.pending).toMatchObject({ primary: 'smg', secondary: 'm1911' })
  })
})
