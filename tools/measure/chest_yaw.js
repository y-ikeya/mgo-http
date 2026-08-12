// クリップごとに、上半身チェーンのワールド yaw を時間に沿って測る。
// 「走ると上半身が左を向く」のような主観を、度数で確かめるため。
import * as THREE from 'three'

const bytes = new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())
const dv = new DataView(bytes.buffer)
const jsonLen = dv.getUint32(12, true)
const j = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
const bin = bytes.subarray(20 + jsonLen + 8)

const COMP = { SCALAR: 1, VEC3: 3, VEC4: 4 }
function readAccessor(i) {
  const a = j.accessors[i]
  const v = j.bufferViews[a.bufferView]
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const n = a.count * COMP[a.type]
  return new Float32Array(bin.buffer, bin.byteOffset + start, n)
}

const parent = new Map()
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
const byName = new Map(j.nodes.map((n, i) => [n.name, i]))

function sample(times, values, stride, t) {
  let i = 0
  while (i < times.length - 1 && times[i + 1] < t) i++
  const j2 = Math.min(i + 1, times.length - 1)
  const span = times[j2] - times[i]
  const a = span > 0 ? (t - times[i]) / span : 0
  const out = []
  for (let k = 0; k < stride; k++) out.push(values[i * stride + k] * (1 - a) + values[j2 * stride + k] * a)
  return out
}

function poseAt(clipName, t) {
  const anim = j.animations.find((a) => a.name === clipName)
  const local = new Map()
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]
    const times = readAccessor(s.input)
    const values = readAccessor(s.output)
    const stride = ch.target.path === 'rotation' ? 4 : 3
    if (!local.has(ch.target.node)) local.set(ch.target.node, {})
    local.get(ch.target.node)[ch.target.path] = sample(times, values, stride, t)
  }
  return local
}

function worldQuat(nodeIndex, local) {
  const chain = []
  for (let i = nodeIndex; i !== undefined; i = parent.get(i)) chain.unshift(i)
  const q = new THREE.Quaternion()
  for (const i of chain) {
    const n = j.nodes[i]
    const r = local.get(i)?.rotation ?? n.rotation ?? [0, 0, 0, 1]
    q.multiply(new THREE.Quaternion(r[0], r[1], r[2], r[3]))
  }
  return q
}

// クォータニオンから「正面 +Z がどちらを向いているか」の yaw を出す
function yawDeg(q) {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
  return (Math.atan2(f.x, f.z) * 180) / Math.PI
}

const BONES = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head']
const clips = process.argv.slice(3)
for (const clip of clips) {
  const anim = j.animations.find((a) => a.name === clip)
  const dur = Math.max(...anim.samplers.map((s) => j.accessors[s.input].max[0]))
  console.log(`\n--- ${clip} (${dur.toFixed(2)}s) ---`)
  const sums = BONES.map(() => 0)
  const steps = 12
  for (let k = 0; k < steps; k++) {
    const t = (dur * k) / steps
    const local = poseAt(clip, t)
    const row = BONES.map((b, bi) => {
      const idx = [...byName.keys()].find((n) => n.endsWith(b) && !n.includes('End'))
      const y = yawDeg(worldQuat(byName.get(idx), local))
      sums[bi] += y
      return y.toFixed(1).padStart(7)
    })
    console.log(`  t=${t.toFixed(2)} ` + BONES.map((b, i) => `${b}${row[i]}`).join(''))
  }
  console.log('  平均   ' + BONES.map((b, i) => `${b}${(sums[i] / steps).toFixed(1).padStart(7)}`).join(''))
}
