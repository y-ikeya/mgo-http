// ある glb の**全クリップ**を、別の glb へ移す。
//
//   bun tools/merge_all_clips.js <取り込み元.glb> <取り込み先.glb> <出力.glb>
//   bun tools/merge_all_clips.js public/models/soldier.glb raiden_base.glb soldier_raiden.glb
//
// merge_clip.js は 1 本ずつで、51 本やると 10MB の glb を 51 回書き直すことになる。
// こちらは 1 回で済ませる。
//
// --- 対応付けはノード名 ---
// 索引で合わせると、書き出しのたびにノード順が変わった場合に静かに壊れる。
// 骨の名前が揃っていることが前提 (Mixamo の auto-rig を通せば mixamorig: で揃う)。
//
// **名前が見つからないチャンネルは落とす。** 落ちた数を出すので、
// 骨格が違う物を渡したときに黙って壊れない。

const [srcPath, destPath, outPath] = process.argv.slice(2)
if (!outPath) {
  console.error('引数: <取り込み元.glb> <取り込み先.glb> <出力.glb>')
  process.exit(1)
}

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  const binStart = 20 + jsonLength + 8
  const binLength = view.getUint32(20 + jsonLength, true)
  return { json, bin: bytes.subarray(binStart, binStart + binLength) }
}

const src = parseGlb(new Uint8Array(await Bun.file(srcPath).arrayBuffer()))
const dest = parseGlb(new Uint8Array(await Bun.file(destPath).arrayBuffer()))

const destNodeByName = new Map(dest.json.nodes.map((n, i) => [n.name, i]))
const added = []
let addedLength = 0

/** 取り込み元の accessor を、取り込み先へ丸ごと写して新しい索引を返す */
const copied = new Map()
function copyAccessor(index) {
  const cached = copied.get(index)
  if (cached !== undefined) return cached

  const accessor = src.json.accessors[index]
  const bufferView = src.json.bufferViews[accessor.bufferView]
  const start = bufferView.byteOffset ?? 0
  const data = src.bin.subarray(start, start + bufferView.byteLength)

  const viewIndex = dest.json.bufferViews.length
  dest.json.bufferViews.push({
    buffer: 0,
    byteOffset: dest.bin.byteLength + addedLength,
    byteLength: data.byteLength,
    ...(bufferView.byteStride ? { byteStride: bufferView.byteStride } : {}),
  })
  added.push(data)
  addedLength += data.byteLength
  // 4 バイト境界を守る。崩すと後ろの accessor が読めなくなる
  const pad = (4 - (addedLength % 4)) % 4
  if (pad) {
    added.push(new Uint8Array(pad))
    addedLength += pad
  }

  const accessorIndex = dest.json.accessors.length
  dest.json.accessors.push({ ...accessor, bufferView: viewIndex })
  copied.set(index, accessorIndex)
  return accessorIndex
}

dest.json.animations = dest.json.animations ?? []
let moved = 0
let dropped = 0

for (const clip of src.json.animations ?? []) {
  const samplers = []
  const channels = []
  for (const channel of clip.channels) {
    const name = src.json.nodes[channel.target.node]?.name
    const to = destNodeByName.get(name)
    if (to === undefined) {
      dropped++
      continue
    }
    const sampler = clip.samplers[channel.sampler]
    samplers.push({
      input: copyAccessor(sampler.input),
      output: copyAccessor(sampler.output),
      interpolation: sampler.interpolation ?? 'LINEAR',
    })
    channels.push({ sampler: samplers.length - 1, target: { node: to, path: channel.target.path } })
  }
  if (channels.length === 0) continue
  dest.json.animations.push({ name: clip.name, samplers, channels })
  moved++
}

const binPad = (4 - (addedLength % 4)) % 4
const newBinLength = dest.bin.byteLength + addedLength + binPad
dest.json.buffers[0].byteLength = newBinLength

const jsonBytes = new TextEncoder().encode(JSON.stringify(dest.json))
const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4
const jsonChunk = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20)
jsonChunk.set(jsonBytes)

const total = 12 + 8 + jsonChunk.byteLength + 8 + newBinLength
const out = new Uint8Array(total)
const write32 = (offset, value) => new DataView(out.buffer).setUint32(offset, value, true)
write32(0, 0x46546c67)
write32(4, 2)
write32(8, total)
write32(12, jsonChunk.byteLength)
write32(16, 0x4e4f534a)
out.set(jsonChunk, 20)
write32(20 + jsonChunk.byteLength, newBinLength)
write32(24 + jsonChunk.byteLength, 0x004e4942)
let cursor = 28 + jsonChunk.byteLength
out.set(dest.bin, cursor)
cursor += dest.bin.byteLength
for (const data of added) {
  out.set(data, cursor)
  cursor += data.byteLength
}

await Bun.write(outPath, out)
console.log(
  `  クリップ ${moved} 本を移した` +
    (dropped ? ` / **対応する骨が無くて落ちたチャンネル ${dropped} 本**` : ' / 落ちたチャンネル なし'),
)
console.log(`  ${outPath} (${(total / 1024 / 1024).toFixed(1)} MB)`)
