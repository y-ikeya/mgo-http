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
 *     ?col=1                 人が止まる面を水色で重ねる (?col=box 審判の箱 / ?col=all 両方。本番と同じ)
 *     ?place=x,y,z,yaw       その足元・向きで置く所の予告 (印と扇) を出す。置けなければ赤
 *
 * --- なぜ要るか ---
 * 壁に斜めの帯が出た時、影マップの影なのか、焼き込んだ頂点色なのか、見えない当たりの
 * 箱の影なのかは、**本番の画面では切り分けられない**。ここで 1 つずつ切って見比べる。
 * 対戦部屋に入らずに済む (同じアカウントだと席を奪う)。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { addColliderOverlay, applyStageSun, buildLights, buildStage, fitShadowToStage, loadStageBoxes, loadStageMoveWorld, loadStageSun, type StageName } from '../../src/presentation/scene/world/stage'
import { PlacePreview } from '../../src/presentation/scene/arms/placePreview'
import { placeSpot } from '../../src/sim/judge/claymore'
import { solidBlockers } from '../../src/sim/space/vision'
import { STEP_UP } from '../../src/domain/player/moving'

const query = new URLSearchParams(location.search)
const stageName = (query.get('stage') ?? 'city') as StageName
const vec = (key: string, fallback: [number, number, number]): THREE.Vector3 => {
  const raw = query.get(key)?.split(',').map(Number)
  return raw && raw.length === 3 && raw.every(Number.isFinite) ? new THREE.Vector3(raw[0], raw[1], raw[2]) : new THREE.Vector3(...fallback)
}
const eye = vec('eye', [-12, 11, 48])
const look = vec('look', [-8, 13, 44])
const fov = Number(query.get('fov') ?? '60')

// 深さの持ち方は本番と同じ既定 (?rdepth=1 で反転)
const renderer = new WebGPURenderer({ antialias: true, reversedDepthBuffer: query.get('rdepth') === '1' })
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
// ?col=1 / box / all … 当たりの形を透けて重ねる (本番と同じ switch)
addColliderOverlay(scene, stageName)
const sun = buildLights(scene)
sun.castShadow = query.get('shadow') !== '0'

const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 400)
camera.position.copy(eye)
camera.lookAt(look)

const [, sunData] = await Promise.all([stage.ready, loadStageSun(stageName)])
if (sunData) applyStageSun(sun, sunData)
fitShadowToStage(sun, stage)

if (query.get('vcol') === '0' || query.get('col') === 'raw') {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (query.get('col') === 'raw' && !mesh.visible) mesh.visible = true
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

// 置く所の予告。本番と同じ式 (placeSpot) と同じ描き方 (PlacePreview)
const placeRaw = query.get('place')?.split(',').map(Number)
if (placeRaw && placeRaw.length === 4 && placeRaw.every(Number.isFinite)) {
  const solid = solidBlockers(await loadStageBoxes(stageName))
  const from = { x: placeRaw[0]!, y: placeRaw[1]!, z: placeRaw[2]!, yaw: placeRaw[3]! }
  const move = await loadStageMoveWorld(stageName)
  const spot = placeSpot(from, solid, STEP_UP, move?.surfaces ?? null)
  new PlacePreview(scene).show(spot, from.yaw, true)
  console.log(`[place] ${spot.x.toFixed(2)} ${spot.y.toFixed(2)} ${spot.z.toFixed(2)} ok=${spot.ok}`)
}

const panel = document.createElement('pre')
panel.className = 'panel'
panel.textContent = `stage ${stageName}\neye ${eye.toArray().map((v) => v.toFixed(1)).join(',')}\nlook ${look.toArray().map((v) => v.toFixed(1)).join(',')}\nshadow ${sun.castShadow ? 'on' : 'off'}  vcol ${query.get('vcol') === '0' ? 'off' : 'on'}  col ${query.get('col') ?? 'off'}`
document.body.appendChild(panel)

/*
 * **チラつきを絵にする (?diff=1)。** カメラを 2mm だけ動かした 2 コマを描いて差を取り、差の大きい所を
 * 白く出す。壁と板の食い合い・影のアクネ・法線の絵のギラつきは、どれも動くたびに画素が変わるので
 * ここに浮かび上がる。普通の面の差は小さい (絵が 2mm ぶんずれるだけ)
 */
async function diffFrames(): Promise<void> {
  const w = Math.floor(window.innerWidth / 2)
  const h = Math.floor(window.innerHeight / 2)
  // WebGPU のキャンバスを 2D キャンバスへ写して読む (描いた直後なら中身が残っている)
  const grab = (): Uint8ClampedArray => {
    renderer.render(scene, camera)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const g = c.getContext('2d')!
    g.drawImage(renderer.domElement, 0, 0, w, h)
    return g.getImageData(0, 0, w, h).data
  }
  const a = grab()
  const side = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize()
  // 動かす量 (m)。?dstep=0.01 など。手ブレ程度の動きで画素がどれだけ変わるかを見る
  const step = Number(query.get('dstep') ?? '0.002')
  camera.position.addScaledVector(side, step)
  camera.position.y += step * 0.5
  camera.lookAt(look)
  const b = grab()
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;image-rendering:pixelated'
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  let hot = 0
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(Math.abs(a[i * 4] - b[i * 4]), Math.abs(a[i * 4 + 1] - b[i * 4 + 1]), Math.abs(a[i * 4 + 2] - b[i * 4 + 2]))
    const v = Math.min(255, d * 4)
    if (d > 12) hot++
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  document.body.appendChild(canvas)
  panel.textContent += `\ndiff: 2mm 動かして 12/255 以上変わった画素 ${hot} / ${w * h}`
  document.body.appendChild(panel)
}

function frame(): void {
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
if (query.get('diff') === '1') {
  renderer.render(scene, camera)
  setTimeout(() => { void diffFrames() }, 1500)
} else {
  frame()
}
;(window as unknown as { stagecamReady: boolean }).stagecamReady = true
