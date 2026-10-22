import * as THREE from 'three'
import { min, shadow } from 'three/tsl'
import type { Node } from 'three/webgpu'

/**
 * **人の影も本物の影で落とす** (2026-10-22 本人「player の影だけは毎回 render するようにしてみよう、一回」)。
 *
 * 足元の丸い影 (actor/blobShadow.ts) は 1 点から貼る絵なので、高台の縁で影が割れずに
 * まとめて滑った。影の地図 (太陽から見た深さ) に人を描き込めば、床の 1 点ずつが
 * 「太陽との間に体があるか」を見るので、縁では足の側が上の床に、上の側が下の階に落ちる。
 *
 * --- 影の地図を 2 枚に分ける ---
 * 街の影の地図 (2048²、ステージ全体) は 1 度だけ焼く (staticShadow.ts)。毎フレーム描き直すと、
 * 街を 1 つにまとめても (三角 52 万) city で 120 → 55fps に落ちた。
 *
 * 人の影は**別の小さな地図** (MOVING_MAP_SIZE²、自分の周り MOVING_RADIUS m) に、人だけを毎フレーム
 * 描く。床はその点で 2 枚の地図を両方見て、暗いほうを採る (sun.shadow.shadowNode)。
 *
 * どちらの地図に描かれるかは**層**で分ける: 街と置いた物は STATIC_SHADOW_LAYER、
 * 人と人が持ち運ぶ物は MOVING_SHADOW_LAYER。画面のカメラは層 0 を見る
 */
export const STATIC_SHADOW_LAYER = 2
export const MOVING_SHADOW_LAYER = 3

/** 人の足元の丸い影を出さない (本物の影が落ちるので二重になる)。試しなので戻せるように 1 か所で切る */
export const LIVE_PLAYER_SHADOWS = true

/** 人の影の地図が写す範囲 (自分から m)。この外の人は影を落とさない */
const MOVING_RADIUS = 30
/** 人の影の地図の画素数。60m を 1024 で 1 画素 5.9cm (街の地図 2048 とほぼ同じ細かさ、2026-10-22 本人) */
const MOVING_MAP_SIZE = 1024

/** 街・置いた物。**動かない**ので街の地図に焼く (置いた / 消えた時に焼き直す、staticShadow.ts) */
export function castStaticShadow(root: THREE.Object3D): void {
  castOn(root, STATIC_SHADOW_LAYER)
}

/** 人と、人が持ち運ぶ物。**毎フレーム**人の地図に描く */
export function castMovingShadow(root: THREE.Object3D): void {
  castOn(root, MOVING_SHADOW_LAYER)
}

function castOn(root: THREE.Object3D, layer: number): void {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return
    obj.castShadow = true
    obj.layers.enable(layer)
  })
}

/**
 * 人の影の地図を持つ光。**場面には入れない** (明るさには足さない)。
 *
 * 地図を太陽そのものに 2 枚付けると、床が地図を読む座標の行列 (lightShadowMatrix) が
 * **光ごとに 1 つ**なので、人の地図も街の地図の行列で読まれて影が出なかった。光を分けて、
 * 向きだけ太陽に揃える (followMovingShadow)
 */
const movingLights = new WeakMap<THREE.DirectionalLight, THREE.DirectionalLight>()

/**
 * 太陽に人の影の地図を足す。**buildLights で 1 度。** 街の地図は 1 度焼き、人の地図は毎フレーム描く。
 * 床は 2 枚の暗いほうを採る
 */
export function addMovingShadow(sun: THREE.DirectionalLight): void {
  sun.shadow.camera.layers.set(STATIC_SHADOW_LAYER)
  const light = new THREE.DirectionalLight()
  light.castShadow = true
  light.shadow = sun.shadow.clone() as THREE.DirectionalLightShadow
  const moving = light.shadow
  moving.mapSize.set(MOVING_MAP_SIZE, MOVING_MAP_SIZE)
  moving.autoUpdate = true
  moving.camera.layers.set(MOVING_SHADOW_LAYER)
  moving.normalBias = ((MOVING_RADIUS * 2) / MOVING_MAP_SIZE) * 1.5
  moving.bias = sun.shadow.bias
  moving.intensity = sun.shadow.intensity
  movingLights.set(sun, light)
  // 型の上では ShadowNode は影の色 (vec3) の Node と見なされないので、渡す所で読み替える
  const fixed = shadow(sun) as unknown as Node<'vec3'>
  const people = shadow(light) as unknown as Node<'vec3'>
  sun.shadow.shadowNode = min(fixed, people)
}

const view = new THREE.Matrix4()
const at = new THREE.Vector3()

/**
 * 人の地図の光を太陽に揃え、枠を**自分の周りへ寄せる。毎フレーム。** 光の向きは街の地図と同じで、
 * 枠 (光から見た上下左右) だけ動かす。奥行きは街の地図と同じ (光から街の一番奥まで)
 */
export function followMovingShadow(sun: THREE.DirectionalLight, x: number, y: number, z: number): void {
  const light = movingLights.get(sun)
  if (!light) return
  light.position.copy(sun.position)
  light.target.position.copy(sun.target.position)
  light.updateMatrixWorld()
  light.target.updateMatrixWorld()
  view.lookAt(light.position, light.target.position, THREE.Object3D.DEFAULT_UP)
  view.setPosition(light.position)
  view.invert()
  at.set(x, y, z).applyMatrix4(view)
  const cam = light.shadow.camera
  cam.left = at.x - MOVING_RADIUS
  cam.right = at.x + MOVING_RADIUS
  cam.bottom = at.y - MOVING_RADIUS
  cam.top = at.y + MOVING_RADIUS
  cam.near = sun.shadow.camera.near
  cam.far = sun.shadow.camera.far
  cam.updateProjectionMatrix()
}
