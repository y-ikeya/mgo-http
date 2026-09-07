/**
 * 腕だけを別の層にしたらどう見えるかを確かめる頁。
 *
 *     bunx vite → http://localhost:5173/tools/preview/arms.html
 *
 * --- ゲームと同じ素材で並べる ---
 * **脚はゲームが使うクリップ** (LOWER_CLIPS の idle / run_f)。ここを揃えないと
 * 症状が再現しない — 脚に run_unarmed を当てていた頃は全員が正面を向いていて、
 * ゲームで起きている捻れが出なかった。
 *
 * --- 何を見比べるか ---
 * 拳銃や手榴弾を持っている間は両手が下りている。いまはその姿を**丸ごと別の
 * クリップ**で持っていて (pistol_relaxed / run_unarmed / crouch_unarmed)、
 * 「状態 × 武器」で要る型が増えている。
 *
 * 胴の動きはライフルの脱力と同じでよいはずなので、**腕だけ挿げ替えて済むか**。
 * ライフルの構えは触らない。
 *
 * 見る所は肩の継ぎ目。**腕の付け根は背骨の子**なので、胴が違うクリップだと
 * 肩の位置がずれて腕が外れて見えることがある。
 *
 * --- ここでは動きの仕掛けを触らない ---
 * 確かめるだけなので、クリップを**この頁の中で組み立てて**流す。良さそうなら
 * animation.ts に 3 本目の層を入れる。
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadSoldier } from '../../src/presentation/scene/assets'

/** 腕の骨。**肩から先** — 付け根 (Shoulder) を含めるかで見え方が変わる */
const ARM_BONE = /Shoulder|Arm|ForeArm|Hand|Thumb|Index|Middle|Ring|Pinky/
/** 下半身。animation.ts の LOWER_BODY_BONE と同じ */
const LOWER_BONE = /Hips|UpLeg|Leg|Foot|Toe/

const nodeNameOf = (track: string) => track.split('.')[0] ?? ''

/**
 * そのクリップから、当てはまる骨のトラックだけを抜く。
 *
 * **その場で走らせる。** 走りのクリップは腰が前へ進む動き (root motion) を
 * 持っているので、そのまま流すと画面の外へ歩いていく。対戦では位置を別に
 * 動かしているので進む分は要らない。
 *
 * 上下の揺れ (y) は残す。消すと足が地面を滑る。
 */
function pick(clip: THREE.AnimationClip, keep: (bone: string) => boolean, name: string) {
  const tracks = clip.tracks
    .filter((t) => keep(nodeNameOf(t.name)))
    .map((t) => {
      /*
       * 止めるのは**根の移動だけ**。
       *
       * Mixamo は骨ごとに位置を持っているので、全部潰すと骨格が中心線へ
       * 寄って体が崩れる (一度やった)。根は 2 つあり得る — 腰 (Hips) と、
       * その親の Armature (骨ではないので mixamorig で始まらない)。
       * **クリップによってどちらに移動が入っているかが違う。**
       */
      const node = nodeNameOf(t.name)
      const isRoot = /Hips/.test(node) || !node.startsWith('mixamorig')
      if (!t.name.endsWith('.position') || !isRoot) return t
      const values = Float32Array.from(t.values)
      // 前後左右を止める。**足元は動かさず、体だけ上下する**
      for (let i = 0; i < values.length; i += 3) {
        values[i] = 0
        values[i + 2] = 0
      }
      return new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(values))
    })
  return new THREE.AnimationClip(name, clip.duration, tracks)
}

/*
 * 見比べる 4 つ。**左 2 つが立ち、右 2 つが走り。**
 *
 * 拳銃や手榴弾を持っている間は両手が下りているので、いまは**丸ごと別のクリップ**
 * を当てている (pistol_relaxed / run_unarmed)。胴の動きはライフルの脱力と
 * 同じでよいはずなので、**腕だけ挿げ替えて済むか**を見る。
 */
