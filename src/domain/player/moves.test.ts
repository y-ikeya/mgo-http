import { describe, expect, test } from 'bun:test'
import { MOVES, blocker, can, type BodyState, type Move } from './moves'

/** 何もしていない、地面に立った体 */
const standing: BodyState = {
  onGround: true,
  dead: false,
  downed: false,
  standingUp: false,
  sleeping: false,
  boxed: false,
  bumping: false,
  saluting: false,
  stabbing: false,
  rolling: false,
  vaulting: false,
  hanging: false,
  onLadder: false,
  prone: false,
  landing: false,
  inWater: false,
  aiming: false,
}

describe('できること', () => {
  test('立っていれば一通りできる', () => {
    for (const move of Object.keys(MOVES) as Move[]) expect(can(standing, move)).toBe(true)
  })

  test('倒れたら何もできない (眠るだけは「もう倒れている」で弾く)', () => {
    const dead = { ...standing, dead: true }
    for (const move of Object.keys(MOVES) as Move[]) expect(can(dead, move)).toBe(false)
  })

  test('全身の型の最中は、他の全身の動作を始められない', () => {
    for (const busy of ['rolling', 'vaulting', 'hanging', 'stabbing'] as const) {
      const body = { ...standing, [busy]: true }
      expect(can(body, 'roll')).toBe(false)
      expect(can(body, 'vault')).toBe(false)
      expect(can(body, 'box')).toBe(false)
    }
  })

  test('空中では転がれず跳べず伏せられない。刺すのと構えるのは空中でも通す', () => {
    const air = { ...standing, onGround: false }
    expect(can(air, 'roll')).toBe(false)
    expect(can(air, 'vault')).toBe(false)
    expect(can(air, 'prone')).toBe(false)
    expect(can(air, 'stab')).toBe(true)
    expect(can(air, 'aim')).toBe(true)
  })

  test('伏せからは転がれない (起き上がる一手を挟む) が、刺せる (prone_stab)', () => {
    const prone = { ...standing, prone: true }
    expect(can(prone, 'roll')).toBe(false)
    expect(can(prone, 'stab')).toBe(true)
  })

  test('梯子の上では両手が塞がっている。投げられず、置けず、刺せない', () => {
    const ladder = { ...standing, onGround: false, onLadder: true }
    expect(can(ladder, 'throw')).toBe(false)
    expect(can(ladder, 'place')).toBe(false)
    expect(can(ladder, 'stab')).toBe(false)
  })

  test('何に阻まれたかが分かる', () => {
    expect(blocker({ ...standing, boxed: true }, 'roll')).toBe('boxed')
    expect(blocker({ ...standing, onGround: false }, 'roll')).toBe('onGround')
    expect(blocker(standing, 'roll')).toBeNull()
  })
})
