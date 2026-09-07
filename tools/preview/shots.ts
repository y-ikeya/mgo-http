import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { Shots } from '../../src/presentation/scene/fx/shots'

/**
 * 銃口と着弾の試写。**部屋に入らずに見る。**
 *
 * 撃った絵は 0.2〜0.5 秒で消えるので、対戦しながらでは確かめられない
 * (待っている人の席も潰す)。壁を 1 枚立てて、金属と木を撃ち分けるだけの
 * 場を作り、**同じ絵を何度でも出す**。
 *
 * 背景の灰色は見るための下地で、遊びの色ではない。
 */
const WIDTH = 1280
const HEIGHT = 720
const EXPOSURE = 3.0

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = EXPOSURE
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const WALL_Z = -8
/*
 * 下地は明暗を半分ずつ。**煙は下地の明るさで見え方が変わる。**
 *
 * 煙の粒は灰色なので、暗い壁だけだと「出ていない」のか「見えていない」のか
 * 区別がつかない。明るい側と暗い側の両方に当てて、どちらでも読めるかを見る。
 */
const wallGeometry = new THREE.PlaneGeometry(24, 12)
const dark = new THREE.Mesh(wallGeometry, new THREE.MeshBasicMaterial({ color: 0x2a2a2a }))
dark.position.set(-12, 0, WALL_Z)
scene.add(dark)
const light = new THREE.Mesh(wallGeometry, new THREE.MeshBasicMaterial({ color: 0x9a9a9a }))
light.position.set(12, 0, WALL_Z)
scene.add(light)

const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 100)
camera.position.set(0, 0, 2)
camera.lookAt(0, 0, WALL_Z)

/*
 * 撃つ場所。**銃口は画の隅に置く。**
 *
 * 銃口の煙は本来カメラの目の前 (自分の手元) に出るが、それだと画面が煙で
 * 埋まって形が読めない。左下から斜めに撃つ形にして、煙と着弾を同じ 1 枚に
 * 収める。
 */
const FROM = new THREE.Vector3(-2.6, -1.6, -1.0)
const NORMAL = new THREE.Vector3(0, 0, 1)
const METAL = new THREE.Vector3(-1.8, 0.2, WALL_Z)
const WOOD = new THREE.Vector3(1.8, 0.2, WALL_Z)

const shots = new Shots(scene)

/** 撃つ間隔 (秒)。連射しても銃口が埋まらないかを併せて見る */
const INTERVAL = 0.14
const query = new URLSearchParams(location.search)
/** ?only=metal / ?only=wood で片方だけ */
const only = query.get('only')

await renderer.init()
// 粒の絵 (particles.png) が届くのを待つ。届く前に撃つと粒が出ない
await new Promise((done) => setTimeout(done, 1500))

let next = 0
let toMetal = true
let last = performance.now()

const frame = async () => {
  const now = performance.now()
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  next -= dt
  if (next <= 0) {
    next = INTERVAL
    const metal = only ? only === 'metal' : toMetal
    toMetal = !toMetal
    if (metal) shots.fire(FROM, METAL, NORMAL, 0xffd9a0, 'metal')
    else shots.fire(FROM, WOOD, NORMAL, 0xffd9a0, 'wood')
  }
  shots.update(dt)

  await renderer.renderAsync(scene, camera)
  ;(globalThis as unknown as { ready: boolean }).ready = true
  requestAnimationFrame(() => void frame())
}
void frame()
