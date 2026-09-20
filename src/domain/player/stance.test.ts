import { describe, expect, test } from 'bun:test'
import { stanceOf, HEAD_HEIGHT, leanOf, leanShift, LEAN_SHIFT } from './stance'

/**
 * 構えは**遊びに効く**ので domain に居る。頭の高さが遮蔽の判定に入り、
 * 屈んだ相手が壁の陰に隠れられるかが変わる。
 *
 * どのモーションを流すかは見た目の話で、こちらには無い
 * (presentation/scene/actor/motion.test.ts)。
 */
describe('構え', () => {
  test('しゃがんだまま刺しても、構えはしゃがみのまま', () => {
    // 立ちの型で流すと立ち上がってしまい、倒れている相手を見下ろせない
    expect(stanceOf('crouch_stab')).toBe('crouch')
  })

  test('爆風で倒れている間は低い構え', () => {
    expect(stanceOf('sweep')).toBe('prone')
    expect(stanceOf('stand')).toBe('prone')
  })

  test('ダンボールはしゃがみと同じ高さ', () => {
    expect(stanceOf('sneak')).toBe('box')
    expect(HEAD_HEIGHT.box).toBe(HEAD_HEIGHT.crouch)
  })

  test('**屈めば頭が下がる。** 遮蔽に隠れられるかがこれで変わる', () => {
    expect(HEAD_HEIGHT.crouch).toBeLessThan(HEAD_HEIGHT.stand)
    expect(HEAD_HEIGHT.down).toBeLessThan(HEAD_HEIGHT.prone)
  })
})

describe('傾き (lean)', () => {
  test('姿勢から引く。左 -1、右 1、それ以外 0', () => {
    expect(leanOf('lean_left')).toBe(-1)
    expect(leanOf('lean_right')).toBe(1)
    expect(leanOf('idle')).toBe(0)
  })

  test('横ずれは右が正。yaw 0 (-Z を向く) なら右は +X、左は -X で量が違う', () => {
    expect(leanShift(1, 'stand', 0).x).toBeCloseTo(LEAN_SHIFT.stand.right)
    expect(leanShift(-1, 'stand', 0).x).toBeCloseTo(-LEAN_SHIFT.stand.left)
    expect(leanShift(1, 'stand', 0).z).toBeCloseTo(0)
    // 90° 左を向けば (+X ではなく -Z を向いていた体が -X を向く)、右は -Z
    expect(leanShift(1, 'stand', Math.PI / 2).z).toBeCloseTo(-LEAN_SHIFT.stand.right)
    expect(leanShift(0, 'stand', 1.2)).toEqual({ x: 0, z: 0 })
  })

  test('しゃがみの傾きは量が違い、姿勢はしゃがみ', () => {
    expect(leanOf('lean_crouch_left')).toBe(-1)
    expect(stanceOf('lean_crouch_right')).toBe('crouch')
    expect(leanShift(1, 'crouch', 0).x).toBeCloseTo(LEAN_SHIFT.crouch.right)
  })
})
