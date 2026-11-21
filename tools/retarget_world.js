// Blender で書き出した型を、**体ごとの骨の休みの向きに合わせて**写し直す (世界での曲がりを写す)。
//
//     bun tools/retarget_world.js <体.glb (圧縮前)> <型.glb (Blender の書き出し)> <出力.glb>
//
// 出力は <型.glb> と同じ形で、回りの値だけを「その体の骨の局所の回り」に置き換えた物。
// そのあと merge_clip.js --rotation-only で体へ入れる。
//
// --- なぜ要るか (2026-11-20 本人「stand ak relax の左手が game と blender で違う」) ---
// merge_clip.js --rotation-only は骨の局所の回り (親から見た向き) をそのまま写す。体どうしで骨の休みの向きが
// 違うと、同じ値でも違う姿勢になる。Freya の骨格で作った AK の見本を写したら、Freya でも右手が 6cm ずれた。
// ここでは骨ごとに「休みの姿勢から世界でどれだけ曲がったか」を見本の骨格で測り、それを体の骨の休みの
// 向きに掛けて、体の局所の回りへ戻す (Blender で見本を別の骨格へ写した時と同じ手)。
// 腰の位置は扱わない (merge_clip.js の --hips-from で体の型に揃える)
const [bodyPath, clipPath, outPath] = process.argv.slice(2)
if (!outPath) { console.error('使い方: bun tools/retarget_world.js <体.glb> <型.glb> <出力.glb>'); process.exit(1) }

function read(path) {
  const bytes = new Uint8Array(require('fs').readFileSync(path))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + n)))
  if (json.extensionsUsed?.includes('EXT_meshopt_compression')) throw new Error(`${path} は圧縮済み (unpack_glb.js を先に)`)
  return { bytes, json, bin: 20 + n + 8 }
}
const body = read(bodyPath)
const clip = read(clipPath)

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]]
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l) }
const key = (name) => (name ?? '').replace(/^mixamorig:?/, '')

const parents = (json) => {
  const p = new Map()
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => p.set(c, i)))
  return p
}
const restOf = (json, i) => json.nodes[i].rotation ?? [0, 0, 0, 1]

// 型の回りの値 (float 前提。Blender の書き出し)
const floats = (g, index) => {
  const a = g.json.accessors[index]
  if (a.componentType !== 5126) throw new Error(`型の accessor ${index} が float でない`)
  const v = g.json.bufferViews[a.bufferView]
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
  return new Float32Array(g.bytes.buffer, g.bytes.byteOffset + g.bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * comps)
}
const anim = clip.json.animations[0]
const rotOut = new Map() // 型の骨 → 回りの値
for (const ch of anim.channels) if (ch.target.path === 'rotation') rotOut.set(ch.target.node, floats(clip, anim.samplers[ch.sampler].output))
const frames = Math.max(...[...rotOut.values()].map((f) => f.length / 4))

// 世界の向き (根から掛ける)。local(i, k) はそのコマの局所の回り
function worldOf(json, local) {
  const par = parents(json)
  const memo = new Map()
  const w = (i) => {
    if (memo.has(i)) return memo.get(i)
    const p = par.get(i)
    const r = p === undefined ? local(i) : qmul(w(p), local(i))
    memo.set(i, r)
    return r
  }
  return w
}

const bodyIndex = new Map(body.json.nodes.map((n, i) => [key(n.name), i]))
const clipIndex = new Map(clip.json.nodes.map((n, i) => [key(n.name), i]))
const bodyPar = parents(body.json)
const bodyRestWorld = worldOf(body.json, (i) => restOf(body.json, i))
const clipRestWorld = worldOf(clip.json, (i) => restOf(clip.json, i))

let written = 0
for (let k = 0; k < frames; k++) {
  const clipPoseWorld = worldOf(clip.json, (i) => {
    const f = rotOut.get(i)
    if (!f) return restOf(clip.json, i)
    const at = Math.min(k, f.length / 4 - 1) * 4
    return [f[at], f[at + 1], f[at + 2], f[at + 3]]
  })
  // 体の骨の、このコマの世界の向き。見本にある骨は「見本の曲がり × 体の休みの向き」、無い骨は休みの局所のまま
  const desired = new Map()
  const bodyPoseWorld = worldOf(body.json, (i) => {
    const ci = clipIndex.get(key(body.json.nodes[i].name))
    if (ci === undefined || !rotOut.has(ci)) return restOf(body.json, i)
    // 局所 = 親の世界の逆 × 欲しい世界 を返したいので、世界を先に出す
    const bend = qmul(clipPoseWorld(ci), qinv(clipRestWorld(ci)))
    const want = qmul(bend, bodyRestWorld(i))
    desired.set(i, want)
    const p = bodyPar.get(i)
    return p === undefined ? want : qmul(qinv(bodyPoseWorldRef(p)), want)
  })
  // worldOf の中から親の世界を引くための参照
  var bodyPoseWorldRef = bodyPoseWorld
  for (const [ci, f] of rotOut) {
    const bi = bodyIndex.get(key(clip.json.nodes[ci].name))
    if (bi === undefined) continue
    bodyPoseWorld(bi)
    const p = bodyPar.get(bi)
    const local = qnorm(p === undefined ? desired.get(bi) : qmul(qinv(bodyPoseWorld(p)), desired.get(bi)))
    const at = Math.min(k, f.length / 4 - 1) * 4
    if (k < f.length / 4) { f.set(local, at); written++ }
  }
}
await Bun.write(outPath, clip.bytes)
console.log(`${clipPath.split('/').pop()} → ${bodyPath.split('/').pop()}: 骨 ${rotOut.size} 本 × ${frames} コマを写し直した (${written})`)
