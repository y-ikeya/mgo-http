/**
 * **構えた時に照準が出る所**を、腰だめの画面の上に印で出す。
 *
 *     bunx vite → http://localhost:5174/tools/preview/reticle.html
 *     ?pitch=-5     見下ろし (度)。既定はカメラの初期値
 *     ?camp=3 ?cams=0.42 ?camy=0 ?camd=3.8   camera.ts と同じ窓
 *
 * 左が立ち、右がしゃがみ。それぞれ腰だめのカメラで描き、その画面の上に
 *   ○ 白 … 画面の中心
 *   ● 橙 … 構えた時の弾道 (aimOrigin + aimDirection) が 4 / 6 / 10 / 20 / 100m 先で
 *          通る点を、腰だめのカメラへ投影した所。**構えた瞬間に照準が出る所**
 *   ● 緑 … 自分の頭 (頭ボーン)
 * 橙が 1 点に重なっていれば、距離によらず同じ所に照準が出る。左右で同じ所なら
 * 姿勢によらない。
 *
 * 2026-10-04 本人: 「立ちとしゃがみで構えた時の照準の出る所が違うのがストレス。
 * 腰だめの自キャラの頭のやや右上に出てほしい」。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { Soldier } from '../../src/presentation/scene/actor/soldier'
import { FollowCamera } from '../../src/presentation/scene/sense/camera'

const query = new URLSearchParams(location.search)
const W = 640
const H = 360
const DISTANCES = [4, 6, 10, 20, 100]

const WORLD = {
  resolveHorizontal: () => {},
  groundHeight: () => 0,
  ceilingHeight: () => Number.POSITIVE_INFINITY,
}
const ZERO = new THREE.Vector3()

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(W, H)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
await renderer.init()

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x585d61)
scene.add(new THREE.HemisphereLight(0xffffff, 0x6e7478, 2.2))
const sun = new THREE.DirectionalLight(0xfff6e8, 2.2)
sun.position.set(3, 6, 4)
scene.add(sun)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x6a6f72 }))
ground.rotation.x = -Math.PI / 2
scene.add(ground)
scene.add(new THREE.GridHelper(200, 200, 0x9aa0a4, 0x7d8286))
// 的。距離ごとに柱を立てて、頭の高さ (1.6m) に玉
for (const d of DISTANCES) {
  for (const x of [-1.5, 0, 1.5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x4a5a6a }))
    post.position.set(x, 0.8, -d)
    scene.add(post)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd0b060 }))
    head.position.set(x, 1.6, -d)
    scene.add(head)
  }
}

interface Cell {
  label: string
  crouch: boolean
  player: Soldier
  hip: FollowCamera
  aim: FollowCamera
  canvas: HTMLCanvasElement
  over: HTMLCanvasElement
}

const views = document.getElementById('views')!
const log = document.getElementById('log')!
const pitch = query.get('pitch') !== null ? (Number(query.get('pitch')) * Math.PI) / 180 : null

const cells: Cell[] = [
  { label: '立ち', crouch: false },
  { label: 'しゃがみ', crouch: true },
].map((spec, i) => {
  const player = new Soldier()
  player.start('soldier')
  player.position.set(i * 40, 0, 0)
  player.yaw = 0
  scene.add(player.object)
  const hip = new FollowCamera(W / H)
  const aim = new FollowCamera(W / H)
  aim.setAiming(true)
  if (pitch !== null) {
    hip.pitch = pitch
    aim.pitch = pitch
  }
  const wrap = document.createElement('div')
  wrap.className = 'cell'
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const over = document.createElement('canvas')
  over.className = 'over'
  over.width = W
  over.height = H
  const label = document.createElement('div')
  label.className = 'label'
  label.textContent = spec.label
  wrap.append(canvas, over, label)
  views.appendChild(wrap)
  return { ...spec, player, hip, aim, canvas, over }
})

const dt = 1 / 60
let frames = 0
const tmp = new THREE.Vector3()
const origin = new THREE.Vector3()
const dir = new THREE.Vector3()

function project(camera: THREE.PerspectiveCamera, p: THREE.Vector3): [number, number] {
  tmp.copy(p).project(camera)
  return [((tmp.x + 1) / 2) * W, ((1 - tmp.y) / 2) * H]
}

function step(): void {
  frames++
  for (const cell of cells) {
    if (cell.player.weaponAttached && cell.player.isCrouching !== cell.crouch) cell.player.toggleCrouch()
    cell.player.setAiming(false)
    cell.player.update(dt, ZERO, cell.player.yaw, 0, WORLD)
    for (const cam of [cell.hip, cell.aim]) {
      cam.setViewHeight(cell.player.viewHeight)
      cam.update(dt, cell.player)
    }
  }
}

function draw(): void {
  const lines: string[] = []
  for (const cell of cells) {
    renderer.render(scene, cell.hip.camera)
    const g = cell.canvas.getContext('2d')!
    g.drawImage(renderer.domElement, 0, 0)
    const o = cell.over.getContext('2d')!
    o.clearRect(0, 0, W, H)
    // 中心
    o.strokeStyle = '#fff'
    o.lineWidth = 1
    o.beginPath()
    o.arc(W / 2, H / 2, 6, 0, Math.PI * 2)
    o.stroke()
    // 構えの弾道
    cell.aim.aimOrigin(origin)
    cell.aim.aimDirection(dir)
    const pts: string[] = []
    for (const d of DISTANCES) {
      tmp.copy(origin).addScaledVector(dir, d)
      const [x, y] = project(cell.hip.camera, tmp)
      o.fillStyle = 'rgba(255,150,40,0.9)'
      o.beginPath()
      o.arc(x, y, 4, 0, Math.PI * 2)
      o.fill()
      pts.push(`${d}m (${((x / W) * 100).toFixed(1)}%, ${((y / H) * 100).toFixed(1)}%)`)
    }
    // 頭
    const head = cell.player.position.clone()
    head.y += cell.player.viewHeight - 0.1
    const [hx, hy] = project(cell.hip.camera, head)
    o.fillStyle = 'rgba(90,220,120,0.9)'
    o.beginPath()
    o.arc(hx, hy, 4, 0, Math.PI * 2)
    o.fill()
    lines.push(`${cell.label}: 頭 (${((hx / W) * 100).toFixed(1)}%, ${((hy / H) * 100).toFixed(1)}%)  照準 ${pts.join(' ')}`)
  }
  log.textContent = lines.join('\n')
}

/*
 * **タイマーで回す。** 背面のタブでは rAF が止まる (weapon.ts の注) ので、
 * 自動操作から開いても進むようにする。600 コマ (10 秒ぶん) 進めて止める
 */
const timer = setInterval(() => {
  for (let i = 0; i < 4; i++) step()
  draw()
  if (frames >= 600) {
    clearInterval(timer)
    ;(window as unknown as { reticleReady: boolean }).reticleReady = true
  }
}, 16)
