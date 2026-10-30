// クリップ 1 本の**速さをファイルの側で変える。**
//
// 使い方: bun tools/retime_clip.js <.glb> <クリップ名> <倍率>
//   例:   bun tools/retime_clip.js public/models/soldier.glb vault 1.2
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

const [path, clipName, rateText] = process.argv.slice(2)
const rate = Number(rateText)
if (!path || !clipName || !(rate > 0)) {
  console.error('使い方: bun tools/retime_clip.js <.glb> <クリップ名> <倍率>')
  process.exit(1)
}

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
const bin = bytes.subarray(20 + jsonLength + 8)

const anim = json.animations?.find((a) => a.name === clipName)
if (!anim) {
  console.error(`${clipName} が ${path} に無い`)
  process.exit(1)
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
for (const index of inputs) {
  const acc = json.accessors[index]
  const bv = json.bufferViews[acc.bufferView]
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const times = new Float32Array(bin.buffer, bin.byteOffset + offset, acc.count)
  before = Math.max(before, times[acc.count - 1])
  for (let i = 0; i < times.length; i++) times[i] /= rate
  after = Math.max(after, times[acc.count - 1])
  // min / max は JSON の側にある。書き直すと JSON の長さが変わるので、下で glb を組み直す
  if (acc.min) acc.min = [times[0]]
  if (acc.max) acc.max = [times[acc.count - 1]]
}

// JSON を書き戻す。長さが変わるので、glb を組み直す (4 バイト境界に空白で詰める)
let text = JSON.stringify(json)
while (text.length % 4) text += ' '
const jsonBytes = new TextEncoder().encode(text)
const binChunk = bytes.subarray(20 + jsonLength) // 長さ・種別ごと
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
console.info(`${path} の ${clipName}: ${before.toFixed(3)} 秒 → ${after.toFixed(3)} 秒 (×${rate})`)
