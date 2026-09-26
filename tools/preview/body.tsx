/**
 * 体を**動かしながら**見る。
 *
 *     bunx vite → http://localhost:5174/tools/preview/body.html
 *     ?skin=soldier_nanashi   見た目 (既定 soldier)
 *     ?clip=run_f             流す型 (既定 idle)
 *     ?at=head                寄る所 head / chest / all / prone (伏せた体を収める)
 *     ?stab                   刺す。clip=prone_idle なら伏せた刺突 (prone_stab)
 *     ?knife                  ナイフを持っている。?aim と組むとナイフの構え
 *     ?t=1.2                  何秒目で止めるか (既定 1.0)
 *     ?turn=40                体を回す角度
 *     ?look=60                首をカメラの向きへ (度、左が正)
 *     ?boxed                  ダンボールを被る (clip=sneak と組む)。箱は半透明で、はみ出しを見る
 *     ?tilt=fwd|right         箱を進行方向へ倒した姿 (fwd = 前へ、right = 右へ全開)
 *     ?shadow                 影を受ける体。頭上に板を吊って上半身に影を落とす
 *     ?sky=0.4                屋内の暗さ (空の見え方 SKY_FLOOR〜1) を体に掛ける
 *
 * 決め絵の試写 (decoy) は**止まった姿勢しか映らない**ので、動かして初めて出る
 * 崩れ — 髪が引きずられる、顎がずれる — が見えない。ここは型を流して、
 * その途中で止めて描く。
 */
import { BoxMotion, boxLift, createCardboardBox, placeBox, setBoxTuning } from '../../src/presentation/scene/actor/box'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { SkyLight } from '../../src/presentation/scene/world/skylight'
import { loadSoldier } from '../../src/presentation/scene/assets'
import { CharacterAnimator, findBoneBySuffix } from '../../src/presentation/scene/actor/animation'
import { Weapon, type WeaponKind } from '../../src/presentation/scene/arms/weapon'

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
const sun = buildLights(scene)

// 床。**足が埋まっていないか**を見るのに要る
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.9 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const gltf = await loadSoldier(skin)
const model = gltf.scene
/*
 * 本番と同じ入れ子にする (soldier.ts)。根 (object) を向きで回し、模型はその中で
 * MODEL_YAW_OFFSET だけ回っている。箱は根の子なので、模型に直に付けると
 * 前後が逆になる。
 */
const MODEL_YAW_OFFSET = Math.PI // soldier.ts と同じ。模型の正面は +Z、根は -Z が前
const root = new THREE.Group()
// 根の前 (-Z) をカメラ (+Z) へ向けるぶんの 180° を足す。turn=0 で正面向き
root.rotation.y = turn + Math.PI
scene.add(root)
model.rotation.y = MODEL_YAW_OFFSET
root.add(model)

/*
 * ?shadow … 影を受ける体 (soldier.ts の receiveShadow)。屋内で日向の明るさに
 * ならないための物だが、体が自分の影で斑になっていないかをここで見る。
 * ?sky … 屋内の暗さ (world/skylight.ts)。材質の色に掛かるので、絵の色が沈むだけで
 * 陰影の向きは変わらないはず。
 */
if (query.has('shadow')) {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  floor.receiveShadow = true
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const frame = sun.shadow.camera as THREE.OrthographicCamera
  frame.left = frame.bottom = -8
  frame.right = frame.top = 8
  frame.updateProjectionMatrix()
  model.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return
    o.castShadow = true
    o.receiveShadow = true
  })
  // 日を遮る板。体の上半分に影を落として、境目の出方を見る
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x555555 }))
  roof.position.set(0.8, 2.4, -1.0)
  roof.castShadow = true
  scene.add(roof)
}
const skyValue = Number(query.get('sky') ?? '1')
if (skyValue < 1) {
  const light = new SkyLight()
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) light.add(m)
  })
  light.follow(skyValue, 10)
}

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
 *     ?fire       撃っている。**上半身の型** (prone_fire などはこれで出る)
 */
