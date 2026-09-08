import { describe, expect, test } from 'bun:test'
import { MeshMoveWorld } from './meshworld'
import { TriangleBvh } from './bvh'

/**
 * 三角の上を歩く。**箱でやっていたことが、面でも同じに起きるか。**
 *
 * ここで押さえるのは移動そのものではなく、movement.ts が問い合わせる 3 つ
 * (押し戻す / 足が着く高さ / 頭がぶつかる高さ) の答え。段差や吸い付きの規則は
 * 向こう側にあるので、こちらは「面をどう読むか」だけを見る。
 *
 * **箱では表せなかった形を混ぜてある** — 斜めの壁と坂。これが通ることが、
 * 面へ移した理由そのもの。
 */

/** 軸に沿った板を三角 2 枚で。y が上面 */
function slab(x0: number, z0: number, x1: number, z1: number, y: number): number[] {
  return [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1]
}

/** 縦の壁。x0..x1 の間に、z の所へ立てる */
function wall(x0: number, x1: number, z: number, y0: number, y1: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z]
}

function world(triangles: number[], options = { height: 1.7, stepUp: 0.25 }) {
  return new MeshMoveWorld(new TriangleBvh({ positions: Float32Array.from(triangles) }), options)
}

describe('足が着く高さ', () => {
  test('平らな床の上では床の高さ', () => {
    const w = world(slab(-5, -5, 5, 5, 2))
    expect(w.groundHeight({ x: 0, y: 2, z: 0 }, 0.35, 2)).toBeCloseTo(2, 3)
  })

  test('**縁に立っても落ちない。** 中心が外でも体が乗っていれば足場', () => {
    const w = world(slab(-5, -5, 0, 5, 2))
    // 床は x <= 0。中心が 0.2 だけはみ出していても、体の半径 0.35 が乗っている
    expect(w.groundHeight({ x: 0.2, y: 2, z: 0 }, 0.35, 2)).toBeCloseTo(2, 3)
  })

  test('段差の上にある床は足場にしない。**乗り越える判断は向こう側**', () => {
    const w = world([...slab(-5, -5, 5, 5, 0), ...slab(-5, -5, 5, 5, 3)])
    // 足元 0 から見て 3m 上の床は、段差 (0.25) を超えているので拾わない
    expect(w.groundHeight({ x: 0, y: 0, z: 0 }, 0.35, 0)).toBeCloseTo(0, 3)
  })

  /**
   * **箱では表せなかった形。** 斜めの板が、傾いたまま足場になる。
   *
   * 箱のときは「一番高い所で蓋をした直方体」になるので、坂の下側でも
   * 天井の高さで足が着いた。上面を平面で持つ細工 (Obstacle.slopeX) は
   * その埋め合わせだった。
   */
  test('坂は、その場所の高さで足が着く', () => {
    // x = -4 で y = 0、x = 4 で y = 2 の坂
    const ramp = [
      -4, 0, -3, 4, 2, -3, 4, 2, 3,
      -4, 0, -3, 4, 2, 3, -4, 0, 3,
    ]
    const w = world(ramp)
    expect(w.groundHeight({ x: 0, y: 1, z: 0 }, 0.35, 1)).toBeCloseTo(1, 1)
    expect(w.groundHeight({ x: 2, y: 1.5, z: 0 }, 0.35, 1.5)).toBeCloseTo(1.5, 1)
  })

  test('何も無ければ 0 (水面 / 地面)', () => {
    expect(world([]).groundHeight({ x: 0, y: 5, z: 0 }, 0.35, 5)).toBe(0)
  })
})

