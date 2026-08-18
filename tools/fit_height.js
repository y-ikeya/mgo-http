// 移した体の背丈を宿主に合わせる。
//
//   bun tools/fit_height.js <宿主.glb> <合わせる.glb>
//   bun tools/fit_height.js public/models/soldier.glb public/models/soldier_raiden.glb
//
// merge_all_clips.js のあとに必ず通す。
//
// --- なぜ要るか ---
// 移したクリップは**宿主の単位で腰の高さを持っている**。腰の移動は骨の回転と違って
// 長さそのものなので、Armature の scale が宿主と違うと、その比のぶん腰が上下する。
//
// Raiden で 6.9cm 沈んで、頭が 10.3cm 低かった。素の姿勢では合っているのに動かすと
// 低い、という形で出る — **クリップが腰の位置を上書きするから**。
//
// --- なぜ「宿主と同じ scale」で合うのか ---
// Mixamo の auto-rig は骨格を正規化して返す。体つきが違っても骨の長さは同じ単位系に
// 揃うので、scale を宿主に合わせれば腰も頭も爪先も揃う (Raiden で実測 0.1mm 以内)。
//
// rebody.py は**腰の高さ**で scale を決めていた。合わせる先が FBX 側の実測値なので、
// 正規化後の単位系とはずれる。そこを最後に上書きするのがこの道具。
//
// --- なぜ背丈を合わせるのか (見た目の話ではない) ---
// sim/stance.ts の HEAD_HEIGHT = 1.47 は 1 体を実測した値で、遮蔽越しに見えるかどうかも
// 当たり判定の頭の位置もそこから決まる。頭がずれた体を入れると、その人だけ見た目と
// 判定が食い違う — 見えている頭を撃つと胴に当たり、頭の上の空を撃つと頭に当たる。

const [hostPath, targetPath] = process.argv.slice(2)
if (!targetPath) {
  console.error('引数: <宿主.glb> <合わせる.glb>')
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

function writeGlb(json, bin) {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  while (jsonBytes.length % 4) jsonBytes = Uint8Array.from([...jsonBytes, 0x20])
  const pad = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length + pad
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  const header = 20 + jsonBytes.length
  view.setUint32(header, bin.length + pad, true)
  view.setUint32(header + 4, 0x004e4942, true)
  out.set(bin, header + 8)
  return out
}

/** 骨格の根 = シーン直下の Armature。ここの scale が全部に掛かる */
function armature(json) {
  return json.nodes[json.scenes[json.scene ?? 0].nodes[0]]
}

const host = parseGlb(new Uint8Array(await Bun.file(hostPath).arrayBuffer()))
const target = parseGlb(new Uint8Array(await Bun.file(targetPath).arrayBuffer()))

const want = armature(host.json).scale ?? [1, 1, 1]
const node = armature(target.json)
const have = node.scale ?? [1, 1, 1]

console.log(`宿主 ${want[0]}`)
console.log(`前   ${have[0]}  (倍率 ${(want[0] / have[0]).toFixed(6)})`)
node.scale = [...want]
console.log(`後   ${node.scale[0]}`)

await Bun.write(targetPath, writeGlb(target.json, target.bin))
console.log(`書いた ${targetPath}`)
