/**
 * ステージの一点を**そのまま覗く**。
 *
 *     bunx vite → http://localhost:5174/tools/preview/spot.html?at=-12.55,16,-37.1&dist=6
 *     ?stage=raft  ?at=x,y,z  ?dist=  ?yaw=  ?mark=x,y,z (印を置く)
 *     ?wait=ms (glb の後の絵を待つ長さ)  ?pick=px,py (その画素の物の名前)  ?list (場の Mesh 一覧)
 *     ?oldshadow (影の枠を原点 ±65m のままにする。見比べ用)
 *
 * 見たい所が対戦の中にしか無いとき、部屋に入らずに確かめるための頁。
 */
import * as THREE from 'three'
import type { StageName } from '../../src/domain/stage'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights, buildStage, fitShadowToStage } from '../../src/presentation/scene/world/stage'
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
// 影もゲームと同じに出す (影の枠の縁が地面に線で出る類は、影を描かないと見えない)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const sun = buildLights(scene)

/*
 * **本番と同じ組み方で立てる** (buildStage)。glb を直に読むと、絵の無い箱に
 * 材質の絵を貼る所 (錆・コンクリート・砂利) を通らないので、塗りつぶしの
 * 箱が映る。空とフォグも本番の物になる。
 */
const built = buildStage(scene, stage as StageName)

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

// 奥行きはゲームのカメラと同じ 500。空の球 (半径 400) は原点中心なので、端に立つと
// 400 では切れて黒く抜ける (city で出た)
const camera = new THREE.PerspectiveCamera(42, 1100 / 800, 0.05, 500)
camera.position.set(at[0] + Math.sin(yaw) * dist, at[1] + dist * 0.25, at[2] + Math.cos(yaw) * dist)
camera.lookAt(at[0], at[1], at[2])

await renderer.init()
// **glb が届くまで待つ。** 時間で待つと、glb が数 MB あるステージ (city の砂の絵)
// では届く前に描いてしまい、コード側の仮の箱と地面が映る (それを本物と見誤った)。
// 絵 (テクスチャ) は glb の後から届くので、その分だけ ?wait= (ms) で足す
await built.ready
// 影の枠もゲームと同じにステージへ合わせる (合わせないと city で縁が斜めの線に出る)
if (!query.has('oldshadow')) fitShadowToStage(sun, built)
await new Promise((done) => setTimeout(done, Number(query.get('wait') ?? '3000')))
await renderer.renderAsync(scene, camera)

// ?pick=px,py … その画素に映っている物の名前を出す (何が映っているか分からないとき)
const pick = query.get('pick')
if (pick) {
  const [px, py] = pick.split(',').map(Number)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((px / 1100) * 2 - 1, -((py / 800) * 2 - 1)), camera)
  for (const hit of ray.intersectObjects(scene.children, true).slice(0, 4)) {
    const mat = (hit.object as THREE.Mesh).material as THREE.Material | undefined
    console.log('[pick]', hit.object.name || hit.object.parent?.name, hit.distance.toFixed(1), 'm', mat?.type, 'side', mat?.side)
  }
}
// ?list … 場に居る Mesh の名前と外接を全部出す (どこに何が居るか分からないとき)
if (query.has('list')) {
  const box = new THREE.Box3()
  scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return
    box.setFromObject(obj)
    const f = (v: THREE.Vector3) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`
    console.log('[list]', obj.name || obj.parent?.name, f(box.min), '..', f(box.max), 'visible', obj.visible, (obj as THREE.Mesh).material?.constructor.name)
  })
}
;(globalThis as unknown as { ready: boolean }).ready = true
