import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { AllyNames } from '../../src/presentation/scene/actor/allyNames'

/**
 * 味方の名札 (actor/allyNames.ts) を見る。
 *
 *     bunx vite → http://localhost:5173/tools/preview/allynames.html
 *     ?team=red  陣営 (既定 blue)
 *
 * 近く・中ほど・遠くに 1 人ずつ。**遠くても同じ大きさで読めるか**、明るい壁の前でも
 * 読めるか、頭の上に浮いているかを見る。カメラの後ろの 1 人 (BEHIND) は出てはいけない。
 */
const WIDTH = 1280
const HEIGHT = 720
const query = new URLSearchParams(location.search)
const team = (query.get('team') ?? 'blue') as 'blue' | 'red'

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = Number(query.get('exp') ?? '3')
const host = document.createElement('div')
host.style.cssText = 'position:relative;width:1280px;height:720px'
document.body.appendChild(host)
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbcd2e4)
buildLights(scene)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.95 }))
floor.rotation.x = -Math.PI / 2
scene.add(floor)
// 明るい壁 (漆喰の色)
const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 0.4), new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.9 }))
wall.position.set(-2, 3, -30)
scene.add(wall)

const people: [string, THREE.Vector3][] = [
  ['Timber_lane', new THREE.Vector3(-1.5, 0, 2)],
  ['TX_Ikemen', new THREE.Vector3(2.5, 0, -8)],
  ['Bowies', new THREE.Vector3(-4, 0, -26)],
  // カメラの後ろ。**出てはいけない** (裏返って前に映った)
  ['BEHIND', new THREE.Vector3(0.5, 0, 14)],
]
for (const [, at] of people) {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }))
  body.position.set(at.x, 0.85, at.z)
  scene.add(body)
}
const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 300)
camera.position.set(0, 1.9, 7)
camera.lookAt(0, 1.4, -10)

const names = new AllyNames(host)
camera.updateMatrixWorld()
names.sync(people.map(([name, at], i) => ({ id: String(i), name, team, head: new THREE.Vector3(at.x, 1.65, at.z) })), camera, WIDTH, HEIGHT)

await renderer.init()
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
