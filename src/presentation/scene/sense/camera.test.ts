import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { FollowCamera, zoomLookScale } from './camera'

/**
 * 覗いている間の見る速さ。
 *
 * --- なぜここを試すか ---
 * 「16 倍と書いてあるのにそこまで寄っている気がしない」から辿り着いた。
 * 画角は本当に 4 度まで下がっていたが、**感度が倍率に付いてきていなかった**。
 * 画面に映る角度が 1/15 なのに手の動きはそのままなので、狙いが飛んで
 * 「寄れていない」ように感じる。
 *
 * 見たいのは倍率そのものではなく、**画面上で同じ距離だけ動くか**。
 */

/** その画角で、画面の端までが何ラジアンか (tan の比で効く) */
const spanOf = (fov: number) => Math.tan((fov * Math.PI) / 360)

describe('覗いたときの見る速さ', () => {
  test('肩越しは 1 倍。**覗いていない間の手触りは変えない**', () => {
    expect(zoomLookScale(38)).toBe(1)
  })

  test('肩越しより広い武器も 1 倍で頭打ち。速くはしない', () => {
    // 拳銃や散弾銃は 42〜44 度。比で言えば 1 を超えるが、上げる理由はない
    expect(zoomLookScale(44)).toBe(1)
    expect(zoomLookScale(60)).toBe(1)
  })

  test('**画面上で動く距離が段によらず揃う**', () => {
    // 狙撃銃の 3 段。画角が狭いほど、同じ px で回る角も狭くなる
    for (const fov of [16, 8, 4]) {
      const moved = zoomLookScale(fov) * spanOf(38)
      expect(moved).toBeCloseTo(spanOf(fov), 6)
    }
  })

  test('16 倍では肩越しの 1/10 まで落ちる', () => {
    // tan(2°) / tan(19°) = 0.1014
    expect(zoomLookScale(4)).toBeCloseTo(0.101, 3)
  })
})

/**
 * 衝撃で画面を揺らす。
 *
 * --- なぜ試すか ---
 * このゲームは**カメラの軸がそのまま弾道**なので、素直に揺らすと狙いまで動く。
 * 反動 (recoilPitch) は狙いごと動かす別の仕掛けで、あちらは撃った本人の代償と
 * して意図している。**爆風で狙いが狂うのは意図していない。**
 *
 * 揺れはカメラの向きにだけ乗せて、`aimDirection` は動かさない。
 */
describe('衝撃で揺れる', () => {
  function rig(): { camera: FollowCamera; player: unknown } {
    const camera = new FollowCamera(1)
    // 追従の相手。位置と頭の高さだけ見ている
    const player = {
      position: new THREE.Vector3(0, 0, 0),
      viewHeight: 1.5,
      speed: 0,
      stanceRate: 0,
      crouching: false,
    }
    return { camera, player }
  }

  test('**揺れても弾道は動かない**', () => {
    const { camera, player } = rig()
    camera.update(1 / 60, player as never)
    const before = camera.aimDirection(new THREE.Vector3()).clone()
    const beforeYaw = camera.aimYaw
    const beforePitch = camera.aimPitch

    camera.punch(1)
    camera.update(1 / 60, player as never)

    expect(camera.aimDirection(new THREE.Vector3()).distanceTo(before)).toBeCloseTo(0, 6)
    expect(camera.aimYaw).toBeCloseTo(beforeYaw, 6)
    expect(camera.aimPitch).toBeCloseTo(beforePitch, 6)
  })

  test('カメラの向きは実際に動く', () => {
    const { camera, player } = rig()
    camera.update(1 / 60, player as never)
    const still = camera.camera.rotation.clone()

    camera.punch(1)
    camera.update(1 / 60, player as never)
    const shaken = camera.camera.rotation.clone()

    expect(Math.abs(shaken.x - still.x) + Math.abs(shaken.y - still.y)).toBeGreaterThan(0.001)
  })

  test('**遠いほど小さい。** 近さは呼ぶ側が渡す', () => {
    const near = rig()
    const far = rig()
    near.camera.update(1 / 60, near.player as never)
    far.camera.update(1 / 60, far.player as never)
    const base = near.camera.camera.rotation.x

    near.camera.punch(1)
    far.camera.punch(0.2)
    near.camera.update(1 / 60, near.player as never)
    far.camera.update(1 / 60, far.player as never)

    expect(Math.abs(near.camera.camera.rotation.x - base)).toBeGreaterThan(
      Math.abs(far.camera.camera.rotation.x - base),
    )
  })

  test('やがて収まる', () => {
    const { camera, player } = rig()
    camera.update(1 / 60, player as never)
    const still = camera.camera.rotation.x
    camera.punch(1)
    for (let i = 0; i < 60; i++) camera.update(1 / 60, player as never)
    expect(camera.camera.rotation.x).toBeCloseTo(still, 5)
  })
})
