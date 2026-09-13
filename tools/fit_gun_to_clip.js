// 型の中で銃が置かれている場所を、ゲームの骨の空間で出す。
//
//   $BLENDER -b --factory-startup --python tools/dump_clip_gun.py -- \
//       ~/Downloads/chrouchFire.fbx Object_46 /tmp/gun.json
//   bun tools/fit_gun_to_clip.js ~/Downloads/chrouchFire.fbx mixamorigRightHand \
//       /tmp/gun.json public/models/sniper.glb
//
// --- なぜ要るか ---
// 動きを作る側は、銃を骨に付けて**目で合わせて**いる。そこがいちばん正しい。
// ところがゲームの銃は別のファイルで、銃口を決まった座標へ揃えてある
// (convert_gltf_gun.py)。原点が違うので、型の中の位置をそのまま写せない。
//
// --- なぜ Blender で場所を測らないか ---
// Blender は FBX も glTF も**自分の流儀に直して**取り込む。軸 (Y 上 -> Z 上) も
// 骨の向き (骨に沿って Y) もそう。どちらもゲーム (three) の読み方とは別物なので、
// Blender で測った「骨から見た位置」を three の骨に置くと**銃が上を向く**
// (実際にそうなった)。Blender から貰うのは**形だけ** — 行列を通らない生の頂点。
//
// --- 段取り ---
//   M  ゲームの銃 -> 型の銃      同じ形どうしを重ねて求める (Kabsch)
//   L  型の銃 -> 型の骨          型を three で読んで、そのまま読み取る
//   C  型の骨 -> ゲームの骨      同じ骨格なので、T ポーズどうしを重ねて求める
// 出すのは C・L・M をこの順に掛けたもの。ゲームの骨にこれを置けば型に重なる。

import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/*
 * FBXLoader は貼り絵を読むのに img を作る。形しか要らないので空で通す。
 *
 * **読み終えたら必ず消す。** 置いたままだと GLTFLoader が「画面がある」と
 * 見なして画像の読み込みを待ち、返ってこない (10 分待った)。
 */
const withDocument = (run) => {
  globalThis.document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }),
    createElement: () => ({ getContext: () => null, style: {} }),
  }
  try {
    return run()
  } finally {
    delete globalThis.document
  }
}

const [clipPath, boneName, rawPath, gunPath, bodyPath = 'public/models/soldier.glb'] =
  process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!gunPath) {
  console.error('引数: <型.fbx> <骨の名前> <型の銃の形.json> <ゲームの銃.glb> [キャラ.glb]')
  process.exit(1)
}

/** 同じ形の点どうしを重ねる変換を求める。並び順が同じ前提 */
function fit(source, target) {
  const centre = (points) =>
    points.reduce((sum, p) => sum.add(p.clone()), new THREE.Vector3()).multiplyScalar(1 / points.length)
  const cs = centre(source)
  const cd = centre(target)
  const a = source.map((p) => p.clone().sub(cs))
  const b = target.map((p) => p.clone().sub(cd))
  const spread = (points) => Math.sqrt(points.reduce((sum, p) => sum + p.lengthSq(), 0) / points.length)
  const scale = spread(b) / spread(a)

  const h = new Array(9).fill(0)
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    h[0] += p.x * q.x; h[1] += p.x * q.y; h[2] += p.x * q.z
    h[3] += p.y * q.x; h[4] += p.y * q.y; h[5] += p.y * q.z
    h[6] += p.z * q.x; h[7] += p.z * q.y; h[8] += p.z * q.z
  }
  // 極分解を反復で取り出す。R <- (R + R^-T) / 2 が直交行列へ寄る
  const turn = new THREE.Matrix3().set(h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8])
  for (let k = 0; k < 80; k++) {
    const inverse = turn.clone().invert().transpose()
    const e = turn.elements
    const f = inverse.elements
    for (let i = 0; i < 9; i++) e[i] = (e[i] + f[i]) / 2
  }
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(turn))
  const position = cd.clone().sub(cs.clone().applyQuaternion(quaternion).multiplyScalar(scale))

  let worst = 0
  const moved = new THREE.Vector3()
  for (let i = 0; i < source.length; i++) {
    moved.copy(source[i]).applyQuaternion(quaternion).multiplyScalar(scale).add(position)
    worst = Math.max(worst, moved.distanceTo(target[i]))
  }
  const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale))
  return { matrix, position, quaternion, scale, worst }
}

/** 根から見た頂点 (glb)。ゲームで骨に付くのはこの根 */
function verticesOf(root) {
  root.updateMatrixWorld(true)
  const fromRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const out = []
  const scratch = new THREE.Vector3()
  root.traverse((o) => {
    if (!o.isMesh) return
    const pos = o.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      scratch.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(fromRoot)
      out.push(scratch.clone())
    }
  })
  return out
}

const loadGlb = async (path) =>
  (await new GLTFLoader().parseAsync(await Bun.file(path).arrayBuffer(), '')).scene

// --- M: ゲームの銃 -> 型の銃 ---
const flat = JSON.parse(await Bun.file(rawPath).text())
const raw = []
for (let i = 0; i < flat.length; i += 3) raw.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]))
const gun = await loadGlb(gunPath)
const mine = verticesOf(gun)
console.log(`  銃 ${mine.length} 頂点 / 型の銃 ${raw.length} 頂点`)
if (mine.length !== raw.length) {
  console.error('  **頂点数が違う。** 同じ銃を焼いていないか、書き出しで変わっている')
  process.exit(1)
}
const m = fit(mine, raw)
console.log(`  M 重ね合わせのずれ ${m.worst.toFixed(5)}`)

