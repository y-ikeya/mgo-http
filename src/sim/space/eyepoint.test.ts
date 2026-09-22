import { describe, expect, test } from 'bun:test'
import { cameraPoint, seesFromCamera, AIM_CAMERA, HIP_CAMERA } from './eyepoint'
import { bodyVisible, boxSight, hasLineOfSight, type StageBox } from './vision'
import { BODY_BOX } from '../../domain/player/stance'

/**
 * どこから見ているか。**注視点の高さは呼ぶ側が渡す。**
 *
 * 1 つの値に決めていた頃、しゃがんで隙間から覗くと画面には映っているのに
 * サーバーは配らなかった (筏の塔の縁の板、床から 12cm の隙間)。
 */

describe('cameraPoint', () => {
  test('注視点の高さ + 構図のずらし (lift) がカメラの高さになる (水平に見ているとき)', () => {
    const low = cameraPoint(0, 0, 0, 0, 0, true, 0.6)
    const high = cameraPoint(0, 0, 0, 0, 0, true, 1.57)
    expect(low.y).toBeCloseTo(0.6 + AIM_CAMERA.lift, 5)
    expect(high.y).toBeCloseTo(1.57 + AIM_CAMERA.lift, 5)
    // 腰だめは注視点が目より上 (キャラが画面の下に居る構図)
    const hip = cameraPoint(0, 0, 0, 0, 0, false, 1.57)
    expect(hip.y).toBeCloseTo(1.57 + HIP_CAMERA.lift, 5)
  })
})

describe('seesFromCamera', () => {
  /*
   * 高さ 10m の台の上。床から 0.05m 浮いた壁 (高さ 3m) が z = -2 に立っている。
   * 相手は壁の向こう z = -20、同じ高さの床に立っている。
   *
   *     低いカメラ (0.03)  隙間を通して相手の足元が見える
   *     高いカメラ (1.57)  壁に遮られる
   *
   * 台の上に置くのは、カメラが世界の 0.4m より下へ潜らない (MIN_Y) ため。
   */
  const FLOOR = 10
  const wall: StageBox = { name: 'wall', min: [-5, FLOOR + 0.05, -2.06], max: [5, FLOOR + 3.0, -1.94] }
  const sight = boxSight([wall])
  const viewer = { x: 0, y: FLOOR, z: 0, cameraYaw: 0, pitch: 0, aiming: true }
  const column = (ex: number, ey: number, ez: number) => hasLineOfSight(ex, ey, ez, 0, FLOOR, -20, 0.3, sight)

  test('低い高さだけで通る相手は、幅の低いほうで拾う', () => {
    expect(seesFromCamera(viewer, [1.57, 1.57], [], column)).toBe(false)
    expect(seesFromCamera(viewer, [0.03, 0.03], [], column)).toBe(true)
    // 幅で渡せば、どちらかで通れば見えている
    expect(seesFromCamera(viewer, [0.03, 1.57], [], column)).toBe(true)
  })

  test('どの高さでも通らなければ見えない', () => {
    // 壁の裏の台の上 (床 + 1.0)。隙間の高さには居ない
    const raised = (ex: number, ey: number, ez: number) => hasLineOfSight(ex, ey, ez, 0, FLOOR + 1.0, -2.5, 0.3, sight)
    expect(seesFromCamera(viewer, [0.03, 1.57], [], raised)).toBe(false)
  })
})

describe('bodyVisible (箱の 12 辺)', () => {
  const FLOOR = 10
  // 床に着いた壁。浮かせると箱の底の辺がその隙間から見える (それ自体は正しい)
  const wall: StageBox = { name: 'wall', min: [-5, FLOOR, -2.06], max: [5, FLOOR + 3.0, -1.94] }
  const sight = boxSight([wall])

  /**
   * 壁の裏に伏せて、頭を出している相手。
   *
   * 伏せの箱は前に 0.65m 長いので、壁 (0.4m 裏) より手前まで出る。
   * 見る側は壁の向こう z = -20。
   */
  test('伏せて頭を出している相手は見える。奥へ下がれば見えない', () => {
    const eye = [0, FLOOR + 1.5, -20] as const
    // -Z を向いて (yaw 0) 壁の 0.4m 裏に伏せている → 箱の前端は壁より手前 (z -2.25)
    expect(bodyVisible(...eye, 0, FLOOR, -1.6, 0, BODY_BOX.prone, sight)).toBe(true)
    // 1.2m 裏なら箱ごと壁の裏
    expect(bodyVisible(...eye, 0, FLOOR, -0.8, 0, BODY_BOX.prone, sight)).toBe(false)
  })

  /** 立っている相手が壁の端から肩だけ出している。縦の辺で拾う */
  test('肩だけ出ていれば見える', () => {
    const edge: StageBox = { name: 'edge', min: [-10, FLOOR, -2.06], max: [0.1, FLOOR + 3, -1.94] }
    const sightEdge = boxSight([edge])
    const eye = [0, FLOOR + 1.5, -20] as const
    // 中心は x = 0 (壁の裏) だが、右の肩 (x + 0.22) は端から出る
    expect(bodyVisible(...eye, 0, FLOOR, -1.6, 0, BODY_BOX.stand, sightEdge)).toBe(true)
    // 0.4m 奥なら箱ごと裏
    expect(bodyVisible(...eye, -0.4, FLOOR, -1.6, 0, BODY_BOX.stand, sightEdge)).toBe(false)
  })
})
