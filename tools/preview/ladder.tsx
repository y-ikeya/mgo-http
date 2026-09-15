/**
 * 梯子を登る姿を**本物の Soldier で**確かめる。
 *
 *     bunx vite → http://localhost:5174/tools/preview/ladder.html
 *     ?t=2.4     何秒登ったところを描くか (既定 1.2)
 *     ?view=side 横から / front 正面から / back 背中側
 *     ?gun=sniper 銃を持たせる (登っている間は隠れるはず)
 *
 * --- なぜ試写が要るか ---
 * 掴む位置も体の向きも、**対戦部屋に入らないと見られない**所に居た。
 * ここは梯子を 1 本立てて、掴ませて、時間を進めて描くだけ。
 *
 * 見る所は 3 つ:
 *   - 梯子の正面に立っているか (横を向いていないか)
 *   - 手と足が梯子の面に乗っているか (浮いていないか / めり込んでいないか)
 *   - 銃が消えているか (両手が塞がる)
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { Soldier } from '../../src/presentation/scene/actor/soldier'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { loadSoldier } from '../../src/presentation/scene/assets'
import type { Ladder } from '../../src/domain/stage'
import type { WeaponId } from '../../src/domain/item/weapons'

const WIDTH = 1000
const HEIGHT = 820

const query = new URLSearchParams(location.search)
const stopAt = Number(query.get('t') ?? '1.2')
const view = query.get('view') ?? 'side'
const gun = query.get('gun') as WeaponId | null

/**
 * 筏の梯子と同じ形。**厚みは x、幅 0.82m (z)、高さ 11.7m。**
 *
 * 本物 (ladder_a) は 0.08 x 11.66 x 0.82。ここも同じ向きに立てておかないと、
 * 幅の真ん中に乗れているかを確かめられない。
 */
const LADDER: Ladder = {
  name: 'ladder_preview',
  min: [-0.04, 0, -0.41],
  max: [0.04, 11.7, 0.41],
  axis: 'x',
}

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(WIDTH, HEIGHT)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
buildLights(scene)

// 床
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.9 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

/*
 * 梯子の見た目。**当たり判定と同じ寸法**で立てる。
 * 桟を並べるのは、足が段に乗っているかを見るため。
 */
const rail = new THREE.MeshStandardMaterial({ color: 0x8a8f7a, roughness: 0.6 })
for (const side of [-0.35, 0.35]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 11.7, 0.06), rail)
  post.position.set(0, 5.85, side)
  scene.add(post)
}
for (let y = 0.3; y < 11.7; y += 0.32) {
  const step = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.76), rail)
  step.position.set(0, y, 0)
  scene.add(step)
}

/** 何も邪魔しない世界。床は y=0 */
const WORLD = {
  resolveHorizontal: () => {},
  groundHeight: () => 0,
  ceilingHeight: () => Number.POSITIVE_INFINITY,
}

const player = new Soldier()
player.start('soldier')
/*
 * **体が届くまで待つ。** start は待てる形ではない (中で投げっぱなし)。
 *
 * 時計で待ってはいけない — 無頭の Chrome は仮想時計で回るので、setTimeout は
 * その場で返る。**同じ物を自分でも読んで**、届いたことを待つ (読み込みは
 * 覚えられているので 2 度落ちない)。そのあと数フレーム回して、Soldier 側の
 * 組み立てが済むのを待つ。
 */
await loadSoldier('soldier')
// 順番待ちを何回か譲る。Soldier 側の組み立ては同じ読み込みの続きで走る
for (let i = 0; i < 8; i++) await new Promise((done) => setTimeout(done, 0))
player.setLadders([LADDER])
scene.add(player.object)
// 梯子の手前に立たせる
player.position.set(0.6, 0, 0)
if (gun) await player.equip(gun)

// **本物の口から掴む。** 押している量も本番と同じ setStickForward で渡す
const grabbed = player.grabLadder()
player.setStickForward(1)

/*
 * **刻んで進める。** 一気に進めると型のばねも当たりも 1 歩で終わる。
 * 実機と同じ 60 分の 1 で回す。
 */
for (let t = 0; t < stopAt; t += 1 / 60) {
  player.update(1 / 60, new THREE.Vector3(), player.yaw, 0, WORLD)
}
player.object.updateMatrixWorld(true)

const feet = player.position.clone()
const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.05, 100)
const eye = feet.y + 1.0
// 厚みが x 向きになったので、見る所も 90 度回す
if (view === 'front') camera.position.set(feet.x + 3.2, eye, 0)
else if (view === 'back') camera.position.set(feet.x - 3.2, eye, 0)
else camera.position.set(feet.x + 0.4, eye, 3.2)
camera.lookAt(0, eye, 0)

await renderer.init()
await renderer.renderAsync(scene, camera)

/** 手と足が梯子の面にどれだけ近いか。**絵だけでは読み取れない** */
function handZ(): string {
  const find = (suffix: string) => {
    let bone: THREE.Object3D | null = null
    player.object.traverse((o) => {
      if (!bone && o.name.endsWith(suffix)) bone = o
    })
    return bone ? (bone as THREE.Object3D).getWorldPosition(new THREE.Vector3()).x : NaN
  }
  return ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']
    .map((name) => `${name.slice(0, 5)} ${find(name).toFixed(2)}`)
    .join('  ')
}

// 数字でも出す。**絵だけだと向きのずれが読み取れない**
const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.object.quaternion)
const report = [
  `掴めた: ${grabbed}`,
  `足元: ${feet.x.toFixed(2)}, ${feet.y.toFixed(2)}, ${feet.z.toFixed(2)}`,
  `体の向き: ${forward.x.toFixed(2)}, ${forward.z.toFixed(2)} (梯子は -z 側)`,
  `梯子の上: ${player.onLadder}`,
  `いまの型: ${player.locomotion}`,
  `手と足の x (梯子は 0): ${handZ()}`,
  `幅の真ん中からのずれ (z): ${feet.z.toFixed(2)}`,
].join('\n')
const box = document.createElement('pre')
box.style.cssText =
  'position:fixed;left:12px;top:12px;margin:0;padding:8px 10px;background:rgba(10,14,9,.85);' +
  'color:#cfe0c0;font:12px ui-monospace,Menlo,monospace;white-space:pre'
box.textContent = report
document.body.appendChild(box)
;(globalThis as unknown as { ready: boolean }).ready = true
