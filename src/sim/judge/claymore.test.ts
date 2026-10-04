import { describe, expect, test } from 'bun:test'
import { blastReach, canPlaceAt, placeSpot, sensedBy, triggeredBy, type Placed } from './claymore'
import type { StageBox } from '../space/vision'
import { TriangleBvh } from '../space/bvh'

/**
 * **試験の数字はここで決める。** 遊びの側 (domain) の値を持ち出さない —
 * 間合いを 4m から 5m に変えただけで幾何の試験が動くのはおかしい。
 * ここで見たいのは「扇の形が正しいか」だけ。
 */
const RANGE = 4
const COS = Math.cos((60 * Math.PI) / 180)

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
    expect(triggeredBy(mine, { x, y: 0, z }, RANGE, COS)).toBe(expected)
  })

  test('間合いの外は通す', () => {
    expect(triggeredBy(mine, { x: 0, y: 0, z: -(RANGE + 0.5) }, RANGE, COS)).toBe(false)
  })

  test('向けた先が変わればひっくり返る', () => {
    const behind = { x: 0, y: 0, z: 2 }
    expect(triggeredBy(at(0), behind, RANGE, COS)).toBe(false)
    // 半回転させれば同じ場所が正面になる
    expect(triggeredBy(at(Math.PI), behind, RANGE, COS)).toBe(true)
  })
})

