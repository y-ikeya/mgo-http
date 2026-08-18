// 別の体を宿主の背丈に合わせる。
//
//   bun tools/fit_height.js <宿主.glb> <合わせる.glb> [骨名]
//   bun tools/fit_height.js public/models/soldier.glb public/models/soldier_raiden.glb
//
// --- なぜ腰ではなく頭で合わせるか ---
// rebody.py は**腰の高さ**を合わせる。体つきが違えば腰から上の比率も違うので、
// 腰を揃えると頭がずれる (Raiden で 3.3cm 低かった)。
//
// ゲームが見ているのは頭の高さのほう。sim/stance.ts の HEAD_HEIGHT = 1.47 は
// 1 体を実測した値で、遮蔽越しに見えるかどうかも、当たり判定の頭の位置も
// そこから決まる。**背の低い体を入れると、その人だけ見た目と判定がずれる** —
// 見えている頭を撃つと胴に当たり、頭の上の空を撃つと頭に当たる。
//
// 骨格の一番上 (HeadTop_End) ではなく Head で合わせるのは、髪型で頭頂が変わる
// ため。骨は髪を知らない。
//
// --- やること ---
// Armature ノードの scale を 1 つ書き換えるだけ。骨もメッシュもクリップの
// 腰の移動も全部その子なので、まとめて同じ倍率がかかる。

const [hostPath, targetPath, boneName = 'mixamorig:Head'] = process.argv.slice(2)
if (!targetPath) {
  console.error('引数: <宿主.glb> <合わせる.glb> [骨名]')
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
  const encoder = new TextEncoder()
  let jsonBytes = encoder.encode(JSON.stringify(json))
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
  const binHeader = 20 + jsonBytes.length
  view.setUint32(binHeader, bin.length + pad, true)
  view.setUint32(binHeader + 4, 0x004e4942, true)
  out.set(bin, binHeader + 8)
  return out
}

/** ノードの TRS を 4x4 (行優先) に */
function trs(node) {
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
  return [
    r[0] * sx, r[1] * sy, r[2] * sz, tx,
    r[3] * sx, r[4] * sy, r[5] * sz, ty,
    r[6] * sx, r[7] * sy, r[8] * sz, tz,
    0, 0, 0, 1,
  ]
}

function mul(a, b) {
  const out = new Array(16).fill(0)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) out[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]
  return out
}

/** 素の姿勢での、その骨のワールド高さ (m) */
function boneHeight(json, name) {
  const nodes = json.nodes
  const parent = new Map()
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
  const cache = new Map()
  const world = (i) => {
    if (cache.has(i)) return cache.get(i)
    const p = parent.get(i)
    const m = p === undefined ? trs(nodes[i]) : mul(world(p), trs(nodes[i]))
    cache.set(i, m)
    return m
  }
  const index = nodes.findIndex((n) => n.name === name)
  if (index < 0) throw new Error(`骨が無い: ${name}`)
  return world(index)[7]
}

/** 骨格の根が下がっているノード = Armature。倍率をかける先 */
function armatureIndex(json) {
  const root = json.scenes[json.scene ?? 0].nodes[0]
  return root
}

const host = parseGlb(new Uint8Array(await Bun.file(hostPath).arrayBuffer()))
const target = parseGlb(new Uint8Array(await Bun.file(targetPath).arrayBuffer()))

const want = boneHeight(host.json, boneName)
const have = boneHeight(target.json, boneName)
const factor = want / have

const index = armatureIndex(target.json)
const node = target.json.nodes[index]
const scale = node.scale ?? [1, 1, 1]
node.scale = scale.map((v) => v * factor)

const after = boneHeight(target.json, boneName)
console.log(`宿主 ${boneName} ${want.toFixed(4)} m`)
console.log(`前   ${have.toFixed(4)} m  (差 ${((have - want) * 100).toFixed(1)} cm)`)
console.log(`倍率 ${factor.toFixed(6)} を ${node.name} の scale へ`)
console.log(`後   ${after.toFixed(4)} m  (差 ${((after - want) * 100).toFixed(1)} cm)`)

await Bun.write(targetPath, writeGlb(target.json, target.bin))
console.log(`書いた ${targetPath}`)
