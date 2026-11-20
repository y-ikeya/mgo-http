import { describe, expect, it } from 'bun:test'
import * as THREE from 'three'
import { keepBoxOutOfWalls } from './box'

/** z < -1 が壁 (体の前 = -Z の先) */
const wall = {
  resolveHorizontal(position: THREE.Vector3, radius: number) {
    if (position.z - radius < -1) position.z = -1 + radius
  },
}

describe('被った箱を壁にめり込ませない', () => {
  it('正面の壁へ寄ると、箱の前面が壁に着く所まで体が戻る', () => {
    // 箱の前面は体から 0.92m 前。体を壁の 0.5m 手前に置くと 0.42m めり込む
    const body = new THREE.Vector3(0, 0, -0.5)
    keepBoxOutOfWalls(body, 0, wall)
    expect(body.z).toBeCloseTo(-1 + 0.92, 2)
    expect(body.x).toBeCloseTo(0, 5)
  })

  it('壁から離れていれば動かさない', () => {
    const body = new THREE.Vector3(0.3, 0, 0.5)
    keepBoxOutOfWalls(body, 0, wall)
    expect(body.toArray()).toEqual([0.3, 0, 0.5])
  })

  it('背中を壁に向けると、箱の後ろ (体から 0.28m) で止まる', () => {
    // yaw = π で前が +Z。壁 (z < -1) は背中側
    const body = new THREE.Vector3(0, 0, -0.9)
    keepBoxOutOfWalls(body, Math.PI, wall)
    expect(body.z).toBeCloseTo(-1 + 0.28, 2)
  })
})
