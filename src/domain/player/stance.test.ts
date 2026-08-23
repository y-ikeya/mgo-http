import { describe, expect, test } from 'bun:test'
import { stanceOf, HEAD_HEIGHT } from './stance'

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
