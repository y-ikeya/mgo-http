import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { FollowCamera, zoomLookScale } from './camera'
import type { Soldier } from '../actor/soldier'

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
 * 肩越しと主観の切り替え。**狙っている所を変えない** (本人 2026-10-14)。
 *
 * 弾の線は注視点 (肩のずれの分だけ右) から出る。主観では肩のずれが 0 になるので、
 * 同じ向きのままだと線が横へ平行に動き、頭に合わせていた照準が頭の左へずれた。
 */
describe('肩越しと主観を切り替えても狙いはそのまま', () => {
  const player = { position: new THREE.Vector3(0, 0, 0), onLadder: false } as unknown as Soldier
  const settle = (follow: FollowCamera) => {
    for (let i = 0; i < 600; i++) follow.update(1 / 60, player)
  }
  /** 線 (始点 o・向き d) から点 p までの距離 */
  const miss = (follow: FollowCamera, p: THREE.Vector3) => {
    const o = follow.aimOrigin(new THREE.Vector3())
    const d = follow.aimDirection(new THREE.Vector3())
    const t = p.clone().sub(o).dot(d)
    return o.addScaledVector(d, t).distanceTo(p)
  }

  for (const [label, from, to] of [
    ['肩越し → 主観', { distance: 1.6, shoulder: 0.4, fov: 38 }, { distance: 0, shoulder: 0, fov: 30 }],
    ['主観 → 肩越し', { distance: 0, shoulder: 0, fov: 30 }, { distance: 1.6, shoulder: 0.4, fov: 38 }],
  ] as const) {
    test(`${label}: 20m 先の狙いから 1cm も外れない`, () => {
      const follow = new FollowCamera(1)
      follow.setAiming(true)
      follow.setAimView(from)
      settle(follow)
      const o = follow.aimOrigin(new THREE.Vector3())
      const aimed = o.addScaledVector(follow.aimDirection(new THREE.Vector3()), 20)

      follow.holdAimAt(20)
      follow.setAimView(to)
      settle(follow)
      expect(miss(follow, aimed)).toBeLessThan(0.01)
    })
  }

  test('合わせないと 肩のずれの分 (0.4m) 外れる (試験が効いている確かめ)', () => {
    const follow = new FollowCamera(1)
    follow.setAiming(true)
    follow.setAimView({ distance: 1.6, shoulder: 0.4, fov: 38 })
    settle(follow)
    const o = follow.aimOrigin(new THREE.Vector3())
    const aimed = o.addScaledVector(follow.aimDirection(new THREE.Vector3()), 20)
    follow.setAimView({ distance: 0, shoulder: 0, fov: 30 })
    settle(follow)
    expect(miss(follow, aimed)).toBeGreaterThan(0.3)
  })
})
