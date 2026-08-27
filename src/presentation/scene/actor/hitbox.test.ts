import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CharacterAnimator } from './animation'
import { Hitbox } from './hitbox'

/**
 * 当たり判定。**どこを撃つとどの部位になるか。**
 *
 * --- 見えている頭と一致していること ---
 * 頭の球は手で置いた数字だった (頭ボーンから 0.08m 上、半径 0.13m)。実測すると
 * **見えている頭より 10cm 低く**、首を撃っても頭になり、頭のてっぺんは
 * 当たらなかった。「うなじの下でヘッドショットになる」という形で出た。
 *
 * 数字を置き直すのではなく、**読み込んだモデルの頭の頂点から測る**ようにした。
 * ここで見るのはその一致で、モデルを差し替えたら数字ごと追随する。
 *
 * 描画は要らない。実際の soldier.glb を読んで、実際の Hitbox を撃つ。
 */
const gltf = await new GLTFLoader().parseAsync(
  await Bun.file('public/models/soldier.glb').arrayBuffer(),
  '',
)

const origin = new THREE.Vector3()
const dir = new THREE.Vector3()

/**
 * 姿勢を落ち着かせた 1 体。骨と、**見えている頭の高さ**を一緒に返す。
 *
 * @param animate false なら束ねた姿勢のまま。**頭の高さを測るのはこちら** —
 *   three の getVertexPosition は WebGL の無い所では骨の行列を通さず、
 *   束ねた姿勢を返す。動かした姿勢と混ぜると、片方だけ動かない値を比べる
 *   ことになる (実際に 6cm ずれて見えた)。
 */
function poseOf(locomotion: string, aiming: boolean, animate = true) {
  const scene = gltf.scene.clone(true)
  const box = new Hitbox()
  box.bind(scene)

  if (animate) {
    const anim = new CharacterAnimator(scene, gltf.animations, 4.5)
    for (let i = 0; i < 90; i++) {
      anim.setLocomotion(locomotion as never)
      anim.setAiming(aiming)
      anim.update(1 / 60)
    }
  }
  scene.updateMatrixWorld(true)

  let mesh: THREE.SkinnedMesh | null = null
  const bones = new Map<string, THREE.Object3D>()
  scene.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh
    for (const name of ['Head', 'Neck', 'Hips']) {
      if (!bones.has(name) && o.name.endsWith(name)) bones.set(name, o)
    }
  })
  const boneAt = (name: string) =>
    new THREE.Vector3().setFromMatrixPosition(bones.get(name)!.matrixWorld)

  // 見えている頭の上下。**判定の正解はこれ**
  const skinned = mesh as unknown as THREE.SkinnedMesh
  const index = skinned.skeleton.bones.findIndex((b) => b.name.endsWith('Head'))
  const position = skinned.geometry.attributes.position
  const skinIndex = skinned.geometry.attributes.skinIndex
  const skinWeight = skinned.geometry.attributes.skinWeight
  const point = new THREE.Vector3()
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < position.count; i++) {
    let weight = 0
    for (let k = 0; k < 4; k++) {
      if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k)
    }
    if (weight < 0.5) continue
    skinned.getVertexPosition(i, point)
    skinned.localToWorld(point)
    low = Math.min(low, point.y)
    high = Math.max(high, point.y)
  }

  return { box, head: boneAt('Head'), neck: boneAt('Neck'), hips: boneAt('Hips'), low, high }
}

type Pose = ReturnType<typeof poseOf>

/** 背中側から水平に撃つ。高さだけを変えて部位を見る */
function shootAt(p: Pose, y: number): string {
  origin.set(p.head.x, y, p.head.z + 3)
  dir.set(0, 0, -1)
  return p.box.raycast(origin, dir, 10)?.zone ?? 'MISS'
}

