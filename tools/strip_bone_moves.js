// 型から**腰以外の骨の位置 (translation) と大きさ (scale) の軌道を外す。** 残すのは回転と腰の位置だけ。
//
// 使い方: bun tools/strip_bone_moves.js <.glb>
//         そのあと npx @gltf-transform/cli prune <.glb> <.glb> && npx @gltf-transform/cli dedup <.glb> <.glb>
//         (外した軌道の値が bin に残っているので、prune で捨てる)
//
// --- なぜ要るか ---
// 骨の位置と大きさは腰以外ほぼ動かず、骨の長さを毎コマ書いているだけ。それでも 1 本ごとに
// accessor と bufferView の記述が付くので、soldier と雷電は JSON が 4MB を超えていた
// (kome27 は merge_all_clips が回転以外を捨てて入れたので腰だけで、同じ型の数で 1.2MB)。
//
// **外すと骨の長さはその体の素の姿勢の値になる。** 宿主 (soldier) の骨の長さを写したまま
// 動いていた型 (雷電で 4602 本) は、その体自身の長さに戻る — 移した型が本来あるべき形。
// 頭の高さが動くことがあるので、外した後は fit_height.js を通し直す (2026-11-02)

const [path] = process.argv.slice(2)
if (!path) {
  console.error('使い方: bun tools/strip_bone_moves.js <.glb>')
  process.exit(1)
}

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
// meshopt 圧縮した glb はバイト列を float と誤読して静かに壊すので、先に断る
if (json.extensionsUsed?.includes('EXT_meshopt_compression')) {
  console.error(`${path} は meshopt 圧縮済み。この道具は圧縮前の glb 専用 (手順は tools/README.md)`)
  process.exit(1)
}
const binChunk = bytes.subarray(20 + jsonLength)

const hips = json.nodes.findIndex((n) => (n.name ?? '').endsWith('Hips'))
if (hips < 0) {
  console.error('腰の骨 (…Hips) が無い')
  process.exit(1)
}

let dropped = 0
let kept = 0
for (const anim of json.animations ?? []) {
  const channels = anim.channels.filter((c) => {
    const keep = c.target.path === 'rotation' || (c.target.path === 'translation' && c.target.node === hips) || c.target.path === 'weights'
    if (keep) kept++
    else dropped++
    return keep
  })
  // 使われなくなった sampler を詰める (channel の sampler 番号を振り直す)
  const used = [...new Set(channels.map((c) => c.sampler))]
  const remap = new Map(used.map((old, i) => [old, i]))
  anim.samplers = used.map((i) => anim.samplers[i])
  anim.channels = channels.map((c) => ({ ...c, sampler: remap.get(c.sampler) }))
}

let text = JSON.stringify(json)
while (text.length % 4) text += ' '
const jsonBytes = new TextEncoder().encode(text)
const total = 12 + 8 + jsonBytes.length + binChunk.length
const out = new Uint8Array(total)
const outView = new DataView(out.buffer)
out.set(bytes.subarray(0, 12))
outView.setUint32(8, total, true)
outView.setUint32(12, jsonBytes.length, true)
outView.setUint32(16, 0x4e4f534a, true) // JSON
out.set(jsonBytes, 20)
out.set(binChunk, 20 + jsonBytes.length)
await Bun.write(path, out)
console.info(`${path}: 外した軌道 ${dropped} 本 / 残した ${kept} 本 (回転と腰の位置)`)
