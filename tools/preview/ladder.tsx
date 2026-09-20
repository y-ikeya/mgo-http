/**
 * 梯子を登る姿を**本物の Soldier で**確かめる。
 *
 *     bunx vite → http://localhost:5174/tools/preview/ladder.html
 *     ?t=2.4     何秒登ったところを描くか (既定 1.2)
 *     ?view=side 横から / front 正面から / back 背中側
 *     ?gun=sniper 銃を持たせる (登っている間は隠れるはず)
 *     ?real=ladder_a **本物のステージで登る** (地形の当たりもそのまま)
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
import { type Ladder, ladderGrip } from '../../src/domain/stage'
import { loadStageLadders, loadStageMoveWorld } from '../../src/presentation/scene/world/stage'
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
const EMPTY_WORLD = {
  resolveHorizontal: () => {},
  groundHeight: () => 0,
  ceilingHeight: () => Number.POSITIVE_INFINITY,
}

/*
 * ?real=ladder_a … **本物のステージで登る。**
 *
 * 作り物の梯子では、地形に引っ掛かって登れないという話が再現しない。
 * 当たりの形 (mesh.bin) ごと読んで、そこで掴ませる。
 */
const realName = query.get('real')
const realLadders = realName ? await loadStageLadders('raft') : []
const realLadder = realLadders.find((l) => l.name === realName) ?? null
const realWorld = realName ? await loadStageMoveWorld('raft') : null
const WORLD = realWorld ?? EMPTY_WORLD

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
player.setLadders(realLadder ? [realLadder] : [LADDER])
scene.add(player.object)
// 梯子の手前に立たせる
if (realLadder) {
  // 梯子の足元、掴める所へ置く
  const mid = (realLadder.min[2] + realLadder.max[2]) / 2
  player.position.set(realLadder.max[0] + 0.5, realLadder.min[1] + 0.1, mid)
} else {
  player.position.set(0.6, 0, 0)
}
if (gun) await player.equip(gun)

// **掴む前に**どこから掴めるかを調べる。掴んだ後では ladderInReach は必ず false
const reachText = realLadder ? reachMap() : '-'

/*
 * ?walk … **歩いて近づく。**
 *
 * 判定の上では届いていても、柵に阻まれてそこまで行けなければ掴めない。
 * デッキ側から梯子へ向かって歩かせて、どこで止まるかを見る。
 */
const walkText: string[] = []
if (realLadder && query.has('walk')) {
  const midX = (realLadder.min[0] + realLadder.max[0]) / 2
  const midZ = (realLadder.min[2] + realLadder.max[2]) / 2
  const from = Number(query.get('walk') || '-3')
  player.position.set(midX + from, realLadder.min[1] + 0.5, midZ)
  // 梯子へ向かって歩く。向きは x の正負で決める
  const dir = new THREE.Vector3(from < 0 ? 1 : -1, 0, 0)
  for (let t = 0; t < 4; t += 1 / 60) {
    player.update(1 / 60, dir, Math.atan2(-dir.x, -dir.z), 0, WORLD)
    if (Math.abs(t * 2 - Math.round(t * 2)) < 1 / 120) {
      const p = player.position
      walkText.push(
        `${t.toFixed(1)}s x${p.x.toFixed(2)} y${p.y.toFixed(2)} ` +
          `梯子まで${Math.abs(p.x - midX).toFixed(2)} ${player.ladderInReach ? '掴める' : '届かない'}`,
      )
    }
  }
}

// **本物の口から掴む。** 押している量も本番と同じ setStickForward で渡す
const grabbed = player.grabLadder()
player.setStickForward(1)

/*
 * **刻んで進める。** 一気に進めると型のばねも当たりも 1 歩で終わる。
 * 実機と同じ 60 分の 1 で回す。
 */
/*
 * ?sleep=3 … **登っている途中で眠らせる。**
 *
 * 眠った体は梯子を離して落ちるはず (soldier.ts の sleep → releaseLadder)。
 * 途中で横になって寝たままなら、離した後の落下が止まっている。
 */
