import { describe, expect, test } from 'bun:test'
import { MODES, ROOMS, ROOM_NAMES, isFriendly, isHostile, modeOf, primariesOf, secondaryOf } from './room'
import { CHOICES } from '../item/weapons'
import { newPlayer, type Player } from '../player/player'

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
    expect(ROOMS.alpha.mode).toBe('DM')
    expect(ROOMS.bravo.mode).toBe('TDM')
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

/**
 * 部屋ごとの設定。**部屋について決まっていることは 1 つの表に。**
 *
 * ルール・ステージ・覚え書き・持ち込める銃を別々の表で持っていた頃は、部屋を
 * 1 つ足すたびに直す場所が増え、**片方だけ直した部屋**が作れてしまった。
 */
describe('部屋の設定', () => {
  test('delta は砂部屋。**狙撃銃だけの TDM**', () => {
    expect(ROOMS.delta.mode).toBe('TDM')
    expect(ROOMS.delta.note).toBe('砂部屋')
    expect(primariesOf('delta')).toEqual(['sniper'])
  })

  test('**delta は副武器も無い。** 詰められたらナイフだけ', () => {
    expect(secondaryOf('delta')).toBeNull()
  })

  test('省いてあれば拳銃。**外すと書いた部屋だけ無くなる**', () => {
    expect(secondaryOf('alpha')).toBe('m9')
    expect(secondaryOf('echo')).toBe('m9')
  })

  test('**絞っていない部屋は全部持ち込める。** 省いた = 制限なし', () => {
    expect(primariesOf('alpha')).toEqual(CHOICES.primary)
    expect(primariesOf('bravo')).toEqual(CHOICES.primary)
  })

  test('絞る銃は主武器の中から選ぶ。**そこに無い物は書けない**', () => {
    for (const room of ROOM_NAMES) {
      for (const id of primariesOf(room)) expect(CHOICES.primary).toContain(id)
    }
  })

  test('覚え書きは無くてよい。**書いてある部屋だけ出す**', () => {
    expect(ROOMS.alpha.note).toBeUndefined()
  })
})
