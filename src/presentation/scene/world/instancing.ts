import * as THREE from 'three'
import { isMesh } from '../util/guards'
import { STATIC_SHADOW_LAYER } from './liveShadow'

/**
 * **同じ形の置き物を 1 回の描画でまとめて描く** (2026-10-23 本人「土嚢と木箱やってみようか」)。
 *
 * Blender で参照コピーした物は glb の中で形を共有しているが、three は物 1 つにつき
 * 1 回描く。city では土嚢の部品が数十個ずつ、木箱が 43 個並んでいて、その数だけ描いていた。
 * 同じ形・同じ材質の物を InstancedMesh 1 つに写して、まとめて 1 回で描く。
 *
 * **元の物は見えなくして残す。** 弾・投げた物・カメラの判定は元の物に光線を当てて取る
 * (three の光線は見えるかを見ない)。描くのだけを InstancedMesh が受け持つ。
 */
/** まとめる物 (物の名前、親の名前を含む)。土嚢と木箱 */
const INSTANCED = /(^|\/)(sand_bag|wood_box)/
/** これより少なければまとめない (まとめても描く回数がほとんど減らない) */
const MIN_COPIES = 3

/**
 * @param path 物の名前 (親からの道筋、stage.ts の札の読み方と同じ)
 * @param brightness 置き場所ごとの明るさ (0〜1)。渡されればコピーごとに色として掛ける。
 *
 * **形を共有する物は頂点の「空の見え方」を持てない。** 焼き込み (tools/bake_stage.py) は
 * 置き場所ごとに違う値を頂点へ入れるので、共有した形には書けない (shared() が外している)。
 * その代わり、まとめた物はコピーごとに色を掛けられる (instanceColor)。物の内側の
 * 濃淡は付けられないが、置き物は小さいので、置き場所の明るさを 1 つ掛けるだけで
 * 「同じ場所の物は同じように沈む」になる。値の測り方は呼び出し側 (stage.ts) が持ち、
 * ここは掛けるだけ。
 * @returns まとめた物の数
 */
export function instanceRepeats(
  model: THREE.Object3D,
  path: (mesh: THREE.Mesh) => string,
  brightness?: (mesh: THREE.Mesh) => number,
): number {
  model.updateMatrixWorld(true)
  const groups = new Map<string, THREE.Mesh[]>()
  model.traverse((obj) => {
    if (!isMesh(obj) || !obj.visible || Array.isArray(obj.material)) return
    if (!INSTANCED.test(path(obj))) return
    const key = `${obj.geometry.uuid}/${obj.material.uuid}`
    const list = groups.get(key)
    if (list) list.push(obj)
    else groups.set(key, [obj])
  })
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert()
  const matrix = new THREE.Matrix4()
  let merged = 0
  for (const meshes of groups.values()) {
    if (meshes.length < MIN_COPIES) continue
    const first = meshes[0]
    const instanced = new THREE.InstancedMesh(first.geometry, first.material, meshes.length)
    instanced.name = `${first.name}_instanced`
    const shade = new THREE.Color()
    meshes.forEach((mesh, i) => {
      instanced.setMatrixAt(i, matrix.multiplyMatrices(toModel, mesh.matrixWorld))
      if (brightness) {
        const value = Math.min(1, Math.max(0, brightness(mesh)))
        instanced.setColorAt(i, shade.setScalar(value))
      }
      mesh.visible = false
    })
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
    instanced.castShadow = first.castShadow
    instanced.receiveShadow = first.receiveShadow
    // 街の影の地図に焼く層も写す (world/liveShadow.ts)
    if (first.layers.isEnabled(STATIC_SHADOW_LAYER)) instanced.layers.enable(STATIC_SHADOW_LAYER)
    // 見えない所を省くための球は、全部の置き場所を包む物にする
    instanced.computeBoundingSphere()
    model.add(instanced)
    merged += meshes.length
  }
  return merged
}
