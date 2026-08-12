// クリップ本来の移動速度を測る。腰の移動量 ÷ 尺。
// 再生速度の補正に使う値で、合っていないと足が滑る。
const bytes = new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())
const dv = new DataView(bytes.buffer); const jl = dv.getUint32(12, true)
const j = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)))
const bin = bytes.subarray(20 + jl + 8)
const acc = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]
  const n = a.count * ({SCALAR:1,VEC3:3,VEC4:4})[a.type]
  return new Float32Array(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), n) }
const hips = j.nodes.findIndex((n) => n.name?.endsWith('Hips'))
// Armature のスケール (0.01) を掛けてメートルに直す
const arm = j.nodes.find((n) => (n.children ?? []).includes(hips))
const scale = arm?.scale?.[0] ?? 1
for (const name of process.argv.slice(3)) {
  const a = j.animations.find((x) => x.name === name)
  if (!a) { console.log(`${name}: 無い`); continue }
  const ch = a.channels.find((c) => c.target.node === hips && c.target.path === 'translation')
  const dur = Math.max(...a.samplers.map((s) => j.accessors[s.input].max[0]))
  if (!ch) { console.log(`${name.padEnd(12)} ${dur.toFixed(2)}s  ルートモーション無し`); continue }
  const V = acc(a.samplers[ch.sampler].output); const n = V.length / 3
  const dx = (V[(n-1)*3] - V[0]) * scale, dz = (V[(n-1)*3+2] - V[2]) * scale
  const d = Math.hypot(dx, dz)
  console.log(`${name.padEnd(12)} ${dur.toFixed(2)}s  移動 ${d.toFixed(2)}m  → ${(d/dur).toFixed(2)} m/s`)
}
