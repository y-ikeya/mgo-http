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
 *     ?trace                  0.1 秒ごとに銃身と両手の向きを書き出す (コンソールの [trace])
 *     ?death=front|back|none  clip の姿勢で 1 秒置いてから倒す (front = 正面から撃たれた)。t は倒してから
 *     ?sleep                  clip の姿勢で 1 秒置いてから眠らせる (麻酔)。clip=sweep なら仰向けに倒してから。t は眠らせてから
 *     ?throw                  手榴弾の振りかぶりを頭から流す (t 秒目で止める)
 *     ?reload=2.4             装填の型を頭から流す (秒)。clip=run_f と組むと走りながら
 *     ?blink=1                瞬きのシェイプキー Blink をその効き (0〜1) に止める
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
import { setBodyOpacity } from '../../src/presentation/scene/actor/skin'
import { CharacterAnimator, findBoneBySuffix } from '../../src/presentation/scene/actor/animation'
import { Weapon, type WeaponKind } from '../../src/presentation/scene/arms/weapon'
import { StunSparks } from '../../src/presentation/scene/fx/stunSparks'
import { LeftArmFollow, RightArmShift, SpineAim } from '../../src/presentation/scene/actor/armIk'
import { WEAPON_CONFIGS } from '../../src/presentation/scene/arms/weapon'

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

/** 骨ごとの世界の行列 (?dump)。素の姿は型を流す前にここで控える */
const bonesWorld = () => {
  const out: Record<string, number[]> = {}
  root.updateMatrixWorld(true)
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) out[o.name] = o.matrixWorld.toArray().map((v) => +v.toFixed(7))
  })
  return out
}
const restWorld = query.has('dump') ? bonesWorld() : null

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
// 構えは銃を付けた後で入れる (下の取り付けの注)
anim.setAiming(false)
// ?knife … ナイフを持っている (構えると knife_idle)
anim.setKnife(query.has('knife'))
// ?look=60 … 首をカメラの向きへ (度、左が正)。構えていないときだけ効く
anim.setLookYaw((Number(query.get('look') ?? '0') * Math.PI) / 180)
anim.setAimPitch(pitch)
// ?hairstay=0.5 … 髪の根を胸に残す割合 (animation.ts の HAIR_STAY) を試す
if (query.has('hairstay')) anim.hairStay = Number(query.get('hairstay'))
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
  /*
   * **構えていない姿勢で付ける。** 本番の Soldier は湧いた直後 (構えていない) に
   * 付けて、その手の向きを以後ずっと基準にする。構えた姿勢で付けていた頃は基準が
   * 違い、同じ握りの値でも銃の向きが本番と 20° 近くずれた (AK: ここでは 8.6° 下、
   * 本番は 10° 上。2026-10-10)
   */
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

// 構えていない時の持ち方は銃ごと (animation.ts の WEAPON_RELAXED)
if (gunName && gunName !== 'knife') anim.setHeldWeapon(gunName)
anim.setAiming(query.has('aim'))

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
  query.has('roll') || query.has('vault') || query.has('vaultup') || query.has('hang') || query.has('hangclimb') ||
  query.has('setup') || query.has('place')
