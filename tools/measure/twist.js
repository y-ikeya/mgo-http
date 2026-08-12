// 上半身のねじれを測る。
// 肩のライン (LeftArm→RightArm) と腰のライン (LeftUpLeg→RightUpLeg) の
// 水平角の差を取る。ボーンのローカル軸に依存しないので取り違えが起きない。
//
// 「今のコードが作る合成ポーズ」をそのまま再現して測るのが要点。
import * as THREE from 'three'

const bytes = new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())
const dv = new DataView(bytes.buffer)
const jsonLen = dv.getUint32(12, true)
const j = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
const bin = bytes.subarray(20 + jsonLen + 8)

const COMP = { SCALAR: 1, VEC3: 3, VEC4: 4 }
const readAccessor = (i) => {
  const a = j.accessors[i]
  const v = j.bufferViews[a.bufferView]
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  return new Float32Array(bin.buffer, bin.byteOffset + start, a.count * COMP[a.type])
}

const parent = new Map()
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
const nodeIndex = (suffix) =>
  j.nodes.findIndex((n) => n.name?.endsWith(suffix) && !n.name.includes('End'))

const sample = (times, values, stride, t) => {
  let i = 0
  while (i < times.length - 1 && times[i + 1] < t) i++
  const k = Math.min(i + 1, times.length - 1)
  const span = times[k] - times[i]
  const a = span > 0 ? (t - times[i]) / span : 0
  if (stride === 4) {
    const qa = new THREE.Quaternion(values[i*4], values[i*4+1], values[i*4+2], values[i*4+3])
    const qb = new THREE.Quaternion(values[k*4], values[k*4+1], values[k*4+2], values[k*4+3])
    return qa.slerp(qb, a).toArray()
  }
  return [0,1,2].map((c) => values[i*3+c] * (1 - a) + values[k*3+c] * a)
}

function poseAt(clipName, t) {
  const anim = j.animations.find((a) => a.name === clipName)
  const local = new Map()
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]
    const stride = ch.target.path === 'rotation' ? 4 : 3
    if (!local.has(ch.target.node)) local.set(ch.target.node, {})
    local.get(ch.target.node)[ch.target.path] =
      sample(readAccessor(s.input), readAccessor(s.output), stride, t)
  }
  return local
}

/** 下半身と上半身を別クリップから取る。overrideSpine で背骨に追加回転を掛ける */
function worldMatrix(index, lower, upper, upperBones, spineIndex, extraSpine) {
  const chain = []
  for (let i = index; i !== undefined; i = parent.get(i)) chain.unshift(i)
  const m = new THREE.Matrix4()
  for (const i of chain) {
    const n = j.nodes[i]
    const src = upperBones.has(i) ? upper : lower
    const r = src?.get(i)?.rotation ?? n.rotation ?? [0, 0, 0, 1]
    const p = src?.get(i)?.translation ?? n.translation ?? [0, 0, 0]
    const s = n.scale ?? [1, 1, 1]
    const q = new THREE.Quaternion(r[0], r[1], r[2], r[3])
    if (i === spineIndex && extraSpine) q.premultiply(extraSpine)
    m.multiply(new THREE.Matrix4().compose(
      new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(s[0], s[1], s[2])))
  }
  return m
}

const HIPS = nodeIndex('Hips')
const SPINE = nodeIndex('Spine')
const L_ARM = nodeIndex('LeftArm')
const R_ARM = nodeIndex('RightArm')
const L_LEG = nodeIndex('LeftUpLeg')
const R_LEG = nodeIndex('RightUpLeg')

// 上半身ボーン = Hips / UpLeg / Leg / Foot / Toe 以外 (animation.ts の LOWER_BODY_BONE と同じ)
const LOWER_RE = /Hips|UpLeg|Leg|Foot|Toe/
const upperBones = new Set(j.nodes.map((n, i) => (n.name && !LOWER_RE.test(n.name) ? i : -1)).filter((i) => i >= 0))

const pos = (m) => new THREE.Vector3().setFromMatrixPosition(m)
const horizAngle = (a, b) => Math.atan2(b.x - a.x, b.z - a.z) * 180 / Math.PI
const wrap = (d) => ((d + 540) % 360) - 180

function hipsQuatAt(clip, t) {
  const local = poseAt(clip, t)
  const r = local.get(HIPS)?.rotation ?? j.nodes[HIPS].rotation
  return new THREE.Quaternion(r[0], r[1], r[2], r[3])
}

function measure(label, lowerClip, upperClip, mode) {
  const anim = j.animations.find((a) => a.name === lowerClip)
  const dur = Math.max(...anim.samplers.map((s) => j.accessors[s.input].max[0]))
  let sum = 0
  const steps = 12
  for (let k = 0; k < steps; k++) {
    const t = (dur * k) / steps
    const lower = poseAt(lowerClip, t)
    const upperT = upperClip === lowerClip ? t : t % Math.max(...j.animations.find((a)=>a.name===upperClip).samplers.map((s) => j.accessors[s.input].max[0]))
    const upper = poseAt(upperClip, upperT)

    let extra = null
    if (mode !== 'none') {
      const ref = hipsQuatAt(upperClip, upperT)
      const cur = hipsQuatAt(lowerClip, t)
      const target = ref.clone()
      if (mode === 'rebase') {
        // クリップ固有の基準を取り除いて、リグの基準 (idle の腰) へ載せ替える
        const neutral = hipsQuatAt(upperClip, 0)
        const upright = hipsQuatAt('idle', 0)
        target.copy(upright).multiply(neutral.clone().invert()).multiply(ref)
      }
      extra = cur.clone().invert().multiply(target)
    }
    const hip = horizAngle(pos(worldMatrix(L_LEG, lower, upper, upperBones, SPINE, extra)),
                           pos(worldMatrix(R_LEG, lower, upper, upperBones, SPINE, extra)))
    const sh = horizAngle(pos(worldMatrix(L_ARM, lower, upper, upperBones, SPINE, extra)),
                          pos(worldMatrix(R_ARM, lower, upper, upperBones, SPINE, extra)))
    sum += wrap(sh - hip)
  }
  console.log(`${label.padEnd(46)} ねじれ平均 ${(sum / steps).toFixed(1).padStart(7)}°`)
}

console.log('肩のライン − 腰のライン (正=どちらかへ捻れている)\n')
measure('idle 単体 (構えの基準)', 'idle', 'idle', 'none')
measure('relaxed_idle 単体', 'relaxed_idle', 'relaxed_idle', 'none')
measure('relaxed_run 単体', 'relaxed_run', 'relaxed_run', 'none')
console.log('')
measure('走り+非構え / 補正なし', 'run_f', 'relaxed_run', 'none')
measure('走り+非構え / 現在のコード (絶対基準)', 'run_f', 'relaxed_run', 'absolute')
measure('走り+非構え / 提案 (クリップ基準を除去)', 'run_f', 'relaxed_run', 'rebase')
console.log('')
measure('静止+非構え / 現在のコード', 'idle', 'relaxed_idle', 'absolute')
measure('静止+非構え / 提案', 'idle', 'relaxed_idle', 'rebase')
