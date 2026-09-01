import { describe, expect, test } from 'bun:test'
import { advanceHold, newHold, takeTap } from './hold'

/**
 * 単押しと長押しの分け方。
 *
 * **装置に触らないので、鍵盤もパッドも無しで確かめられる。** 前は押した時間を
 * 呼ぶ側 (presentation/scene/Game.ts) が数えていて、画面を出さないと動かせ
 * なかった。
 */

/** しゃがみ / 回避の閾値 (index.ts の BINDINGS と同じ値) */
const STANCE = 0.17

describe('しゃがみ (単押し) と回避 (長押し)', () => {
  test('**押している間はまだ決まらない。** どちらも立たない', () => {
    const hold = newHold()
    advanceHold(hold, true, 0.1, STANCE)
    expect(hold.fired).toBe(false)
    expect(takeTap(hold)).toBe(false)
  })

  test('短く押して離せば、単押し', () => {
    const hold = newHold()
    advanceHold(hold, true, 0.1, STANCE)
    advanceHold(hold, false, 0.016, STANCE)
    expect(takeTap(hold)).toBe(true)
  })

  test('**閾値を超えたら、離す前に立つ。** 判断してから体が動くまでの遅れを作らない', () => {
    const hold = newHold()
    advanceHold(hold, true, 0.1, STANCE)
    expect(hold.fired).toBe(false)
    advanceHold(hold, true, 0.1, STANCE)
    expect(hold.fired).toBe(true)
  })

  test('長押しの後に離しても、単押しは立たない', () => {
    const hold = newHold()
    advanceHold(hold, true, 0.3, STANCE)
    advanceHold(hold, false, 0.016, STANCE)
    expect(takeTap(hold)).toBe(false)
  })

  test('離せば長押しも解ける。次の押下でまた立つ', () => {
    const hold = newHold()
    advanceHold(hold, true, 0.3, STANCE)
    advanceHold(hold, false, 0.016, STANCE)
    expect(hold.fired).toBe(false)
    advanceHold(hold, true, 0.3, STANCE)
    expect(hold.fired).toBe(true)
  })

  test('単押しは 1 回だけ取れる。**消費する**', () => {
    const hold = newHold()
    advanceHold(hold, true, 0.05, STANCE)
    advanceHold(hold, false, 0.016, STANCE)
    expect(takeTap(hold)).toBe(true)
    expect(takeTap(hold)).toBe(false)
  })

  test('押さないまま進めても何も立たない', () => {
    const hold = newHold()
    advanceHold(hold, false, 0.5, STANCE)
    expect(hold.fired).toBe(false)
    expect(takeTap(hold)).toBe(false)
  })

  test('境目は含む。ちょうど 0.17 秒で立つ', () => {
    const hold = newHold()
    advanceHold(hold, true, STANCE, STANCE)
    expect(hold.fired).toBe(true)
  })
})

describe('長押しを持たない操作', () => {
  test('**いくら押しても長押しは立たない。** 単押しだけ', () => {
    const hold = newHold()
    advanceHold(hold, true, 5)
    expect(hold.fired).toBe(false)
    advanceHold(hold, false, 0.016)
    expect(takeTap(hold)).toBe(true)
  })
})