const sleepAt = query.has('sleep') ? Number(query.get('sleep')) : null
const track: string[] = []
const frames: string[] = []
for (let t = 0; t < stopAt; t += 1 / 60) {
  if (sleepAt !== null && t >= sleepAt && t < sleepAt + 1 / 60) player.sleep(30)
  player.update(1 / 60, new THREE.Vector3(), player.yaw, 0, WORLD)
  if (frames.length < 30 && realWorld) {
    const p = player.position
    frames.push(
      `${p.y.toFixed(3)}/g${realWorld.groundHeight(p, 0.35, p.y).toFixed(2)}`,
    )
  }
  // 1 秒ごとの高さ。**どこで止まったか**を数字で残す
  if (Math.floor(t) !== Math.floor(t - 1 / 60)) {
    track.push(`${Math.floor(t)}s ${player.position.y.toFixed(2)}${player.onLadder ? ' 梯子' : ''}${player.sleeping ? ' 眠り' : ''}`)
  }
}
player.object.updateMatrixWorld(true)
// 数字は console にも出す。無頭の Chrome から読むため
console.info('[ladder] ' + track.join(' | '))

const feet = player.position.clone()
const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.05, 100)
const eye = feet.y + 1.0
// 厚みが x 向きになったので、見る所も 90 度回す
// 本物のステージでは、見る先も本人の足元に合わせる
const look = realLadder ? new THREE.Vector3(feet.x, eye, feet.z) : new THREE.Vector3(0, eye, 0)
if (view === 'front') camera.position.set(look.x + 3.2, eye, look.z)
else if (view === 'back') camera.position.set(look.x - 3.2, eye, look.z)
else camera.position.set(look.x + 0.4, eye, look.z + 3.2)
camera.lookAt(look)

await renderer.init()
await renderer.renderAsync(scene, camera)

/**
 * 梯子の上下で**頭がどこでつかえるか**を並べる。
 *
 * 途中で登れなくなるのは、横にずれたか、上に何かあるかのどちらか。位置を
 * 固定したうえでこれを見れば、どちらなのかが決まる。
 */
function ceilingScan(): string {
  if (!realWorld || !realLadder) return '-'
  const probe = new THREE.Vector3(feet.x, 0, feet.z)
  const out: string[] = []
  for (let y = Math.ceil(realLadder.min[1]); y < realLadder.max[1]; y += 2) {
    probe.y = y
    const ceiling = realWorld.ceilingHeight(probe, 0.35, y)
    out.push(`${y}m:${Number.isFinite(ceiling) ? ceiling.toFixed(1) : '∞'}`)
  }
  return out.join(' ')
}

/**
 * 梯子の上端で**どちら側に床があるか。**
 *
 * 登り切った先が床でなければ落ちる。掴む側を選ぶときはこれも見ないといけない。
 */
function topGround(): string {
  if (!realWorld || !realLadder) return '-'
  const top = realLadder.max[1]
  const midX = (realLadder.min[0] + realLadder.max[0]) / 2
  const midZ = (realLadder.min[2] + realLadder.max[2]) / 2
  const out: string[] = []
  for (const side of [1, -1]) {
    for (const step of [0.3, 0.8, 1.4]) {
      const probe =
        realLadder.axis === 'x'
          ? new THREE.Vector3(midX + side * step, top + 0.5, midZ)
          : new THREE.Vector3(midX, top + 0.5, midZ + side * step)
      const g = realWorld.groundHeight(probe, 0.35, top + 0.5)
      out.push(`${side > 0 ? '+' : '-'}${step}m:${Number.isFinite(g) ? g.toFixed(1) : '無'}`)
    }
  }
  return out.join(' ')
}

/**
 * 梯子の周りで**どこから掴めるか**を並べる。
 *
 * 「G を押しても掴めない」は、届いていないのか、そこに立てないのかの
 * どちらか。本物の地形の高さと本物の判定 (ladderInReach) の両方を並べる。
 */
