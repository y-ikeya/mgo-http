import { describe, expect, test } from 'bun:test'
import { blastEffect, BLAST_DAMAGE, BLAST_RADIUS, BLAST_SHADOWED } from './grenade'
import { MAX_HEALTH, takeDamage } from '../rule/damage'

/**
 * **どれだけ削れるかは規則。** 距離と遮蔽を測るのは sim
 * (judge/blast.ts の blastExposure) で、その事実をここが量に直す。
 */
describe('手榴弾の爆風', () => {
  test('足元で爆ぜても死なない。**倒す道具ではなく動きを止める道具**', () => {
    expect(blastEffect(0, 1).damage).toBeLessThan(MAX_HEALTH)
    expect(blastEffect(0, 1).damage).toBeCloseTo(BLAST_DAMAGE, 5)
  })

  test('近いほど削れる', () => {
    expect(blastEffect(1, 1).damage).toBeGreaterThan(blastEffect(5, 1).damage)
  })

  test('届かない距離は 0', () => {
    expect(blastEffect(BLAST_RADIUS, 1).damage).toBe(0)
    expect(blastEffect(BLAST_RADIUS + 1, 1).damage).toBe(0)
  })

  test('**壁 1 枚で無傷にはならない。** 隠れても少しは食らう', () => {
    const hidden = blastEffect(2, 0)
    expect(hidden.damage).toBeCloseTo(blastEffect(2, 1).damage * BLAST_SHADOWED, 5)
    expect(hidden.damage).toBeGreaterThan(0)
  })

  test('遮蔽の裏では転ばない。削られるだけ', () => {
    expect(blastEffect(1, 0).knock).toBe(false)
    expect(blastEffect(1, 1).knock).toBe(true)
  })

  test('端で掠っただけなら立っていられる', () => {
    expect(blastEffect(BLAST_RADIUS - 0.5, 1).knock).toBe(false)
  })
})

/**
 * 削る量から「倒れたか」を決めるのも規則 (rule/damage.ts の takeDamage)。
 * **同じ判断をクライアントも先に回す**ので、2 か所に書かない。
 */
describe('倒れるか', () => {
  test('満身で足元に落としても立っている', () => {
    const wound = takeDamage(MAX_HEALTH, blastEffect(0, 1).damage)
    expect(wound.downed).toBe(false)
    expect(wound.health).toBeGreaterThan(0)
  })

  test('削られた体で受ければ倒れる', () => {
    expect(takeDamage(20, blastEffect(0, 1).damage).downed).toBe(true)
  })
})
