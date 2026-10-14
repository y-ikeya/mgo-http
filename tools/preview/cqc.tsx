/**
 * CQC (投げる / 投げられる) を**ゲームの体で 2 人並べて**見る頁。
 *
 *     bunx vite → http://localhost:5174/tools/preview/cqc.html
 *     ?t=1.2        最初に止める秒。下のバーで動かせる
 *     ?miss         投げる側を空振りの型にする (相手は立ったまま)
 *     ?release=1.2  その秒で投げられる側を放す (投げた側が倒れた時、soldier の releaseThrown)
 *     ?cam=side|front|top|back   カメラ (既定 side)。?dist= で距離
 *     ?skin=soldier_raiden
 *
 * 投げる側は原点で -Z を向き、投げられる側は CQC_PAIR_DISTANCE 前でこちらを向く
 * (ゲームで thrown を受けた時と同じ置き方)。型に焼かれた移動は soldier.ts と同じ式で
 * 辿る。左上に、腕と喉の距離・つま先の位置・腰の高さを出す。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { loadSoldier } from '../../src/presentation/scene/assets'
import { CharacterAnimator, findBoneBySuffix } from '../../src/presentation/scene/actor/animation'
import { CQC_PAIR_DISTANCE } from '../../src/domain/player/cqc'

const query = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => {
  const v = Number(query.get(key))
  return query.has(key) && Number.isFinite(v) ? v : fallback
}
const stopAt = num('t', 0)
const miss = query.has('miss')
const releaseAt = num('release', -1)
const cam = query.get('cam') ?? 'side'
const dist = num('dist', 4)
const skin = query.get('skin') ?? 'soldier'

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
const grid = new THREE.GridHelper(10, 20, 0x333333, 0x555555)
grid.position.y = 0.002
scene.add(grid)

interface Body {
  root: THREE.Group
  model: THREE.Object3D
  anim: CharacterAnimator
  yaw: number
  start: THREE.Vector3
  play: () => void
}

async function body(x: number, z: number, yaw: number, play: (a: CharacterAnimator) => void): Promise<Body> {
  const gltf = await loadSoldier(skin)
  // 読み込みは 1 つを共有しているので、2 人目は複製する (soldier.ts と同じ)
  const model = cloneSkinned(gltf.scene)
  const root = new THREE.Group()
  root.rotation.y = yaw
  root.position.set(x, 0, z)
  scene.add(root)
  model.rotation.y = Math.PI // MODEL_YAW_OFFSET
  root.add(model)
  const anim = new CharacterAnimator(model, gltf.animations)
  anim.setHandsEmpty(true)
  return { root, model, anim, yaw, start: root.position.clone(), play: () => play(anim) }
}

const attacker = await body(0, 0, 0, (a) => a.playCqc(miss ? 'cqc_miss' : 'cqc_throw'))
const victim = await body(0, -CQC_PAIR_DISTANCE, Math.PI, (a) => (miss ? undefined : a.playThrown()))
const bodies = [attacker, victim]

const STEP = 1 / 60
let current = -1
const delta = new THREE.Vector3()
function seekTo(t: number): void {
  if (t < current || current < 0) {
    for (const b of bodies) {
      b.root.position.copy(b.start)
      b.play()
      // 型の移動の起点を取らせる (最初の 1 回は差が出ない)
      b.anim.consumeRootMotion(delta)
    }
    current = 0
  }
  while (current < t) {
    if (releaseAt >= 0 && current < releaseAt && current + STEP >= releaseAt) {
      victim.anim.releaseThrown()
      victim.anim.setLocomotion('idle' as never)
    }
    for (const b of bodies) {
      b.anim.update(STEP)
      // soldier.ts と同じ写し方 (モデル空間の正面 +Z、yaw + π)
      if (b.anim.consumeRootMotion(delta)) {
        const sin = Math.sin(b.yaw)
        const cos = Math.cos(b.yaw)
        b.root.position.x += -delta.x * cos - delta.z * sin
        b.root.position.z += delta.x * sin - delta.z * cos
      }
    }
    current += STEP
  }
  for (const b of bodies) b.model.updateMatrixWorld(true)
}

const v = new THREE.Vector3()
const at = (b: Body, suffix: string) => {
  const bone = findBoneBySuffix(b.model, suffix)
  return bone ? bone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(NaN, NaN, NaN)
}
const fmt = (p: THREE.Vector3) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`
function readout(): string[] {
  const elbow = at(attacker, 'RightForeArm')
  const wrist = at(attacker, 'RightHand')
  const neck = at(victim, 'Neck').lerp(at(victim, 'Head'), 0.5)
  const contact = elbow.clone().lerp(wrist, 0.3)
  return [
    `t=${current.toFixed(2)} ${miss ? '空振り' : '投げ'}`,
    `腕 (前腕の根元) と喉: ${contact.distanceTo(neck).toFixed(2)} m`,
    `投げる側 根 ${fmt(attacker.root.position)} 腰 ${fmt(at(attacker, 'Hips'))}`,
    `  左つま先 ${fmt(at(attacker, 'LeftToeBase'))} 右つま先 ${fmt(at(attacker, 'RightToeBase'))}`,
    `投げられる側 根 ${fmt(victim.root.position)} 腰 ${fmt(at(victim, 'Hips'))} 頭 ${fmt(at(victim, 'Head'))}`,
  ]
}
void v

const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.05, 100)
const look = new THREE.Vector3(0, 0.9, -0.5)
if (cam === 'front') camera.position.set(0, look.y + 0.3, look.z - dist)
else if (cam === 'back') camera.position.set(0, look.y + 0.3, look.z + dist)
else if (cam === 'top') camera.position.set(0.01, look.y + dist, look.z)
else camera.position.set(dist, look.y + 0.2, look.z)
camera.lookAt(look)

await renderer.init()

const seek = document.getElementById('seek') as HTMLInputElement
const playButton = document.getElementById('play') as HTMLButtonElement
const timeLabel = document.getElementById('time') as HTMLSpanElement
seek.max = String(miss ? 1.6 : 3.4)

async function show(t: number): Promise<void> {
  seekTo(t)
  const lines = readout()
  document.getElementById('readout')!.textContent = lines.join('\n')
  console.log('[cqc] ' + lines.join(' | '))
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
