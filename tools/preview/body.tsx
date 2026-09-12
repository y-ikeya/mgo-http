/**
 * 体を**動かしながら**見る。
 *
 *     bunx vite → http://localhost:5174/tools/preview/body.html
 *     ?skin=soldier_nanashi   見た目 (既定 soldier)
 *     ?clip=run_f             流す型 (既定 idle)
 *     ?at=head                寄る所 head / chest / all
 *     ?t=1.2                  何秒目で止めるか (既定 1.0)
 *     ?turn=40                体を回す角度
 *
 * 決め絵の試写 (decoy) は**止まった姿勢しか映らない**ので、動かして初めて出る
 * 崩れ — 髪が引きずられる、顎がずれる — が見えない。ここは型を流して、
 * その途中で止めて描く。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { loadSoldier } from '../../src/presentation/scene/assets'
import { CharacterAnimator } from '../../src/presentation/scene/actor/animation'

const WIDTH = 1280
const HEIGHT = 900
const EXPOSURE = 3.0

const query = new URLSearchParams(location.search)
const skin = query.get('skin') ?? 'soldier'
const clipName = query.get('clip') ?? 'idle'
const at = query.get('at') ?? 'all'
const stopAt = Number(query.get('t') ?? '1.0')
const turn = ((Number(query.get('turn') ?? '0') * Math.PI) / 180) as number

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = EXPOSURE
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
buildLights(scene)

// 床。**足が埋まっていないか**を見るのに要る
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.9 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const gltf = await loadSoldier(skin)
const model = gltf.scene
model.rotation.y = turn
scene.add(model)

/*
 * ?nomip … ミップマップを切って見る。**UV の島がにじんでいるか**の切り分け。
 *
 * 島の境で隣の島の色を拾うと、四角い継ぎ目が出る。切って消えるならそれ。
 */
if (query.has('nomip')) {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      for (const map of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) {
        if (!map) continue
        map.generateMipmaps = false
        map.minFilter = THREE.LinearFilter
        map.needsUpdate = true
      }
    }
  })
}

/*
 * **本物の animator で回す。**
 *
 * 素の AnimationMixer で流すと、本番が掛けている補正 (照準の上下・背骨の
 * 揃え・胸のばね) が**一切入らない**。それで出る崩れは試写に映らないので、
 * 2 度掴み損ねた。ここは走っているのと同じ物を通す。
 *
 *     ?pitch=25   照準の上下 (度)。**背骨へ差し込まれる**
 *     ?aim        構えているか
 */
const pitch = (Number(query.get('pitch') ?? '0') * Math.PI) / 180
const anim = new CharacterAnimator(model, gltf.animations, 4.5)
anim.setAiming(query.has('aim'))
anim.setAimPitch(pitch)

/*
 * **刻んで進める。** 一気に進めると、骨の追従 (ばね) が 1 歩で終わってしまう。
 * 実機と同じ 60 分の 1 で回して、その時刻の形を描く。
 */
for (let t = 0; t < stopAt; t += 1 / 60) {
  anim.setLocomotion(clipName as never)
  anim.update(1 / 60)
}
model.updateMatrixWorld(true)

const bone = (name: string) => {
  let found: THREE.Object3D | null = null
  model.traverse((o) => {
    if (!found && o.name.endsWith(name)) found = o
  })
  return found ? (found as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : null
}

const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.05, 100)
const head = bone('Head') ?? new THREE.Vector3(0, 1.5, 0)
const chest = bone('Spine2') ?? new THREE.Vector3(0, 1.3, 0)
if (at === 'head') {
  camera.position.set(head.x + 0.1, head.y + 0.05, head.z + 0.55)
  camera.lookAt(head.x, head.y + 0.05, head.z)
} else if (at === 'chest') {
  camera.position.set(chest.x, chest.y, chest.z + 0.9)
  camera.lookAt(chest)
} else {
  camera.position.set(0.4, 1.2, 3.0)
  camera.lookAt(0, 0.95, 0)
}

await renderer.init()
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
