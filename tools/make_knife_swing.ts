// ナイフの横振り (knife_swing) を、手続きで作って glb に足す。
//
// 素材が無い動きを 1 本だけ作るための道具。Mixamo の刺突 (stab) は一撃死の
// 代わりに隙が大きい。こちらは「隙が小さい代わりに 4 発で倒れる」振り回し
// として設計した (2026-11-05)。ゲームへの接続 (入力・命中・ダメ―ジ) は
// まだ無い。まず型だけ入れて、実機で見た目を判断する。
//
// 作り方:
// - 基準ポーズは knife_idle の先頭 (ナイフを構えた姿勢)。この型のキーは
//   「構え + 世界軸まわりの回転」で組み立てる。骨のローカル軸は骨ごとに
//   向きが違うので、肩・肘を世界で回してから local に直す。
// - 体は +Z 向き、右手は -X 側。引き (右へ) → 薙ぎ (左へ) の水平振り。
// - 下半身の骨は入れない。上半身レイヤーでだけ流れる型にする
//   (CharacterAnimator の上下分離に合わせる)。
//
// 使い方: bun tools/make_knife_swing.ts <入力.glb> <出力.glb>
//   入力は meshopt 圧縮前の glb (圧縮済みは unpack_glb.js で戻す)。
//   足した後は pack_glb.js で詰め直すこと。

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'

const [srcPath, outPath] = process.argv.slice(2)
if (!outPath) throw new Error('使い方: bun tools/make_knife_swing.ts <入力.glb> <出力.glb>')

const bytes = new Uint8Array(await Bun.file(srcPath).arrayBuffer())
{
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jl = view.getUint32(12, true)
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)))
  if (head.extensionsUsed?.includes('EXT_meshopt_compression')) {
    throw new Error(`${srcPath} は meshopt 圧縮済み。unpack_glb.js で戻してから (手順は tools/README.md)`)
  }
}
const g = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
const scene = g.scene

// --- 基準ポーズ ---
const idle = g.animations.find((c) => c.name === 'knife_idle')
if (!idle) throw new Error('knife_idle が無い')
const bones = new Map<string, THREE.Object3D>()
scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o) })
const baseLocal = new Map<string, THREE.Quaternion>()
for (const t of idle.tracks) {
  if (!t.name.endsWith('.quaternion')) continue
  const bone = bones.get(t.name.split('.')[0])
  if (!bone) continue
  const q = new THREE.Quaternion(t.values[0], t.values[1], t.values[2], t.values[3])
  bone.quaternion.copy(q)
  baseLocal.set(bone.name, q.clone())
}
scene.updateMatrixWorld(true)
const baseWorld = new Map<string, THREE.Quaternion>()
for (const [name, b] of bones) {
  const q = new THREE.Quaternion()
  b.getWorldQuaternion(q)
  baseWorld.set(name, q)
}

// --- キーポーズ (世界軸まわりの回転・度) ---
// 0.48 秒。引き 0.10 / 振り抜き 0.23 (ここが当たる所) / 抜け 0.30 / 戻し 0.48。
// stab (2.37 秒) と比べて戻しまでが速い = 隙が小さい、がこの型の設計。
type Pose = Record<string, [number, number, number]>
const KEYS: { t: number; pose: Pose }[] = [
  { t: 0.0, pose: {} },
  { t: 0.1, pose: {
      mixamorigSpine2: [0, 14, 0], mixamorigRightShoulder: [0, 0, 6],
      mixamorigRightArm: [-8, -18, -62], mixamorigRightForeArm: [0, 0, -38],
      mixamorigRightHand: [0, 0, -10] } },
  { t: 0.23, pose: {
      mixamorigSpine2: [0, -22, 0], mixamorigRightShoulder: [0, 0, 2],
      mixamorigRightArm: [4, 52, -74], mixamorigRightForeArm: [0, 0, -6],
      mixamorigRightHand: [0, 0, 14] } },
  { t: 0.3, pose: {
      mixamorigSpine2: [0, -26, 0],
      mixamorigRightArm: [4, 60, -70], mixamorigRightForeArm: [0, 0, -10],
      mixamorigRightHand: [0, 0, 14] } },
  { t: 0.48, pose: {} },
]
const TARGETS = ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2', 'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand']
function poseFor(bone: string, pose: Pose): [number, number, number] {
  // 背骨のひねりは 3 本に配る (根元ほど小さく)
  if (bone === 'mixamorigSpine') return (pose.mixamorigSpine2 ?? [0, 0, 0]).map((v) => v * 0.3) as [number, number, number]
  if (bone === 'mixamorigSpine1') return (pose.mixamorigSpine2 ?? [0, 0, 0]).map((v) => v * 0.6) as [number, number, number]
  return pose[bone] ?? [0, 0, 0]
}
const D2R = Math.PI / 180
function localQuatAt(boneName: string, pose: Pose): THREE.Quaternion {
  const bone = bones.get(boneName)!
  const parentWorld = new THREE.Quaternion()
  bone.parent!.getWorldQuaternion(parentWorld)
  const [x, y, z] = poseFor(boneName, pose)
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D2R, y * D2R, z * D2R, 'YXZ'))
  const world = delta.multiply(baseWorld.get(boneName)!)
  return parentWorld.invert().multiply(world)
}
function samplePose(t: number): Pose {
  let a = KEYS[0], b = KEYS[KEYS.length - 1]
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break }
  }
  const span = b.t - a.t
  let f = span === 0 ? 0 : (t - a.t) / span
  f = f * f * (3 - 2 * f) // 緩急
  const out: Pose = {}
  for (const n of new Set([...Object.keys(a.pose), ...Object.keys(b.pose)])) {
    const pa = a.pose[n] ?? [0, 0, 0], pb = b.pose[n] ?? [0, 0, 0]
    out[n] = [0, 1, 2].map((i) => pa[i] + (pb[i] - pa[i]) * f) as [number, number, number]
  }
  return out
}
const FPS = 60, DUR = 0.48
const frames = Math.round(DUR * FPS) + 1
const times: number[] = []
const trackValues = new Map<string, number[]>(TARGETS.map((b) => [b, []]))
for (let fr = 0; fr < frames; fr++) {
  times.push(fr / FPS)
  const pose = samplePose(fr / FPS)
  for (const name of TARGETS) {
    const q = localQuatAt(name, pose)
    trackValues.get(name)!.push(q.x, q.y, q.z, q.w)
    bones.get(name)!.quaternion.copy(q)
    bones.get(name)!.updateWorldMatrix(true, false)
  }
  for (const [name, q] of baseLocal) bones.get(name)!.quaternion.copy(q)
  scene.updateMatrixWorld(true)
}

