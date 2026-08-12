// glb に埋め込まれた JPEG を縮小して書き戻す。
// bufferView の中身が変わるので BIN チャンクを丸ごと組み直し、全 bufferView の
// byteOffset を振り直す。accessor の byteOffset は bufferView 相対なので触らなくてよい。

import { unlinkSync } from 'node:fs'

const [input, output, maxSizeArg, qualityArg] = process.argv.slice(2)
const MAX_SIZE = Number(maxSizeArg)
const QUALITY = Number(qualityArg)
// 作業用の置き場。特定の環境の絶対パスを埋めると、他所で動かない
const TMP = process.env.TMPDIR ?? '/tmp'

const src = new Uint8Array(await Bun.file(input).arrayBuffer())
const view = new DataView(src.buffer, src.byteOffset, src.byteLength)

// GLB: [magic, version, length] + チャンク列 (JSON, BIN)
const jsonLength = view.getUint32(12, true)
const gltf = JSON.parse(new TextDecoder().decode(src.subarray(20, 20 + jsonLength)))
const binStart = 20 + jsonLength + 8
const bin = src.subarray(binStart, binStart + view.getUint32(20 + jsonLength, true))

const bufferViews = gltf.bufferViews
const replaced = new Map()

for (const [i, image] of (gltf.images ?? []).entries()) {
  const bv = bufferViews[image.bufferView]
  const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)

  const inPath = `${TMP}/img${i}.jpg`
  const outPath = `${TMP}/img${i}.out.jpg`
  await Bun.write(inPath, bytes)

  // sips は macOS 標準。-Z は縦横比を保ったまま長辺を上限に合わせる
  const proc = Bun.spawnSync([
    'sips', '-Z', String(MAX_SIZE),
    '-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY),
    inPath, '--out', outPath,
  ])
  if (proc.exitCode !== 0) throw new Error(`sips 失敗 (image ${i}): ${proc.stderr}`)

  const shrunk = new Uint8Array(await Bun.file(outPath).arrayBuffer())
  const before = (bytes.length / 1024 / 1024).toFixed(2)
  const after = (shrunk.length / 1024 / 1024).toFixed(2)
  console.log(`image ${String(i).padStart(2)}: ${before} MB -> ${after} MB`)
  replaced.set(image.bufferView, shrunk)

  unlinkSync(inPath)
  unlinkSync(outPath)
}

// BIN を組み直す。glTF は bufferView の 4 バイト境界を要求する
const chunks = []
let offset = 0
for (const [index, bv] of bufferViews.entries()) {
  // data は byteOffset を書き換える前に確定させる
  const data = replaced.get(index) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
  bv.byteOffset = offset
  bv.byteLength = data.length
  chunks.push(data)
  offset += data.length
  const padding = (4 - (offset % 4)) % 4
  if (padding) {
    chunks.push(new Uint8Array(padding))
    offset += padding
  }
}

const newBin = new Uint8Array(offset)
let cursor = 0
for (const chunk of chunks) {
  newBin.set(chunk, cursor)
  cursor += chunk.length
}
gltf.buffers[0].byteLength = newBin.length

// JSON チャンクはスペース、BIN チャンクはゼロでパディングするのが仕様
const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
const jsonPadded = new Uint8Array(jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4)).fill(0x20)
jsonPadded.set(jsonBytes)

const total = 12 + 8 + jsonPadded.length + 8 + newBin.length
const out = new Uint8Array(total)
const dv = new DataView(out.buffer)
dv.setUint32(0, 0x46546c67, true) // 'glTF'
dv.setUint32(4, 2, true)
dv.setUint32(8, total, true)
dv.setUint32(12, jsonPadded.length, true)
dv.setUint32(16, 0x4e4f534a, true) // 'JSON'
out.set(jsonPadded, 20)
dv.setUint32(20 + jsonPadded.length, newBin.length, true)
dv.setUint32(24 + jsonPadded.length, 0x004e4942, true) // 'BIN'
out.set(newBin, 28 + jsonPadded.length)

await Bun.write(output, out)
console.log(`\n${(src.length / 1024 / 1024).toFixed(1)} MB -> ${(out.length / 1024 / 1024).toFixed(1)} MB`)
