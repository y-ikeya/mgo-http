import { describe, expect, test } from 'bun:test'
import {
  blastFrom,
  canPlaceAt,
  triggeredBy,
  BLAST_MAX,
  BLAST_MIN,
  BLAST_RANGE,
  TRIGGER_RANGE,
  type Placed,
} from './claymore'

/**
 * クレイモアの向き。
 *
 * **符号を 1 つ間違えると後ろで爆ぜる。** 向きが読み合いの全部なので、
 * 前後が入れ替わると道具そのものが逆の意味になる (背後から回れば無事、が
 * 正面から来れば無事、になる)。表を読むだけでは気づけないので置いて測る。
 *
 * 規約は hitcheck と同じで、yaw = θ のとき前方は (-sinθ, -cosθ)。
 * yaw = 0 なら -Z を向く。
 */

/** 原点に置いて yaw だけ変える */
function at(yaw: number): Placed {
  return { x: 0, y: 0, z: 0, yaw }
}

describe('前を通ったときだけ起爆する', () => {
  const mine = at(0) // -Z を向いている

  test.each<[string, number, number, boolean]>([
    ['正面 2m', 0, -2, true],
    ['背後 2m', 0, 2, false],
    ['真横 2m', 2, 0, false],
    // 左右 60 度まで。斜め前は入り、斜め後ろは入らない
    ['斜め前 45 度', -1.4, -1.4, true],
    ['斜め後ろ 45 度', -1.4, 1.4, false],
  ])('%s', (_, x, z, expected) => {
    expect(triggeredBy(mine, { x, y: 0, z })).toBe(expected)
  })

  test('間合いの外は通す', () => {
    expect(triggeredBy(mine, { x: 0, y: 0, z: -(TRIGGER_RANGE + 0.5) })).toBe(false)
  })

  test('向けた先が変わればひっくり返る', () => {
    const behind = { x: 0, y: 0, z: 2 }
    expect(triggeredBy(at(0), behind)).toBe(false)
    // 半回転させれば同じ場所が正面になる
    expect(triggeredBy(at(Math.PI), behind)).toBe(true)
  })
})

describe('爆風', () => {
  const mine = at(0)

  test('近いほど削れる。至近でも単体では死なない', () => {
    const near = blastFrom(mine, { x: 0, y: 0, z: -0.5 })
    const far = blastFrom(mine, { x: 0, y: 0, z: -(BLAST_RANGE - 0.2) })
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(BLAST_MAX)
    expect(BLAST_MAX).toBeLessThan(100)
    expect(far).toBeGreaterThanOrEqual(BLAST_MIN - 1)
  })

  test('背後には入らない。起爆したあとでも向きは効いている', () => {
    expect(blastFrom(mine, { x: 0, y: 0, z: 2 })).toBe(0)
  })

  test('届く距離は反応する距離より広い。反応した時点で逃げ切れない', () => {
    expect(BLAST_RANGE).toBeGreaterThan(TRIGGER_RANGE)
    // 反応する縁に立った人には必ず入る
    expect(blastFrom(mine, { x: 0, y: 0, z: -TRIGGER_RANGE })).toBeGreaterThan(0)
  })
})

describe('置ける場所', () => {
  /** 1m 角の箱を原点に置く */
  const wall = [{ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }]

  test('開けた地面には置ける', () => {
    expect(canPlaceAt(5, 5, 0, 0, [])).toBe(true)
  })

  test('壁の中には置けない', () => {
    expect(canPlaceAt(0, 0, 0, 0, wall)).toBe(false)
  })

  test('縁の外には置けない。足元と地面が離れる', () => {
    expect(canPlaceAt(5, 5, 2, 0, [])).toBe(false)
  })

  test('床の上には置ける。地面そのものに当たって弾かれない', () => {
    const floor = [{ min: [-10, -1, -10], max: [10, 0, 10] }]
    expect(canPlaceAt(0, 0, 0, 0, floor)).toBe(true)
  })
})
