import { describe, expect, test } from 'bun:test'
import { blastEffect, BLAST_MAX, BLAST_MIN, BLAST_RANGE, BLAST_SHADOWED, TRIGGER_RANGE } from './claymore'

/**
 * **どれだけ削れるかはドメインルール。** 距離を測るのは sim (judge/claymore.ts) で、
 * その距離をここが量に直す。
 */
describe('クレイモアの爆風', () => {
  test('近いほど削れる。至近でも単体では死なない', () => {
    const near = blastEffect(0.5, 1).damage
    const far = blastEffect(BLAST_RANGE - 0.2, 1).damage
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(BLAST_MAX)
    expect(BLAST_MAX).toBeLessThan(100)
    expect(far).toBeGreaterThanOrEqual(BLAST_MIN - 1)
  })

  test('近ければ転ぶ。端で掠っただけなら立っていられる', () => {
    expect(blastEffect(1, 1).knock).toBe(true)
    expect(blastEffect(BLAST_RANGE - 0.2, 1).knock).toBe(false)
  })

  test('届く距離は反応する距離より広い。反応した時点で逃げ切れない', () => {
    expect(BLAST_RANGE).toBeGreaterThan(TRIGGER_RANGE)
    // 反応する縁に立った人には必ず入る
    expect(blastEffect(TRIGGER_RANGE, 1).damage).toBeGreaterThan(0)
  })

  test('届かない距離は 0', () => {
    expect(blastEffect(BLAST_RANGE + 0.1, 1).damage).toBe(0)
  })

  /** 壁の裏は減る。手榴弾と同じ式 */
  test('全部隠れていれば 1/4。半分見えていれば間。転ぶのは見えていた相手だけ', () => {
    const open = blastEffect(1, 1)
    const hidden = blastEffect(1, 0)
    const half = blastEffect(1, 0.5)
    expect(hidden.damage).toBeCloseTo(open.damage * BLAST_SHADOWED)
    expect(half.damage).toBeGreaterThan(hidden.damage)
    expect(half.damage).toBeLessThan(open.damage)
    expect(open.knock).toBe(true)
    expect(hidden.knock).toBe(false)
  })
})
