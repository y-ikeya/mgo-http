import { describe, expect, test } from 'bun:test'
import { TriangleBvh } from './bvh'

/** 軸に沿った壁 1 枚 (z = z0 の面、x と y の範囲)。2 枚の三角 */
function wallZ(z: number, x0: number, x1: number, y0: number, y1: number): number[] {
  return [
    x0, y0, z, x1, y0, z, x1, y1, z,
    x0, y0, z, x1, y1, z, x0, y1, z,
  ]
}
const bvh = (tris: number[]) => new TriangleBvh({ positions: new Float32Array(tris) })

/**
 * 目から線分の**どこかが見えているか**。点でなく扇で見る。
 * 目は原点、線分は z = -10 に立てた縦の線 (高さ 0..1.6)。
 */
describe('segmentVisible', () => {
  const E = [0, 0.8, 0] as const
  const A = [0, 0, -10] as const
  const B = [0, 1.6, -10] as const

  test('何も無ければ見える', () => {
    expect(bvh([]).segmentVisible(...E, ...A, ...B)).toBe(true)
  })

  test('線分を丸ごと覆う壁の裏は見えない', () => {
    const wall = bvh(wallZ(-5, -5, 5, -1, 5))
    expect(wall.segmentVisible(...E, ...A, ...B)).toBe(false)
  })

  /** 壁に 10cm の隙間。点で見ると間隔次第で落とすが、線分なら必ず拾う */
  test('細い隙間から線分の一部が見えていれば見える', () => {
    // 隙間: 目の高さ (0.8) の線が通る所、y 0.35..0.45 (z=-5 の所で、線分の y 0.0..1.6 → 手前で半分の高さ)
    const lower = wallZ(-5, -5, 5, -1, 0.35)
    const upper = wallZ(-5, -5, 5, 0.45, 5)
    const world = bvh([...lower, ...upper])
    expect(world.segmentVisible(...E, ...A, ...B)).toBe(true)
    // 隙間を目の線が通らない高さ (2.0..2.1) へ動かすと見えない
    const closed = bvh([...wallZ(-5, -5, 5, -1, 2.0), ...wallZ(-5, -5, 5, 2.1, 5)])
    expect(closed.segmentVisible(...E, ...A, ...B)).toBe(false)
  })

  test('線分より向こうの壁は遮らない', () => {
    const behind = bvh(wallZ(-15, -5, 5, -1, 5))
    expect(behind.segmentVisible(...E, ...A, ...B)).toBe(true)
  })

  test('目より後ろの壁は遮らない', () => {
    const back = bvh(wallZ(5, -5, 5, -1, 5))
    expect(back.segmentVisible(...E, ...A, ...B)).toBe(true)
  })

  /** 下半分だけ隠す壁。上半分は見える */
  test('線分の半分が隠れていても、残りが見えていれば見える', () => {
    const half = bvh(wallZ(-5, -5, 5, -1, 0.6))
    expect(half.segmentVisible(...E, ...A, ...B)).toBe(true)
    // 上も別の壁で塞ぐと見えない (2 枚の区間の和が線分を覆う)
    const both = bvh([...wallZ(-5, -5, 5, -1, 0.6), ...wallZ(-5, -5, 5, 0.55, 5)])
    expect(both.segmentVisible(...E, ...A, ...B)).toBe(false)
  })

  /** 扇の横を通る壁 (x が外れている) は遮らない */
  test('扇の外の壁は遮らない', () => {
    const aside = bvh(wallZ(-5, 1, 5, -1, 5))
    expect(aside.segmentVisible(...E, ...A, ...B)).toBe(true)
  })

  /** 斜めの三角 (扇の平面を斜めに横切る) でも区間が出る */
  test('斜めの板が線分の中ほどだけを隠す', () => {
    // z=-5 で y 0.5..1.0 の帯を、少し傾けて置く
    const slanted = bvh([
      -2, 0.5, -4.8, 2, 0.5, -5.2, 2, 1.0, -5.2,
      -2, 0.5, -4.8, 2, 1.0, -5.2, -2, 1.0, -4.8,
    ])
    expect(slanted.segmentVisible(...E, ...A, ...B)).toBe(true)
    // 上下を壁で塞げば見えない
    const sealed = bvh([
      ...wallZ(-5, -5, 5, -1, 0.55), ...wallZ(-5, -5, 5, 0.95, 5),
      -2, 0.5, -4.8, 2, 0.5, -5.2, 2, 1.0, -5.2,
      -2, 0.5, -4.8, 2, 1.0, -5.2, -2, 1.0, -4.8,
    ])
    expect(sealed.segmentVisible(...E, ...A, ...B)).toBe(false)
  })
})
