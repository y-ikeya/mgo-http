// AK (public/models/rifle.glb) のマガジンの絵を、黒い金属の所へ貼り替える。
//
//     bun tools/fix_ak_mag_uv.js tools/raw/rifle_orig.glb public/models/rifle.glb [--dry]
//
// **元の模型 (tools/raw/rifle_orig.glb、convert_ak.py の出力) から毎回作る。** 直した glb にかけ直すと、
// 写した UV の三角が付け根の木目の判定に入って結果が変わる
//
// --- なぜ要るか (2026-11-20 本人「ak のマガジン部分の texure おかしいかも」) ---
// 元の素材 (OBJ + 絵 1 枚、tools/convert_ak.py で変換) は、マガジンの UV が絵と合っていない。マガジンの大きな
// 面が銃床の木目の所に重なり、黒い金属に木目の帯がまだらに出ていた。元の素材は手元に無いので、glb の上で直す。
//
// 直すのは 2 つ。どちらも頂点の UV を、絵の中のむらの少ない暗い金属の所 (PATCH) へ、元の並びのまま縮めて写す。
//   1. マガジン = 受け筒より下 (模型の -X、寝かせてある) で、握りより前の三角
//   2. マガジンの付け根・受け筒の下の方 (WELL) で、絵が木目を指している三角 (金属の所なので木目は誤り)
const [path, out, ...flags] = process.argv.slice(2)
const dry = flags.includes('--dry')
// マガジンの三角の重心の範囲 (模型の空間、m)。下 = -X、前 = -Z
const MAG = { xBelow: -0.108, zFrom: -0.53, zTo: -0.36 }
// マガジンの付け根の辺り。ここでは絵が木目 (赤み) を指している三角だけを直す
const WELL = { xBelow: -0.033, zFrom: -0.55, zTo: -0.33 }
// 絵の暗い金属の所 (UV、v は glTF の向き = 上から)。512px の絵の (16..56, 136..176) px
const PATCH = { u0: 16 / 512, u1: 56 / 512, v0: 136 / 512, v1: 176 / 512 }

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
if (json.extensionsUsed?.length) throw new Error(`拡張付き (${json.extensionsUsed}) は扱わない`)
const binStart = 20 + jsonLength + 8
const typed = (index, Type, comps) => {
  const a = json.accessors[index]
  const v = json.bufferViews[a.bufferView]
  if (v.byteStride && v.byteStride !== comps * Type.BYTES_PER_ELEMENT) throw new Error('stride')
  return new Type(bytes.buffer, binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * comps)
}
// 絵 (埋め込みの JPEG) を読む。木目 = 赤みが強い (r - b > 0.08)
const imageView = json.bufferViews[json.images[0].bufferView]
const imageBytes = bytes.subarray(binStart + (imageView.byteOffset ?? 0), binStart + (imageView.byteOffset ?? 0) + imageView.byteLength)
const sharp = (await import('sharp')).default
const { data: texels, info } = await sharp(Buffer.from(imageBytes)).raw().toBuffer({ resolveWithObject: true })
const isWood = (u, v) => {
  const x = Math.min(info.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * info.width)))
  const y = Math.min(info.height - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * info.height)))
  const i = (y * info.width + x) * info.channels
  return (texels[i] - texels[i + 2]) / 255 > 0.08
}
let changed = 0
for (const mesh of json.meshes) for (const prim of mesh.primitives) {
  if (json.accessors[prim.attributes.TEXCOORD_0].componentType !== 5126) throw new Error('UV が float でない')
  const pos = typed(prim.attributes.POSITION, Float32Array, 3)
  const uv = typed(prim.attributes.TEXCOORD_0, Float32Array, 2)
  const ia = json.accessors[prim.indices]
  const idx = typed(prim.indices, ia.componentType === 5125 ? Uint32Array : Uint16Array, 1)
  const mag = new Set()
  let woody = 0
  for (let t = 0; t < idx.length; t += 3) {
    let x = 0, z = 0, u = 0, v = 0
    for (let k = 0; k < 3; k++) {
      x += pos[idx[t + k] * 3]; z += pos[idx[t + k] * 3 + 2]
      u += uv[idx[t + k] * 2]; v += uv[idx[t + k] * 2 + 1]
    }
    x /= 3; z /= 3; u /= 3; v /= 3
    const inMag = x < MAG.xBelow && z > MAG.zFrom && z < MAG.zTo
    const inWell = !inMag && x < WELL.xBelow && z > WELL.zFrom && z < WELL.zTo && isWood(u, v)
    if (inWell) woody++
    if (inMag || inWell) for (let k = 0; k < 3; k++) mag.add(idx[t + k])
  }
  console.log(`付け根の木目の三角 ${woody}`)
  if (mag.size === 0) continue
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (const i of mag) { u0 = Math.min(u0, uv[i * 2]); u1 = Math.max(u1, uv[i * 2]); v0 = Math.min(v0, uv[i * 2 + 1]); v1 = Math.max(v1, uv[i * 2 + 1]) }
  for (const i of mag) {
    uv[i * 2] = PATCH.u0 + ((uv[i * 2] - u0) / (u1 - u0 || 1)) * (PATCH.u1 - PATCH.u0)
    uv[i * 2 + 1] = PATCH.v0 + ((uv[i * 2 + 1] - v0) / (v1 - v0 || 1)) * (PATCH.v1 - PATCH.v0)
  }
  changed += mag.size
  console.log(`${mesh.name}: マガジンの頂点 ${mag.size} / ${pos.length / 3} (元の UV の範囲 u ${u0.toFixed(2)}..${u1.toFixed(2)} v ${v0.toFixed(2)}..${v1.toFixed(2)})`)
}
if (!dry && changed) await Bun.write(out, bytes)
console.log(dry ? '数えただけ' : `書いた ${out}`)
