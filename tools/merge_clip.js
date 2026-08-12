// 別の .glb からアニメーションを 1 本だけ取り込む。
//
// キャラを再変換せずにクリップを足せる。元の FBX が手元に残っていないときや、
// 142MB の読み込みを避けたいときに使う。
//
// チャンネルの対象ノードは**名前で対応付ける**。索引で合わせると、
// エクスポートのたびにノード順が変わった場合に静かに壊れる。
//
// 使い方: bun merge_clip.js <取り込み先.glb> <取り込み元.glb> <クリップ名> <出力.glb>

const [destPath, srcPath, clipName, outPath] = process.argv.slice(2)

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  const binStart = 20 + jsonLength + 8
  const binLength = view.getUint32(20 + jsonLength, true)
  return { json, bin: bytes.subarray(binStart, binStart + binLength) }
}

const dest = parseGlb(new Uint8Array(await Bun.file(destPath).arrayBuffer()))
const src = parseGlb(new Uint8Array(await Bun.file(srcPath).arrayBuffer()))

const animation = src.json.animations?.find((a) => a.name === clipName)
if (!animation) throw new Error(`${srcPath} に ${clipName} が無い`)

const destNodeByName = new Map(dest.json.nodes.map((n, i) => [n.name, i]))

// 追記するデータ。既存の bufferView は位置が変わらないので、末尾に足すだけで済む。
const appended = []
let appendedLength = 0

function copyAccessor(index) {
  const accessor = src.json.accessors[index]
  const view = src.json.bufferViews[accessor.bufferView]
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type] * 4
  const bytes = src.bin.subarray(start, start + accessor.count * size)

  // 4 バイト境界を守る
  const padding = (4 - (appendedLength % 4)) % 4
  if (padding) {
    appended.push(new Uint8Array(padding))
    appendedLength += padding
  }

  const byteOffset = dest.bin.length + appendedLength
  appended.push(bytes)
  appendedLength += bytes.length

  dest.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length })
  dest.json.accessors.push({
    ...accessor,
    bufferView: dest.json.bufferViews.length - 1,
    byteOffset: 0,
  })
  return dest.json.accessors.length - 1
}

const samplers = animation.samplers.map((s) => ({
  input: copyAccessor(s.input),
  output: copyAccessor(s.output),
  interpolation: s.interpolation,
}))

let dropped = 0
const channels = []
for (const channel of animation.channels) {
  const name = src.json.nodes[channel.target.node].name
  const target = destNodeByName.get(name)
  if (target === undefined) {
    dropped++
    continue
  }
  channels.push({ sampler: channel.sampler, target: { node: target, path: channel.target.path } })
}

dest.json.animations = dest.json.animations ?? []

// 同じ名前が既にあれば差し替える。
// glTF は同名のアニメーションを許すが、three は最初に見つかったものを使うので、
// 追記するだけだと「取り込んだのに古いまま」が静かに起きる。
// (モーションを取り直して入れ直す、はよくやる)
const existing = dest.json.animations.findIndex((a) => a.name === clipName)
if (existing >= 0) {
  dest.json.animations[existing] = { name: clipName, samplers, channels }
  console.log(`${clipName}: 既にあったので差し替え`)
} else {
  dest.json.animations.push({ name: clipName, samplers, channels })
}

// --- 書き出し ---
const bin = new Uint8Array(dest.bin.length + appendedLength)
bin.set(dest.bin, 0)
let cursor = dest.bin.length
for (const chunk of appended) {
  bin.set(chunk, cursor)
  cursor += chunk.length
}
dest.json.buffers[0].byteLength = bin.length

const jsonBytes = new TextEncoder().encode(JSON.stringify(dest.json))
const jsonPadded = new Uint8Array(jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4)).fill(0x20)
jsonPadded.set(jsonBytes)

const total = 12 + 8 + jsonPadded.length + 8 + bin.length
const out = new Uint8Array(total)
const dv = new DataView(out.buffer)
dv.setUint32(0, 0x46546c67, true)
dv.setUint32(4, 2, true)
dv.setUint32(8, total, true)
dv.setUint32(12, jsonPadded.length, true)
dv.setUint32(16, 0x4e4f534a, true)
out.set(jsonPadded, 20)
dv.setUint32(20 + jsonPadded.length, bin.length, true)
dv.setUint32(24 + jsonPadded.length, 0x004e4942, true)
out.set(bin, 28 + jsonPadded.length)

await Bun.write(outPath, out)
console.log(
  `${clipName}: チャンネル ${channels.length} 本を取り込み` +
    (dropped ? ` (対応するノードが無く ${dropped} 本は捨てた)` : ''),
)
console.log(`${outPath} (${(out.length / 1024 / 1024).toFixed(1)} MB)`)
