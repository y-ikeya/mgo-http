/**
 * 突撃銃の主観 (照準器を覗く段) を、**本番と同じ置き方で**カメラの前に出して見る。
 *
 *     bunx vite → http://localhost:5174/tools/preview/sight.html?weapon=rifle
 *     ?weapon=rifle|m4   どの銃か
 *     ?fov=30            画角 (度)。weapons.ts の scope と同じ値
 *
 * 画面の真ん中に細い十字を引く。**照準器 (照門と照星の頂 / ホロサイトの窓) が十字に
 * 重なっていれば、照準線と弾の行き先が一致している** (弾は画面の真ん中へ飛ぶ)
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { Weapon, WEAPON_CONFIGS, cutSightGlass } from '../../src/presentation/scene/arms/weapon'

const query = new URLSearchParams(location.search)
const kind = (query.get('weapon') ?? 'rifle') as 'rifle' | 'm4'
const fov = Number(query.get('fov') ?? '30')
const WIDTH = 1280
const HEIGHT = 800

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fa3b8)
buildLights(scene)
// 遠くの的。照準線がどこを指すかを見る
const target = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), new THREE.MeshStandardMaterial({ color: 0x884422 }))
target.position.set(0, 0, -25)
scene.add(target)

// 本番と同じ: 画角 fov、近い面 0.1 (sense/camera.ts)
const camera = new THREE.PerspectiveCamera(fov, WIDTH / HEIGHT, 0.1, 500)
scene.add(camera)
const weapon = await Weapon.load(kind)
const sight = WEAPON_CONFIGS[kind].sight!
const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sight.pitch).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sight.roll))
weapon.object.quaternion.copy(turn)
weapon.object.position.copy(sight.eye).applyQuaternion(turn).negate()
if (sight.glass) cutSightGlass(weapon.object, sight.glass)
camera.add(weapon.object)

// 真ん中の十字 (画面に描く)
const cross = document.createElement('div')
cross.style.cssText = 'position:fixed;left:640px;top:400px;width:1px;height:1px;pointer-events:none'
cross.innerHTML =
  '<div style="position:absolute;left:-40px;top:0;width:80px;height:1px;background:#0f0"></div>' +
  '<div style="position:absolute;left:0;top:-40px;width:1px;height:80px;background:#0f0"></div>'
document.body.appendChild(cross)

await renderer.init()
await renderer.renderAsync(scene, camera)
console.log('[sight] drawn', kind, JSON.stringify(sight), weapon.object.position.toArray().map((v) => v.toFixed(4)).join(','))
