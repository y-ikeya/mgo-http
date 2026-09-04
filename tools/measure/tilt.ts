// 上半身の前後の傾きを測る。**「素材どおりに立っているか」を数字で見る。**
//
// 腰→首 / 腰→頭 のベクトルを矢状面で見た角度。正 = 前傾、負 = のけぞり。
// 前方は「左脚→右脚を右とした法線」で決めるので、素材の向きに依存しない。
// ついでに肩と腰の水平角の差 (ねじれ) も出す。
//
// クリップ単体 (--clips) と、CharacterAnimator を回した合成後を並べる。
// 差がそのまま「コードが上乗せしている分」になる。
//
//   bun tools/measure/tilt.ts                     # 合成後
//   bun tools/measure/tilt.ts --clips idle relaxed_idle
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CharacterAnimator } from '../../src/presentation/scene/actor/animation'

const MODEL = 'public/models/soldier.glb'
const gltf = await new GLTFLoader().parseAsync(await Bun.file(MODEL).arrayBuffer(), '')

function bone(root: THREE.Object3D, suffix: string): THREE.Object3D {
  let found: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!found && o.name.endsWith(suffix) && !o.name.includes('End')) found = o
  })
  if (!found) throw new Error(`ボーンが無い: ${suffix}`)
  return found
}

/** 腰を原点に、頭と首がどれだけ前後へ振れているか */
function report(label: string, root: THREE.Object3D): void {
  const at = (suffix: string) => bone(root, suffix).getWorldPosition(new THREE.Vector3())
  const hips = at('Hips')
  const right = at('RightUpLeg').sub(at('LeftUpLeg')).setY(0).normalize()
  const forward = new THREE.Vector3(0, 1, 0).cross(right).normalize()
  const tilt = (suffix: string) => {
    const d = at(suffix).sub(hips)
    return (Math.atan2(d.dot(forward), d.y) * 180) / Math.PI
  }
  const horizontal = (a: THREE.Vector3, b: THREE.Vector3) =>
    (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI
  const twist =
    ((horizontal(at('LeftArm'), at('RightArm')) -
      horizontal(at('LeftUpLeg'), at('RightUpLeg')) +
      540) %
      360) -
    180
  console.log(
    `${label.padEnd(24)} 頭 ${tilt('Head').toFixed(1).padStart(7)}°   ` +
      `首 ${tilt('Neck').toFixed(1).padStart(7)}°   ` +
      `ねじれ ${twist.toFixed(1).padStart(7)}°`,
  )
}

/** クリップを 1 本そのまま流したときの姿勢 */
function clipPose(label: string, clip: string): void {
  const holder = new THREE.Group()
  const scene = gltf.scene.clone(true)
  holder.add(scene)
  const mixer = new THREE.AnimationMixer(scene)
  const found = gltf.animations.find((a: THREE.AnimationClip) => a.name === clip)
  if (!found) {
    console.log(`${label.padEnd(24)} クリップが無い`)
    return
  }
  mixer.clipAction(found).play()
  mixer.update(found.duration / 2)
  holder.updateWorldMatrix(true, true)
  report(label, scene)
}

/** CharacterAnimator を回したあとの姿勢 */
function livePose(
  label: string,
  options: { aiming?: boolean; locomotion?: string; boxed?: boolean; lean?: number } = {},
): void {
  const holder = new THREE.Group()
  const scene = gltf.scene.clone(true)
  holder.add(scene)
  const anim = new CharacterAnimator(scene, gltf.animations, 4.5)
  if (options.lean !== undefined) anim.relaxedLean = (options.lean * Math.PI) / 180
  if (options.boxed) anim.setBoxed(true)
  for (let i = 0; i < 240; i++) {
    anim.setLocomotion((options.locomotion ?? 'idle') as never)
    anim.setAiming(options.aiming ?? false)
    anim.update(1 / 60)
  }
  holder.updateWorldMatrix(true, true)
  report(label, scene)
}

console.log('正 = 前傾 / 負 = のけぞり\n')
const clips = process.argv.indexOf('--clips')
if (clips >= 0) {
  for (const clip of process.argv.slice(clips + 1)) clipPose(clip, clip)
} else {
  livePose('立ち・脱力')
  livePose('立ち・構え', { aiming: true })
  livePose('忍び足', { locomotion: 'sneak' })
  livePose('箱・忍び足', { locomotion: 'sneak', boxed: true })
  console.log('')
  clipPose('(素材) relaxed_idle', 'relaxed_idle')
  clipPose('(素材) idle', 'idle')
}
