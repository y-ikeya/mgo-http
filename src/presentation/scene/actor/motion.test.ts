import { describe, expect, test } from 'bun:test'
import { WHOLE_BODY, resolveLocomotion, type StanceInput } from './motion'
import { stanceOf } from '../../../domain/player/stance'

/**
 * しゃがんだまま刺す。
 *
 * 立ちの刺突は**全身の型**なので、しゃがんでいても流すと立ち上がる。倒れている
 * 相手を刺すには見下ろす必要がある (damage.ts の STAB_DOWN_PITCH) のに、
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
  fallRoll: 0,
  airborneFor: 0,
  stairFor: 0,
  stairDown: false,
  forward: 0,
  strafe: 0,
  speed: 0,
  dirX: 0,
  dirZ: 0,
  actualSpeed: 0,
  yaw: 0,
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

describe('落下の受け身', () => {
  test('削られる高さから落ちたら受け身。ただの着地とは別', () => {
    expect(resolveLocomotion({ ...base, fallRoll: 1.6 })).toBe('fall_roll')
    expect(resolveLocomotion({ ...base, landing: 0.1 })).toBe('jump_down')
  })

  test('受け身の間は移動の型に戻らない。**転がり切るまで続く**', () => {
    expect(
      resolveLocomotion({ ...base, fallRoll: 0.4, actualSpeed: 5, dirZ: -1 } as StanceInput),
    ).toBe('fall_roll')
  })

  test('受け身は着いてから。**空中では立たない札**なので、そもそも来ない', () => {
    // fallRoll は着地した瞬間に立てる (player.ts)。空中で立っていることは無い
    expect(resolveLocomotion({ ...base, fallRoll: 0 } as StanceInput)).not.toBe('fall_roll')
  })
})

describe('階段', () => {
  test('段差を上がっている間は専用の型', () => {
    expect(resolveLocomotion({ ...base, stairFor: 0.3 } as StanceInput)).toBe('up_stair')
  })

  test('**下りは別の型。** 同じ型の逆再生では下りに見えない', () => {
    expect(resolveLocomotion({ ...base, stairFor: 0.3, stairDown: true } as StanceInput)).toBe(
      'down_stair',
    )
  })

  test('**落ちている間は移動の型のまま。** 滞空のループは出さない', () => {
    const falling = { ...base, onGround: false, velocityY: -6, airborneFor: 0.5 } as StanceInput
    expect(resolveLocomotion(falling)).not.toBe('jump_loop')
    // 走って落ちれば走ったまま (前へ倒していれば前進の型)
    expect(
      resolveLocomotion({ ...falling, actualSpeed: 5, dirZ: -1, yaw: 0 } as StanceInput),
    ).toBe('run_f')
  })

  test('上がっている間だけ跳躍の型', () => {
    expect(
      resolveLocomotion({ ...base, onGround: false, velocityY: 4, airborneFor: 0.3 } as StanceInput),
    ).toBe('jump_up')
  })

  test('跳ぶほうが先。**階段を上って跳んだら跳躍の型**', () => {
    expect(
      resolveLocomotion({
        ...base, onGround: false, velocityY: 4, airborneFor: 0.3, stairFor: 0.3,
      } as StanceInput),
    ).toBe('jump_up')
  })
})
