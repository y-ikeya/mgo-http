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

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const args = process.argv.slice(2)
// 持ち上げずに、型の腰の高さを伸ばして足を着ける (下の「--hips」)
const HIPS = args.includes('--hips')
const [hostPath, targetPath] = args.filter((a) => a !== '--hips')
if (!targetPath) {
  console.error('引数: <宿主.glb> <合わせる.glb> [--hips]')
  process.exit(1)
}

function parseGlb(bytes, path) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  // meshopt 圧縮した glb はバイト列を float と誤読して静かに壊すので、先に断る
  if (json.extensionsUsed?.includes('EXT_meshopt_compression')) {
    console.error(`${path} は meshopt 圧縮済み。この道具は圧縮前の glb 専用 (手順は tools/README.md)`)
    process.exit(1)
  }
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

const host = parseGlb(new Uint8Array(await Bun.file(hostPath).arrayBuffer()), hostPath)
const target = parseGlb(new Uint8Array(await Bun.file(targetPath).arrayBuffer()), targetPath)

/**
 * 素の姿勢での頭の高さ。**節を root から辿って足し上げる。**
 *
 * 回転は骨の並びに沿っているので、素の姿勢なら足し算で届く。ここで見たいのは
 * 絶対の高さではなく**宿主との比**なので、これで足りる。
 */
/**
 * 素の型 (idle) を流したときの、頭の骨の高さ (m)。
 *
 * **骨の translation を足し算しない。** 骨のローカル軸は Y 上とは限らず
 * (この骨格は Z が上)、しかも節ごとに回転が挟まる。実際に読み込んで
 * 世界座標を読むのが確実。
 */
async function measure(path) {
  const gltf = await new GLTFLoader().parseAsync(await Bun.file(path).arrayBuffer(), '')
  const clip = gltf.animations.find((a) => a.name === 'idle') ?? gltf.animations[0]
  if (!clip) throw new Error(`${path} にクリップが無い`)
  const mixer = new THREE.AnimationMixer(gltf.scene)
  mixer.clipAction(clip).play()
  mixer.update(0.5)
  gltf.scene.updateMatrixWorld(true)
  const at = (suffix) => {
    let found = null
    gltf.scene.traverse((o) => {
      if (found === null && o.name.endsWith(suffix)) found = o.getWorldPosition(new THREE.Vector3()).y
    })
    if (found === null) throw new Error(`${path} に ${suffix} の骨が無い`)
    return found
  }
  const toe = Math.min(at('LeftToeBase'), at('RightToeBase'))
  return { head: at('mixamorigHead'), toe, hips: at('mixamorigHips') }
}

/*
 * --- 合わせるのは腰ではなく**頭** ---
 *
 * 遮蔽も当たり判定も頭の高さ (sim の HEAD_HEIGHT = 1.47) から決まる。頭が
 * ずれた体を入れると、その人だけ**見えている頭を撃つと胴に当たる**。
 *
 * 腰を揃えても頭は合わない。骨の長さが体ごとに違うので、胴が長い体は腰を
 * 揃えたぶん頭が上へ出る (実測で 11.8cm)。全体を均一に縮めれば、頭が合って
 * 足も地面に着く — 腰が宿主より少し低い体になるだけ。
 *
 * **クリップが骨の位置を持っていた頃は要らなかった。** あの頃は骨格ごと
 * 宿主に上書きされていたので、何を入れても頭は揃った — 代わりにメッシュが
 * 裂けていた (merge_all_clips.js の注)。
 */
/** 骨格の根に乗っている持ち上げ (m) */
function armatureLift(json) {
  return armature(json).translation?.[1] ?? 0
}

/**
 * 全部の型の腰の位置の、**上の成分だけ**を f 倍にする。返すのは書き換えた列の数。
 *
 * 上がどの軸かは腰の親 (骨格の根) の回転で決まる (この骨格は Z が上)。
 * 同じ列を型どうしで分け合っている (dedup) ので、列ごとに 1 度だけ掛ける
 */
