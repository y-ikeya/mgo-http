import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { BlastFx } from '../../src/presentation/scene/fx/blastfx'

/**
 * 手榴弾の爆発を**時を止めて並べる**。
 *
 *     bunx vite → http://localhost:5174/tools/preview/blast.html
 *     ?t=0.4        全部を同じ秒に (既定は 0.12 / 0.5 / 1.3 秒を横に並べる)
 *     ?view=low     地面すれすれから (破片の跳ねを見る)
 *     ?dist=10      カメラの距離 (m)。既定 22。対戦で見る距離は 8〜15m ほど
 *
 * 爆発は 2.4 秒で消えるので、対戦の中では形を比べられない。日向の床の上に
 * 3 つ並べて、**煙が光を受けているか** (太陽の側が明るく、陰が暗いか) と
 * **破片が飛んで落ちているか**を見る。
 *
 * 壁を 1 枚立ててあるのは、爆発の光が壁に落ちるのを見るため。
 */
const WIDTH = 1280
const HEIGHT = 720
const EXPOSURE = 3.0

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = EXPOSURE
renderer.shadowMap.enabled = true
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbcd2e4)
buildLights(scene)

// 床。**煙の陰と破片が乗る面**
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// 奥の壁。爆発の光が落ちるのを見る
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 10),
  new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 }),
)
wall.position.set(0, 5, -6)
wall.receiveShadow = true
scene.add(wall)

const query = new URLSearchParams(location.search)
const view = query.get('view') ?? 'mid'
const dist = Number(query.get('dist') ?? '22')

const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 200)
if (view === 'low') {
  camera.position.set(0, 1.2, dist)
  camera.lookAt(0, 1.5, 0)
} else {
  camera.position.set(0, 5, dist)
  camera.lookAt(0, 2.5, 0)
}

// 並べる間隔はカメラの距離に合わせる。近づけたら 3 つが画面に入らない
const AT = [-8, 0, 8].map((x) => (x * dist) / 22)
const ELAPSED = query.has('t') ? AT.map(() => Number(query.get('t'))) : [0.12, 0.5, 1.3]

// 1 つの BlastFx は 1 発分の粒しか持たない。並べるので 3 つ作る
const blasts = AT.map(() => new BlastFx(scene))

await renderer.init()
// 粒の絵 (particles.png) が届くのを待つ。届く前に爆ぜると粒が出ない
await new Promise((done) => setTimeout(done, 2000))

// **時を止めて 1 枚。** 固定刻みで進めてから描く (対戦と同じ dt の刻み)
const STEP = 1 / 60
blasts.forEach((blast, i) => {
  // ?scale=0.2 … 小さい爆発 (E LOCATOR が寿命で弾けるときの大きさ)
  blast.explode(new THREE.Vector3(AT[i]!, 0, 0), Number(query.get('scale') ?? '1'))
  for (let t = 0; t < ELAPSED[i]!; t += STEP) blast.update(STEP)
})

await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
