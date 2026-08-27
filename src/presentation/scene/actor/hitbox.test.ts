import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CharacterAnimator } from './animation'
import { Hitbox } from './hitbox'

/**
 * 当たり判定。**どこを撃つとどの部位になるか。**
 *
 * ここが無かったので「うなじの少し上を撃っても HEAD にならない」を出した。
 * 頭の球と胴の球が 15cm 重なっていて、重なった所は**近いほうが勝つ**ため
 * 胴が取っていた。コメントには「頭を優先する」と書いてあったが、
 * **書いてあることと動きが違っていた** — 読んでも気づけない類なので、
 * 実際に撃って部位を見る。
 *
 * 描画は要らない。実際の soldier.glb を読んで、実際の Hitbox を撃つ。
 */
const gltf = await new GLTFLoader().parseAsync(
  await Bun.file('public/models/soldier.glb').arrayBuffer(),
  '',
)

/** hitbox.ts と揃えてある。ここを変えたらあちらも */
const HEAD_RADIUS = 0.13
const HEAD_OFFSET = 0.08

/** 姿勢を落ち着かせた 1 体と、その骨の位置 */
function poseOf(locomotion: string, aiming: boolean) {
  const scene = gltf.scene.clone(true)
  const anim = new CharacterAnimator(scene, gltf.animations, 4.5)
  for (let i = 0; i < 90; i++) {
    anim.setLocomotion(locomotion as never)
    anim.setAiming(aiming)
    anim.update(1 / 60)
  }
  scene.updateMatrixWorld(true)

  const box = new Hitbox()
  box.bind(scene)

  const boneAt = (suffix: string) => {
    let found: THREE.Object3D | null = null
    scene.traverse((o) => {
      if (!found && o.name.endsWith(suffix)) found = o
    })
    const at = new THREE.Vector3()
    at.setFromMatrixPosition((found as unknown as THREE.Object3D).matrixWorld)
    return at
  }
  return { box, head: boneAt('Head'), neck: boneAt('Neck'), hips: boneAt('Hips') }
}

const standing = () => poseOf('idle', false)

/** 背中側から水平に撃つ */
function shootAt(p: ReturnType<typeof poseOf>, y: number): string {
  origin.set(p.head.x, y, p.head.z + 3)
  dir.set(0, 0, -1)
  return p.box.raycast(origin, dir, 10)?.zone ?? 'MISS'
}

const origin = new THREE.Vector3()
const dir = new THREE.Vector3()

/** 背中側から水平に撃つ。高さだけを変えて部位を見る */
function shootFromBehind(s: ReturnType<typeof standing>, y: number): string {
  origin.set(s.head.x, y, s.head.z + 3)
  dir.set(0, 0, -1)
  return s.box.raycast(origin, dir, 10)?.zone ?? 'MISS'
}

describe('頭の判定', () => {
  const s = standing()

  /**
   * **うなじの少し上は頭。** ここが胴になっていた。
   *
   * 胴の球は首を中心に半径 0.20m あるので上端が頭の球へ 15cm 食い込む。
   * 重なった所を近いほうに譲ると、**頭のボーンより 12cm 上** — 頭骨の
   * てっぺん — でないと HEAD にならなかった。
   */
  test('うなじの少し上を撃つと HEAD', () => {
    expect(shootFromBehind(s, s.neck.y + 0.05)).toBe('HEAD')
  })

  test('頭のボーンの高さは HEAD', () => {
    expect(shootFromBehind(s, s.head.y)).toBe('HEAD')
  })

  test('頭骨のてっぺん寄りも HEAD', () => {
    expect(shootFromBehind(s, s.head.y + 0.15)).toBe('HEAD')
  })

  /** **首から下は胴。** 頭を広げすぎると、肩を撃っても頭になる */
  test('首より下は BODY', () => {
    expect(shootFromBehind(s, s.neck.y - 0.05)).toBe('BODY')
  })

  test('胸の高さは BODY', () => {
    expect(shootFromBehind(s, (s.neck.y + s.hips.y) / 2)).toBe('BODY')
  })

  /** 頭の上を通せば当たらない。**当たり判定が青天井ではない** */
  test('頭より上は外れる', () => {
    expect(shootFromBehind(s, s.head.y + 0.35)).toBe('MISS')
  })

  /**
   * **首より下は、頭の球に入っていても胴。**
   *
   * 優先させただけだと逆に食い過ぎた。頭の球は下端が首のボーンまで落ちて
   * いるので、首の下を撃っても頭になる。当たった点の高さで切る。
   */
  test('構えている相手の、首の下は BODY', () => {
    // **構えると首が上がる** (1.415 → 1.434) 一方、頭の球は頭のボーンから
    // 決まるので下端が動かない。そこに「頭の球なのに首より下」の帯ができる。
    // 撃ち合いの姿勢そのものなので、ここが頭になると首の下で倒せてしまう
    const aim = poseOf('idle', true)
    const band = aim.neck.y - 0.01
    expect(band).toBeGreaterThan(aim.head.y + HEAD_OFFSET - HEAD_RADIUS)
    expect(shootAt(aim, band)).toBe('BODY')
    expect(shootAt(aim, aim.neck.y + 0.02)).toBe('HEAD')
  })

  /**
   * **境目は骨。** 高さを直書きすると、しゃがんだ相手 (頭 0.94m) で
   * 切れる場所がずれる。首のボーンは姿勢と一緒に動く。
   */
  test('しゃがんでも境目は首のまま', () => {
    const scene = gltf.scene.clone(true)
    const anim = new CharacterAnimator(scene, gltf.animations, 4.5)
    for (let i = 0; i < 90; i++) {
      anim.setLocomotion('crouch_idle' as never)
      anim.setAiming(false)
      anim.update(1 / 60)
    }
    scene.updateMatrixWorld(true)
    const box = new Hitbox()
    box.bind(scene)
    let neck: THREE.Object3D | null = null
    scene.traverse((o) => {
      if (!neck && o.name.endsWith('Neck')) neck = o
    })
    const at = new THREE.Vector3()
    at.setFromMatrixPosition((neck as unknown as THREE.Object3D).matrixWorld)

    const shoot = (y: number) => {
      origin.set(at.x, y, at.z + 3)
      dir.set(0, 0, -1)
      return box.raycast(origin, dir, 10)?.zone ?? 'MISS'
    }
    // しゃがむと頭は 0.95m あたりまで下がる。それでも切れるのは首
    expect(shoot(at.y - 0.05)).toBe('BODY')
    expect(shoot(at.y + 0.05)).toBe('HEAD')
  })

  /**
   * **重なった所は頭。**
   *
   * 代償として、胴を貫いた先に頭がある角度でも頭になる。弾は当たった所で
   * 止まるので厳密ではないが、「頭を撃ったのに胴になる」ほうが理不尽なので
   * そちらへ倒してある。ここが逆に倒れたらこの試験が落ちる。
   */
  test('頭と胴が重なる高さでは頭を取る', () => {
    // 胴の球の上端 (首 + 0.20) より下でも、頭の球に入っていれば頭
    const overlap = s.neck.y + 0.1
    expect(overlap).toBeLessThan(s.neck.y + 0.2)
    expect(shootFromBehind(s, overlap)).toBe('HEAD')
  })
})