describe('壁の押し戻し', () => {
  test('壁に埋まったら外へ出る', () => {
    const w = world(wall(-5, 5, 0, 0, 3))
    const position = { x: 0, y: 0, z: 0.1 }
    w.resolveHorizontal(position, 0.35, 0)
    // 壁は z = 0。半径 0.35 ぶん離れる
    expect(position.z).toBeGreaterThan(0.34)
    // 横には動かない
    expect(position.x).toBeCloseTo(0, 3)
  })

  /**
   * **斜めの壁が斜めのまま止める。** これが箱では出せなかった答え。
   *
   * 箱にすると、壁の無い側の空間まで判定に含まれる。
   */
  test('斜めの壁は、面に垂直な向きへ押し返す', () => {
    // z = x の線に沿った壁 (45 度)
    const diagonal = [
      -5, 0, -5, 5, 0, 5, 5, 3, 5,
      -5, 0, -5, 5, 3, 5, -5, 3, -5,
    ]
    const w = world(diagonal)
    const position = { x: 0, y: 0, z: 0.1 }
    w.resolveHorizontal(position, 0.35, 0)
    // 面の法線は (∓1, 0, ±1)/√2。x と z が同じだけ、逆向きに動く
    expect(position.z - 0.1).toBeCloseTo(-(position.x - 0), 1)
    expect(Math.hypot(position.x - 0, position.z - 0.1)).toBeGreaterThan(0.2)
  })

  /**
   * **坂には押し返させない。** 登れる面を水平に押すと、坂の途中で止まる。
   *
   * 筏で 2 階から 3 階へ上がれなかったのがこれの箱版だった。
   */
  test('登れる坂の上では押し戻されない', () => {
    const ramp = [
      -4, 0, -3, 4, 2, -3, 4, 2, 3,
      -4, 0, -3, 4, 2, 3, -4, 0, 3,
    ]
    const w = world(ramp)
    const position = { x: 0, y: 1, z: 0 }
    w.resolveHorizontal(position, 0.35, 1)
    expect(position.x).toBeCloseTo(0, 3)
    expect(position.z).toBeCloseTo(0, 3)
  })

  test('低い段は押し返さない。**またぐ物であって壁ではない**', () => {
    // 高さ 0.2m の縁石 (段差 0.25 より低い)
    const w = world(wall(-5, 5, 0, 0, 0.2))
    const position = { x: 0, y: 0, z: 0.1 }
    w.resolveHorizontal(position, 0.35, 0)
    expect(position.z).toBeCloseTo(0.1, 3)
  })
})

describe('頭がぶつかる高さ', () => {
  test('梁の下では梁の高さ', () => {
    const w = world(slab(-5, -5, 5, 5, 2.5))
    expect(w.ceilingHeight({ x: 0, y: 0, z: 0 }, 0.35, 0)).toBeCloseTo(2.5, 2)
  })

  test('**乗っている床は天井ではない**', () => {
    const w = world(slab(-5, -5, 5, 5, 0))
    expect(w.ceilingHeight({ x: 0, y: 0, z: 0 }, 0.35, 0)).toBe(Infinity)
  })

  test('何も無ければ Infinity', () => {
    expect(world([]).ceilingHeight({ x: 0, y: 0, z: 0 }, 0.35, 0)).toBe(Infinity)
  })
})

describe('足元の材質', () => {
  test('踏んでいる三角から引く', () => {
    const positions = Float32Array.from([
      ...slab(-5, -5, 0, 5, 0), // 手前は 2 = wood
      ...slab(0, -5, 5, 5, 0), // 奥は 1 = metal
    ])
    const bvh = new TriangleBvh({ positions, surfaces: Uint8Array.from([2, 2, 1, 1]) })
    const w = new MeshMoveWorld(bvh, { height: 1.7, stepUp: 0.25 })
    expect(w.surfaceUnder({ x: -2, y: 0, z: 0 }, 0)).toBe(2)
    expect(w.surfaceUnder({ x: 2, y: 0, z: 0 }, 0)).toBe(1)
  })

  test('何も踏んでいなければ null', () => {
    expect(world([]).surfaceUnder({ x: 0, y: 5, z: 0 }, 5)).toBeNull()
  })
})
