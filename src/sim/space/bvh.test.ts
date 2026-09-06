import { describe, expect, test } from 'bun:test'
import { TriangleBvh } from './bvh'

/**
 * 四角い板 1 枚を三角 2 枚で作る。**xy 平面に立てて、z の位置を指定する。**
 */
function panel(z: number, half = 1): number[] {
  return [
    -half, -half, z, half, -half, z, half, half, z,
    -half, -half, z, half, half, z, -half, half, z,
  ]
}

const bvh = (tris: number[]) => new TriangleBvh({ positions: new Float32Array(tris) })

describe('線が通るか', () => {
  test('**何も無ければ通る。** 空の網は誰も遮らない', () => {
    expect(bvh([]).clear(0, 0, -5, 0, 0, 5)).toBe(true)
  })

  test('板を貫く線は通らない', () => {
    expect(bvh(panel(0)).clear(0, 0, -5, 0, 0, 5)).toBe(false)
  })

  test('板の外を通る線は通る', () => {
    // 板は ±1 の範囲。その外側を抜ける
    expect(bvh(panel(0)).clear(5, 5, -5, 5, 5, 5)).toBe(true)
  })

  /**
   * **線分の外は当たらない。**
   *
   * 半直線で見ると、的の向こう側にある壁で遮られたことになる。
   */
  test('線分が届く手前で終われば通る', () => {
    // 板は z = 0。線分は z = -5 から -2 まで。届いていない
    expect(bvh(panel(0)).clear(0, 0, -5, 0, 0, -2)).toBe(true)
  })

  test('線分の始点より後ろの板は関係ない', () => {
    // 板は z = 0。線分は z = 1 から 5 へ (板から遠ざかる)
    expect(bvh(panel(0)).clear(0, 0, 1, 0, 0, 5)).toBe(true)
  })

  /**
   * **表裏を区別しない。**
   *
   * 壁は片面しか無いことがある。裏から当てた弾が素通りすると
   * 「後ろから撃つと壁を抜ける」になる。
   */
  test('裏から当てても遮られる', () => {
    expect(bvh(panel(0)).clear(0, 0, 5, 0, 0, -5)).toBe(false)
  })

  test('板の縁のすぐ外は通る', () => {
    // 板は ±1。1.05 は外
    expect(bvh(panel(0)).clear(1.05, 0, -5, 1.05, 0, 5)).toBe(true)
  })
})

describe('たくさんの板', () => {
  /** z = 0, 4, 8 ... に板を並べる */
  const wall = (n: number) => {
    const tris: number[] = []
    for (let i = 0; i < n; i++) tris.push(...panel(i * 4))
    return bvh(tris)
  }

  test('枚数が増えても答えは変わらない', () => {
    const many = wall(200)
    expect(many.size).toBe(400)
    // 板の中心を貫く
    expect(many.clear(0, 0, -5, 0, 0, 1000)).toBe(false)
    // 板の外を抜ける
    expect(many.clear(5, 5, -5, 5, 5, 1000)).toBe(true)
  })

  /**
   * **総当たりと同じ答えを出す。**
   *
   * 木は「捨てるためだけ」に箱を使う。捨てた枝に当たる三角が在ったら、
   * それは木が壊れている。無作為な線で突き合わせる。
   */
  test('総当たりと食い違わない', () => {
    const tris: number[] = []
    // 少しずつずらした板を並べる (軸に揃っていない配置を作る)
    for (let i = 0; i < 60; i++) {
      const z = i * 1.7 - 50
      const shift = ((i * 7) % 11) - 5
      tris.push(...panel(z).map((v, k) => (k % 3 === 0 ? v + shift : v)))
    }
    const tree = bvh(tris)
    const brute = (a: number[], b: number[]) => {
      for (let t = 0; t < tris.length / 9; t++) {
        const one = bvh(tris.slice(t * 9, t * 9 + 9))
        if (!one.clear(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!)) return false
      }
      return true
    }
    // 種を固定した簡単な乱数 (試験を毎回同じにする)
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let i = 0; i < 300; i++) {
      const a = [next() * 20 - 10, next() * 4 - 2, next() * 120 - 60]
      const b = [next() * 20 - 10, next() * 4 - 2, next() * 120 - 60]
      expect(tree.clear(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!)).toBe(brute(a, b))
    }
  })
})
