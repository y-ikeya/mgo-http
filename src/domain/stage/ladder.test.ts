import { describe, expect, test } from 'bun:test'
import { LADDER_REACH, type Ladder, ladderAt, ladderGrip } from './ladder'

/**
 * raft に立っている梯子と同じ形。厚みは z、高さ 12m。
 */
const LADDER: Ladder = {
  name: 'ladder_a',
  min: [-13.2, 10.5, -36.5],
  max: [-12.4, 22.8, -36.4],
  axis: 'z',
}

describe('梯子', () => {
  test('前に立てば掴める', () => {
    expect(ladderAt([LADDER], -12.8, 10.6, -36.0, 1.7)?.name).toBe('ladder_a')
  })

  test('**裏からでも掴める。** 回り込んだ先で登れないと逃げ場が消える', () => {
    expect(ladderAt([LADDER], -12.8, 10.6, -36.9, 1.7)?.name).toBe('ladder_a')
  })

  test('離れていれば掴めない', () => {
    expect(ladderAt([LADDER], -12.8, 10.6, -36.45 - LADDER_REACH - 0.3, 1.7)).toBeNull()
  })

  test('幅の外では掴めない。**横から手は届かない**', () => {
    expect(ladderAt([LADDER], -11.0, 10.6, -36.0, 1.7)).toBeNull()
  })

  test('**下端より下では掴めない。** 空を掴むことになる', () => {
    expect(ladderAt([LADDER], -12.8, 5.0, -36.0, 1.7)).toBeNull()
  })

  test('掴んだら梯子の正面に立って、梯子を向く', () => {
    const grip = ladderGrip(LADDER, -12.8, -36.0)
    // 幅の中央へ寄る
    expect(grip.x).toBeCloseTo(-12.8, 2)
    // 居た側に立つ (+z 側から掴んだ)
    expect(grip.z).toBeGreaterThan(-36.45)
    // -z を向く。yaw = θ のとき体の前は (-sinθ, 0, -cosθ)
    expect(Math.sin(grip.yaw)).toBeCloseTo(0, 3)
    expect(Math.cos(grip.yaw)).toBeCloseTo(1, 3)
  })

  test('裏から掴めば裏に立って、逆を向く', () => {
    const grip = ladderGrip(LADDER, -12.8, -37.0)
    expect(grip.z).toBeLessThan(-36.45)
    expect(Math.cos(grip.yaw)).toBeCloseTo(-1, 3)
  })
})
