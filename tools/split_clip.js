// クリップを 2 本に割る。
//
// 使い方: bun tools/split_clip.js <入出力.glb> <クリップ名> <秒> <前半の名> <後半の名>
//   bun tools/split_clip.js public/models/soldier.glb throw 1.5 throw_windup throw_release
//
// --- なぜ割るか ---
// 「振りかぶりで止めて、放したら振り切る」を 1 本のクリップでやると、
// **止める位置をクリップ内の絶対秒で持つ**ことになる (THROW_HOLD_AT = 1.5)。
// モデルを差し替えて尺が変われば、その数字は別の場所を指す。実際、移植した
// モデルが 25% 速くなっていたとき、振り切ったあとを指して「押しっぱなしなのに
// 手を振り下ろす」になった。
//
// 割ってしまえば、止める位置は**クリップの終わり**になる。数字がコードから
// 消えて資産に移る。保持も clampWhenFinished で素直に書ける。
//
// --- 境目の扱い ---
// 切る時刻はサンプルの位置へ丸める。クリップは 30fps で焼かれているので、
// 標本の上で切れば補間が要らない。境目の 1 標本は**両方に入れる** —
// 前半の最後と後半の最初が同じ姿勢になり、繋ぎ目で飛ばない。

const [path, clipName, atText, headName, tailName] = process.argv.slice(2)
if (!tailName) {
  console.error('引数: <glb> <クリップ名> <秒> <前半の名> <後半の名>')
  process.exit(1)
}
const at = Number(atText)

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
const binStart = 20 + jsonLength + 8
const binLength = view.getUint32(20 + jsonLength, true)
const bin = bytes.subarray(binStart, binStart + binLength)

const index = json.animations.findIndex((a) => a.name === clipName)
if (index < 0) throw new Error(`${path} に ${clipName} が無い`)
const clip = json.animations[index]

/** accessor を float の配列として読む */
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
function read(accessorIndex) {
  const accessor = json.accessors[accessorIndex]
  if (accessor.componentType !== 5126) {
    throw new Error(`float 以外の accessor は扱わない (componentType ${accessor.componentType})`)
  }
  const bufferView = json.bufferViews[accessor.bufferView]
  const step = COMPONENTS[accessor.type]
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const out = []
  for (let i = 0; i < accessor.count; i++) {
    const row = []
    for (let c = 0; c < step; c++) {
      row.push(new DataView(bin.buffer, bin.byteOffset).getFloat32(start + (i * step + c) * 4, true))
    }
    out.push(row)
  }
  return { rows: out, type: accessor.type, step }
}

// 末尾に足していく。既存の bufferView は位置が変わらないので触らなくてよい
const added = []
let addedLength = 0
function write(rows, type) {
  const step = COMPONENTS[type]
  const buffer = new ArrayBuffer(rows.length * step * 4)
  const out = new DataView(buffer)
  rows.forEach((row, i) => row.forEach((v, c) => out.setFloat32((i * step + c) * 4, v, true)))
  const data = new Uint8Array(buffer)

  const bufferViewIndex = json.bufferViews.length
  json.bufferViews.push({
    buffer: 0,
    byteOffset: bin.byteLength + addedLength,
    byteLength: data.byteLength,
  })
  added.push(data)
  addedLength += data.byteLength

  const flat = rows.flat()
  const accessorIndex = json.accessors.length
  json.accessors.push({
    bufferView: bufferViewIndex,
    componentType: 5126,
    count: rows.length,
    type,
    // 時刻の accessor は min/max が要る (glTF の規約)
    ...(type === 'SCALAR' ? { min: [Math.min(...flat)], max: [Math.max(...flat)] } : {}),
  })
  return accessorIndex
}

const head = { name: headName, channels: [], samplers: [] }
const tail = { name: tailName, channels: [], samplers: [] }

// **クリップ全体で 1 つの境目を決める。** チャンネルごとに出すと、標本の少ない
// チャンネル (ずっと動かない骨など) が別の場所で切れて、そこだけ尺が合わなくなる。
// 最初はそれで、後半が丸ごと 2.3 秒のまま残った。
const dense = clip.channels
  .map((c) => read(clip.samplers[c.sampler].input).rows.map(([t]) => t))
  .reduce((best, times) => (times.length > best.length ? times : best), [])