const CELLS = [
  {
    label: '① ゲーム中 · 拳銃の脱力 (脚 idle + 上 pistol_relaxed)',
    legs: 'idle', torso: 'pistol_relaxed', arms: 'pistol_relaxed',
  },
  {
    label: '② 案 · 脚 idle + 胴 relaxed_idle + 腕 pistol_relaxed',
    legs: 'idle', torso: 'relaxed_idle', arms: 'pistol_relaxed',
  },
  {
    label: '③ ゲーム中 · 手榴弾の走り (脚 run_f + 上 run_unarmed)',
    legs: 'run_f', torso: 'run_unarmed', arms: 'run_unarmed',
  },
  {
    label: '④ 案 · 脚 run_f + 胴 relaxed_run + 腕 run_unarmed',
    legs: 'run_f', torso: 'relaxed_run', arms: 'run_unarmed',
  },
  {
    label: '⑤ ゲーム中 · ライフルの走り (脚 run_f + 上 relaxed_run)',
    legs: 'run_f', torso: 'relaxed_run', arms: 'relaxed_run',
  },
  { label: '⑥ 素材 · run_f だけ (戻しが効いている姿)', legs: 'run_f', torso: 'run_f', arms: 'run_f' },
] as const

/** ?front で真正面から見る。**体がどちらを向いているかは正面でしか分からない** */
const FRONT = new URLSearchParams(location.search).has('front')

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.getElementById('root')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x12171c)
scene.add(new THREE.HemisphereLight(0xcfe0d4, 0x4a4a44, 4.5))
const key = new THREE.DirectionalLight(0xffffff, 3.2)
key.position.set(2, 4, 3)
scene.add(key)

await renderer.init()
const gltf = await loadSoldier()
const byName = new Map(gltf.animations.map((c) => [c.name, c]))

console.log('CLIPS ' + gltf.animations.map((c) => c.name).sort().join(' '))

const labels = document.getElementById('labels')!
labels.style.gridTemplateColumns = `repeat(${CELLS.length}, 1fr)`

/** 上半身クリップの腰の向き。**補正の基準** */
const upperHips: (THREE.QuaternionKeyframeTrack | null)[] = []
/** その上半身クリップの腰の初期姿勢。載せ替えの元 */
const neutrals: (THREE.Quaternion | null)[] = []
/** 補正のために骨を引く */
const bones: { hips?: THREE.Object3D; spine?: THREE.Object3D }[] = []

const mixers: THREE.AnimationMixer[] = []
const cameras: THREE.PerspectiveCamera[] = []
const models: THREE.Object3D[] = []

CELLS.forEach((cell, i) => {
  // **SkeletonUtils で複製する。** 素の clone は骨の対応を作り直さないので、
  // 2 体目から先が動かない (最初の 1 体しか映らなかった)
  const model = cloneSkinned(gltf.scene)
  model.position.set(i * 3, 0, 0)
  scene.add(model)
  models.push(model)

  const mixer = new THREE.AnimationMixer(model)
  mixers.push(mixer)

  /*
   * 3 つの層を別々のクリップから取る。
   *
   * **脚は左右で揃える** (① ② が拳銃の脱力、③ ④ が手ぶらの走り)。変えたいのは
   * 上半身だけなので、脚まで違うと何を見比べているのか分からなくなる。
   */
  const legs = byName.get(cell.legs)
  const torso = byName.get(cell.torso)
  const arms = byName.get(cell.arms)
  if (legs) mixer.clipAction(pick(legs, (b) => LOWER_BONE.test(b), `${i}_legs`)).play()
  if (torso) {
    mixer.clipAction(pick(torso, (b) => !LOWER_BONE.test(b) && !ARM_BONE.test(b), `${i}_torso`)).play()
  }
  if (arms) mixer.clipAction(pick(arms, (b) => ARM_BONE.test(b), `${i}_arms`)).play()

  /*
   * ゲームの補正 (animation.ts の alignSpineToUpperClip) をそのまま持ってくる。
   *
   * **上半身が「本来乗るはずだった腰」の上に乗るように、背骨で差を打ち消す。**
   * 下半身のクリップが腰を振って作られていても、上半身はその振れを受けない。
   */
  const track = torso?.tracks.find(
    (t) => t.name.endsWith('.quaternion') && /Hips/.test(nodeNameOf(t.name)),
  )
  upperHips.push((track as THREE.QuaternionKeyframeTrack | undefined) ?? null)
  neutrals.push(track ? new THREE.Quaternion().fromArray(track.values, 0) : null)
  bones.push({
    hips: model.getObjectByName('mixamorigHips'),
    spine: model.getObjectByName('mixamorigSpine'),
  })

  const div = document.createElement('div')
  div.className = 'cell'
  div.innerHTML = `<span>${cell.label}</span>`
  labels.appendChild(div)
})

/**
 * 寄りは決め打ち。**その場で走らせてあるので、体は原点から動かない。**
 */