function reachMap(): string {
  if (!realWorld || !realLadder) return '-'
  const keep = player.position.clone()
  const rows: string[] = []
  const midX = (realLadder.min[0] + realLadder.max[0]) / 2
  const midZ = (realLadder.min[2] + realLadder.max[2]) / 2
  const probe = new THREE.Vector3()
  for (let dz = -1.6; dz <= 1.61; dz += 0.4) {
    let row = (midZ + dz).toFixed(1).padStart(7) + ' '
    for (let dx = -1.6; dx <= 1.61; dx += 0.2) {
      probe.set(midX + dx, realLadder.min[1] + 1, midZ + dz)
      const ground = realWorld.groundHeight(probe, 0.35, probe.y)
      player.position.set(midX + dx, ground, midZ + dz)
      // 立てる高さか (梯子の下端の近く) と、そこから手が届くか
      const standable = Math.abs(ground - realLadder.min[1]) < 1.2
      row += standable ? (player.ladderInReach ? 'O' : '.') : '#'
    }
    rows.push(row)
  }
  player.position.copy(keep)
  return `x ${(midX - 1.6).toFixed(1)}→${(midX + 1.6).toFixed(1)} (O=掴める #=立てない)\n` + rows.join('\n')
}

/** いま効いている型と重み。**T ポーズは「何も流れていない」の顔** */
function playing(): string {
  const animator = (player as unknown as { animator?: unknown }).animator as
    | { upper: Map<string, THREE.AnimationAction>; lower: Map<string, THREE.AnimationAction> }
    | undefined
  if (!animator) return '型が読めていない'
  const out: string[] = []
  for (const [layer, map] of [
    ['上', animator.upper],
    ['下', animator.lower],
  ] as const) {
    const on = [...map.entries()]
      .filter(([, a]) => a.getEffectiveWeight() > 0.001)
      .map(
        ([k, a]) =>
          `${k} 重み${a.getEffectiveWeight().toFixed(2)} 速さ${a.getEffectiveTimeScale().toFixed(1)} ` +
          `${a.isRunning() ? '流れてる' : '止まってる'} 位置${a.time.toFixed(2)}/${a.getClip().duration.toFixed(2)}`,
      )
    out.push(`${layer}: ${on.join(', ') || '無し'}`)
  }
  return out.join('  /  ')
}

/** 左右それぞれ、体が地形を噛む回数。**どちら側が空いているか** */
function sideBlocks(): string {
  if (!realWorld || !realLadder) return '-'
  const out: string[] = []
  for (const side of [1, -1] as (1 | -1)[]) {
    const grip = ladderGrip(realLadder, 0, 0, side)
    let count = 0
    let total = 0
    for (let y = realLadder.min[1]; y < realLadder.max[1]; y += 0.5) {
      const probe = new THREE.Vector3(grip.x, y, grip.z)
      realWorld.resolveHorizontal(probe, 0.35, y)
      total++
      if (Math.hypot(probe.x - grip.x, probe.z - grip.z) > 0.05) count++
    }
    out.push(`${side > 0 ? '+' : '-'}側 ${count}/${total}`)
  }
  return out.join('  ')
}

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
  realLadder ? `本物の梯子 ${realLadder.name} (${realLadder.min[1].toFixed(1)}→${realLadder.max[1].toFixed(1)})` : '作り物の梯子',
  `高さの移り: ${track.join('  ')}`,
  `最初の 30 コマ (足元/地面): ${frames.join(' ')}`,
  realLadder ? `頭がつかえる高さ: ${ceilingScan()}` : '',
  `流れている型: ${playing()}`,
  realLadder ? `掴める所:\n${reachText}` : '',
  walkText.length ? `歩いて近づく:\n  ${walkText.join('\n  ')}` : '',
  realLadder ? `噛む回数: ${sideBlocks()}` : '',
  realLadder ? `上端の床 (${realLadder.max[1].toFixed(1)}m 付近): ${topGround()}` : '',
].join('\n')
const box = document.createElement('pre')
box.style.cssText =
  'position:fixed;left:12px;top:12px;margin:0;padding:8px 10px;background:rgba(10,14,9,.85);' +
  'color:#cfe0c0;font:12px ui-monospace,Menlo,monospace;white-space:pre'
box.textContent = report
document.body.appendChild(box)
;(globalThis as unknown as { ready: boolean }).ready = true
