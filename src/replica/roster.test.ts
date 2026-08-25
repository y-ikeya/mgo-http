import { describe, expect, test } from 'bun:test'
import { applyRoster, newRoster } from './roster'
import type { ServerMessage } from '../protocol/types'

/**
 * 名簿は**サーバーが持っている状態**なので、写しの側で試せる。
 *
 * これまでは three のオブジェクト (RemotePlayer) が名前も陣営も体力も持って
 * いたので、GL 無しでは 1 行も確かめられなかった。
 */
const SELF = 'alice'

const roster = (players: unknown[]): ServerMessage =>
  ({ type: 'roster', players }) as ServerMessage

describe('名簿の写し', () => {
  test('**自分は入れない。** 自分の体も体力も別の道で届く', () => {
    const r = newRoster()
    applyRoster(r, roster([{ id: SELF, name: 'A', health: 100, team: 'blue', slot: 0 }]), SELF)
    expect(r.size).toBe(0)
  })

  test('名簿で名前・所属・体力・状態が入る', () => {
    const r = newRoster()
    const effects = applyRoster(
      r,
      roster([{ id: 'bob', name: 'B', health: 70, team: 'red', slot: 1, life: 'alive' }]),
      SELF,
    )
    expect(r.get('bob')).toEqual({ name: 'B', team: 'red', health: 70, life: 'alive' })
    expect(effects).toEqual([{ kind: 'sync', id: 'bob', entry: r.get('bob')! }])
  })

  /**
   * **状態が無い名簿でも既定に落とさない。** 落とすと戦場に居ない扱いになり、
   * 位置が届いていても一度も描かれない。
   */
  test('あとから届いた状態が名簿を上書きする', () => {
    const r = newRoster()
    applyRoster(r, { type: 'life', id: 'bob', state: 'alive' } as ServerMessage, SELF)
    applyRoster(r, roster([{ id: 'bob', name: 'B', health: 100, team: 'red', slot: 1 }]), SELF)
    expect(r.get('bob')?.life).toBe('alive')
  })

  test('体力は health で動く。**倒れたかは状態が決める**', () => {
    const r = newRoster()
    applyRoster(r, { type: 'health', id: 'bob', health: 12, damage: 88 } as ServerMessage, SELF)
    expect(r.get('bob')?.health).toBe(12)
    expect(r.get('bob')?.life).toBe('joining')
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
    applyRoster(r, roster([{ id: 'bob', name: 'B', health: 100, team: 'red', slot: 1 }]), SELF)
    const effects = applyRoster(r, { type: 'leave', id: 'bob' } as ServerMessage, SELF)
    expect(r.has('bob')).toBe(false)
    expect(effects).toEqual([{ kind: 'left', id: 'bob' }])
  })

  test('参加は名前と所属だけ。体力と状態はそのまま', () => {
    const r = newRoster()
    applyRoster(r, { type: 'health', id: 'bob', health: 40, damage: 60 } as ServerMessage, SELF)
    applyRoster(r, { type: 'join', id: 'bob', name: 'BOB', team: 'blue' } as ServerMessage, SELF)
    expect(r.get('bob')).toMatchObject({ name: 'BOB', team: 'blue', health: 40 })
  })
})