if (!oneShot) anim.setLocomotion(clipName as never)
if (query.has('roll')) anim.playRoll()
// ?reload … 装填の型を頭から流す (clip の姿勢のまま。&reload=2.4 で秒を決める)。走りながらの上体の折れを見る
if (query.has('reload')) anim.playReload(Number(query.get('reload')) || 0)
// ?bolt … ボルトを引く型を頭から流す (&t= で止める秒)。狙撃銃のコッキングの上体を見る
if (query.has('bolt')) anim.playBolt()
// ?vault … 窓枠を跳び越える。転がりと同じ全身の型で、playVault が入口
if (query.has('vault')) anim.playVault()
// ?vaultup … 一段上へ乗る (上下は型から抜いてあるので、その場で足だけ動く)
if (query.has('vaultup')) anim.playVault(true)
// ?hang … 縁から落ちてぶら下がる (最後のコマで止まる)。?hangclimb … そこから登る
if (query.has('hang')) anim.playHang()
if (query.has('hangclimb')) anim.playHangClimb()
// ?stab … 刺す。姿勢が伏せ (clip=prone_idle) なら伏せた刺突になる
if (query.has('stab')) anim.playStab()
if (query.has('throw')) {
  anim.setHandsEmpty(true)
  anim.playThrow()
}
// ?setup … クレイモアを構える (振りかぶりを頭から。&fromcrouch で屈んだ所から)。?place … 構え切った所から置く型を流す。
// locomotion に 'claymore_place' を渡しても出ない (一度きりの全身の型は playSetup が入口)
// ?setupspeed=1.75 … TRAP MASTERY の速さで (soldier.ts の setSkills と同じ口)
if (query.has('setupspeed')) anim.setSetupSpeed(Number(query.get('setupspeed')))
if (query.has('setup')) anim.playSetup(query.has('fromkneel') ? 'kneel' : query.has('fromcrouch') ? 'crouch' : 'stand')
if (query.has('place')) anim.releaseSetup()
// ?zap … スタンナイフの放電 (fx/stunSparks.ts)。頭から右手に出す。&stab と組むと刺しながら
const zap = query.has('zap') ? new StunSparks(scene) : null
// ?death … 姿勢を 1 秒落ち着かせてから倒す。相手の体と同じ口 (playDeath) を通す
const death = query.get('death')
if (death) {
  for (let i = 0; i < 60; i++) {
    anim.setLocomotion(clipName as never)
    anim.update(1 / 60)
  }
  anim.playDeath(death === 'front' ? false : death === 'back' ? true : undefined)
}
// ?sleep … 姿勢を 1 秒落ち着かせてから眠らせる。本番と同じく playSleep を通し、その後は姿勢 sleep を渡し続ける。
// clip=sweep なら爆風で仰向けに倒してから (仰向けのまま眠る)
const sleep = query.has('sleep')
if (sleep) {
  if (clipName === 'sweep') anim.playSweep()
  for (let i = 0; i < 60; i++) {
    if (clipName !== 'sweep') anim.setLocomotion(clipName as never)
    anim.update(1 / 60)
  }
  anim.playSleep()
}
const zapHand = findBoneBySuffix(model, 'RightHand')
if (zap && zapHand) zap.discharge((out) => out.setFromMatrixPosition(zapHand.matrixWorld))
/*
 * ?trace … 0.1 秒ごとに**銃身と両手の向き**を書き出す (体の前に対する左右・上下、度)。
 * 構えて歩く間に銃口が揺れていないかを、お手本 (tools/raw/m4Walk.fbx の 4 本目) と比べる
 */
