import { describe, expect, test } from 'bun:test'
import {
  TARGET_REPICK_MS,
  TARGET_RETURN_MS,
  TARGET_TOUCH,
  carryTo,
  drop,
  placeTarget,
  returnIfIdle,
  take,
  targetHomeFor,
  targetReturnsAt,
  touches,
} from './target'

/**
 * TSNE のターゲット。**守る側の陣地の近くに置き、攻める側が触れて取り、落ちれば 30 秒で戻る。**
 */
describe('ターゲット', () => {
  const home = { x: 10, z: 20, y: 1 }

  test('置き場所は守る側の基地に近いほう', () => {
    const near = { x: 0, z: 0 }
    const far = { x: 100, z: 100 }
    expect(targetHomeFor([far, near], { x: 5, z: 5 })).toBe(near)
    expect(targetHomeFor([], { x: 5, z: 5 })).toBeNull()
  })

  test('触れる距離に入れば取れる。運ばれている物は取れない', () => {
    const target = placeTarget(home)
    expect(touches(target, 'a', home.x + TARGET_TOUCH - 0.01, 1, home.z, 0)).toBe(true)
    expect(touches(target, 'a', home.x + TARGET_TOUCH + 0.1, 1, home.z, 0)).toBe(false)
    // 上の階の床越しには取れない
    expect(touches(target, 'a', home.x, 4, home.z, 0)).toBe(false)
    expect(touches(take(target, 'a'), 'b', home.x, 1, home.z, 0)).toBe(false)
  })

  test('落とすとその場に落ち、30 秒動かされなければ置き場所へ戻る', () => {
    const carried = carryTo(take(placeTarget(home), 'a'), 50, 1, 60)
    const dropped = drop(carried, 50, 1, 60, 1000)
    expect(dropped.carrier).toBeNull()
    expect([dropped.x, dropped.z]).toEqual([50, 60])
    expect(returnIfIdle(dropped, 1000 + TARGET_RETURN_MS - 1)).toBe(dropped)
    const back = returnIfIdle(dropped, 1000 + TARGET_RETURN_MS)
    expect([back.x, back.z, back.carrier]).toEqual([home.x, home.z, null])
  })

  test('落とした本人は 2 秒拾い直せない (足元に落ちるので)。他の人はすぐ拾える', () => {
    const dropped = drop(take(placeTarget(home), 'a'), 50, 1, 60, 1000)
    expect(touches(dropped, 'a', 50, 1, 60, 1000 + TARGET_REPICK_MS - 1)).toBe(false)
    expect(touches(dropped, 'a', 50, 1, 60, 1000 + TARGET_REPICK_MS)).toBe(true)
    expect(touches(dropped, 'b', 50, 1, 60, 1001)).toBe(true)
  })

  test('拾い直せば戻るまでの時計は止まる (取って落としてで少しずつ運べる)', () => {
    const dropped = drop(take(placeTarget(home), 'a'), 50, 1, 60, 1000)
    const again = take(dropped, 'b')
    expect(returnIfIdle(again, 1000 + TARGET_RETURN_MS * 2)).toBe(again)
  })

  test('**戻るまでのカウントダウンは落ちている間だけ。取り直すと消え、次に落とした時は 30 秒から**', () => {
    const home = { x: 0, z: 0, y: 0 }
    expect(targetReturnsAt(placeTarget(home))).toBeNull()
    const first = drop(take(placeTarget(home), 'a'), 5, 0, 5, 1000)
    expect(targetReturnsAt(first)).toBe(1000 + TARGET_RETURN_MS)
    const retaken = take(first, 'a')
    expect(targetReturnsAt(retaken)).toBeNull()
    const second = drop(retaken, 9, 0, 9, 21_000)
    expect(targetReturnsAt(second)).toBe(21_000 + TARGET_RETURN_MS)
  })
})
