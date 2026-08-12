// クリップの中で腰と頭の高さがどう動くかを追う。
// 倒れて終わるのか、立って終わるのかを目で確かめずに判定するため。
import * as THREE from 'three'
const bytes = new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())
const dv = new DataView(bytes.buffer); const jl = dv.getUint32(12, true)
const j = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)))
const bin = bytes.subarray(20 + jl + 8)
const C = { SCALAR: 1, VEC3: 3, VEC4: 4 }
const acc = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]
  return new Float32Array(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * C[a.type]) }
const parent = new Map(); j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
const smp = (T, V, st, t) => { let i = 0; while (i < T.length - 1 && T[i+1] < t) i++
  const k = Math.min(i+1, T.length-1), sp = T[k]-T[i], a = sp>0 ? (t-T[i])/sp : 0
  if (st === 4) return new THREE.Quaternion(V[i*4],V[i*4+1],V[i*4+2],V[i*4+3])
    .slerp(new THREE.Quaternion(V[k*4],V[k*4+1],V[k*4+2],V[k*4+3]), a).toArray()
  return [0,1,2].map((c) => V[i*3+c]*(1-a) + V[k*3+c]*a) }
const clip = (n) => j.animations.find((a) => a.name === n)
const dur = (n) => Math.max(...clip(n).samplers.map((s) => j.accessors[s.input].max[0]))
function pose(name, t) { const local = new Map()
  for (const ch of clip(name).channels) { const s = clip(name).samplers[ch.sampler]
    const st = ch.target.path === 'rotation' ? 4 : 3
    if (!local.has(ch.target.node)) local.set(ch.target.node, {})
    local.get(ch.target.node)[ch.target.path] = smp(acc(s.input), acc(s.output), st, t) }
  return local }
function world(i, local) { const ch = []
  for (let k = i; k !== undefined; k = parent.get(k)) ch.unshift(k)
  const m = new THREE.Matrix4()
  for (const k of ch) { const n = j.nodes[k]
    const r = local.get(k)?.rotation ?? n.rotation ?? [0,0,0,1]
    const p = local.get(k)?.translation ?? n.translation ?? [0,0,0]
    const s = n.scale ?? [1,1,1]
    m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...p),
      new THREE.Quaternion(r[0],r[1],r[2],r[3]), new THREE.Vector3(...s))) }
  return new THREE.Vector3().setFromMatrixPosition(m) }

const hips = j.nodes.findIndex((n) => n.name?.endsWith('Hips'))
const head = j.nodes.findIndex((n) => n.name?.endsWith('Head'))
for (const name of process.argv.slice(3)) {
  if (!clip(name)) { console.log(`${name}: 無い`); continue }
  const D = dur(name)
  console.log(`\n${name}  ${D.toFixed(2)}秒`)
  console.log('   時刻     腰      頭')
  for (let k = 0; k <= 10; k++) {
    const t = (D * k) / 10, local = pose(name, t)
    const h = world(hips, local).y, hd = world(head, local).y
    console.log(`  ${t.toFixed(2)}s  ${h.toFixed(2)}m  ${hd.toFixed(2)}m  ${'█'.repeat(Math.round(hd * 8))}`)
  }
}
