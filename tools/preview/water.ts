import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights, buildStage } from '../../src/presentation/scene/world/stage'
import { Shots } from '../../src/presentation/scene/fx/shots'

/**
 * 水面だけの試写。**部屋に入らずに見る。**
 *
 * 映り込みは場面をもう一度描くので、組み上がるまで分からない。対戦部屋へ
 * 入ると席を 1 つ潰すので、庭園とカメラだけを立てて 1 枚描く。
 */
const WIDTH = 1280
const HEIGHT = 720
const EXPOSURE = 3.0

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = EXPOSURE
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
buildStage(scene, 'garden')
buildLights(scene)

/*
 * 見る場所と、止める時刻を URL で選ぶ。
 *   ?eye=near  しぶきの真横 (柱と泡を見る)
 *   ?t=0.2     叩いてから何秒の絵か
 */
const query = new URLSearchParams(location.search)
const near = query.get('eye') === 'near'
const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 500)
if (near) {
  camera.position.set(-27.6, 10.65, -25.4)
  camera.lookAt(-30, 10.25, -28)
} else {
  // 灯篭 (x -38.8, z -33.1) を水越しに見る。目の高さから、浅い角度で
  // 灯篭 (x -38.8, z -33.1) を水越しに見る。目の高さから、浅い角度で
  // 青の台に立って、開けた水の向こうを見る
  camera.position.set(-14, 22, -14)
  camera.lookAt(-33, 11, -35)
}

/*
 * 水しぶき。**時をずらして出す。**
 *
 * 柱 (0.4 秒) と波紋 (1.2 秒) は寿命が 3 倍違うので、同時に出すと 1 枚の絵で
 * 両方を見られない。落ちた時刻をずらして並べれば、1 枚で経過が読める。
 */
const shots = new Shots(scene)
const SPLASH_AT = [
  { x: -30, z: -30, delay: 0.0, strength: 1 },
  { x: -27, z: -33, delay: 0.12, strength: 2.2 },
  { x: -33, z: -27, delay: 0.35, strength: 1 },
  { x: -24, z: -24, delay: 0.8, strength: 0.45 },
]
const WATER_Y = 10.02
const STEP = 1 / 120
const UNTIL = Number(query.get('t') ?? 0.95)

await renderer.init()
// glb が届くのを待つ。届く前に描くと箱だけの下絵が映る
await new Promise((done) => setTimeout(done, 4000))

const fired = new Set<number>()
for (let t = 0; t < UNTIL; t += STEP) {
  SPLASH_AT.forEach((s, i) => {
    if (fired.has(i) || t < s.delay) return
    fired.add(i)
    shots.splash(new THREE.Vector3(s.x, WATER_Y, s.z), WATER_Y, s.strength)
  })
  shots.update(STEP)
}

await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
