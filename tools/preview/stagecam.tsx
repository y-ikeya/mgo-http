/**
 * ステージを**本番と同じ光と影で**、決めた場所から描く。
 *
 *     bunx vite → http://localhost:5174/tools/preview/stagecam.html
 *     ?stage=city            どのステージか
 *     ?eye=-12,11,48         カメラの位置 (three の x,y,z)
 *     ?look=-8,13,44         カメラの向く先
 *     ?fov=60
 *     ?shadow=0              太陽の影マップを切る
 *     ?vcol=0                焼き込みの頂点色 (空の見え方) を切る
 *     ?col=1                 描かない物 (col_ など) も描く
 *
 * --- なぜ要るか ---
 * 壁に斜めの帯が出た時、影マップの影なのか、焼き込んだ頂点色なのか、見えない当たりの
 * 箱の影なのかは、**本番の画面では切り分けられない**。ここで 1 つずつ切って見比べる。
 * 対戦部屋に入らずに済む (同じアカウントだと席を奪う)。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { applyStageSun, buildLights, buildStage, fitShadowToStage, loadStageSun, type StageName } from '../../src/presentation/scene/world/stage'

const query = new URLSearchParams(location.search)
const stageName = (query.get('stage') ?? 'city') as StageName
const vec = (key: string, fallback: [number, number, number]): THREE.Vector3 => {
  const raw = query.get(key)?.split(',').map(Number)
  return raw && raw.length === 3 && raw.every(Number.isFinite) ? new THREE.Vector3(raw[0], raw[1], raw[2]) : new THREE.Vector3(...fallback)
}
const eye = vec('eye', [-12, 11, 48])
const look = vec('look', [-8, 13, 44])
const fov = Number(query.get('fov') ?? '60')

const renderer = new WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = query.get('shadow') !== '0'
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.0
document.body.appendChild(renderer.domElement)
await renderer.init()

const scene = new THREE.Scene()
const stage = buildStage(scene, stageName)
const sun = buildLights(scene)
sun.castShadow = query.get('shadow') !== '0'

const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 400)
camera.position.copy(eye)
camera.lookAt(look)

const [, sunData] = await Promise.all([stage.ready, loadStageSun(stageName)])
if (sunData) applyStageSun(sun, sunData)
fitShadowToStage(sun, stage)

if (query.get('vcol') === '0' || query.get('col') === '1') {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (query.get('col') === '1' && !mesh.visible) mesh.visible = true
    if (query.get('vcol') === '0') {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const m = material as THREE.Material & { vertexColors?: boolean }
        if (m.vertexColors) {
          m.vertexColors = false
          m.needsUpdate = true
        }
      }
    }
  })
}

const panel = document.createElement('pre')
panel.className = 'panel'
panel.textContent = `stage ${stageName}\neye ${eye.toArray().map((v) => v.toFixed(1)).join(',')}\nlook ${look.toArray().map((v) => v.toFixed(1)).join(',')}\nshadow ${sun.castShadow ? 'on' : 'off'}  vcol ${query.get('vcol') === '0' ? 'off' : 'on'}  col ${query.get('col') === '1' ? 'shown' : 'hidden'}`
document.body.appendChild(panel)

function frame(): void {
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
frame()
;(window as unknown as { stagecamReady: boolean }).stagecamReady = true
