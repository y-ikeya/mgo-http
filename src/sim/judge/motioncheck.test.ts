import { describe, expect, test } from 'bun:test'
import { arenaHalfOf, checkMove, checkMoveOnMesh } from './motioncheck'
import { TriangleBvh } from '../space/bvh'
import type { StageBox } from '../space/vision'

/**
 * 移動の申告の検算。**箱で見ると嘘になる形**が三角で通ることを見る。
 */

/** 軸に沿った壁 1 枚 (2 枚の三角)。x を跨ぐ面 */
function wallX(x: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return [
    x, y0, z0, x, y1, z0, x, y1, z1,
    x, y0, z0, x, y1, z1, x, y0, z1,
  ]
}

function bvh(tris: number[]): TriangleBvh {
  return new TriangleBvh({ positions: new Float32Array(tris) })
}

describe('checkMoveOnMesh', () => {
  test('壁を跨ぐ 1 歩は弾く', () => {
    const world = bvh(wallX(0, 0, 3, -5, 5))
    const verdict = checkMoveOnMesh({ x: -0.2, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }, world, 100, 0.9)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('壁を抜けた')
  })

  /**
   * **箱では弾かれ、三角なら通る。** 円柱の塔の外接の角。
   *
   * 塔を「x -3..3, z -3..3 の箱」で持つと、角 (2.8, 2.8) は箱の中。
   * 三角で持てば壁 (x = 3 の面だけ置いてある) の外なので、その角を歩いても通る。
   */
  test('外接の箱の角は、三角なら通る', () => {
    const towerBox: StageBox = { name: 'tower', min: [-3, 0, -3], max: [3, 12, 3] }
    const from = { x: 2.6, y: 0, z: 2.6 }
    const to = { x: 2.8, y: 0, z: 2.8 }
    expect(checkMove(from, to, [towerBox], 100).ok).toBe(false)
    const world = bvh(wallX(3, 0, 12, -3, 3))
    expect(checkMoveOnMesh(from, to, world, 100, 0.9).ok).toBe(true)
  })

  /** 伏せている人は低い線で見る。0.6m の梁の下を這う */
  test('低い梁の下を這うのは、伏せの高さなら通る', () => {
    // 梁: 高さ 0.6..0.8 の薄い板が x = 0 に立っている
    const world = bvh(wallX(0, 0.6, 0.8, -5, 5))
    const from = { x: -0.2, y: 0, z: 0 }
    const to = { x: 0.2, y: 0, z: 0 }
    expect(checkMoveOnMesh(from, to, world, 100, 0.7).ok).toBe(false)
    expect(checkMoveOnMesh(from, to, world, 100, 0.3).ok).toBe(true)
  })

  test('止まっている人は見ない', () => {
    const world = bvh(wallX(0, 0, 3, -5, 5))
    expect(checkMoveOnMesh({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, world, 100, 0.9).ok).toBe(true)
  })

  test('場外と跳びは三角でも見る', () => {
    const world = bvh([])
    expect(checkMoveOnMesh({ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }, world, 100, 0.9).reason).toContain('場外')
    expect(checkMoveOnMesh({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, world, 100, 0.9).reason).toContain('跳んだ')
  })
})

describe('arenaHalfOf', () => {
  /** 床は箱の外接より外まで敷いてあることがある。縁に伏せても場外にしない */
  test('外接に余白が付く', () => {
    const box: StageBox = { name: 'edge', min: [0, 0, 0], max: [40.47, 1, 40.47] }
    expect(arenaHalfOf([box])).toBeGreaterThan(40.5)
  })
})
