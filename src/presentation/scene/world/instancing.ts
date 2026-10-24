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
 * @returns まとめた物の数
 */
export function instanceRepeats(model: THREE.Object3D, path: (mesh: THREE.Mesh) => string): number {
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
    meshes.forEach((mesh, i) => {
      instanced.setMatrixAt(i, matrix.multiplyMatrices(toModel, mesh.matrixWorld))
      mesh.visible = false
    })
    instanced.instanceMatrix.needsUpdate = true
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
