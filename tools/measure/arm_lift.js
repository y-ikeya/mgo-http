// 上腕を回したときに手がどちらへ動くかを測る。
// ボーンのローカル軸は目で分からないので、実際に回して手の移動を見る。
//
//   bun tools/measure/arm_lift.js public/models/soldier.glb crouch_aim LeftArm LeftHand
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
// extra: ノード番号 → 上乗せするクォータニオン
function world(i, local, extra) { const ch = []
  for (let k = i; k !== undefined; k = parent.get(k)) ch.unshift(k)
  const m = new THREE.Matrix4()
  for (const k of ch) { const n = j.nodes[k]
    const r = local.get(k)?.rotation ?? n.rotation ?? [0,0,0,1]
    const p = local.get(k)?.translation ?? n.translation ?? [0,0,0]
    const s = n.scale ?? [1,1,1]
    const q = new THREE.Quaternion(r[0],r[1],r[2],r[3])
    if (extra?.node === k) q.multiply(extra.q)
    m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s))) }
  return new THREE.Vector3().setFromMatrixPosition(m) }

// ワールドの XYZ ではなく、キャラから見た 右/上/前 で報告する。
// どちらへ動いたかは、ボーンの軸ではなくキャラの向きで判断したい。
function frame(local) {
  const l = world(node('LeftShoulder'), local)
  const r = world(node('RightShoulder'), local)
  const right = r.clone().sub(l).setY(0).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  return { right, up, forward: new THREE.Vector3().crossVectors(right, up).normalize() }
}

const [, , , clipName, armName, handName] = process.argv
const node = (suffix) => j.nodes.findIndex((n) => n.name?.endsWith(suffix))
const arm = node(armName), hand = node(handName), elbow = node('LeftForeArm')
const local = pose(clipName, dur(clipName) / 2)
const F = frame(local)
const base = { hand: world(hand, local), elbow: world(elbow, local) }
// 手が体の中心からどれだけ左に出ているか
const mid = world(node('Spine2'), local)
const out = base.hand.clone().sub(mid).dot(F.right) * 100
console.log(`${clipName} / ${armName} を回す`)
console.log(`基準: 手 高さ ${base.hand.y.toFixed(3)}m  体の中心から右へ ${out.toFixed(1)}cm (負なら左)\n`)
console.log('  軸  角度      手 (右,上,前 cm)          肘 (右,上,前 cm)')
const local3 = (v) => [v.dot(F.right), v.dot(F.up), v.dot(F.forward)]
const f = (v) => local3(v).map((c) => `${c >= 0 ? '+' : ''}${c.toFixed(1)}`).join(',')
for (const [name, axis] of [['X', [1,0,0]], ['Y', [0,1,0]], ['Z', [0,0,1]]]) {
  for (const deg of [15, -15]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), (deg*Math.PI)/180)
    const h = world(hand, local, { node: arm, q }).sub(base.hand).multiplyScalar(100)
    const e = world(elbow, local, { node: arm, q }).sub(base.elbow).multiplyScalar(100)
    console.log(`  ${name}  ${String(deg).padStart(4)}°   ${f(h).padEnd(24)} ${f(e)}`)
  }
}
