import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * 装備の画面に出す**影絵**を作る。
 *
 *     ?model=rifle   public/models/<model>.glb を横から白一色で描く
 *
 * 背景は透明。headless Chrome の `--default-background-color=00000000` で
 * 撮ると、そのまま public/icons/<model>.png になる (tools/README.md)。
 * 色は付けない — 画面側が mask にして塗る (殺傷は赤、麻酔は青)。
 *
 * 銃は銃口が -Z を向いている (convert_gltf_gun.py)。+X 側から見ると
 * 銃身が横に寝て、右が銃口になる。
 */
const query = new URLSearchParams(location.search)
const model = query.get('model') ?? 'rifle'
const WIDTH = 240
const HEIGHT = 120

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.setClearColor(0x000000, 0)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
// ?debug … 読めたか・大きさを画面に書く (撮った絵が空のときの手掛かり)
const note = document.createElement('pre')
note.style.cssText = 'position:fixed;left:2px;top:2px;margin:0;font:9px monospace;color:#9ab88c;white-space:pre-wrap'
if (query.has('debug')) document.body.appendChild(note)
const say = (text: string) => { note.textContent += text + '\n' }
window.addEventListener('error', (e) => say('error ' + e.message))
/*
 * **絵 (テクスチャ) は読まない。** 影絵に要るのは形だけで、glb の大半は絵。
 * 散弾銃は 12MB のうちほぼ全部が絵で、headless では絵の展開が終わらず
 * 1 枚も撮れなかった。glb の JSON から images / textures / samplers を
 * 落とし、材質の絵の参照も外してから読む。
 */
async function loadShapeOnly(url: string) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  const view = new DataView(bytes.buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  const binStart = 20 + jsonLength + 8
  const binLength = view.getUint32(20 + jsonLength, true)
  const bin = bytes.subarray(binStart, binStart + binLength)
  delete json.images
  delete json.textures
  delete json.samplers
  for (const mat of json.materials ?? []) {
    delete mat.normalTexture
    delete mat.occlusionTexture
    delete mat.emissiveTexture
    if (mat.pbrMetallicRoughness) {
      delete mat.pbrMetallicRoughness.baseColorTexture
      delete mat.pbrMetallicRoughness.metallicRoughnessTexture
    }
    delete mat.extensions
  }
  delete json.extensionsUsed
  delete json.extensionsRequired
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const padded = new Uint8Array(jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4)).fill(0x20)
  padded.set(jsonBytes)
  const out = new Uint8Array(12 + 8 + padded.length + 8 + bin.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, out.length, true)
  dv.setUint32(12, padded.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(padded, 20)
  dv.setUint32(20 + padded.length, bin.length, true)
  dv.setUint32(24 + padded.length, 0x004e4942, true)
  out.set(bin, 28 + padded.length)
  return new GLTFLoader().parseAsync(out.buffer, '')
}

let gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>>
try {
  gltf = await loadShapeOnly(`/models/${model}.glb`)
} catch (e) {
  say('load failed ' + String(e))
  throw e
}
const root = gltf.scene
let meshes = 0
root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++ })
say(`loaded ${model} meshes ${meshes}`)
// 白一色。陰も付けない — 影絵なので形だけを渡す
root.traverse((o) => {
  const mesh = o as THREE.Mesh
  if (!mesh.isMesh) return
  mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff })
})
scene.add(root)
root.updateMatrixWorld(true)

const box = new THREE.Box3().setFromObject(root)
const size = box.getSize(new THREE.Vector3())
const center = box.getCenter(new THREE.Vector3())
/*
 * 見る向きは**薄いほうの軸から**。
 *
 * 銃身は -Z で揃っているが、横に寝ている物がある (突撃銃は側面が X に
 * 向いていて、Y の厚みは 3cm)。厚みの薄い軸から見れば側面が映る。
 * `?view=x` / `?view=y` で決め打ちもできる。
 */
const view = query.get('view') ?? (size.x < size.y ? 'x' : 'y')
const spanUp = view === 'x' ? size.y : size.x
// 横 (Z) と縦を枠に収める。余白は 8%
const margin = 1.08
const aspect = WIDTH / HEIGHT
let halfW = (size.z * margin) / 2
let halfH = (spanUp * margin) / 2
if (halfW / halfH < aspect) halfW = halfH * aspect
else halfH = halfW / aspect
const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100)
// 銃口 (-Z) が画面の右に来る側から見る
if (view === 'x') {
  camera.position.set(center.x + 10, center.y, center.z)
  camera.up.set(0, 1, 0)
} else {
  // 上から。**上は -X** — +X にすると絵が 180° 回って、銃口が左・弾倉が上になる
  // 模型ごとに寝ている向きが違う (突撃銃は逆)。`?flip` で上下を返す
  camera.position.set(center.x, center.y + 10, center.z)
  camera.up.set(query.has('flip') ? 1 : -1, 0, 0)
}
camera.lookAt(center)
say(`size ${size.toArray().map((v) => v.toFixed(3)).join(',')} view ${view} half ${halfW.toFixed(3)}x${halfH.toFixed(3)}`)
renderer.render(scene, camera)
say('rendered')
;(globalThis as unknown as { ready: boolean }).ready = true
