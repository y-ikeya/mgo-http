import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { Locators } from '../../src/presentation/scene/arms/locators'
import { loadLocator } from '../../src/presentation/scene/assets'
import type { SolidWorld } from '../../src/sim/space/vision'

/**
 * 置かれた E LOCATOR を**近くで見る**。
 *
 *     bunx vite → http://localhost:5174/tools/preview/locator.html
 *     ?shade=1     日陰に置く (太陽を弱めて、灯の光が床に落ちるのを見る)
 *     ?off=1       灯が消えている瞬間
 *     ?wave=0.15   自分の物から出る波を、出てから何秒の所で止めるか (0.7 で消える)
 *     ?eye=far     8m 離れて見る (波を丸ごと画面に入れる)
 *
 * 左が**自分の物** (光の玉が出る)、右が**敵の物** (装置と灯の点滅だけ)。
 * 見るのは 2 つ — 敵の物に光の玉が出ていないか、灯の光が床に落ちているか。
 */
const WIDTH = 1280
const HEIGHT = 720
const EXPOSURE = 3.0

const query = new URLSearchParams(location.search)
const shade = query.has('shade')
const off = query.has('off')
const wave = query.get('wave')
const far = query.get('eye') === 'far'

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = EXPOSURE
renderer.shadowMap.enabled = true
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbcd2e4)
const sun = buildLights(scene)
// 日陰。太陽を弱めて、灯の光が床に落ちるのを見えるようにする
if (shade) sun.intensity = 0.15

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.9 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// 後ろの壁。壁にも光が落ちるか
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 4),
  new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 0.9 }),
)
wall.position.set(0, 2, -0.45)
wall.receiveShadow = true
scene.add(wall)

const camera = new THREE.PerspectiveCamera(35, WIDTH / HEIGHT, 0.05, 100)
if (far) {
  camera.position.set(0, 2.5, 8)
  camera.lookAt(-0.7, 0.8, 0)
} else {
  camera.position.set(0, 0.9, 2.6)
  camera.lookAt(0, 0.05, 0)
}

const locators = new Locators(scene)
locators.setSelfTeam('blue')

await renderer.init()
// 模型 (glb) が届くのを待つ。届く前に描くと代役の箱が映る。**秒で待たない** —
// 撮る側 (headless Chrome) は時計を進めるので、秒では間に合わない
await loadLocator()
locators.place(1, [-0.7, 0, 0], true)
locators.place(2, [0.7, 0, 0], false)

/*
 * 点滅の位相を進める。**時を止めて 1 枚。**
 *
 * 1 周 (1 秒) 回してから止める。波 (0.7 秒で消える) が画面を覆わない所で、
 * 灯だけが点いている瞬間になる。
 */
const STEP = 1 / 60
// 波は置いた瞬間から数えるので、指定の秒でそのまま止めればその位相になる
const until = wave !== null ? Number(wave) : off ? 1.5 : 1.05
// 置いた物は止まっているので、地形は問われない。何も無い世界でよい
const open: SolidWorld = { hit: () => null }
for (let t = 0; t < until; t += STEP) locators.update(STEP, open, null)

await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
