/**
 * 縁にぶら下がる姿を、**壁を置いて**見る。壁までの距離を目と数字で測るための頁。
 *
 *     bunx vite → http://localhost:5174/tools/preview/hang.html
 *     ?clip=hang_drop|hang|hang_climb   流す型 (既定 hang_drop)。hang は登る型の頭で止めた姿
 *     ?t=3.0        最初に止める秒 (既定 3.0 = 落ちる型が終わった後)。下のバーで動かせる
 *     ?yaw=0        体の向き (度)。0 = 根の正面が壁、180 = 壁に背
 *     ?out=0.17     体の中心 (足元の原点) を壁面から外へ何 m 出すか
 *     ?below=1.78   足元を縁からどれだけ下げるか (m)
 *     ?cam=side|front|top|back   カメラ (既定 side)。?dist= で距離
 *     ?skin=soldier_raiden
 *
 * 壁面は z = 0 (壁は z < 0 側、縁の上面は y = 3)。体は z > 0 側に居る。
 * 画面左上に、手・胸・腰の**壁面からの距離** (正 = 壁の外、負 = 壁の中) と、
 * 手の高さ (縁の上面との差) と、胸がどちらを向いているかを出す。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { loadSoldier } from '../../src/presentation/scene/assets'
import { CharacterAnimator, findBoneBySuffix } from '../../src/presentation/scene/actor/animation'

const query = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(query.get(key))
  return query.has(key) && Number.isFinite(v) ? v : fallback
}
const clip = query.get('clip') ?? 'hang_drop'
const stopAt = num('t', 3.0)
const yaw = (num('yaw', 0) * Math.PI) / 180
const out = num('out', 0.17)
const below = num('below', 1.78)
const cam = query.get('cam') ?? 'side'
const dist = num('dist', 3.2)
const skin = query.get('skin') ?? 'soldier'

const TOP = 3
const WIDTH = 1280
const HEIGHT = 900

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x30343a)
buildLights(scene)

const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.9 }))
floor.rotation.x = -Math.PI / 2
scene.add(floor)

// 壁と縁。壁面 z = 0、上面 y = TOP。少し透かして中に入った手も見える
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(6, TOP, 3),
  new THREE.MeshStandardMaterial({ color: 0x9a9388, roughness: 0.95, transparent: true, opacity: 0.85 }),
)
wall.position.set(0, TOP / 2, -1.5)
scene.add(wall)
// 縁の線
const edge = new THREE.Mesh(new THREE.BoxGeometry(6, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: 0xff5533 }))
edge.position.set(0, TOP, 0)
scene.add(edge)
// 壁面の位置が分かるように、壁面に薄い格子
const grid = new THREE.GridHelper(6, 12, 0x333333, 0x555555)
grid.rotation.x = Math.PI / 2
grid.position.set(0, TOP / 2, 0.005)
scene.add(grid)

const gltf = await loadSoldier(skin)
const model = gltf.scene
const root = new THREE.Group()
// 根の正面は -Z (soldier.ts)。yaw=0 で壁 (-Z 側) を向く
root.rotation.y = yaw
root.position.set(0, TOP - below, out)
scene.add(root)
model.rotation.y = Math.PI // MODEL_YAW_OFFSET
root.add(model)

const anim = new CharacterAnimator(model, gltf.animations)
anim.setHandsEmpty(true)

/*
 * 型を頭から流し直して t 秒まで進める。**戻るときは頭から** — 一度きりの型は
 * 巻き戻せないので、reset して同じ刻み (1/60) で進め直す。同じ t なら同じ絵になる。
 */
const STEP = 1 / 60
let current = -1
function seekTo(t: number): void {
  if (t < current || current < 0) {
    if (clip === 'hang_drop') anim.playHang()
    else if (clip === 'hang_climb') anim.playHangClimb()
    else anim.setLocomotion('hang' as never)
    current = 0
  }
  while (current < t) {
    if (clip === 'hang') anim.setLocomotion('hang' as never)
    anim.update(STEP)
    current += STEP
  }
  model.updateMatrixWorld(true)
}

