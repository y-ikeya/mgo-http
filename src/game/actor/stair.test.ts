import { describe, expect, test } from 'bun:test'
import { stepMovement, type MoveWorld, type Mover } from '../../sim/space/movement'
import { STAIR_DROP_MAX, STAIR_DROP_MIN, STAIR_RISE_MIN } from './motion'

/**
 * **坂と階段を落差で見分けられるか。**
 *
 * 下りの型 (down_stair) を出すかどうかは、着地したときに「どれだけ落ちたか」で
 * 決めている (player.ts)。その閾値が実際の物理と合っているかを、
 * 本物の stepMovement を通して測る。
 *
 * そもそも**坂では浮かない** (sim/space/movement.ts の GROUND_SNAP)。浮いていた頃は、
 * 着地のたびに下りの型が流れて屈伸しているように見えていた。ここでは
 * 「坂では離れない」「段では落差が出る」の両方を押さえる。
 */

const TUNING = {
  radius: 0.35,
  height: 1.7,
  gravity: 9.8,
  /** player.ts と同じ。落ちる側だけ速い */
  fallGravityScale: 1.8,
  airControl: 0.2,
}
const DT = 1 / 60
/** 走る速さ (player.ts の MOVE_SPEED) */
const RUN = 3.04
/** 駐車場のスロープ。stage.json の concrete_ramp_up2 (top.dz) */
const RAMP = 0.275
/** 階段。stage.json の metal_stair_* は蹴上げ 0.25m / 踏面 0.35m */
const RISE = 0.25
const TREAD = 0.35

interface Descent {
  /** 着地したときの落差 (m) */
  drops: number[]
  /** 1 フレームで足元が上がった幅 (m)。上りの判定に使う */
  rises: number[]
  /** 宙に居たフレーム数 */
  airborne: number
}

/** ground(z) の地形を speed で z 方向へ 4 秒ぶん歩かせて、着地のたびに落差を測る */
function walk(ground: (z: number) => number, speed: number): Descent {
  const mover: Mover = {
    position: { x: 0, y: ground(0), z: 0 },
    velocityY: 0,
    onGround: true,
    airX: 0,
    airZ: 0,
  }
  const world: MoveWorld = {
    groundHeight: (p) => ground(p.z),
    ceilingHeight: () => 100,
    resolveHorizontal: () => {},
  }
  const drops: number[] = []
  const rises: number[] = []
  let airborne = 0
  // player.ts と同じ持ち方: 最後に地面へ触れていた高さ / 前フレームの足元
  let airFromY = mover.position.y
  let lastFeetY = mover.position.y
  for (let i = 0; i < 240; i++) {
    const moved = stepMovement(mover, { dirX: 0, dirZ: 1, speed }, world, TUNING, DT)
    if (moved.landed) drops.push(airFromY - mover.position.y)
    if (!mover.onGround) airborne++
    if (mover.onGround) {
      rises.push(mover.position.y - lastFeetY)
      airFromY = mover.position.y
    }
    lastFeetY = mover.position.y
  }
  return { drops, rises, airborne }
}

const slopeDown = (z: number) => -RAMP * z
const slopeUp = (z: number) => RAMP * z
const stairDown = (z: number) => -RISE * Math.floor(z / TREAD)
const stairUp = (z: number) => RISE * Math.floor(z / TREAD)

describe('坂と階段', () => {
  test('坂を下る間は一度も地面を離れない', () => {
    const { drops, airborne } = walk(slopeDown, RUN)
    // **浮かないことが本題。** 浮いて着地を繰り返すと、下りの型が出るだけでなく
    // 接地を見ている跳躍・ローリング・足音が坂の上で効かなくなる
    expect(airborne).toBe(0)
    expect(drops).toEqual([])
  })

  test('急な坂でも離れない', () => {
    // 傾き 0.5 (27 度)。今のステージには無いが、置いても崩れないこと
    const { airborne } = walk((z) => -0.5 * z, RUN)
    expect(airborne).toBe(0)
  })

  test('階段を下りたら段と読まれる', () => {
    for (const speed of [RUN, 1.5]) {
      const { drops } = walk(stairDown, speed)
      expect(drops.length).toBeGreaterThan(5)
      for (const drop of drops) {
        expect(drop).toBeGreaterThanOrEqual(STAIR_DROP_MIN)
        expect(drop).toBeLessThanOrEqual(STAIR_DROP_MAX)
      }
    }
  })

  test('坂を上っても段とは読まれない', () => {
    const { rises } = walk(slopeUp, RUN)
    expect(Math.max(...rises)).toBeLessThan(STAIR_RISE_MIN)
  })

  test('階段を上ったら段と読まれる', () => {
    const { rises } = walk(stairUp, RUN)
    expect(Math.max(...rises)).toBeGreaterThanOrEqual(STAIR_RISE_MIN)
  })

  test('平らな床では一度も浮かない', () => {
    const { drops } = walk(() => 0, RUN)
    expect(drops).toEqual([])
  })
})
