// 2 本の型から 1 本を組む。**体は片方、腕はもう片方の先頭の姿で止めて。**
//
// 拳銃で走る型 (pistol_run) を、長物の走り (relaxed_run) の体に、拳銃の立ち止まり
// (handgun_relaxed_idle) の腕を載せて作るために書いた。持ち替えで頭の位置が変わらないよう、
// 体 (腰・脚・背骨・首・頭) は走りの型をそのまま使う (本人 2026-11-18「running の pistol と p90 で
// head の位置が違う」、しゃがみ走り pistol_crouch_run と同じ考え方)。
//
// 腕の骨 (Shoulder / Arm / ForeArm / Hand と指) は、腕の型の**先頭のキー**を体の型の長さいっぱいに
// 置く。腕の型の長さのまま流すと、型の長さが体の型と違って走りの 1 周がずれる。
//
// 使い方: bun tools/compose_clip.js <入出力.glb> <新しい型の名前> <体の型> <腕の型>
//         圧縮前の glb 専用 (tools/unpack_glb.js で戻してから)。同じ名前があれば差し替える

const [path, newName, bodyName, armName] = process.argv.slice(2)
if (!armName) throw new Error('使い方: bun tools/compose_clip.js <入出力.glb> <新しい型> <体の型> <腕の型>')

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
if (json.extensionsUsed?.includes('EXT_meshopt_compression')) throw new Error(`${path} は meshopt 圧縮済み (unpack_glb.js を先に)`)
const binStart = 20 + jsonLength + 8
const bin = bytes.subarray(binStart, binStart + view.getUint32(20 + jsonLength, true))

const body = json.animations.find((a) => a.name === bodyName)
const arm = json.animations.find((a) => a.name === armName)
if (!body || !arm) throw new Error(`${bodyName} か ${armName} が無い`)

const SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4 }
const floatsOf = (index) => {
  const a = json.accessors[index]
  const v = json.bufferViews[a.bufferView]
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const n = a.count * SIZE[a.type]
  if (a.componentType === 5126) return new Float32Array(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + n * 4))
  // 量子化された型のキー (gltfpack): 正規化した整数を float に戻す
  const Int = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array }[a.componentType]
  if (!Int) throw new Error(`accessor ${index} の型が読めない (${a.componentType})`)
  const raw = new Int(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + n * Int.BYTES_PER_ELEMENT))
  const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = a.normalized ? Math.max(raw[i] / max, -1) : raw[i]
  return out
}

// 腕の骨。名前の後ろで見分ける (mixamorig:LeftForeArm / mixamorig:RightHandIndex1 など)
const isArm = (name) => /(Shoulder|Arm|ForeArm|Hand)/.test(name.replace(/^.*:/, '')) && !/^Armature/.test(name)

// 体の型の長さ
let duration = 0
for (const s of body.samplers) {
  const t = floatsOf(s.input)
  duration = Math.max(duration, t[t.length - 1])
}

const appended = []
let appendedLength = 0
const push = (floats, type) => {
  const pad = (4 - (appendedLength % 4)) % 4
  if (pad) { appended.push(new Uint8Array(pad)); appendedLength += pad }
  const b = new Uint8Array(floats.buffer)
  json.bufferViews.push({ buffer: 0, byteOffset: bin.length + appendedLength, byteLength: b.length })
  appended.push(b); appendedLength += b.length
  const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: floats.length / SIZE[type], type }
  if (type === 'SCALAR') { acc.min = [floats[0]]; acc.max = [floats[floats.length - 1]] }
  json.accessors.push(acc)
  return json.accessors.length - 1
}
const times = push(new Float32Array([0, duration]), 'SCALAR')

const samplers = []
const channels = []
const armKey = new Map(arm.channels.map((c) => [`${c.target.node}:${c.target.path}`, c]))
let fromBody = 0
let fromArm = 0
for (const c of body.channels) {
  const name = json.nodes[c.target.node].name
  const key = `${c.target.node}:${c.target.path}`
  if (isArm(name) && armKey.has(key)) {
    const a = armKey.get(key)
    const src = arm.samplers[a.sampler]
    const out = floatsOf(src.output)
    const width = SIZE[json.accessors[src.output].type]
    const first = out.slice(0, width)
    const values = new Float32Array(width * 2)
    values.set(first, 0)
    values.set(first, width)
    samplers.push({ input: times, output: push(values, json.accessors[src.output].type), interpolation: 'LINEAR' })
    fromArm++
  } else {
    samplers.push({ ...body.samplers[c.sampler] })
    fromBody++
  }
  channels.push({ sampler: samplers.length - 1, target: { ...c.target } })
}

const clip = { name: newName, samplers, channels }
const at = json.animations.findIndex((a) => a.name === newName)
if (at >= 0) json.animations[at] = clip
else json.animations.push(clip)

const total = new Uint8Array(bin.length + appendedLength)
total.set(bin, 0)
let offset = bin.length
for (const b of appended) { total.set(b, offset); offset += b.length }
json.buffers[0].byteLength = total.length

let js = new TextEncoder().encode(JSON.stringify(json))
const jpad = (4 - (js.length % 4)) % 4
if (jpad) { const p = new Uint8Array(js.length + jpad).fill(0x20); p.set(js); js = p }
const bpad = (4 - (total.length % 4)) % 4
const binOut = bpad ? (() => { const p = new Uint8Array(total.length + bpad); p.set(total); return p })() : total
const out = new Uint8Array(12 + 8 + js.length + 8 + binOut.length)
const dv = new DataView(out.buffer)
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true)
dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20)
dv.setUint32(20 + js.length, binOut.length, true); dv.setUint32(24 + js.length, 0x004e4942, true); out.set(binOut, 28 + js.length)
await Bun.write(path, out)
console.log(`${newName}: 体 ${bodyName} から ${fromBody} 本、腕 ${armName} の先頭から ${fromArm} 本 (${duration.toFixed(3)} 秒)`)
