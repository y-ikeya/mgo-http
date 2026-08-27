import { describe, expect, test } from 'bun:test'
import { applySelf, driftOf, newSelfReplica } from './self'
import type { ServerMessage } from '../protocol/types'
import type { WeaponId } from '../domain/item/weapons'

/**
 * 自分の本当の値。**サーバーが持っている、自分についての状態。**
 *
 * 体力も弾数もサーバーが権威なのに、クライアントには自分で数えた値しか
 * 無かった。名簿 (roster) は他人の体力まで持っているのに、**自分だけ
 * レプリカを通っていなかった**。
 *
 * three も音も持たないので、ここは GL 無しで試せる。
 */

const table = (rifle: number, pistol = 0): Record<WeaponId, number> =>
  ({ rifle, pistol, smg: 0, sniper: 0 }) as Record<WeaponId, number>

function selfMessage(over: Partial<{ health: number; magazine: number; reserve: number; grenades: number }> = {}): ServerMessage {
  return {
    type: 'self',
    health: over.health ?? 100,
    magazine: table(over.magazine ?? 30),
    reserve: table(over.reserve ?? 90),
    grenades: over.grenades ?? 3,
  } as ServerMessage
}

describe('本当の値を受け取る', () => {
  test('届く前は「知らない」', () => {
    expect(newSelfReplica().known).toBe(false)
  })

  test('届いたら覚える', () => {
    const self = newSelfReplica()
    expect(applySelf(self, selfMessage({ health: 62 }))).toBe(true)
    expect(self.known).toBe(true)
    expect(self.health).toBe(62)
    expect(self.grenades).toBe(3)
  })

  test('自分宛て以外は受け取らない', () => {
    const self = newSelfReplica()
    expect(applySelf(self, { type: 'knockdown' } as ServerMessage)).toBe(false)
    expect(self.known).toBe(false)
  })
})

describe('ずれ', () => {
  /**
   * **届く前は比べない。** 何も知らない状態を 0 として比べると、
   * 最初の 1 秒だけ「体力が 100 ずれている」ことになる。
   */
  test('一度も届いていなければ、ずれは無い', () => {
    const drift = driftOf(newSelfReplica(), { health: 30, magazine: 5, reserve: 5, grenades: 0 }, 'rifle')
    expect(drift).toEqual({ health: 0, magazine: 0, reserve: 0, grenades: 0 })
  })

  test('一致していればずれは 0', () => {
    const self = newSelfReplica()
    applySelf(self, selfMessage())
    const drift = driftOf(self, { health: 100, magazine: 30, reserve: 90, grenades: 3 }, 'rifle')
    expect(drift).toEqual({ health: 0, magazine: 0, reserve: 0, grenades: 0 })
  })

  /**
   * **符号は「本当 − 予測」。** 正なら予測が減らしすぎている
   * (撃った申告が届かず、サーバーはまだ弾を持っている)。
   */
  test('撃った申告が届いていなければ、本当のほうが多い', () => {
    const self = newSelfReplica()
    applySelf(self, selfMessage({ magazine: 30 }))
    expect(driftOf(self, { health: 100, magazine: 27, reserve: 90, grenades: 3 }, 'rifle').magazine).toBe(3)
  })

  test('予測が多すぎれば負になる', () => {
    const self = newSelfReplica()
    applySelf(self, selfMessage({ health: 40 }))
    expect(driftOf(self, { health: 100, magazine: 30, reserve: 90, grenades: 3 }, 'rifle').health).toBe(-60)
  })

  /** **手にしている銃で比べる。** 持ち替えれば比べる相手も変わる */
  test('銃ごとに比べる', () => {
    const self = newSelfReplica()
    applySelf(self, selfMessage({ magazine: 30 }))
    // 拳銃の表は 0。拳銃を 12 発持っているつもりならずれる
    expect(driftOf(self, { health: 100, magazine: 12, reserve: 0, grenades: 3 }, 'pistol').magazine).toBe(-12)
  })

  test('投擲物もずれを見る', () => {
    const self = newSelfReplica()
    applySelf(self, selfMessage({ grenades: 1 }))
    expect(driftOf(self, { health: 100, magazine: 30, reserve: 90, grenades: 3 }, 'rifle').grenades).toBe(-2)
  })
})
