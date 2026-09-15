/**
 * ステージの一点を**そのまま覗く**。
 *
 *     bunx vite → http://localhost:5174/tools/preview/spot.html?at=-12.55,16,-37.1&dist=6
 *     ?stage=raft  ?at=x,y,z  ?dist=  ?yaw=  ?mark=x,y,z (印を置く)
 *
 * 見たい所が対戦の中にしか無いとき、部屋に入らずに確かめるための頁。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { ladderGrip, type Ladder } from '../../src/domain/stage'

const query = new URLSearchParams(location.search)
const stage = query.get('stage') ?? 'raft'
const nums = (key: string, fallback: number[]) =>
  (query.get(key)?.split(',').map(Number) ?? fallback) as number[]
const at = nums('at', [0, 2, 0])
const mark = query.get('mark') ? nums('mark', [0, 0, 0]) : null
const dist = Number(query.get('dist') ?? '6')
const yaw = (Number(query.get('yaw') ?? '45') * Math.PI) / 180

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(1100, 800)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
buildLights(scene)

const gltf = await new GLTFLoader().loadAsync(`/models/stage_${stage}.glb`)
scene.add(gltf.scene)

/*
 * ?ladder=ladder_a … その梯子の**掴む位置**に印を置いて、正面から見る。
 *
 * 数字ではなく絵で確かめる所なので、印はドメインの式 (ladderGrip) から
 * そのまま出す。手で座標を入れると、式が間違っていても合って見える。
 */
const asked = query.get('ladder')
if (asked) {
  const data = (await (await fetch(`/models/stage_${stage}.json`)).json()) as {
    ladders?: Ladder[]
  }
  const ladder = data.ladders?.find((l) => l.name === asked)
  if (ladder) {
    const mid = (ladder.min[1] + ladder.max[1]) / 2
    // 掴む側は梯子の厚みの向きで決まる。**居る側に立つ**ので、両側を出す
    for (const side of [1, -1]) {
      const from = ladderGrip(
        ladder,
        ladder.axis === 'x' ? (ladder.min[0] + ladder.max[0]) / 2 + side : 0,
        ladder.axis === 'z' ? (ladder.min[2] + ladder.max[2]) / 2 + side : 0,
      )
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 16, 12),
        new THREE.MeshBasicMaterial({ color: side > 0 ? 0xff5533 : 0x33aaff }),
      )
      ball.position.set(from.x, mid, from.z)
      scene.add(ball)
    }
    console.log('[spot]', asked, ladder.min, ladder.max, ladder.axis)
  } else {
    console.warn('[spot] その名前の梯子が無い', asked)
  }
}

// 印。**掴む位置がどこに来るか**を目で見る
if (mark) {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5533 }),
  )
  ball.position.set(mark[0], mark[1], mark[2])
  scene.add(ball)
}

const camera = new THREE.PerspectiveCamera(42, 1100 / 800, 0.05, 400)
camera.position.set(at[0] + Math.sin(yaw) * dist, at[1] + dist * 0.25, at[2] + Math.cos(yaw) * dist)
camera.lookAt(at[0], at[1], at[2])

await renderer.init()
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
