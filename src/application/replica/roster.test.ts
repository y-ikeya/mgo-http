import { describe, expect, test } from 'bun:test'
import { applyRoster, newRoster } from './roster'
import type { ServerMessage } from '../protocol/types'

/**
 * 名簿は**サーバーが持っている状態**なので、レプリカの側で試せる。
 *
 * これまでは three のオブジェクト (RemoteSoldier) が名前も陣営も体力も持って
 * いたので、GL 無しでは 1 行も確かめられなかった。
 */
const SELF = 'alice'

const roster = (players: unknown[]): ServerMessage =>
  ({ type: 'roster', players }) as ServerMessage

describe('名簿のレプリカ', () => {
  test('**自分は入れない。** 自分の体も体力も別の道で届く', () => {
    const r = newRoster()
    applyRoster(r, roster([{ id: SELF, name: 'A', team: 'blue', slot: 0 }]), SELF)
    expect(r.size).toBe(0)
  })

  test('名簿で名前・所属・状態が入る。**体力は入らない**', () => {
    const r = newRoster()
    const effects = applyRoster(
      r,
      roster([{ id: 'bob', name: 'B', team: 'red', slot: 1, life: 'alive' }]),
      SELF,
    )
    expect(r.get('bob')).toMatchObject({ name: 'B', team: 'red', life: 'alive' })
    expect(effects).toEqual([{ kind: 'sync', id: 'bob', entry: r.get('bob')! }])
  })

  /**
   * **状態が無い名簿でも既定に落とさない。** 落とすと戦場に居ない扱いになり、
   * 位置が届いていても一度も描かれない。
   */
  test('あとから届いた状態が名簿を上書きする', () => {
    const r = newRoster()
    applyRoster(r, { type: 'life', id: 'bob', state: 'alive' } as ServerMessage, SELF)
    applyRoster(r, roster([{ id: 'bob', name: 'B', team: 'red', slot: 1 }]), SELF)
    expect(r.get('bob')?.life).toBe('alive')
  })

  test('health では名簿は動かない。**他人の体力は届かない** (本人宛てだけ)', () => {
    const r = newRoster()
    const effects = applyRoster(r, { type: 'health', id: 'bob', damage: 88 } as ServerMessage, SELF)
    expect(effects).toEqual([])
    expect(r.has('bob')).toBe(false)
  })

  test('倒れた瞬間だけ叫ぶ。**倒れ続けている間は鳴らさない**', () => {
    const r = newRoster()
    const first = applyRoster(r, { type: 'life', id: 'bob', state: 'downed' } as ServerMessage, SELF)
    const again = applyRoster(r, { type: 'life', id: 'bob', state: 'downed' } as ServerMessage, SELF)
    expect(first.some((e) => e.kind === 'died')).toBe(true)
    expect(again.some((e) => e.kind === 'died')).toBe(false)
  })

  test('自分の状態は名簿に入れない (叫びも出さない)', () => {
    const r = newRoster()
    const effects = applyRoster(r, { type: 'life', id: SELF, state: 'downed' } as ServerMessage, SELF)
    expect(effects).toEqual([])
  })

  test('出て行ったら消える', () => {
    const r = newRoster()
    applyRoster(r, roster([{ id: 'bob', name: 'B', team: 'red', slot: 1 }]), SELF)
    const effects = applyRoster(r, { type: 'leave', id: 'bob' } as ServerMessage, SELF)
    expect(r.has('bob')).toBe(false)
    expect(effects).toEqual([{ kind: 'left', id: 'bob' }])
  })

  test('参加は名前と所属だけ。状態はそのまま', () => {
    const r = newRoster()
    applyRoster(r, roster([{ id: 'bob', name: 'B', team: 'red', slot: 1, life: 'alive' }]), SELF)
    applyRoster(r, { type: 'join', id: 'bob', name: 'BOB', team: 'blue' } as ServerMessage, SELF)
    expect(r.get('bob')).toMatchObject({ name: 'BOB', team: 'blue', life: 'alive' })
  })
})
