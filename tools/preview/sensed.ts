import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { Sensed } from '../../src/presentation/scene/fx/sensed'

/**
 * AWARENESS の気配 (霧) を**壁越しに**見る。
 *
 *     bunx vite → http://localhost:5174/tools/preview/sensed.html
 *     ?t=1.5    脈の位相 (秒)
 *
 * 壁を 1 枚立てて、その裏に 2 つ、手前に 1 つ気配を置く。見るのは
 * **壁の裏でも見えているか**と、**物には見えず「その辺に何かある」に留まっているか**。
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

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.95 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// 壁。裏の気配がこれを透けて見えるか
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(10, 3, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.9 }),
)
wall.position.set(0, 1.5, -4)
wall.castShadow = true
wall.receiveShadow = true
scene.add(wall)

const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 200)
camera.position.set(0, 2.2, 8)
camera.lookAt(0, 1, -4)

const sensed = new Sensed(scene)
sensed.show('claymore:1', [-2.5, 0, -8])
sensed.show('decoy:2', [2.5, 0, -7])
sensed.show('grenade:3', [3.5, 0, -1.5])

const query = new URLSearchParams(location.search)
const at = Number(query.get('t') ?? '1.5')

await renderer.init()
sensed.update(at)
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