/** ?fix で補正を掛ける。**掛ける前と後を見比べるため** */
const FIX = new URLSearchParams(location.search).has('fix')
/**
 * ?rebase で「作られた向きの差の打ち消し」も掛ける (ゲームの upperTwistFix=1)。
 *
 * ゲームは補正した基準をさらに **idle の腰**へ載せ替えている。下半身が idle
 * 系のときは正しいが、走り (run_f) は別の向きで作られているので、載せ替えると
 * その差がそのまま捻れになる — という筋を確かめる。
 */
const REBASE = new URLSearchParams(location.search).has('rebase')
/** idle の腰。載せ替えの行き先 */
const uprightHips = (() => {
  const t = byName
    .get('idle')
    ?.tracks.find((x) => x.name.endsWith('.quaternion') && /Hips/.test(nodeNameOf(x.name)))
  return t ? new THREE.Quaternion().fromArray(t.values, 0) : null
})()


const refHips = new THREE.Quaternion()
const diff = new THREE.Quaternion()
const rebase = new THREE.Quaternion()
const scratch = new THREE.Quaternion()

/** ゲームと同じ補正。mixer が骨を書いた**後**に掛ける */
function align(i: number) {
  if (!FIX) return
  const track = upperHips[i]
  const { hips, spine } = bones[i] ?? {}
  if (!track || !hips || !spine) return
  // その再生位置での「本来の腰」。試写は 1 本を流し続けるので時刻は mixer から
  const time = (mixers[i]!.time % (track.times[track.times.length - 1] ?? 1)) || 0
  let at = 0
  while (at < track.times.length - 1 && track.times[at + 1]! <= time) at++
  refHips.fromArray(track.values, at * 4)
  const neutral = neutrals[i]
  if (REBASE && uprightHips && neutral) {
    // idle の腰へ載せ替える (ゲームの upperTwistFix = 1 と同じ向き)
    rebase.copy(uprightHips).multiply(scratch.copy(neutral).invert())
    refHips.premultiply(rebase)
  }
  diff.copy(hips.quaternion).invert().multiply(refHips)
  spine.quaternion.premultiply(diff)
}

/*
 * 腰と頭がどちらを向いているかを測る。**目で見ても角度は当てられない。**
 *
 * setTimeout では仮想時計の頁撮りで出ないので、その場で何コマか進めて測る。
 */
for (let n = 0; n < 30; n++) {
  for (const mixer of mixers) mixer.update(1 / 60)
  models.forEach((_, i) => align(i))
}
{
  const forward = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yawOf = (o: THREE.Object3D | undefined) => {
    if (!o) return NaN
    o.getWorldQuaternion(quat)
    forward.set(0, 0, -1).applyQuaternion(quat)
    return (Math.atan2(forward.x, -forward.z) * 180) / Math.PI
  }
  models.forEach((m, i) => {
    console.log(
      `YAW ${i + 1} 腰 ${yawOf(m.getObjectByName('mixamorigHips')).toFixed(0)}° ` +
        `胸 ${yawOf(m.getObjectByName('mixamorigSpine2')).toFixed(0)}° ` +
        `頭 ${yawOf(m.getObjectByName('mixamorigHead')).toFixed(0)}°`,
    )
  })
}

function layout() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  const w = window.innerWidth / CELLS.length
  cameras.length = 0
  CELLS.forEach((_, i) => {
    const camera = new THREE.PerspectiveCamera(30, w / window.innerHeight, 0.1, 100)
    /*
     * 斜め前から全身。
     *
     * **画角は縦。** 入る高さ = 2 × 距離 × tan(画角 / 2)。30° で 3m だと
     * 縦 1.6m しか入らず、身長 1.8m が収まらない。
     *
     * **このモデルは原点が腰。** 足は y = −0.9 あたりに在る。地面を 0 と思って
     * 狙うと、頭の上ばかり写って足が切れる (何度か撮り直した)。
     */
    if (FRONT) camera.position.set(i * 3, 0.2, 4.2)
    else camera.position.set(i * 3 + 2.3, 0.2, 3.5)
    camera.lookAt(i * 3, 0, 0)
    cameras.push(camera)
  })
}
layout()
window.addEventListener('resize', layout)

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta()
  for (const mixer of mixers) mixer.update(dt)
  models.forEach((_, i) => align(i))
  const w = Math.floor(window.innerWidth / CELLS.length)
  renderer.setScissorTest(true)
  cameras.forEach((camera, i) => {
    renderer.setViewport(i * w, 0, w, window.innerHeight)
    renderer.setScissor(i * w, 0, w, window.innerHeight)
    renderer.render(scene, camera)
  })
})