const trace = query.has('trace')
const traceRight = findBoneBySuffix(model, 'RightHand')
const traceLeft = findBoneBySuffix(model, 'LeftHand')
let traceAt = 0
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1)
for (let t = 0; t < stopAt; t += 1 / 60) {
  if (trace && weapon && traceRight && traceLeft && t >= traceAt) {
    traceAt += 0.1
    model.updateMatrixWorld(true)
    const barrel = new THREE.Vector3(0, 0, -1).transformDirection(weapon.object.matrixWorld)
    const hands = new THREE.Vector3()
      .setFromMatrixPosition(traceLeft.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(traceRight.matrixWorld))
      .normalize()
    // 体の前は根の -Z (turn で回した分を戻して測る)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion)
    const yawOf = (v: THREE.Vector3) => Math.atan2(v.x * fwd.z - v.z * fwd.x, -(v.x * fwd.x + v.z * fwd.z))
    console.log(
      '[trace]', t.toFixed(1),
      'barrel', deg(yawOf(barrel)), deg(Math.asin(barrel.y)),
      'hands', deg(yawOf(hands)), deg(Math.asin(hands.y)),
    )
  }
  // 流した型を姿勢で上書きしない (roll / stab は型が姿勢を持っている)
  if (!oneShot && !query.has('stab')) anim.setLocomotion((sleep ? 'sleep' : clipName) as never)
  // 置く型は本番と同じく、姿勢を setupLocomotion から引く (soldier.ts の setting)
  if (query.has('setup') || query.has('place')) anim.setLocomotion((anim.setupLocomotion ?? clipName) as never)
  anim.setFiring(firing)
  anim.update(1 / 60)
  if (query.has('blink')) {
    const shut = Number(query.get('blink') || '1')
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      const index = mesh.morphTargetDictionary?.Blink
      if (index !== undefined) mesh.morphTargetInfluences![index] = shut
    })
  }
  // 体の薄さ (カメラが寄った時の setFade)。くり抜きの髪が抜けないかを見る
  if (query.has('fade')) {
    const fade = Number(query.get('fade'))
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of [mesh.material].flat()) {
        if (!m.transparent) { m.transparent = true; m.needsUpdate = true }
        if (query.has('oldfade')) m.opacity = fade
        else setBodyOpacity(m as never, fade)
      }
    })
  }
  if (zap) {
    model.updateMatrixWorld(true)
    zap.update(1 / 60)
  }
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
  /*
   * ?gunref … 右手の骨 3 本の位置と、銃の空間の 3 点の位置 (世界)。**Blender で同じ持ち方を再現する**ための数字
   * (骨の頭の位置は軸の取り方によらないので、骨の向きの違う Blender でも同じ枠が組める。2026-11-14)
   */
  if (weapon && query.has('gunref')) {
    // 姿勢と構えの持ち方は下で当てるが、測るのはそれを当てた後の置き場所
    weapon.applyStance(Number(query.get('stance') ?? '0'))
    weapon.setAimWeight(query.has('aim') ? 1 : 0)
    weapon.object.updateMatrixWorld(true)
    const at = (s: string) => findBoneBySuffix(model, s)?.getWorldPosition(new THREE.Vector3()).toArray()
    const gun = [[0, 0, 0], [0, 0, -1], [0, 1, 0]].map((p) => weapon!.object.localToWorld(new THREE.Vector3(...(p as [number, number, number]))).toArray())
    const hand = findBoneBySuffix(model, 'RightHand')!.getWorldPosition(new THREE.Vector3())
    console.log('[gunref] muzzle-hand', weapon.muzzleWorld(new THREE.Vector3()).sub(hand).toArray().map((x) => x.toFixed(3)).join(' '))
    console.log('[gunref] keys', anim.playingKeys)
    {
      // 銃身 (銃の -Z) の向き。体の前 (根の -Z) からの左右と上下 (度)
      const b = new THREE.Vector3(0, 0, -1).transformDirection(weapon.object.matrixWorld)
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion)
      const yaw = Math.atan2(b.x * f.z - b.z * f.x, b.x * f.x + b.z * f.z)
      console.log('[gunref] barrel yaw', ((yaw * 180) / Math.PI).toFixed(1), 'pitch', ((Math.asin(b.y) * 180) / Math.PI).toFixed(1))
    }
    console.log('[gunref] chain', JSON.stringify(['Hips', 'Spine', 'Spine1', 'Spine2', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'].map((b) => at(b)?.map((x) => +x.toFixed(3)))))
    console.log('[gunref]', JSON.stringify({ hand: at('RightHand'), fore: at('RightForeArm'), mid: at('RightHandMiddle1'), gun, local: { position: weapon.object.position.toArray(), quaternion: weapon.object.quaternion.toArray(), scale: weapon.object.scale.x } }))
  }
  // 銃口の高さ (構えの壁判定の高さを決めるのに使う)
  if (weapon) {
    const muzzle = weapon.muzzleWorld(new THREE.Vector3())
    console.log('[bones] muzzle', muzzle.y.toFixed(3), 'forward', Math.hypot(muzzle.x, muzzle.z).toFixed(3))
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
// 構えの持ち方 (aimHold) は試合と同じく掛かり具合で寄せる。提げている間の左手も試合と同じく型に聞く
weapon?.setAimWeight(query.has('aim') ? 1 : 0)
weapon?.setAimHoldWeight(query.has('aim') ? 1 : 0)
weapon?.setCarryWeight(anim.carrying ? 1 : 0)
/*
 * ?dump … 試合と同じ順で**構えの補正を掛けて**、骨と銃の置き場所をページに書き出す (Blender で同じ姿を
 * 組むため)。構えている間は背骨を照準へ向け直し (SpineAim)、右手をずらし (rightShift)、銃身を照準へ
 * (alignBarrel の銃だけ)、最後に左手を運ぶ (soldier.ts の順)。?dump を付けない時は今まで通り左手だけ
 */
const rightShift = new RightArmShift()
const spineAim = new SpineAim()
const leftArm = new LeftArmFollow()
/**
 * 型を当てた後の腕の手当て。**試合 (soldier.ts) と同じ順。** ?orbit で流し続ける間も毎コマ掛け直す
 * (掛け直さないと、型が骨を書き直した後の姿 = 試合と違う姿になる)
 */
function applyArms(): void {
  if (!weapon) return
  if (gunName && query.has('dump') && query.has('aim')) {
    model.updateMatrixWorld(true)
    // 試合の向き (yaw) は根の回りそのもの (soldier.ts の object.rotation.y = yaw)。ここの根は turn + 180°
    const yaw = turn + Math.PI
    spineAim.apply(model, weapon.object, yaw, pitch, 1)
    const shift = WEAPON_CONFIGS[gunName as keyof typeof WEAPON_CONFIGS]?.rightShift
    if (shift) {
      const crouch = Math.min(1, Number(query.get('stance') ?? '0'))
      rightShift.apply(model, root, new THREE.Vector3().lerpVectors(shift.stand, shift.crouch, crouch))
    }
    weapon.object.updateWorldMatrix(true, false)
    const aimDir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    weapon.alignTo(aimDir, 1)
  }
  // 左手を銃へ運ぶ (試合の Soldier と同じ。構えの左手・提げている間の左手)
  model.updateMatrixWorld(true)
  leftArm.apply(model, weapon, rightShift.moved)
}
/** 前のコマの手当てを外す。型を当てる前に (soldier.ts と同じ) */
function restoreArms(): void {
  leftArm.restore()
  rightShift.restore()
  spineAim.restore()
}
applyArms()
if (restWorld) {
  const dump = document.createElement('pre')
  dump.id = 'dump'
  dump.textContent = JSON.stringify({
    rest: restWorld,
    pose: bonesWorld(),
    keys: anim.playingKeys,
    // 右手の骨の空間の銃の置き場所 (weapon.object は右手の子)
    hold: weapon
      ? { position: weapon.object.position.toArray(), quaternion: weapon.object.quaternion.toArray(), scale: weapon.object.scale.x }
      : null,
  })
  document.body.appendChild(dump)
}

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
// ?cam=x,y,z … 頭から見たカメラの位置 (m)。顎の下から見上げるなど (例 cam=0.1,-0.25,0.45)
const camAt = query.get('cam')?.split(',').map(Number)
if (at === 'head' && camAt?.length === 3) {
  camera.position.set(head.x + camAt[0]!, head.y + camAt[1]!, head.z + camAt[2]!)
  camera.lookAt(head.x, head.y - 0.05, head.z)
} else if (at === 'head') {
  camera.position.set(head.x + 0.1, head.y + 0.05, head.z + 0.55)
  camera.lookAt(head.x, head.y + 0.05, head.z)
} else if (at === 'chest') {
  camera.position.set(chest.x, chest.y, chest.z + 0.9)
  camera.lookAt(chest)
} else {
  camera.position.set(0.4, 1.2, 3.0)
  camera.lookAt(0, 0.95, 0)
}
// ?at=hips … 腰へ寄る (股の布や腰回りの重みを見る)。?cam=x,y,z で腰から見たカメラの位置 (m)
if (at === 'hips') {
  const hips = bone('Hips') ?? new THREE.Vector3(0, 0.95, 0)
  const off = camAt?.length === 3 ? camAt : [0, -0.05, 0.75]
  camera.position.set(hips.x + off[0]!, hips.y + off[1]!, hips.z + off[2]!)
  camera.lookAt(hips.x, hips.y - 0.08, hips.z)
}
// ?at=prone … 伏せた体を枠に収める。立ちの高さのままだと頭しか映らない
if (at === 'prone') {
  camera.position.set(1.4, 1.0, 2.2)
  camera.lookAt(0, 0.25, 0)
}

// 骨の世界の位置 (m) を読む口。CDP の Runtime.evaluate で `pose()` を呼ぶ
;(globalThis as unknown as { pose: () => unknown }).pose = () =>
  Object.fromEntries(['Hips', 'Spine2', 'Neck', 'Head', 'RightHand', 'LeftHand', 'LeftToeBase', 'RightToeBase', 'LeftLeg', 'RightLeg'].map((n) => [n, bone(n)?.toArray().map((v) => +v.toFixed(3))]))
;(globalThis as unknown as { sole: () => unknown }).sole = () => {
  // 体の形の一番下 (m)。足裏が地面 (0) から浮いていないかを見る
  let y = Infinity
  const v = new THREE.Vector3()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    const pos = m.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v)
      v.applyMatrix4(m.matrixWorld)
      if (v.y < y) y = v.y
    }
  })
  return +y.toFixed(3)
}
;(globalThis as unknown as { crown: () => unknown }).crown = () => {
  // 体の形の一番上 (m)。骨で曲げた後の形で測る (頭の天辺)
  let y = -Infinity
  const v = new THREE.Vector3()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    const pos = m.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 3) {
      m.getVertexPosition(i, v)
      v.applyMatrix4(m.matrixWorld)
      if (v.y > y) y = v.y
    }
  })
  return +y.toFixed(3)
}
;(globalThis as unknown as { pitch: () => unknown }).pitch = () =>
  // 骨の前 (局所 +Z) が水平からどれだけ上を向いているか (度)。胸と頭の起き具合を見る
  Object.fromEntries(['Spine2', 'Head'].map((n) => {
    const b = findBoneBySuffix(model, n)
    if (!b) return [n, null]
    const f = new THREE.Vector3(0, 0, 1).transformDirection(b.matrixWorld)
    return [n, +((Math.asin(f.y) * 180) / Math.PI).toFixed(1)]
  }))