// 手・頭・腰・足に印。位置は毎回置き直す
const MARKS = [
  ['右手', 'RightHand', 0xff3333],
  ['左手', 'LeftHand', 0x3399ff],
  ['頭', 'Head', 0xffff33],
  ['腰', 'Hips', 0x33ff33],
  ['右足', 'RightFoot', 0xff33ff],
] as const
const balls = MARKS.map(([, , color]) => {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshBasicMaterial({ color }))
  scene.add(ball)
  return ball
})
const v = new THREE.Vector3()
function readout(): string[] {
  const lines: string[] = []
  lines.push(`clip=${clip} t=${current.toFixed(2)} yaw=${(yaw * 180) / Math.PI}° out=${out} below=${below}`)
  lines.push(`壁面 z=0 / 縁 y=${TOP}  (正 = 壁の外、負 = 壁の中)`)
  MARKS.forEach(([label, suffix], i) => {
    const bone = findBoneBySuffix(model, suffix)
    if (!bone) return
    bone.getWorldPosition(v)
    balls[i].position.copy(v)
    lines.push(`${label}: 壁から ${v.z.toFixed(2)} m / 縁から ${(v.y - TOP).toFixed(2)} m (高さ ${v.y.toFixed(2)})`)
  })
  const l = findBoneBySuffix(model, 'LeftArm')
  const r = findBoneBySuffix(model, 'RightArm')
  if (l && r) {
    const lp = l.getWorldPosition(new THREE.Vector3())
    const rp = r.getWorldPosition(new THREE.Vector3())
    const right = rp.sub(lp).setY(0).normalize()
    const forward = new THREE.Vector3(0, 1, 0).cross(right)
    // 壁は -Z 側。forward.z < 0 なら胸が壁を向いている
    lines.push(`胸の向き: ${forward.z < 0 ? '壁向き' : '壁に背'} (z ${forward.z.toFixed(2)})`)
  }
  return lines
}

const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.05, 100)
const look = new THREE.Vector3(0, TOP - below + 1.0, out)
if (cam === 'front') camera.position.set(0, look.y, look.z + dist) // 壁を背にして体を見る
else if (cam === 'back') camera.position.set(0, look.y + 0.5, look.z - dist) // 壁の中から (透かして)
else if (cam === 'top') camera.position.set(0.01, look.y + dist, look.z)
else camera.position.set(dist, look.y, look.z + 0.3) // side
camera.lookAt(look)

await renderer.init()

const seek = document.getElementById('seek') as HTMLInputElement
const playButton = document.getElementById('play') as HTMLButtonElement
const timeLabel = document.getElementById('time') as HTMLSpanElement
const duration = clip === 'hang_drop' ? 1.8 : clip === 'hang_climb' ? 1.17 : 1.0
seek.max = String(Math.max(duration + 0.5, stopAt))

async function show(t: number): Promise<void> {
  seekTo(t)
  const lines = readout()
  document.getElementById('readout')!.textContent = lines.join('\n')
  seek.value = String(current)
  timeLabel.textContent = `${current.toFixed(2)} s`
  await renderer.renderAsync(scene, camera)
}

let playing = false
let last = 0
function tick(now: number): void {
  if (!playing) return
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  const next = current + dt
  if (next >= Number(seek.max)) {
    playing = false
    playButton.textContent = '▶ 再生'
    void show(Number(seek.max))
    return
  }
  void show(next)
  requestAnimationFrame(tick)
}
playButton.addEventListener('click', () => {
  playing = !playing
  playButton.textContent = playing ? '❚❚ 止める' : '▶ 再生'
  if (playing) {
    // 終わりで押したら頭から
    if (current >= Number(seek.max) - 1e-3) void show(0)
    last = performance.now()
    requestAnimationFrame(tick)
  }
})
seek.addEventListener('input', () => {
  playing = false
  playButton.textContent = '▶ 再生'
  void show(Number(seek.value))
})

await show(stopAt)
console.log('[hang]\n' + readout().join('\n'))
;(globalThis as unknown as { ready: boolean }).ready = true