// --- glb へ足す (merge_clip.js と同じ組み直し) ---
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
const binStart = 20 + jsonLength + 8
const binLength = view.getUint32(20 + jsonLength, true)
const bin = bytes.subarray(binStart, binStart + binLength)
if (json.animations?.some((a: { name: string }) => a.name === 'knife_swing')) throw new Error('knife_swing は既にある')
const nodeByName = new Map<string, number>(json.nodes.map((n: { name: string }, i: number) => [n.name, i]))
const appended: Uint8Array[] = []
let addedLength = 0
function appendAccessor(data: Float32Array, type: 'SCALAR' | 'VEC4'): number {
  const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const pad = (4 - (addedLength % 4)) % 4
  if (pad) { appended.push(new Uint8Array(pad)); addedLength += pad }
  const byteOffset = binLength + addedLength
  appended.push(raw); addedLength += raw.byteLength
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: raw.byteLength })
  const size = { SCALAR: 1, VEC4: 4 }[type]
  const extra = type === 'SCALAR' ? { min: [Math.min(...data)], max: [Math.max(...data)] } : {}
  json.accessors.push({ bufferView: json.bufferViews.length - 1, byteOffset: 0, componentType: 5126, count: data.length / size, type, ...extra })
  return json.accessors.length - 1
}
const timesAcc = appendAccessor(new Float32Array(times), 'SCALAR')
const channels: unknown[] = [], samplers: unknown[] = []
for (const [bone, values] of trackValues) {
  const node = nodeByName.get(bone.replace('mixamorig', 'mixamorig:'))
  if (node === undefined) throw new Error(`骨が無い: ${bone}`)
  const outAcc = appendAccessor(new Float32Array(values), 'VEC4')
  samplers.push({ input: timesAcc, output: outAcc, interpolation: 'LINEAR' })
  channels.push({ sampler: samplers.length - 1, target: { node, path: 'rotation' } })
}
json.animations.push({ name: 'knife_swing', channels, samplers })
json.buffers[0].byteLength = binLength + addedLength
let jsonBytes = new TextEncoder().encode(JSON.stringify(json))
while (jsonBytes.length % 4) jsonBytes = Uint8Array.from([...jsonBytes, 0x20])
const total = 12 + 8 + jsonBytes.length + 8 + binLength + addedLength
const out = new Uint8Array(total)
const dv = new DataView(out.buffer)
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true)
dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true)
out.set(jsonBytes, 20)
let off = 20 + jsonBytes.length
dv.setUint32(off, binLength + addedLength, true); dv.setUint32(off + 4, 0x004e4942, true)
out.set(bin, off + 8)
off += 8 + binLength
for (const chunk of appended) { out.set(chunk, off); off += chunk.byteLength }
await Bun.write(outPath, out)
console.log(`knife_swing を足した: ${outPath} (${(total / 1e6).toFixed(2)}MB)`)