;(globalThis as unknown as { locals: (names: string[]) => unknown }).locals = (names: string[]) =>
  // 骨の局所の回り (親から見た、x y z w)。型の値と突き合わせて、型の後に誰が骨を触ったかを見る
  Object.fromEntries(names.map((n) => [n, findBoneBySuffix(model, n)?.quaternion.toArray().map((v) => +v.toFixed(5)) ?? null]))
;(globalThis as unknown as { held: () => unknown }).held = () => {
  // 右手の骨に付いている物 (銃) の、手からの置き場所。weapon.ts の standHold などと突き合わせる
  const hand = findBoneBySuffix(model, 'RightHand')
  if (!hand) return null
  return hand.children
    .filter((c) => !(c as THREE.Bone).isBone)
    .map((c) => ({
      name: c.name,
      position: c.position.toArray().map((v) => +v.toFixed(4)),
      quaternion: c.quaternion.toArray().map((v) => +v.toFixed(5)),
      scale: +c.scale.x.toFixed(3),
      world: c.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)),
      box: (() => { const b = new THREE.Box3().setFromObject(c); return [b.min.toArray(), b.max.toArray()].map((p) => p.map((v) => +v.toFixed(3))) })(),
      // 銃の形の、銃自身の原点から見た範囲 (銃の単位)。Blender の銃の原点と突き合わせる
      localBox: (() => {
        const inv = c.matrixWorld.clone().invert()
        const b = new THREE.Box3()
        const v = new THREE.Vector3()
        c.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const pos = m.geometry.attributes.position
          for (let i = 0; i < pos.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv))
        })
        return [b.min.toArray(), b.max.toArray()].map((p) => p.map((x) => +x.toFixed(4)))
      })(),
      // 銃の局所の軸 (+X / +Y / +Z) が世界でどちらを向いているか
      axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.transformDirection(c.matrixWorld).toArray().map((v) => +v.toFixed(3))),
      handAxes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.transformDirection(hand.matrixWorld).toArray().map((v) => +v.toFixed(3))),
      children: c.children.map((g) => ({ name: g.name, position: g.position.toArray().map((v) => +v.toFixed(4)), quaternion: g.quaternion.toArray().map((v) => +v.toFixed(5)) })),
    }))
}
await renderer.init()
await renderer.renderAsync(scene, camera)
;(globalThis as unknown as { ready: boolean }).ready = true

/*
 * ?orbit … 止めずに型を流し続け、マウスでカメラを回せる (左ドラッグで回す・右で平行移動・ホイールで寄る)。
 * 本人が体を見回して、崩れている所を指すため (2026-11-19)。&clip=run_f で走らせながら回せる
 */
if (query.has('orbit')) {
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
  const canvas = renderer.domElement as HTMLCanvasElement
  const fit = () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }
  fit()
  window.addEventListener('resize', fit)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(head.x, at === 'head' ? head.y : 1.0, head.z)
  controls.enableDamping = true
  controls.update()
  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05)
    if (!oneShot && !query.has('stab')) anim.setLocomotion(clipName as never)
    restoreArms()
    anim.update(dt)
    applyArms()
    controls.update()
    renderer.render(scene, camera)
  })
}
