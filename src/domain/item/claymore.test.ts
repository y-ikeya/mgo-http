import { describe, expect, test } from 'bun:test'
import { blastEffect, BLAST_MAX, BLAST_MIN, BLAST_RANGE, TRIGGER_RANGE } from './claymore'

/**
 * **どれだけ削れるかは規則。** 距離を測るのは sim (judge/claymore.ts) で、
 * その距離をここが量に直す。
 */
describe('クレイモアの爆風', () => {
  test('近いほど削れる。至近でも単体では死なない', () => {
    const near = blastEffect(0.5).damage
    const far = blastEffect(BLAST_RANGE - 0.2).damage
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(BLAST_MAX)
    expect(BLAST_MAX).toBeLessThan(100)
    expect(far).toBeGreaterThanOrEqual(BLAST_MIN - 1)
  })

  test('近ければ転ぶ。端で掠っただけなら立っていられる', () => {
    expect(blastEffect(1).knock).toBe(true)
    expect(blastEffect(BLAST_RANGE - 0.2).knock).toBe(false)
  })

  test('届く距離は反応する距離より広い。反応した時点で逃げ切れない', () => {
    expect(BLAST_RANGE).toBeGreaterThan(TRIGGER_RANGE)
    // 反応する縁に立った人には必ず入る
    expect(blastEffect(TRIGGER_RANGE).damage).toBeGreaterThan(0)
  })

  test('届かない距離は 0', () => {
    expect(blastEffect(BLAST_RANGE + 0.1).damage).toBe(0)
  })
})