describe('爆風の届き方 (量は domain の試験)', () => {
  const mine = at(0)

  test('**測るのは距離だけ。全方位。** 背後でも横でも同じ', () => {
    const front = blastReach(mine, { x: 0, y: 0, z: -2 })
    const back = blastReach(mine, { x: 0, y: 0, z: 2 })
    const side = blastReach(mine, { x: 2, y: 0, z: 0 })
    expect(back).toBeCloseTo(front, 5)
    expect(side).toBeCloseTo(front, 5)
  })

  test('向きが効くのは起爆まで。背後を通っても反応はしない', () => {
    expect(triggeredBy(mine, { x: 0, y: 0, z: 2 }, RANGE, COS)).toBe(false)
    // 届く距離のほうが広いので、反応しなくても爆風には入る
    expect(blastReach(mine, { x: 0, y: 0, z: 2 })).toBeLessThan(6)
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

  /**
   * **本体の足跡で見る。向きで変わる。** 横 21.6cm × 奥行 16.6cm。
   * 壁に沿わせる (壁が横) なら 10.8cm、壁に向ける (壁が前) なら 8.3cm まで寄れる
   */
  test('壁に沿わせれば横幅の半分まで寄れる', () => {
    // 壁は x ≤ -0.12。yaw = 0 (前は -Z) なので壁は左横
    const side = [{ min: [-5, 0, -5], max: [-0.12, 2, 5] }]
    expect(canPlaceAt(0, 0, 0, 0, side, 0)).toBe(true)
    // 横幅の半分 (10.8cm) + 余白 1cm より近いと埋まる
    const closer = [{ min: [-5, 0, -5], max: [-0.1, 2, 5] }]
    expect(canPlaceAt(0, 0, 0, 0, closer, 0)).toBe(false)
  })

  test('壁に向ければ奥行の半分まで寄れる', () => {
    // 壁は z ≤ -0.1。yaw = 0 で前
    const front = [{ min: [-5, 0, -5], max: [5, 2, -0.1] }]
    expect(canPlaceAt(0, 0, 0, 0, front, 0)).toBe(true)
    // 横を向けると (yaw = 90 度) 横幅が z に出て埋まる
    expect(canPlaceAt(0, 0, 0, 0, front, Math.PI / 2)).toBe(false)
  })

  test('斜めでも角で埋まる', () => {
    // 45 度。角から対角線の半分 (約 13.6cm) まで張り出す
    const corner = [{ min: [0.12, 0, -5], max: [5, 2, 5] }]
    expect(canPlaceAt(0, 0, 0, 0, corner, Math.PI / 4)).toBe(false)
    const farther = [{ min: [0.15, 0, -5], max: [5, 2, 5] }]
    expect(canPlaceAt(0, 0, 0, 0, farther, Math.PI / 4)).toBe(true)
  })
})

/** 試験用の箱。型だけ揃える */
function box(name: string, min: [number, number, number], max: [number, number, number]): StageBox {
  return { name, min, max } as StageBox
}

describe('置く所 (placeSpot)。審判も客も同じ式', () => {
  const floor = [box('floor', [-10, -1, -10], [10, 0, 10])]

  test('前へ 0.9m、地面に乗る', () => {
    // yaw = 0 なら前は -Z
    const spot = placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, floor, 0.4, null)
    expect(spot.x).toBeCloseTo(0)
    expect(spot.z).toBeCloseTo(-0.9)
    expect(spot.y).toBeCloseTo(0)
    expect(spot.ok).toBe(true)
  })

  test('どこまで引いても入らなければ、0.9m 先を ok=false で返す (印を赤く出す場所)', () => {
    const wall = [...floor, box('wall', [-2, 0, -1.5], [2, 2, -0.2])]
    const spot = placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, wall, 0.4, null)
    expect(spot.ok).toBe(false)
    expect(spot.z).toBeCloseTo(-0.9)
  })

  test('縁の外なら、縁の内側まで手前へ引く', () => {
    const ledge = [box('ledge', [-10, 0, 0], [10, 2, 10])]
    // 縁 (z=0) から 0.5m。0.9m 先は宙だが、縁の手前に置ける
    const spot = placeSpot({ x: 0, y: 2, z: 0.5, yaw: 0 }, ledge, 0.4, null)
    expect(spot.ok).toBe(true)
    expect(spot.y).toBeCloseTo(2)
    expect(spot.z).toBeGreaterThan(0)
    expect(spot.z).toBeLessThan(0.5)
  })

  test('壁に向いて立っても、本体が壁に埋まらない所まで引いて置ける', () => {
    const wall = [...floor, box('wall', [-5, 0, -5], [5, 2, -0.6])]
    const spot = placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, wall, 0.4, null)
    expect(spot.ok).toBe(true)
    // 本体の奥行の半分 (8.3cm) + 余白ぶん、壁の面 (z=-0.6) より手前
    expect(spot.z).toBeGreaterThan(-0.6 + 0.083)
    expect(spot.z).toBeLessThan(-0.4)
  })

  test('壁が体のすぐ前なら置けない (引ける限界より近い)', () => {
    const wall = [...floor, box('wall', [-5, 0, -5], [5, 2, -0.3])]
    expect(placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, wall, 0.4, null).ok).toBe(false)
  })

  test('渡した器に書く (毎フレーム呼んでも散らかさない)', () => {
    const out = { x: 9, y: 9, z: 9, ok: false }
    expect(placeSpot({ x: 1, y: 0, z: 1, yaw: 0 }, floor, 0.4, null, out)).toBe(out)
    expect(out.x).toBeCloseTo(1)
  })
})

/** 軸に沿った板を三角 2 枚で。y が上面 */
function slab(x0: number, z0: number, x1: number, z1: number, y: number): number[] {
  return [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1]
}
/** 縦の壁。x0..x1 の間に、z の所へ立てる */
function wallAtZ(x0: number, x1: number, z: number, y0: number, y1: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z]
}
const mesh = (tris: number[]) => new TriangleBvh({ positions: Float32Array.from(tris) })

