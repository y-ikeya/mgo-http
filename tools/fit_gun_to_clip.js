// 型の中で銃が置かれている場所へ、ゲームの銃を合わせる数値を出す。
//
//   $BLENDER -b --factory-startup --python tools/dump_clip_gun.py -- \
//       ~/Downloads/proneFire.fbx Object_46 "mixamorig:LeftHand" /tmp/clip_gun.json
//   bun tools/fit_gun_to_clip.js /tmp/clip_gun.json public/models/sniper.glb
//
// 出た値を weapon.ts の boltHold へ写す。
//
// --- なぜ要るか ---
// 動きを作る側は、銃を骨に付けて**目で合わせて**いる。そこがいちばん正しい。
// ところがゲームの銃は別のファイルで、**銃口を決まった座標へ揃えて**ある
// (convert_gltf_gun.py)。原点が違うので、型の中の位置をそのまま写せない。
//
// --- なぜ three で読むか ---
// **Blender で銃を読んではいけない。** glTF を読むときに軸を Z 上へ直すので、
// そこで 90° 入る。ゲームは three で読んでいるので、同じ読み方で測らないと
// **銃が上を向く** (実際にそうなった)。
//
// 型側 (骨から見た座標) は変換に依らないので、そちらは Blender で出してよい。
//
// --- どう合わせるか ---
// 同じ銃なら**頂点の数も順番も同じ**なので、1 対 1 で対応が付く。そこから
// 回す量と寄せる量を厳密に解ける (Kabsch)。主軸から出すやり方は軸の向きが
// 決まらず、当てに行くと外れる。

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const [clipPath, gunPath] = process.argv.slice(2)
if (!gunPath) {
  console.error('引数: <型の銃.json> <ゲームの銃.glb>')
  process.exit(1)
}

const flat = JSON.parse(await Bun.file(clipPath).text())
const target = []
for (let i = 0; i < flat.length; i += 3) {
  target.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]))
}

const gltf = await new GLTFLoader().parseAsync(await Bun.file(gunPath).arrayBuffer(), '')
const root = gltf.scene
root.updateMatrixWorld(true)
// **根から見た座標。** ゲームで骨に付くのはこの根 (weapon.object)
const fromRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
const source = []
const scratch = new THREE.Vector3()
root.traverse((o) => {
  if (!o.isMesh) return
  const pos = o.geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    scratch.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(fromRoot)
    source.push(scratch.clone())
  }
})

console.log(`  型 ${target.length} 頂点 / 銃 ${source.length} 頂点`)
if (source.length !== target.length) {
  console.error('  **頂点数が違う。** 同じ銃を焼いていないか、書き出しで変わっている')
  process.exit(1)
}

const centre = (points) =>
  points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length)
const cs = centre(source.map((p) => p.clone()))
const cd = centre(target.map((p) => p.clone()))
const a = source.map((p) => p.clone().sub(cs))
const b = target.map((p) => p.clone().sub(cd))
const spread = (points) =>
  Math.sqrt(points.reduce((sum, p) => sum + p.lengthSq(), 0) / points.length)
const scale = spread(b) / spread(a)

// 相互共分散
const h = new Array(9).fill(0)
for (let i = 0; i < a.length; i++) {
  const p = a[i]
  const q = b[i]
  h[0] += p.x * q.x
  h[1] += p.x * q.y
  h[2] += p.x * q.z
  h[3] += p.y * q.x
  h[4] += p.y * q.y
  h[5] += p.y * q.z
  h[6] += p.z * q.x
  h[7] += p.z * q.y
  h[8] += p.z * q.z
}
// 極分解を反復で取り出す。R <- (R + R^-T) / 2 が直交行列へ寄る
const turn = new THREE.Matrix3().set(h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8])
for (let k = 0; k < 80; k++) {
  const inverse = turn.clone().invert().transpose()
  const e = turn.elements
  const f = inverse.elements
  for (let i = 0; i < 9; i++) e[i] = (e[i] + f[i]) / 2
}
const quaternion = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().setFromMatrix3(turn),
)
const position = cd.clone().sub(cs.clone().applyQuaternion(quaternion).multiplyScalar(scale))

let worst = 0
const moved = new THREE.Vector3()
for (let i = 0; i < source.length; i++) {
  moved.copy(source[i]).applyQuaternion(quaternion).multiplyScalar(scale).add(position)
  worst = Math.max(worst, moved.distanceTo(target[i]))
}

console.log(`  一番大きいずれ ${worst.toFixed(5)} (骨の単位)`)
console.log()
console.log('  --- weapon.ts の boltHold へ写す ---')
console.log(
  `  position: new THREE.Vector3(${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)}),`,
)
console.log(
  `  quaternion: new THREE.Quaternion(${quaternion.x.toFixed(5)}, ${quaternion.y.toFixed(5)}, ${quaternion.z.toFixed(5)}, ${quaternion.w.toFixed(5)}),`,
)
console.log(`  scale: ${scale.toFixed(4)},`)
