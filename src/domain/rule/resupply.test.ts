import { describe, expect, test } from 'bun:test'
import { atBase, RESUPPLY_RADIUS, soloSupplyBase } from './resupply'

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

describe('個人戦の補給', () => {
  const bases = { blue: { x: 0, z: 0 }, red: { x: 50, z: 0 } }

  test('どちらの基地でも補給できる', () => {
    expect(soloSupplyBase(0, 0, 0, bases, null)).toBe('blue')
    expect(soloSupplyBase(50, 0, 0, bases, null)).toBe('red')
  })

  test('前に補給した基地は続けて使えない', () => {
    expect(soloSupplyBase(0, 0, 0, bases, 'blue')).toBeNull()
    expect(soloSupplyBase(50, 0, 0, bases, 'blue')).toBe('red')
  })

  test('基地の外では補給できない', () => {
    expect(soloSupplyBase(25, 0, 0, bases, null)).toBeNull()
  })
})
