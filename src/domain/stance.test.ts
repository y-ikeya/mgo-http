import { describe, expect, test } from 'bun:test'
import { WHOLE_BODY, resolveLocomotion, stanceOf, type StanceInput } from './stance'

/**
 * しゃがんだまま刺す。
 *
 * 立ちの刺突は**全身の型**なので、しゃがんでいても流すと立ち上がる。倒れている
 * 相手を刺すには見下ろす必要がある (hitcheck の STAB_DOWN_PITCH) のに、
 * 立ち上がってしまうと見下ろせない。
 */

const base: StanceInput = {
  previous: 'idle',
  down: false,
  boxed: false,
  crouching: false,
  aiming: false,
  saluting: false,
  stabbing: false,
  setting: null,
  downed: false,
  standingUp: false,
  rolling: false,
  onGround: true,
  landing: 0,
  forward: 0,
  strafe: 0,
  speed: 0,
  sprinting: false,
} as unknown as StanceInput

describe('刺す姿勢', () => {
  test('立って刺せば立ちの型', () => {
    expect(resolveLocomotion({ ...base, stabbing: true })).toBe('stab')
  })

  test('しゃがんで刺せば、しゃがんだままの型', () => {
    expect(resolveLocomotion({ ...base, stabbing: true, crouching: true })).toBe('crouch_stab')
  })

  test('しゃがんだままなので、構えもしゃがみのまま', () => {
    expect(stanceOf('crouch_stab')).toBe('crouch')
  })

  test('全身の型ではない。下半身はしゃがみ、上半身だけが刺す', () => {
    expect(WHOLE_BODY.has('stab')).toBe(true)
    expect(WHOLE_BODY.has('crouch_stab')).toBe(false)
  })
})
