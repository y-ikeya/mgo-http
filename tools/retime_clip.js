// クリップ 1 本の**速さをファイルの側で変える。**
//
// 使い方: bun tools/retime_clip.js <.glb> <クリップ名> <倍率> [--as <新しい名前>]
//   例:   bun tools/retime_clip.js public/models/soldier.glb vault 1.2
//         bun tools/retime_clip.js public/models/soldier.glb sweep 1.6 --as sweep_shotgun
//
// --as を付けると**元の型は残して、速くした写しを別の名前で足す** (同じ型を等倍でも使う時。
// 爆風の sweep と散弾の sweep_shotgun)。姿勢の値 (output) は元と分け合い、時刻だけ新しく持つ。
//
// 倍率 1.2 なら、キーの時刻を全部 1/1.2 にする (尺が 1/1.2 になり、1.2 倍速で流したのと同じ)。
//
// --- なぜ要るか ---
// 画面の側で再生速度を掛けても同じ絵になるが、**型の尺と流れる速さが別々の所に書かれる**。
// 尺を読む所 (焼かれた移動を辿る・型の何割まで来たか) が増えるたびに、倍率を掛け忘れる
// 余地が増える。速さは型の持ち物にしておく (2026-10-30 本人「倍率をかけるんじゃなくて
// ファイル自体を変えられないの？」)。
//
// 時刻の accessor を他の型と分け合っていたら書き換えない (他の型まで速くなる)。

const args = process.argv.slice(2)
const asAt = args.indexOf('--as')
const copyName = asAt >= 0 ? args[asAt + 1] : null
const [path, clipName, rateText] = asAt >= 0 ? args.filter((_, i) => i !== asAt && i !== asAt + 1) : args
const rate = Number(rateText)
if (!path || !clipName || !(rate > 0)) {
  console.error('使い方: bun tools/retime_clip.js <.glb> <クリップ名> <倍率>')
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
const bin = bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + view.getUint32(20 + jsonLength, true))

let anim = json.animations?.find((a) => a.name === clipName)
if (!anim) {
  console.error(`${clipName} が ${path} に無い`)
  process.exit(1)
}

/** 足した時刻の値。書き出す時に bin の末尾へ付ける */
const appended = []
let binLength = bin.length
if (copyName) {
  if (json.animations.some((a) => a.name === copyName)) {
    console.error(`${copyName} はもう ${path} に在る`)
    process.exit(1)
  }
  // 時刻の accessor だけ写しを作る (bin の末尾に足す)。output は元と分け合う
  const copies = new Map()
  for (const input of new Set(anim.samplers.map((s) => s.input))) {
    const acc = json.accessors[input]
    const bv = json.bufferViews[acc.bufferView]
    const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    const data = new Float32Array(bin.slice(offset, offset + acc.count * 4).buffer)
    const pad = (4 - (binLength % 4)) % 4
    if (pad) appended.push(new Uint8Array(pad))
    binLength += pad
    json.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: data.byteLength })
    appended.push(new Uint8Array(data.buffer))
    binLength += data.byteLength
    json.accessors.push({ ...acc, bufferView: json.bufferViews.length - 1, byteOffset: 0 })
    copies.set(input, json.accessors.length - 1)
  }
  const copy = {
    ...anim,
    name: copyName,
    samplers: anim.samplers.map((s) => ({ ...s, input: copies.get(s.input) })),
    channels: anim.channels.map((c) => ({ ...c, target: { ...c.target } })),
  }
  json.animations.push(copy)
  anim = copy
}

const inputs = new Set(anim.samplers.map((s) => s.input))
for (const other of json.animations) {
  if (other === anim) continue
  for (const s of other.samplers) {
    if (inputs.has(s.input)) {
      console.error(`時刻の accessor ${s.input} を ${other.name} も使っている。書き換えない`)
      process.exit(1)
    }
  }
}

let before = 0
let after = 0
// 写しの時刻は bin の末尾 (appended) に在る。元の bin と続けて 1 枚にしてから書き換える
const whole = new Uint8Array(binLength)
whole.set(bin)
{
  let at = bin.length
  for (const part of appended) {
    whole.set(part, at)
    at += part.length
  }
}
for (const index of new Set(anim.samplers.map((s) => s.input))) {
  const acc = json.accessors[index]
  const bv = json.bufferViews[acc.bufferView]
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const times = new Float32Array(whole.buffer, offset, acc.count)
  before = Math.max(before, times[acc.count - 1])
  for (let i = 0; i < times.length; i++) times[i] /= rate
  after = Math.max(after, times[acc.count - 1])
  // min / max は JSON の側にある。書き直すと JSON の長さが変わるので、下で glb を組み直す
  if (acc.min) acc.min = [times[0]]
  if (acc.max) acc.max = [times[acc.count - 1]]
}

// JSON と bin を書き戻す。どちらも長さが変わるので、glb を組み直す (4 バイト境界に詰める)
let binOut = whole
if (binOut.length % 4) {
  binOut = new Uint8Array(binOut.length + ((4 - (binOut.length % 4)) % 4))
  binOut.set(whole)
}
json.buffers[0].byteLength = binOut.length
let text = JSON.stringify(json)
while (text.length % 4) text += ' '
const jsonBytes = new TextEncoder().encode(text)
const total = 12 + 8 + jsonBytes.length + 8 + binOut.length
const out = new Uint8Array(total)
const outView = new DataView(out.buffer)
out.set(bytes.subarray(0, 12))
outView.setUint32(8, total, true)
outView.setUint32(12, jsonBytes.length, true)
outView.setUint32(16, 0x4e4f534a, true) // JSON
out.set(jsonBytes, 20)
outView.setUint32(20 + jsonBytes.length, binOut.length, true)
outView.setUint32(24 + jsonBytes.length, 0x004e4942, true) // BIN
out.set(binOut, 28 + jsonBytes.length)
await Bun.write(path, out)
console.info(`${path} の ${clipName}${copyName ? ` → ${copyName}` : ''}: ${before.toFixed(3)} 秒 → ${after.toFixed(3)} 秒 (×${rate})`)
