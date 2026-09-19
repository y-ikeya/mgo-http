import { describe, expect, test } from 'bun:test'
import { Footsteps } from './footsteps'

/**
 * 梯子の足音。**縦に進んだ分を段として数える。**
 *
 * 横の距離しか見ていなかったので、梯子を登っても 1 度も鳴らなかった。
 */
describe('梯子', () => {
  test('登った高さぶん、段の音が出る。金属の札が付く', () => {
    const steps = new Footsteps()
    steps.warp(0, 10, 0)
    let heard = 0
    // 1.0 m/s で 2 秒登る (64Hz)
    for (let i = 1; i <= 128; i++) {
      const step = steps.update(0, 10 + i / 64, 0, 'climb', false)
      if (step) {
        heard++
        expect(step.climbing).toBe(true)
      }
    }
    // 2m / 0.35m = 5 段と少し
    expect(heard).toBe(5)
  })

  test('床の上では高さの変化を数えない (段差を降りても歩いたことにならない)', () => {
    const steps = new Footsteps()
    steps.warp(0, 10, 0)
    for (let i = 1; i <= 64; i++) {
      expect(steps.update(0, 10 - i / 32, 0, 'run_f', true)).toBeNull()
    }
  })

  test('上端を乗り越える型では鳴らない', () => {
    const steps = new Footsteps()
    steps.warp(0, 10, 0)
    for (let i = 1; i <= 64; i++) {
      expect(steps.update(0, 10 + i / 32, 0, 'climb_top', false)).toBeNull()
    }
  })
})