// --- L: 型の銃 -> 型の骨 ---
const clipBuffer = await Bun.file(clipPath).arrayBuffer()
const clip = withDocument(() => new FBXLoader().parse(clipBuffer, ''))
/*
 * 型を流した**途中の姿勢**で測りたいときは take と秒を渡す。
 *
 *     bun tools/fit_gun_to_clip.js ... --at=2,0.83
 *
 * 渡さなければファイルに入っている姿勢のまま。銃と手の関係は姿勢に依らないので
 * 置き場所の答えは変わらないが、銃身の角度は姿勢で変わる。
 */
const askedAt = process.argv.find((a) => a.startsWith('--at='))
if (askedAt) {
  const [take, second] = askedAt.slice(5).split(',').map(Number)
  const action = clip.animations[take - 1]
  if (action) {
    const mixer = new THREE.AnimationMixer(clip)
    mixer.clipAction(action).play()
    mixer.update(Math.min(second, action.duration - 0.001))
    console.log(`  ${take} 本目を ${second} 秒で止めて測る`)
  }
}
clip.updateMatrixWorld(true)
const clipBone = clip.getObjectByName(boneName)
// **骨に直付けされているメッシュが銃。** 体のメッシュが一緒に焼いてある型も
// あるので、最初に見つけたものを取ってはいけない (伏せの型がそれで、2m の銃に
// なった)
const clipGun = (() => {
  let found = null
  clip.traverse((o) => {
    if (!found && o.isMesh && o.parent?.isBone) found = o
  })
  return found
})()
if (!clipBone || !clipGun) {
  console.error(`  型の中に ${!clipBone ? '骨 ' + boneName : '銃'} が無い`)
  process.exit(1)
}
const l = new THREE.Matrix4().copy(clipBone.matrixWorld).invert().multiply(clipGun.matrixWorld)

/*
 * --- C: 型の骨 -> ゲームの骨 ---
 *
 * 同じ骨でも**座標系の向きは揃っていない。** 型は FBX のまま読んでいて、
 * ゲームのキャラは Blender を通して書き出してある。Blender は骨を自分の流儀
 * (骨に沿って Y) に直すので、名前が同じでも軸が別を向いている。
 *
 * **指の付け根で繋ぐ。** 手の子である 5 本の付け根は、指をどう曲げても手から
 * 見た位置が変わらない (子の回転は自分の根元を動かさない)。つまり姿勢に
 * よらず手に貼り付いている点で、両方の骨格で同じ場所を指す。そこを重ねれば、
 * 手に付いている物をそのまま移せる。
 *
 * 全身の骨で重ねてはいけない — 型は動いている姿勢、キャラは素の姿勢なので、
 * 別の形どうしを重ねることになる (実際にやって 1.2 のずれが出た)。
 */
const body = await loadGlb(bodyPath)
body.updateMatrixWorld(true)
const bonesOf = (root) => {
  const map = new Map()
  root.traverse((o) => {
    if (o.isBone) map.set(o.name.replace(':', ''), o)
  })
  return map
}
const bodyBones = bonesOf(body)
const bodyBone = bodyBones.get(boneName.replace(':', ''))
if (!bodyBone) {
  console.error(`  ゲームのキャラに骨 ${boneName} が無い`)
  process.exit(1)
}
const at = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
const anchors = [clipBone, ...clipBone.children.filter((o) => o.isBone)]
  .map((o) => [o, bodyBones.get(o.name.replace(':', ''))])
  .filter(([, twin]) => twin)
if (anchors.length < 4) {
  console.error(`  ${boneName} に繋げる子の骨が足りない (${anchors.length})`)
  process.exit(1)
}
const g = fit(anchors.map(([o]) => at(o)), anchors.map(([, twin]) => at(twin)))
console.log(`  指の付け根 ${anchors.length} 点で繋いだ。ずれ ${g.worst.toFixed(4)} / 倍率 ${g.scale.toFixed(5)}`)
const c = new THREE.Matrix4()
  .copy(bodyBone.matrixWorld)
  .invert()
  .multiply(g.matrix)
  .multiply(clipBone.matrixWorld)

// --- 出す ---
const a = new THREE.Matrix4().multiplyMatrices(c, l).multiply(m.matrix)
const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const scale = new THREE.Vector3()
a.decompose(position, quaternion, scale)

/*
 * 型の中で銃身がどこを向いているか。**作った側が水平に置いたかどうか**が
 * これで分かる。ゲーム側は試写 (weapon.html) が同じ数字を出すので、突き合わせる。
 */
{
  const inClip = new THREE.Matrix4().multiplyMatrices(clipGun.matrixWorld, m.matrix)
  const q = new THREE.Quaternion()
  inClip.decompose(new THREE.Vector3(), q, new THREE.Vector3())
  const barrel = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
  console.log(`  型の中の銃身 ${((Math.asin(barrel.y / barrel.length()) * 180) / Math.PI).toFixed(1)} 度 (0 が水平)`)
}

const turn = new THREE.Euler().setFromQuaternion(quaternion)
const deg = (r) => ((r * 180) / Math.PI).toFixed(1)
console.log()
console.log(`  --- ${boneName} の空間で、銃をここへ置く ---`)
console.log(
  `  position: new THREE.Vector3(${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)}),`,
)
console.log(
  `  quaternion: new THREE.Quaternion(${quaternion.x.toFixed(5)}, ${quaternion.y.toFixed(5)}, ${quaternion.z.toFixed(5)}, ${quaternion.w.toFixed(5)}),`,
)
console.log(`  scale: ${scale.x.toFixed(4)},`)
console.log(`  (向きは ${deg(turn.x)}, ${deg(turn.y)}, ${deg(turn.z)} 度)`)
