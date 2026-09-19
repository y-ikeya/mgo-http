import { describe, expect, test } from 'bun:test'
import { atBase, RESUPPLY_RADIUS } from './resupply'

describe('補給できる場所', () => {
  const base = { x: 10, z: -20, y: 5 }

  test('基地の上に立っていれば補給できる', () => {
    expect(atBase(11, 5.1, -21, base)).toBe(true)
  })

  test('半径の外では補給できない', () => {
    expect(atBase(10 + RESUPPLY_RADIUS + 0.1, 5, -20, base)).toBe(false)
  })

  test('天板の下 (水面) からは届かない', () => {
    expect(atBase(10, 0, -20, base)).toBe(false)
  })
})
