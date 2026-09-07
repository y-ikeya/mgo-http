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
    resolveCircle(position, RADIUS, obstacles, feetY, HEIGHT, STEP)
  }
  return position.z
}

/** 足を乗せられる段差 (m)。**試験の数字はここで決める** */
const STEP = 0.25

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
    expect(groundHeight({ x: 0, y: 0, z: 0 }, RADIUS, [bridge], 0, STEP)).toBe(0)
  })

  test('橋の高さまで上がれば橋が床になる', () => {
    expect(groundHeight({ x: 0, y: 2.4, z: 0 }, RADIUS, [bridge], 2.4, STEP)).toBe(2.4)
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

describe('坂を上る', () => {
  /**
   * **坂の途中で、隣の高い面へ飛び移らない。**
   *
   * 人は太さ 0.35m の筒なので、坂を上っている間ずっと体の前が上の板に触れて
   * いる。足より上の面をそのままの高さで拾うと、板の縁に届いた瞬間に
   * **0.2m 跳ね上がる** — 見た目は坂の途中なのに階段のモーションが出る、
   * という形で筏に出ていた。跳ぶ幅は「半径 × 坂の傾き」で決まる。
   *
   * 足より上は「近づいた分しか上がらない」ので、1 コマの上がり幅は進んだ距離を
   * 超えない。走る速さでも 0.08m (階段とみなす線) に届かない。
   */
  const RADIUS = 0.35
  const STEP = 0.25

  /** 坂 (x が小さいほど高い) と、その先に続く平らな板 */
  const ramp: Obstacle = {
    minX: 2, maxX: 6, minZ: -1, maxZ: 1,
    top: 3, baseTop: 3, slopeX: -0.5, slopeZ: 0,
    bottom: 0, surface: 'wood',
  }
  const deck: Obstacle = {
    minX: -4, maxX: 2, minZ: -1, maxZ: 1,
    top: 3, baseTop: 3, slopeX: 0, slopeZ: 0,
    bottom: 0, surface: 'wood',
  }

  test('**坂から板へ移るとき、1 コマの上がり幅は進んだ距離を超えない**', () => {
    const stride = 0.07
    let feet = groundHeight({ x: 6, y: 9, z: 0 }, RADIUS, [ramp, deck], 9, 99)
    let worst = 0
    for (let x = 6; x > 1; x -= stride) {
      const next = groundHeight({ x, y: feet, z: 0 }, RADIUS, [ramp, deck], feet, STEP)
      if (next > 0) {
        worst = Math.max(worst, next - feet)
        feet = next
      }
    }
    // 板の高さまで上りきる
    expect(feet).toBeCloseTo(3, 2)
    // 進んだ距離 (0.07m) より大きくは上がらない
    expect(worst).toBeLessThanOrEqual(stride + 1e-6)
  })

  /**
   * **支えるのは足の裏。** 板の縁に立っても沈まない。
   *
   * 足より下の面は今までどおり筒で拾う。丸めると、筏のように**落ちたら死ぬ**
   * 細い板の上で縁に寄っただけで沈むことになる。
   */
  /**
   * **段は今までどおり上がれる。**
   *
   * 抑えるのは坂の上に居るときだけ。平らな所から段へ寄ったときまで抑えると、
   * 段が壁になって上がれなくなる (実際、常に抑える形にして 3 階へ行けなくなった)。
   */
  test('**平らな所からは、段に乗れる**', () => {
    const ledge: Obstacle = {
      minX: 0, maxX: 5, minZ: -2, maxZ: 2,
      top: 0.25, baseTop: 0.25, slopeX: 0, slopeZ: 0,
      bottom: 0, surface: 'concrete',
    }
    const floor: Obstacle = {
      minX: -5, maxX: 0, minZ: -2, maxZ: 2,
      top: 0, baseTop: 0, slopeX: 0, slopeZ: 0,
      bottom: -1, surface: 'concrete',
    }
    let feet = 0
    for (let x = -1.5; x < 0.5; x += 0.07) {
      feet = groundHeight({ x, y: feet, z: 0 }, RADIUS, [ledge, floor], feet, STEP)
    }
    expect(feet).toBeCloseTo(0.25, 3)
  })

  /**
   * **坂を上り切って板に乗れる。**
   *
   * 坂の上り口で板が待っていると、足がまだ低いうちに体の縁が板へ触れる。
   * いまの足元だけで判じると「乗り越えられない高さ」= 壁になり、**数 cm 幅の
   * 帯から出られなくなる** — 筏で 2 階から 3 階へ上がれなかったのがこれ。
   *
   * 実際の形と同じように、**板を坂に少しかぶせて**置く。かぶった所には
   * 8cm の段ができる (筏の実測と同じ)。
   */
  test('**坂を上り切って板に乗れる。** 板が坂にかぶっていても', () => {
    const rampUp: Obstacle = {
      minX: 2, maxX: 7, minZ: -2, maxZ: 2,
      top: 3, baseTop: 3, slopeX: -0.6, slopeZ: 0,
      bottom: 0, surface: 'wood',
    }
    // 坂に 0.1m かぶせる。天面は坂の上端より 0.08m 高い = 段になる
    const landing: Obstacle = {
      minX: -3, maxX: 2.1, minZ: -2, maxZ: 2,
      top: 3.08, baseTop: 3.08, slopeX: 0, slopeZ: 0,
      bottom: 0, surface: 'wood',
    }
    const world = [rampUp, landing]
    const p = { x: 6.5, y: 0, z: 0 }
    p.y = groundHeight(p, RADIUS, world, 40, 99)
    for (let i = 0; i < 200; i++) {
      const before = p.x
      p.x -= 0.07
      resolveCircle(p, RADIUS, world, p.y, 1.7, STEP)
      const g = groundHeight(p, RADIUS, world, p.y, STEP)
      if (g > 0) p.y = g
      // 押し返されて進まなくなっていないか
      if (p.x > before - 0.02 && p.x > 1.5) break
    }
    // 板の高さまで上がって、板の上まで進めている
    expect(p.y).toBeCloseTo(3.08, 2)
    expect(p.x).toBeLessThan(1.5)
  })

  test('板の縁に立っても沈まない', () => {
    // 板の外へ 0.2m はみ出して立つ (半径 0.35 なので、まだ乗っている)
    const feet = groundHeight({ x: 2.2, y: 3, z: 0 }, RADIUS, [deck], 3, STEP)
    expect(feet).toBe(3)
  })
})
