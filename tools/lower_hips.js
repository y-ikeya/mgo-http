// 型の**腰の高さだけ**を下げる (m)。体ごとに、Blender で作った構えの型が地面から浮いているのを直す。
//
// 使い方: bun tools/lower_hips.js <入出力.glb> <下げる m> <型の名前> [<型の名前> …]
//         圧縮前の glb 専用 (tools/unpack_glb.js で戻してから、終わったら pack_glb.js)
//
// --- なぜ要るか (2026-11-20 本人「freya は chrouch すると地面から浮いてるな」「idle の時に足が接地してない」) ---
// 銃ごとのしゃがみ止まり (smg_crouch_relaxed / sniper_crouch_relaxed / pistol_crouch_relaxed) は名無しの体で
// Blender で作り、腰の高さを共通のしゃがみ (crouch_idle) に揃えて入れた (merge_clip.js --hips-from)。脚の曲げが
// 共通のしゃがみと違うので、腰を揃えても足は揃わず、Freya で 6.3cm・X Bot で 10cm 浮いた。
// 浮きは体ごとに違う (脚の長さが違う) ので、体ごとに測った分だけ下げる。
//
// 下げる量は**世界の m**。腰の骨の親をたどった大きさ (Armature の scale・fit_height の縮め) で割って、
// 型の単位に直す。上の軸は idle の腰の位置で一番大きい成分 (merge_clip.js と同じ見分け方)。
//
// 型の値は他の型と同じ値なら dedup で共有されている。**下げる型の外と共有している値は触らずに止める**
// (他の型まで下がる)。下げる型どうしの共有は 1 回だけ下げる

const [path, byText, ...names] = process.argv.slice(2)
const by = Number(byText)
if (!path || !Number.isFinite(by) || names.length === 0) {
  console.error('使い方: bun tools/lower_hips.js <.glb> <下げる m> <型> [<型> …]')
  process.exit(1)
}

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
if (json.extensionsUsed?.includes('EXT_meshopt_compression')) {
  console.error(`${path} は meshopt 圧縮済み (unpack_glb.js を先に)`)
  process.exit(1)
}
const binStart = 20 + jsonLength + 8

const hips = json.nodes.findIndex((n) => (n.name ?? '').endsWith('Hips'))
if (hips < 0) throw new Error('腰の骨 (…Hips) が無い')

// 腰の親をたどって大きさを掛ける (どれも等方の前提。違えば止める)
const parentOf = new Map()
json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)))
let scale = 1
for (let at = parentOf.get(hips); at !== undefined; at = parentOf.get(at)) {
  const s = json.nodes[at].scale
  if (!s) continue
  if (Math.abs(s[0] - s[1]) > 1e-4 || Math.abs(s[0] - s[2]) > 1e-4) throw new Error(`${json.nodes[at].name} の大きさが等方でない`)
  scale *= s[0]
}

const floatsAt = (index) => {
  const a = json.accessors[index]
  if (a.componentType !== 5126) throw new Error(`accessor ${index} が float でない`)
  const v = json.bufferViews[a.bufferView]
  const start = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  return new Float32Array(bytes.buffer, bytes.byteOffset + start, a.count * 3)
}
const hipsOutput = (animation) => {
  const channel = animation.channels.find((c) => c.target.node === hips && c.target.path === 'translation')
  return channel ? animation.samplers[channel.sampler].output : null
}

// 上の軸は idle の腰で決める
const idle = json.animations.find((a) => a.name === 'idle')
if (!idle || hipsOutput(idle) === null) throw new Error('idle の腰の位置が無い')
const rest = Array.from(floatsAt(hipsOutput(idle)).slice(0, 3))
const up = rest.map(Math.abs).indexOf(Math.max(...rest.map(Math.abs)))
const step = (by / scale) * Math.sign(rest[up])

// 共有を確かめる
const targets = new Set()
for (const name of names) {
  const animation = json.animations.find((a) => a.name === name)
  if (!animation) throw new Error(`${name} が無い`)
  const output = hipsOutput(animation)
  if (output === null) throw new Error(`${name} に腰の位置が無い`)
  targets.add(output)
}
for (const animation of json.animations) {
  if (names.includes(animation.name)) continue
  const output = hipsOutput(animation)
  if (output !== null && targets.has(output)) throw new Error(`${animation.name} と腰の値を共有している。下げると一緒に下がる`)
}

for (const output of targets) {
  const values = floatsAt(output)
  for (let i = up; i < values.length; i += 3) values[i] -= step
}
await Bun.write(path, bytes)
console.log(`${names.join(', ')}: 腰を ${(by * 100).toFixed(1)}cm 下げた (型の単位 ${step.toFixed(3)}、軸 ${'XYZ'[up]}、値 ${targets.size} 本)`)