function scaleHipsHeight(glb, f) {
  const { json, bin } = glb
  const hipsIndex = json.nodes.findIndex((n) => n.name?.endsWith('Hips'))
  // 親の空間での「上」。世界の上 (0,1,0) を、根から親までの回転の逆で戻す
  const chain = []
  for (let p = json.nodes.findIndex((n) => n.children?.includes(hipsIndex)); p >= 0; ) {
    chain.push(p)
    p = json.nodes.findIndex((n) => n.children?.includes(p))
  }
  const world = new THREE.Quaternion()
  for (const i of chain.reverse()) world.multiply(new THREE.Quaternion(...(json.nodes[i].rotation ?? [0, 0, 0, 1])))
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(world.invert())
  const done = new Set()
  for (const clip of json.animations ?? []) {
    for (const ch of clip.channels) {
      if (ch.target.node !== hipsIndex || ch.target.path !== 'translation') continue
      const index = clip.samplers[ch.sampler].output
      if (done.has(index)) continue
      done.add(index)
      const acc = json.accessors[index]
      if (acc.componentType !== 5126 || acc.type !== 'VEC3') throw new Error(`腰の列 ${index} が float の VEC3 でない`)
      const view = json.bufferViews[acc.bufferView]
      const stride = view.byteStride ?? 12
      const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
      const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
      const v = new THREE.Vector3()
      for (let k = 0; k < acc.count; k++) {
        const o = base + k * stride
        v.set(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true))
        v.addScaledVector(up, (f - 1) * v.dot(up))
        dv.setFloat32(o, v.x, true)
        dv.setFloat32(o + 4, v.y, true)
        dv.setFloat32(o + 8, v.z, true)
      }
      if (acc.min && acc.max) {
        delete acc.min
        delete acc.max
      }
    }
  }
  return done.size
}

const host_ = await measure(hostPath)
const mine = await measure(targetPath)
const node = armature(target.json)
const have = (node.scale ?? [1, 1, 1])[0]

/*
 * --- 背丈 (足→頭) を合わせて、足元で置き直す ---
 *
 * 頭だけ合わせると、脚の長い体は**爪先が地面を突き抜ける** (実測 7.5cm)。
 * 腰だけ合わせると頭が上へ出る (11.8cm)。どちらも片手落ち。
 *
 * **足から頭までの長さ**で縮めてから、爪先が宿主と同じ高さに来るよう全体を
 * 持ち上げる。足が地面に着いて、頭も揃う。腰の高さは体つきのぶんだけずれるが、
 * そこは見た目の話で、判定はどれも頭と足から決まる。
 */
const want = have * ((host_.head - host_.toe) / (mine.head - mine.toe))
node.scale = [want, want, want]

console.log(`宿主 頭 ${host_.head.toFixed(4)} 爪先 ${host_.toe.toFixed(4)}`)
console.log(`こちら 頭 ${mine.head.toFixed(4)} 爪先 ${mine.toe.toFixed(4)}`)

if (!HIPS) {
  // 縮めたぶん爪先も動くので、そのあとで持ち上げる量を出す
  const lift = host_.toe - mine.toe * (want / have)
  node.translation = [
    (node.translation?.[0] ?? 0),
    (node.translation?.[1] ?? 0) + lift,
    (node.translation?.[2] ?? 0),
  ]
  console.log(`scale ${have.toFixed(6)} -> ${want.toFixed(6)} / 持ち上げ ${lift.toFixed(4)}m`)
} else {
  /*
   * --- --hips: 持ち上げずに、型の腰の高さを伸ばす ---
   *
   * **持ち上げは型によらず一定**なので、伏せると体が浮く。型の腰の高さは
   * 宿主の脚の長さで入っているから、脚の長い体は立つと爪先が沈み、それを
   * 持ち上げで埋めると、腰が低い型 (伏せ・匍匐) ではその分だけ宙に浮く
   * (名無しで匍匐の一番低い所が 14.7cm、soldier は 2.5cm)。
   *
   * 腰の**上下だけ**を f 倍にする。立っても伏せても腰の高さが脚の長さに比例する。
   * 前後左右の動きは触らない (跳び越えの距離などは宿主のまま)。
   * f は idle で爪先が宿主と同じ高さに来る値。爪先の高さは f に対して一次なので、
   * 1 回測って解き、もう 1 回測って確かめる
   */
  await Bun.write(targetPath, writeGlb(target.json, target.bin))
  const before = await measure(targetPath)
  const f = 1 + (host_.toe - before.toe) / (before.hips - armatureLift(target.json))
  const touched = scaleHipsHeight(target, f)
  await Bun.write(targetPath, writeGlb(target.json, target.bin))
  const after = await measure(targetPath)
  console.log(`scale ${have.toFixed(6)} -> ${want.toFixed(6)} / 腰の上下 ×${f.toFixed(4)} (列 ${touched})`)
  console.log(`合わせた後 頭 ${after.head.toFixed(4)} 爪先 ${after.toe.toFixed(4)}`)
}

await Bun.write(targetPath, writeGlb(target.json, target.bin))
console.log(`書いた ${targetPath}`)