const pitch = (Number(query.get('pitch') ?? '0') * Math.PI) / 180
const anim = new CharacterAnimator(model, gltf.animations, 4.5)
// ?onehand … 片手の持ち物 (拳銃・手榴弾・設置物) の姿勢を見る
// ?empty   … 手に何も出ていない (投げ物・設置物)。転がりの尻尾が変わる
anim.setPistol(query.has('onehand') || query.has('empty'))
anim.setHandsEmpty(query.has('empty'))
anim.setAiming(query.has('aim'))
// ?knife … ナイフを持っている (構えると knife_idle)
anim.setKnife(query.has('knife'))
// ?look=60 … 首をカメラの向きへ (度、左が正)。構えていないときだけ効く
anim.setLookYaw((Number(query.get('look') ?? '0') * Math.PI) / 180)
anim.setAimPitch(pitch)
// ?boxed … 箱の中の姿勢。箱は本番と同じ物を半透明で重ねて、頭と腕の収まりを見る
const boxed = query.has('boxed')
anim.setBoxed(boxed)
const box = boxed ? createCardboardBox() : null
if (box) {
  // ?boxalpha=1 … 箱を不透明で (既定は半透明で中を透かす)
  setBoxTuning({ opacity: Number(query.get('boxalpha') ?? '0.45') })
  box.visible = true
  root.add(box)
}

/*
 * 銃を持たせる。**取り付けはゲームと同じ順で** — 型を流す前の姿勢で基準を
 * 取る (Soldier は生まれた直後に 1 フレーム進めてから付ける)。ここを後ろへ
 * ずらすと、その時の手の向きが基準になって銃が下を向く。
 *
 *     ?gun=sniper    銃 (sniper / rifle / smg / shotgun / m9 / m1911)
 *     ?stance=1      握り 0 = 立ち / 1 = しゃがみ / 2 = 伏せ
 */
const gunName = query.get('gun')
let weapon: Weapon | null = null
if (gunName) {
  anim.update(0)
  model.updateMatrixWorld(true)
  const right = findBoneBySuffix(model, 'RightHand')
  const left = findBoneBySuffix(model, 'LeftHand')
  const foreArm = findBoneBySuffix(model, 'RightForeArm')
  if (right && left && foreArm) {
    weapon = await Weapon.load(gunName as WeaponKind)
    scene.add(weapon.object)
    if (gunName === 'knife') {
      // ナイフは本番と同じ付け方 (soldier.ts)。右手に、肘から手首の線を刃の向きに
      weapon.attachTo(
        right,
        new THREE.Vector3().setFromMatrixPosition(foreArm.matrixWorld),
        new THREE.Vector3().setFromMatrixPosition(right.matrixWorld),
      )
    } else {
      weapon.attachTo(
        right,
        new THREE.Vector3().setFromMatrixPosition(right.matrixWorld),
        new THREE.Vector3().setFromMatrixPosition(left.matrixWorld),
        right.matrixWorld.clone(),
      )
    }
  }
}

/*
 * **刻んで進める。** 一気に進めると、骨の追従 (ばね) が 1 歩で終わってしまう。
 * 実機と同じ 60 分の 1 で回して、その時刻の形を描く。
 */
/*
 * 上半身の型は locomotion では出ない。**撃っているかどうかで決まる** ので、
 * 伏せ撃ち (prone_fire) を見たいときは ?fire を付けて姿勢を prone_idle にする。
 */
/*
 * ?roll … 転がりを頭から流す。**locomotion では出ない** — 転がりは上下を
 * 同時に流す全身動作で、playRoll が入口。尻尾で何の姿勢に渡るかを見るのに使う。
 */
const firing = query.has('fire')
// 一度きりの全身の型は**姿勢を決めてから**頭から流す。伏せていれば伏せの刺突になる
const oneShot =
  query.has('roll') || query.has('vault') || query.has('vaultup') || query.has('hang') || query.has('hangclimb')
