import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { reachTwoBone } from './armIk'

/** 肩 → 肘 → 手首 の 3 つ。上腕 0.3m、前腕 0.25m で、肘を少し曲げて置く */
function arm() {
  const root = new THREE.Object3D()
  const upper = new THREE.Object3D()
  const lower = new THREE.Object3D()
  const end = new THREE.Object3D()
  root.add(upper)
  upper.add(lower)
  lower.add(end)
  upper.position.set(0, 1.4, 0)
  lower.position.set(0.3, 0, 0)
  end.position.set(0.25, 0, 0)
  // 肘を下へ少し曲げておく (張り出す向きの手掛かり)
  lower.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.4)
  root.updateMatrixWorld(true)
  return { upper, lower, end }
}

const worldOf = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)

describe('腕の 2 関節 IK', () => {
  test('届く所なら手首が目標に来る。腕の長さは変わらない', () => {
    const { upper, lower, end } = arm()
    const target = new THREE.Vector3(0.35, 1.5, 0.15)
    reachTwoBone(upper, lower, end, target)
    expect(worldOf(end).distanceTo(target)).toBeLessThan(1e-4)
    expect(worldOf(lower).distanceTo(worldOf(upper))).toBeCloseTo(0.3, 5)
    expect(worldOf(end).distanceTo(worldOf(lower))).toBeCloseTo(0.25, 5)
  })

  test('届かない所へは伸ばし切って向ける', () => {
    const { upper, lower, end } = arm()
    const target = new THREE.Vector3(2, 1.4, 0)
    reachTwoBone(upper, lower, end, target)
    expect(worldOf(end).distanceTo(worldOf(upper))).toBeCloseTo(0.55, 3)
    expect(worldOf(end).y).toBeCloseTo(1.4, 3)
  })

  test('手首の向きを渡せばその向きになる', () => {
    const { upper, lower, end } = arm()
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7)
    reachTwoBone(upper, lower, end, new THREE.Vector3(0.4, 1.35, 0.1), want)
    expect(end.getWorldQuaternion(new THREE.Quaternion()).angleTo(want)).toBeLessThan(1e-4)
  })
})
