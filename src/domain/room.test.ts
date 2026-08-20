import { describe, expect, test } from 'bun:test'
import { MODES, ROOM_MODE, isFriendly, isHostile, modeOf } from './room'
import { newPlayer, type Player } from './player'

/** 試験用の人。id と陣営だけあればよい */
const who = (id: string, team: 'blue' | 'red'): Player =>
  newPlayer({ id, name: id, team, slot: 0, now: 0 })

describe('誰が敵か', () => {
  const a = who('a', 'blue')
  const b = who('b', 'blue')
  const c = who('c', 'red')

  test('個人戦は**同じ色でも敵**。味方は居ない', () => {
    expect(isHostile(MODES.DM, a, b)).toBe(true)
    expect(isHostile(MODES.DM, a, c)).toBe(true)
    expect(isFriendly(MODES.DM, a, b)).toBe(false)
  })

  test('自分は自分の敵ではない', () => {
    expect(isHostile(MODES.DM, a, a)).toBe(false)
  })

  test('陣営戦は色で分かれる', () => {
    expect(isHostile(MODES.TDM, a, b)).toBe(false)
    expect(isHostile(MODES.TDM, a, c)).toBe(true)
  })

  test('休憩部屋は誰も敵ではない', () => {
    expect(isHostile(MODES.INT, a, c)).toBe(false)
  })
})

describe('部屋の割り当て', () => {
  test('alpha が個人戦、bravo がチーム戦', () => {
    expect(ROOM_MODE.alpha).toBe('DM')
    expect(ROOM_MODE.bravo).toBe('TDM')
  })

  test('**陣営で分かれない部屋は 1 位が光る。** 個人戦だけ', () => {
    expect(MODES.DM.teams).toBe(false)
    expect(MODES.DM.leaderGlows).toBe(true)
    expect(MODES.TDM.leaderGlows).toBe(false)
  })

  test('入れない部屋 (TSNE) は非殺傷武器が要る。枠だけ残す', () => {
    expect(modeOf('charlie').active).toBe(false)
  })
})