if (!oneShot) anim.setLocomotion(clipName as never)
if (query.has('roll')) anim.playRoll()
// ?vault … 窓枠を跳び越える。転がりと同じ全身の型で、playVault が入口
if (query.has('vault')) anim.playVault()
// ?vaultup … 一段上へ乗る (上下は型から抜いてあるので、その場で足だけ動く)
if (query.has('vaultup')) anim.playVault(true)
// ?hang … 縁から落ちてぶら下がる (最後のコマで止まる)。?hangclimb … そこから登る
if (query.has('hang')) anim.playHang()
if (query.has('hangclimb')) anim.playHangClimb()
// ?stab … 刺す。姿勢が伏せ (clip=prone_idle) なら伏せた刺突になる
if (query.has('stab')) anim.playStab()
for (let t = 0; t < stopAt; t += 1 / 60) {
  // 流した型を姿勢で上書きしない (roll / stab は型が姿勢を持っている)
  if (!oneShot && !query.has('stab')) anim.setLocomotion(clipName as never)
  anim.setFiring(firing)
  anim.update(1 / 60)
}
model.updateMatrixWorld(true)
// ?bones … 手と腰の高さを出す (ぶら下がりで足元を縁からどれだけ下げるかを測る)
if (query.has('bones')) {
  const v = new THREE.Vector3()
  for (const suffix of ['Hips', 'RightHand', 'LeftHand', 'Head', 'RightFoot']) {
    const bone = findBoneBySuffix(model, suffix)
    if (bone) {
      bone.getWorldPosition(v)
      console.log('[bones]', suffix, v.y.toFixed(3), 'x', v.x.toFixed(3), 'z', v.z.toFixed(3))
    }
  }
  // 胸の向き = 上 × (左肩→右肩)。骨の軸より確か (ぶら下がりでは腰も頭も傾く)
  {
    const l = findBoneBySuffix(model, 'LeftArm')
    const r = findBoneBySuffix(model, 'RightArm')
    if (l && r) {
      const lp = l.getWorldPosition(new THREE.Vector3())
      const rp = r.getWorldPosition(new THREE.Vector3())
      const right = rp.sub(lp).setY(0).normalize()
      const forward = new THREE.Vector3(0, 1, 0).cross(right)
      console.log('[bones] chest forward', forward.x.toFixed(2), forward.z.toFixed(2))
    }
  }
  // 腰と頭の向き (Y 軸回り、度)。型が体を回している量を見る
  const q = new THREE.Quaternion()
  const dir = new THREE.Vector3()
  for (const suffix of ['Hips', 'Head']) {
    const bone = findBoneBySuffix(model, suffix)
    if (!bone) continue
    bone.getWorldQuaternion(q)
    // 腰の骨の +Y が体の前 (Mixamo)。それをワールドへ写して水平の向きを取る
    // 腰の骨は +Y が背骨 (上)。体の前は +Z
    dir.set(0, 0, 1).applyQuaternion(q)
    console.log('[bones]', suffix, 'yaw', ((Math.atan2(-dir.x, -dir.z) * 180) / Math.PI).toFixed(1), 'dir', dir.x.toFixed(2), dir.y.toFixed(2), dir.z.toFixed(2))
  }
}
if (box) {
  const headBone = findBoneBySuffix(model, 'Head')
  const headHeight = headBone ? headBone.getWorldPosition(new THREE.Vector3()).y : 1
  const tilt = query.get('tilt')
  const motion = new BoxMotion()
  if (tilt === 'fwd') motion.z = -1
  if (tilt === 'right') motion.x = 1
  placeBox(box, boxLift(headHeight), tilt ? motion : undefined)
  /*
   * 箱の写真 (cardboard.jpg) が届くまで待つ。**届く前に描くと箱ごと写らない** —
   * 撮る側は時計を進めるので、秒では待てない。画像の complete を見る。
   */
  const images: HTMLImageElement[] = []
  box.traverse((o) => {
    const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map
    if (map?.image) images.push(map.image as HTMLImageElement)
  })
  while (!images.every((image) => image.complete && image.naturalWidth > 0)) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
// 姿勢ごとに握りが違う。しゃがみの型を見るときは stance=1 を付ける
weapon?.applyStance(Number(query.get('stance') ?? '0'))

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
// ?at=prone … 伏せた体を枠に収める。立ちの高さのままだと頭しか映らない
if (at === 'prone') {
  camera.position.set(1.4, 1.0, 2.2)
  camera.lookAt(0, 0.25, 0)
}

await renderer.init()
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true