describe('置く所を面の網で見る (審判が人を立たせている面そのもの)', () => {
  test('平らな床に、前へ 0.9m', () => {
    const spot = placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, [], 0.4, mesh(slab(-10, -10, 10, 10, 0)))
    expect(spot.ok).toBe(true)
    expect(spot.z).toBeCloseTo(-0.9)
    expect(spot.y).toBeCloseTo(0, 3)
  })

  test('壁に向いて立てば、本体が面を跨がない所まで引く。**箱の外接に左右されない**', () => {
    // 壁の面は z = -0.6。箱で見れば庇の外接が手前まで来ていても、面はここにしか無い
    const world = mesh([...slab(-10, -10, 10, 10, 0), ...wallAtZ(-5, 5, -0.6, 0, 3)])
    const boxes = [box('trim', [-5, 0, -5], [5, 3, 0.3])]
    const spot = placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, boxes, 0.4, world)
    expect(spot.ok).toBe(true)
    expect(spot.z).toBeGreaterThan(-0.6 + 0.083)
    expect(spot.z).toBeLessThan(-0.4)
  })

  test('壁に沿わせる (壁が横) なら、横幅の半分だけ離れていれば置ける', () => {
    // 壁の面は x = -0.12。yaw = 0 で前は -Z なので壁は左横
    const near = mesh([...slab(-10, -10, 10, 10, 0), ...[-0.12, 0, -10, -0.12, 0, 10, -0.12, 3, 10, -0.12, 0, -10, -0.12, 3, 10, -0.12, 3, -10]])
    expect(placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, [], 0.4, near).ok).toBe(true)
    const closer = mesh([...slab(-10, -10, 10, 10, 0), ...[-0.1, 0, -10, -0.1, 0, 10, -0.1, 3, 10, -0.1, 0, -10, -0.1, 3, 10, -0.1, 3, -10]])
    const spot = placeSpot({ x: 0, y: 0, z: 0, yaw: 0 }, [], 0.4, closer)
    // 本体が壁を跨ぐ。前へ引いても横の距離は変わらないので置けない
    expect(spot.ok).toBe(false)
  })

  test('縁の外は浮く。縁の内側まで引く', () => {
    const spot = placeSpot({ x: 0, y: 2, z: 0.5, yaw: 0 }, [], 0.4, mesh(slab(-10, 0, 10, 10, 2)))
    expect(spot.ok).toBe(true)
    expect(spot.z).toBeGreaterThan(0)
    expect(spot.y).toBeCloseTo(2, 3)
  })

  test('段の上 (35cm 以内) には乗せて置ける', () => {
    const world = mesh([...slab(-10, -10, 10, 0, 0), ...slab(-10, -10, 10, -0.5, 0.3), ...wallAtZ(-10, 10, -0.5, 0, 0.3)])
    const spot = placeSpot({ x: 0, y: 0, z: 0.4, yaw: 0 }, [], 0.4, world)
    expect(spot.ok).toBe(true)
    expect(spot.y).toBeCloseTo(0.3, 3)
  })
})

describe('反応するのは、扇の中で・同じ高さで・見えている相手だけ (sensedBy)', () => {
  const HEAD = 1.7
  const open = { clear: () => true }
  /** z = -1 の所に壁。線がその面を跨げば通らない */
  const wallAt = (wz: number) => ({
    clear: (_ax: number, _ay: number, az: number, _bx: number, _by: number, bz: number) => (az - wz) * (bz - wz) > 0,
  })
  const sense = (target: { x: number; y: number; z: number }, world: { clear: (...a: number[]) => boolean }) =>
    sensedBy(at(0), target, RANGE, COS, HEAD, 1.2, 0.13, world)

  test('何も無ければ扇の中で反応する', () => {
    expect(sense({ x: 0, y: 0, z: -2 }, open)).toBe(true)
  })

  test('壁の向こうは反応しない。壁の手前なら反応する', () => {
    expect(sense({ x: 0, y: 0, z: -2 }, wallAt(-1))).toBe(false)
    expect(sense({ x: 0, y: 0, z: -0.8 }, wallAt(-1))).toBe(true)
  })

  test('別の階 (上下に 1.2m より離れた足元) は反応しない。1 段の段差は中', () => {
    expect(sense({ x: 0, y: 3.2, z: -2 }, open)).toBe(false)
    expect(sense({ x: 0, y: -3.2, z: -2 }, open)).toBe(false)
    expect(sense({ x: 0, y: 0.4, z: -2 }, open)).toBe(true)
  })

  test('扇の外は、見えていても反応しない', () => {
    expect(sense({ x: 0, y: 0, z: 2 }, open)).toBe(false)
  })
})