const cutAt = dense.reduce((best, t) => (Math.abs(t - at) < Math.abs(best - at) ? t : best), dense[0])

/** 2 つの標本の間を t で混ぜる。回転は球面で (直線に混ぜると近道して捻れる) */
function mix(a, b, t, isQuat) {
  if (!isQuat) return a.map((v, i) => v + (b[i] - v) * t)
  let [bx, by, bz, bw] = b
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw
  // 逆向きの表現は同じ姿勢。近いほうを採る
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw }
  if (dot > 0.9995) {
    const out = [a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]
    const len = Math.hypot(...out) || 1
    return out.map((v) => v / len)
  }
  const theta = Math.acos(dot)
  const s0 = Math.sin((1 - t) * theta) / Math.sin(theta)
  const s1 = Math.sin(t * theta) / Math.sin(theta)
  return [a[0] * s0 + bx * s1, a[1] * s0 + by * s1, a[2] * s0 + bz * s1, a[3] * s0 + bw * s1]
}

for (const channel of clip.channels) {
  const sampler = clip.samplers[channel.sampler]
  const times = read(sampler.input)
  const values = read(sampler.output)
  if (times.rows.length !== values.rows.length) {
    throw new Error('標本の数が入力と出力で違う (STEP/CUBICSPLINE は扱わない)')
  }
  const isQuat = channel.target.path === 'rotation'

  // **境目にちょうど標本を作る。**
  //
  // 標本の少ないチャンネル (ずっと動かない骨は 2 点しか持たない) だと、境目の
  // 次の標本が終端になる。そのまま前半に入れると前半が丸ごとの尺になり、
  // 「終わりで止める」が効かない。境目の姿勢を補間して打ち切る。
  let i = 0
  while (i + 1 < times.rows.length && times.rows[i + 1][0] <= cutAt) i++
  const t0 = times.rows[i][0]
  const t1 = times.rows[Math.min(i + 1, times.rows.length - 1)][0]
  const ratio = t1 > t0 ? Math.min(1, Math.max(0, (cutAt - t0) / (t1 - t0))) : 0
  const edge = mix(values.rows[i], values.rows[Math.min(i + 1, values.rows.length - 1)], ratio, isQuat)

  // 境目の姿勢は**前半の最後であり後半の最初**。繋ぎ目で飛ばない
  const headTimes = [...times.rows.slice(0, i + 1), [cutAt]]
  const headValues = [...values.rows.slice(0, i + 1), edge]
  const rest = times.rows.slice(i + 1).filter(([t]) => t > cutAt)
  const tailTimes = [[0], ...rest.map(([t]) => [t - cutAt])]
  const tailValues = [edge, ...values.rows.slice(times.rows.length - rest.length)]

  head.samplers.push({
    input: write(headTimes, 'SCALAR'),
    output: write(headValues, values.type),
    interpolation: sampler.interpolation ?? 'LINEAR',
  })
  head.channels.push({ sampler: head.samplers.length - 1, target: channel.target })

  tail.samplers.push({
    input: write(tailTimes, 'SCALAR'),
    output: write(tailValues, values.type),
    interpolation: sampler.interpolation ?? 'LINEAR',
  })
  tail.channels.push({ sampler: tail.samplers.length - 1, target: channel.target })
}

// 元のクリップは残さない。残すと「どちらが本物か」が曖昧になる
json.animations.splice(index, 1, head, tail)

const binPadded = (4 - (addedLength % 4)) % 4
json.buffers[0].byteLength = bin.byteLength + addedLength + binPadded

const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4
const jsonChunk = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20)
jsonChunk.set(jsonBytes)

const newBinLength = bin.byteLength + addedLength + binPadded
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
out.set(bin, cursor)
cursor += bin.byteLength
for (const data of added) {
  out.set(data, cursor)
  cursor += data.byteLength
}

await Bun.write(path, out)
const seconds = (a) => Math.max(...a.samplers.map((s) => json.accessors[s.input].max[0]))
console.log(
  `${clipName} (${at} 秒で指定) を ${cutAt.toFixed(3)} 秒で割った\n` +
    `  ${headName.padEnd(16)} ${seconds(head).toFixed(3)} 秒\n` +
    `  ${tailName.padEnd(16)} ${seconds(tail).toFixed(3)} 秒`,
)
