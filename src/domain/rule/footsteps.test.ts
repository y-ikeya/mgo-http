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

/**
 * 歩きの足音。**走りより小さく、近くまでしか届かない。**
 */
describe('歩き', () => {
  function firstStep(locomotion: 'walk' | 'crouch_walk' | 'run_f' | 'crouch_f') {
    const steps = new Footsteps()
    steps.warp(0, 0, 0)
    for (let i = 1; i <= 200; i++) {
      const step = steps.update(0, 0, i * 0.02, locomotion, true)
      if (step) return step
    }
    throw new Error('鳴らない')
  }

  test('立って歩くと、走りより静かで届く距離も短い', () => {
    const walk = firstStep('walk')
    const run = firstStep('run_f')
    expect(walk.volume).toBeLessThan(run.volume)
    expect(walk.range).toBeLessThan(run.range)
  })

  test('しゃがんで歩くと、しゃがんで走るより静か', () => {
    const walk = firstStep('crouch_walk')
    const run = firstStep('crouch_f')
    expect(walk.range).toBeLessThan(run.range)
  })
})
