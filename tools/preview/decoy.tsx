/**
 * decoy を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/decoy.html
 *     ?t=0.6      置いてから何秒の絵か (膨らみ切るのは 2 秒)
 *     ?skin=raiden
 *
 * 本物は「支援に decoy を選んで、置いて、2 秒待つ」でしか出ない。膨らむ途中の
 * 形は 2 秒しか映らないので、**時を止めて 1 枚描く**。
 *
 * 見たいのは 2 つ。**下から膨らんでいるか** (腰を中心に伸びると床へめり込む)
 * と、**平たい台があるか** (よく見れば偽物だと分かる手掛かり)。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { Decoys } from '../../src/presentation/scene/arms/decoys'
import { DEPLOY_SECONDS } from '../../src/domain/item/decoy'

const WIDTH = 1280
const HEIGHT = 720
const EXPOSURE = 3.0

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = EXPOSURE
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
buildLights(scene)

// 床。**足が埋まっていないか**を見るのに要る
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.9 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 100)
camera.position.set(0, 1.6, 5.6)
camera.lookAt(0, 0.85, 0)

const query = new URLSearchParams(location.search)
const skin = query.get('skin') ?? 'soldier'

/*
 * 経過をずらして 4 体並べる。**1 枚で移り変わりが読める。**
 *
 * 膨らみは 2 秒で終わるので、動かして見ると速すぎて形を比べられない
 * (水しぶきの試写と同じ理由)。
 */
const decoys = new Decoys(scene)
const AT = [-2.4, -0.8, 0.8, 2.4]
const ELAPSED = query.has('t')
  ? AT.map(() => Number(query.get('t')))
  : [0, DEPLOY_SECONDS * 0.35, DEPLOY_SECONDS * 0.7, DEPLOY_SECONDS]

AT.forEach((x, i) => {
  decoys.place(i + 1, [x, 0, 0], Math.PI, skin, Math.max(0, DEPLOY_SECONDS - ELAPSED[i]!))
})

await renderer.init()
// 姿 (glb) が届くのを待つ。届く前に描くと台だけが映る
await new Promise((done) => setTimeout(done, 4000))

// 膨らみを進める。**時を止めて 1 枚**なので、まとめて進めてから描く
decoys.update(0)
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
