/**
 * 試合と同じ姿勢の骨を書き出す。**Blender の試写のコピーに、試合の姿をそのまま写すため。**
 *
 *     bun tools/posedump.ts <体> <銃> <出力.json>
 *
 * 型を流すだけでは試合の姿にならない。試合はその上に、しゃがみの上体のひねり・上下の型の腰の差の
 * 打ち消し (CharacterAnimator)、構えた時の背骨の向け直し・右手の寄せ・左手の運び直し (armIk.ts) を
 * 重ねている。ここでは試写 (tools/preview/body.tsx) と同じ手順で型を流してから、Soldier と同じ順で
 * armIk を掛ける。銃の置き場所 (右手の骨の空間) は試写の ?gunref で測った値を下の表に書く
 *
 * 出力は骨ごとの世界の行列 (three の並び)。rest は読み込んだままの姿、ほかは姿勢ごと
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { CharacterAnimator } from '../src/presentation/scene/actor/animation'
import { LeftArmFollow, RightArmShift, SpineAim } from '../src/presentation/scene/actor/armIk'
import { WEAPON_CONFIGS } from '../src/presentation/scene/arms/weapon'

const [skin = 'soldier_nanashi', gun = 'sniper', out = 'posedump.json'] = process.argv.slice(2)

type Hold = { position: number[]; quaternion: number[]; scale: number }
type Case = { name: string; clip: string; stance: 0 | 1 | 2; aim: boolean; hold: Hold; plain?: Hold }

/** 試写 (?gunref) で測った、右手の骨の空間の銃の置き場所。plain は構えの回し (aimTrim) を掛ける前 */
const STAND_RELAX: Hold = { position: [22.18218709573995, 28.605846247044305, 4.801159503996072], quaternion: [0.5510062097282947, -0.42539230645757076, 0.6432613354877836, 0.3188356489991786], scale: 117.40730361019092 }
const CROUCH_RELAX: Hold = { position: [27.0692, 15.78, 4.4352], quaternion: [0.50893, -0.51028, 0.52889, 0.4482], scale: 100 }
const PRONE: Hold = { position: [24.202330565507197, 19.308210373658483, -9.23651403071717], quaternion: [0.5990353044056651, -0.3309313619554754, 0.4350721265806922, 0.5851159744440152], scale: 117.40974881720004 }
const CASES: Case[] = [
  { name: 'stand', clip: 'idle', stance: 0, aim: false, hold: STAND_RELAX },
  { name: 'stand_aim', clip: 'idle', stance: 0, aim: true, plain: STAND_RELAX, hold: { position: [24.664156777670517, 26.914083397802198, 0.8246073629120865], quaternion: [0.5026743572272716, -0.4015966674004572, 0.6610632702096497, 0.3860539083775007], scale: 117.40730361019092 } },
  { name: 'crouch', clip: 'crouch_idle', stance: 1, aim: false, hold: CROUCH_RELAX },
  { name: 'crouch_aim', clip: 'crouch_idle', stance: 1, aim: true, plain: CROUCH_RELAX, hold: { position: [27.265129029987882, 14.818144676407815, 6.200515448012423], quaternion: [0.548442477824993, -0.5461816315194017, 0.47933034984039213, 0.4136883739778497], scale: 100 } },
  { name: 'prone', clip: 'prone_idle', stance: 2, aim: false, hold: PRONE },
  { name: 'prone_aim', clip: 'prone_idle', stance: 2, aim: true, hold: PRONE },
]

const config = WEAPON_CONFIGS[gun as keyof typeof WEAPON_CONFIGS]
const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await Bun.file(`public/models/${skin}.glb`).arrayBuffer(), '')

const worldOf = (root: THREE.Object3D) => {
  const out: Record<string, number[]> = {}
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out[o.name] = o.matrixWorld.toArray().map((v) => +v.toFixed(7))
  })
  return out
}
const bone = (root: THREE.Object3D, suffix: string) => {
  let hit: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && o.name.endsWith(suffix)) hit = o
  })
  return hit as unknown as THREE.Object3D
}

const result: Record<string, Record<string, number[]>> = {}
for (const c of CASES) {
  // 試写と同じ入れ子: 根を 180° 回し、模型はその中で 180° (正面は +Z)
  const root = new THREE.Group()
  root.rotation.y = Math.PI
  const model = g.scene.clone(true)
  model.rotation.y = Math.PI
  root.add(model)
  if (!result.rest) result.rest = worldOf(root)

  const anim = new CharacterAnimator(model, g.animations, 4.5)
  anim.setHeldWeapon(gun)
  anim.setAiming(c.aim)
  anim.gunLift.stand = THREE.MathUtils.degToRad(config.aimLift?.stand ?? 0)
  anim.gunLift.crouch = THREE.MathUtils.degToRad(config.aimLift?.crouch ?? 0)
  for (let t = 0; t < 1.0; t += 1 / 60) {
    anim.setLocomotion(c.clip as never)
    anim.setFiring(false)
    anim.update(1 / 60)
  }
  root.updateMatrixWorld(true)

  // 銃の代わり。右手の骨に同じ置き場所で付ける (銃身はローカルの -Z)
  const hand = bone(model, 'RightHand')
  const dummy = new THREE.Object3D()
  const place = (h: Hold) => {
    dummy.position.fromArray(h.position)
    dummy.quaternion.fromArray(h.quaternion)
    dummy.scale.setScalar(h.scale)
  }
  place(c.hold)
  hand.add(dummy)
  root.updateMatrixWorld(true)

  // Soldier と同じ順: 背骨を照準へ → 右手をずらす → 左手を運び直す。伏せは掛けない (proneStage)
  if (c.aim && c.stance < 2) {
    new SpineAim().apply(model, dummy, root.rotation.y, 0, 1)
    const right = new RightArmShift()
    const shift = config.rightShift
      ? new THREE.Vector3().lerpVectors(config.rightShift.stand, config.rightShift.crouch, Math.min(1, c.stance))
      : new THREE.Vector3()
    right.apply(model, root, shift)
    root.updateMatrixWorld(true)
    // 構えの回し (aimTrim) で銃が回った分。握り (grip) を支点に
    const grip = (c.stance === 0 ? config.grip : config.crouchGrip ?? config.grip).clone()
    const corrected = {
      aimAmount: 1,
      leftHandTarget: () => false,
      aimCorrection(outDelta: THREE.Quaternion, outPivot: THREE.Vector3): boolean {
        if (!c.plain) return false
        const handWorld = hand.getWorldQuaternion(new THREE.Quaternion())
        const aim = handWorld.clone().multiply(new THREE.Quaternion().fromArray(c.hold.quaternion))
        const plain = handWorld.clone().multiply(new THREE.Quaternion().fromArray(c.plain.quaternion))
        outDelta.copy(aim).multiply(plain.invert())
        outPivot.copy(grip).applyMatrix4(dummy.matrixWorld)
        return true
      },
    }
    new LeftArmFollow().apply(model, corrected, right.moved)
  }
  result[c.name] = worldOf(root)
  console.log(c.name, anim.playingKeys)
}
await Bun.write(out, JSON.stringify(result))
console.log('wrote', out)
