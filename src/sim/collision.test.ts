import { describe, expect, test } from 'bun:test'
import {
  ceilingHeight,
  groundHeight,
  resolveCircle,
  type Obstacle,
  type Vec3,
} from './collision'

/**
 * 階のある地形。
 *
 * 箱が**下面を持つ**ようになったので、橋の下をくぐれて、屋根を架けられて、
 * 跳ねると天井で止まる。以前はどの箱も地面からの柱だったので、上に浮かせても
 * 下が塞がっていた。
 *
 * 体の高さは 1.8m、半径は 0.35m (player.ts の実測値)。
 */

const HEIGHT = 1.8
const RADIUS = 0.35

/** 原点をまたぐ板を 1 枚。bottom から top まで */
function slab(bottom: number, top: number): Obstacle {
  return {
    minX: -2,
    maxX: 2,
    minZ: -2,
    maxZ: 2,
    top,
    slopeX: 0,
    slopeZ: 0,
    baseTop: top,
    bottom,
    surface: 'concrete',
  }
}

/** 板の手前から中心へ向かって歩かせ、どこまで進めたかを返す */
function walkInto(obstacles: Obstacle[], feetY: number): number {
  const position: Vec3 = { x: 0, y: feetY, z: 3 }
  // 1 歩ずつ詰める。押し戻しは貫入深度の解決なので、少しずつ入れる
  for (let i = 0; i < 100; i++) {
    position.z -= 0.05
    resolveCircle(position, RADIUS, obstacles, feetY, HEIGHT)
  }
  return position.z
}

describe('下をくぐる', () => {
  test('頭より上に浮いた板はくぐれる', () => {
    // 2.0m に浮いた橋。体は 1.8m
    expect(walkInto([slab(2.0, 2.4)], 0)).toBeLessThan(-1)
  })

  test('体より低い所に浮いた板は塞ぐ', () => {
    // 1.0m に浮いている。下は空いて見えるが体が入らない
    expect(walkInto([slab(1.0, 1.4)], 0)).toBeGreaterThan(2)
  })

  test('地面に置かれた箱は今までどおり塞ぐ', () => {
    expect(walkInto([slab(0, 3)], 0)).toBeGreaterThan(2)
  })

  test('くぐれる橋でも、その上に立てば壁として働く', () => {
    // 橋の上 (2.4m) に立っていれば、同じ板の上面 3.0m の部分は壁
    expect(walkInto([slab(2.0, 2.4), slab(2.4, 4.2)], 2.4)).toBeGreaterThan(2)
  })
})

describe('床の選び方', () => {
  const bridge = slab(2.0, 2.4)

  test('地面に居るとき、橋は床にならない', () => {
    expect(groundHeight({ x: 0, y: 0, z: 0 }, RADIUS, [bridge], 0)).toBe(0)
  })

  test('橋の高さまで上がれば橋が床になる', () => {
    expect(groundHeight({ x: 0, y: 2.4, z: 0 }, RADIUS, [bridge], 2.4)).toBe(2.4)
  })
})

describe('天井', () => {
  test('頭の上の下面を返す', () => {
    expect(ceilingHeight({ x: 0, y: 0, z: 0 }, RADIUS, [slab(2.0, 2.4)], 0)).toBe(2.0)
  })

  test('乗っている床そのものは天井に数えない', () => {
    // 足元と同じ高さに下面がある = いま乗っている板
    const floor = slab(0, 2.4)
    expect(ceilingHeight({ x: 0, y: 0, z: 0 }, RADIUS, [floor], 0)).toBe(Infinity)
  })

  test('離れていれば天井は無い', () => {
    expect(ceilingHeight({ x: 10, y: 0, z: 10 }, RADIUS, [slab(2.0, 2.4)], 0)).toBe(Infinity)
  })

  test('重なっていれば低いほうを返す', () => {
    const boxes = [slab(4.0, 4.4), slab(2.0, 2.4)]
    expect(ceilingHeight({ x: 0, y: 0, z: 0 }, RADIUS, boxes, 0)).toBe(2.0)
  })
})