describe('頭の判定は、見えている頭と一致する', () => {
  // 測るのは束ねた姿勢。球もそこで測っているので、同じ土俵で比べられる
  const standing = poseOf('idle', false, false)

  test('球の中心が、見えている頭の真ん中に来る', () => {
    const centre = new THREE.Vector3()
    standing.box.headPosition(centre)
    expect(centre.y).toBeCloseTo((standing.low + standing.high) / 2, 2)
  })

  /** 足りないと**当たったように見えて外れる**。少しだけ大きく取る */
  test('見えている頭を覆い切る。少しだけ大きい', () => {
    const centre = new THREE.Vector3()
    standing.box.headPosition(centre)
    const radius = standing.box.headRadius
    expect(centre.y - radius).toBeLessThanOrEqual(standing.low)
    expect(centre.y + radius).toBeGreaterThanOrEqual(standing.high)
    // 際限なく大きくはしない。頭の高さの 6 割を超える半径は行き過ぎ
    expect(radius).toBeLessThan((standing.high - standing.low) * 0.6)
  })

  test('頭の真ん中を撃つと HEAD', () => {
    expect(shootAt(standing, (standing.low + standing.high) / 2)).toBe('HEAD')
  })

  test('頭のてっぺん寄りも HEAD。**上が当たらないことがあった**', () => {
    expect(shootAt(standing, standing.high - 0.03)).toBe('HEAD')
  })

  /**
   * **見えている頭の下は胴。** ここが「うなじの下でヘッドショットになる」だった。
   * 球が 10cm 低くて、首の高さまで頭になっていた。
   */
  test('見えている頭より下は BODY', () => {
    expect(shootAt(standing, standing.low - 0.03)).toBe('BODY')
  })

  test('首のボーンの高さは BODY', () => {
    expect(standing.neck.y).toBeLessThan(standing.low)
    expect(shootAt(standing, standing.neck.y)).toBe('BODY')
  })

  test('胸の高さは BODY', () => {
    expect(shootAt(standing, (standing.neck.y + standing.hips.y) / 2)).toBe('BODY')
  })

  test('頭より上は外れる', () => {
    expect(shootAt(standing, standing.high + 0.1)).toBe('MISS')
  })
})

/**
 * **姿勢が変わっても付いて回る。**
 *
 * 高さを直書きすると、しゃがんだ相手 (頭 0.94m) で切れる場所がずれる。
 * 球は頭のボーンのローカルで持っているので、屈んでも見上げても頭に乗る。
 */
describe('姿勢を変えても頭に乗っている', () => {
  for (const [label, locomotion, aiming] of [
    ['構え', 'idle', true],
    ['しゃがみ', 'crouch_idle', false],
    ['しゃがみ構え', 'crouch_idle', true],
  ] as const) {
    test(`${label} でも、球が頭に乗っている`, () => {
      const p = poseOf(locomotion, aiming)
      const centre = new THREE.Vector3()
      p.box.headPosition(centre)
      // **頭のボーンより上に乗っている。** 屈んでも見上げても同じ関係が続く
      expect(centre.y).toBeGreaterThan(p.head.y)
      // 撃った結果で見る。球の下端は顎を覆うぶん首の骨より下に来ることが
      // あるので、そこは当たった点の高さで切っている (raycast)
      expect(shootAt(p, centre.y)).toBe('HEAD')
      // 首の骨のすぐ下。**ちょうどの高さは境界そのもの**なので少し下げる
      expect(shootAt(p, p.neck.y - 0.02)).toBe('BODY')
    })
  }
})

describe('頭と胴が重なったら頭', () => {
  const standing = poseOf('idle', false, false)

  /**
   * 胴の球は首を中心に半径 0.20m あるので、上端が頭へ食い込む。**近いほうが
   * 勝つ**形だと、後頭部の大半が胴になっていた (頭のボーンより 12cm 上でないと
   * HEAD にならなかった)。
   *
   * 代償として、胴を貫いた先に頭がある角度でも頭になる。弾は当たった所で
   * 止まるので厳密ではないが、「頭を撃ったのに胴になる」ほうが理不尽なので
   * そちらへ倒してある。
   */
  test('胴の球の中に居る高さでも、頭に当たれば HEAD', () => {
    const y = standing.low + 0.02
    expect(y).toBeLessThan(standing.neck.y + 0.2) // 胴の球の上端より下
    expect(shootAt(standing, y)).toBe('HEAD')
  })
})
