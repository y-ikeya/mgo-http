/**
 * 梯子を**登り切る所だけ**を見る。
 *
 *     bunx vite → http://localhost:5174/tools/preview/climbtop.html
 *     ?from=1.8   上端の何 m 下から始めるか (既定 1.8 — 型に入る手前)
 *     ?t=1.2      何秒目を描くか。下のつまみでも動かせる
 *     ?view=side  横から / front 正面 / back 背中 / over 斜め上
 *     ?dist=3.2   カメラの距離
 *     ?ladder=ladder_b.001  どの梯子か
 *     ?stage=0    ステージの見た目を出さない (読み込みが重いとき)
 *
 * --- なぜ要るか ---
 * 登り切りは 3 秒しかないのに、梯子の下から回すと 12 秒待つ。しかも
 * **止まった絵では滑って見えるかどうかが分からない。** ここは上端の手前に
 * 置いて、つまみで時間を前後に動かしながら見る。
 *
 * 見る所:
 *   - 足がコンクリートにめり込んでいないか (縦に上がり切る前に前へ出ていないか)
 *   - 足を止めたまま体だけ滑っていないか
 *   - 登り切った先が屋上の上か (縁から落ちないか)
 */
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CLIMB_TOP_TUNING, Soldier } from '../../src/presentation/scene/actor/soldier'
import { buildLights } from '../../src/presentation/scene/world/stage'
import { loadSoldier } from '../../src/presentation/scene/assets'
import { loadStageLadders, loadStageMoveWorld } from '../../src/presentation/scene/world/stage'

const query = new URLSearchParams(location.search)
const from = Number(query.get('from') ?? '1.8')
const view = query.get('view') ?? 'side'
const dist = Number(query.get('dist') ?? '3.2')
const wanted = query.get('ladder') ?? ''
const showStage = query.get('stage') !== '0'
/** 何秒ぶん回せるようにするか。登り切りは 3 秒ほど */
const SPAN = 6
/**
 * 本番で乗り越えに入る高さ (上端から何 m 下か)。soldier.ts の CLIMB_TOP_LEAD。
 *
 * **ここより上から始めてはいけない。** 掴んだ瞬間に乗り越えが始まり、手が
 * 梯子の上端より上を掴む (空中を掴んで見える) — 本番では押して登る限り必ず
 * この高さで型に入るので、起きない絵になる。
 */
const LEAD = CLIMB_TOP_TUNING.lead
/** 型に入る前に**少し登らせる**余白 (m)。入り口の噛み合いもここで見える */
const RUN_UP = 0.3

const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
document.body.appendChild(renderer.domElement)
await renderer.init()

const scene = new THREE.Scene()
buildLights(scene)

const ladders = await loadStageLadders('raft')
const ladder = ladders.find((l) => l.name === wanted) ?? ladders[0]
const world = await loadStageMoveWorld('raft')
if (!ladder) throw new Error('梯子が無い')

if (showStage) {
  const gltf = await new GLTFLoader().loadAsync('/models/stage_raft.glb')
  scene.add(gltf.scene)
}

/*
 * 始める高さ。**乗り越えの入り口より下からしか始めない。**
 *
 * 上から始めると本番に無い絵になる (上で書いた通り)。指定が浅くても、
 * 入り口の少し下へ下げて、そこから登って型に入る所を見せる。
 */
function startBelow(): number {
  return Math.max(from, CLIMB_TOP_TUNING.lead + RUN_UP)
}

const midX = (ladder.min[0] + ladder.max[0]) / 2
const midZ = (ladder.min[2] + ladder.max[2]) / 2
/*
 * どちら側から掴むか。**下に足場がある側から登ってくる。**
 *
 * 決め打ちで -x 側から掴ませていたら、梯子によっては壁側 (裏) から登る形に
 * なっていた。梯子の足元で両側を踏んでみて、床がある側を選ぶ — 本番で人が
 * 歩いて来られるのはその側。
 */
const startSide = (() => {
  const probe = new THREE.Vector3()
  const foot = ladder.min[1] + 0.5
  let best: 1 | -1 = -1
  let bestGap = Infinity
  for (const side of [1, -1] as (1 | -1)[]) {
    probe.set(midX + side * 0.6, foot, midZ)
    const ground = world.groundHeight(probe, 0.35, foot)
    // 梯子の下端に近い床があるか。壁側や海側は遠く外れる
    const gap = Math.abs(ground - ladder.min[1])
    if (gap < bestGap) {
      bestGap = gap
      best = side
    }
  }
  console.info(`[試写] ${best > 0 ? '+x' : '-x'} 側から掴む (足場との差 ${bestGap.toFixed(2)}m)`)
  return best
})()
const startX = midX + startSide * 0.5

/*
 * **毎回ゼロから回す。** 時間を戻せるようにするため。
 *
 * 型は一度きりの再生なので、途中から巻き戻すと状態が残る。人形ごと作り直す
 * のが確実で、模型の読み込みは覚えられているので待たされない。
 */
let player: Soldier | null = null

async function rebuild(): Promise<Soldier> {
  if (player) scene.remove(player.object)
  const next = new Soldier()
  next.start('soldier')
  await loadSoldier('soldier')
  for (let i = 0; i < 8; i++) await new Promise((done) => setTimeout(done, 0))
  next.setLadders([ladder])
  scene.add(next.object)
  player = next
  return next
}

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 200)
const panel = document.createElement('pre')
panel.className = 'panel'
document.body.appendChild(panel)

async function draw(at: number): Promise<void> {
  const soldier = await rebuild()
  // 上端の手前、梯子の上に置いて掴ませる
  soldier.position.set(startX, ladder.max[1] - startBelow(), midZ)
  soldier.grabLadder()
  soldier.setStickForward(1)

  const track: string[] = []
  for (let t = 0; t < at; t += 1 / 60) {
    soldier.update(1 / 60, new THREE.Vector3(), soldier.yaw, 0, world)
    if (Math.abs(t * 4 - Math.round(t * 4)) < 1 / 120) {
      track.push(
        `${t.toFixed(2)}s 高さ${soldier.position.y.toFixed(2)} 横${(soldier.position.x - midX).toFixed(2)}`,
      )
    }
  }
  soldier.object.updateMatrixWorld(true)

  const feet = soldier.position
  const eye = feet.y + 0.9
  if (view === 'front') camera.position.set(feet.x + dist, eye, midZ)
  else if (view === 'back') camera.position.set(feet.x - dist, eye, midZ)
  else if (view === 'over') camera.position.set(feet.x - dist * 0.7, eye + dist * 0.7, midZ + dist * 0.7)
  else camera.position.set(feet.x + 0.4, eye, midZ + dist)
  camera.lookAt(feet.x, feet.y + 0.8, midZ)
  await renderer.renderAsync(scene, camera)

  /** 足の骨がどこにあるか。**滑っているかどうかは足で見る** */
  const bone = (suffix: string) => {
    let found: THREE.Object3D | null = null
    soldier.object.traverse((o) => {
      if (!found && o.name.endsWith(suffix)) found = o
    })
    return found ? (found as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : null
  }
  const left = bone('LeftFoot')
  const right = bone('RightFoot')
  const leftHand = bone('LeftHand')
  const rightHand = bone('RightHand')
  const ground = world.groundHeight(feet, 0.35, feet.y)

  panel.textContent = [
    `梯子 ${ladder.name} (${startSide > 0 ? '+x' : '-x'} 側から / 上端 ${ladder.max[1].toFixed(2)}m) / ${startBelow().toFixed(2)}m 下から` +
      (startBelow() > from ? ` (?from=${from} は乗り越えの入り口より上なので下げた)` : ''),
    `いま ${at.toFixed(2)}s   型 ${soldier.locomotion}   梯子の上 ${soldier.onLadder}`,
    `足元 x${feet.x.toFixed(2)} y${feet.y.toFixed(2)} z${feet.z.toFixed(2)}`,
    (() => {
      // **体の前と梯子の向きが合っているか。** ここがずれていると、裏返した
      // 型で誤魔化すことになる
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(soldier.object.quaternion)
      const toLadder = Math.sign(midX - feet.x)
      /*
       * **絵の向きは爪先で見る。** 体の向き (object の回転) は型の中身までは
       * 見ていない。爪先 (Foot → ToeBase) は必ず前を向いているので、これなら
       * 「型ごと裏返っている」も出る。
       */
      const foot = bone('LeftFoot')
      const toe = bone('LeftToeBase')
      const toeX = foot && toe ? toe.x - foot.x : 0
      return (
        `体の向き x${forward.x.toFixed(2)} / 爪先の向き x${toeX.toFixed(2)} / ` +
        `梯子は ${toLadder > 0 ? '+x' : '-x'} 側 → ` +
        (Math.abs(toeX) < 0.05
          ? '(爪先が横を向いていて読めない)'
          : Math.sign(toeX) === toLadder
            ? '**梯子を向いている**'
            : '**梯子に背を向けている**')
      )
    })(),
    `梯子の中心からの横ずれ ${(feet.x - midX).toFixed(2)}m / 足元の床 ${Number.isFinite(ground) ? ground.toFixed(2) : '無し'}`,
    left && right
      ? `足の x  左 ${left.x.toFixed(2)}  右 ${right.x.toFixed(2)}  (高さ 左 ${left.y.toFixed(2)} 右 ${right.y.toFixed(2)})`
      : '足の骨が読めない',
    leftHand && rightHand
      ? `手の高さ 左 ${leftHand.y.toFixed(2)} 右 ${rightHand.y.toFixed(2)}  ` +
        `(足元から +${(Math.max(leftHand.y, rightHand.y) - feet.y).toFixed(2)}m / ` +
        `上端まで ${(ladder.max[1] - Math.max(leftHand.y, rightHand.y)).toFixed(2)}m)`
      : '手の骨が読めない',
    '',
    track.slice(-12).join('\n'),
  ].join('\n')
}

/* --- 下のつまみ。時間を前後に動かす --- */
const bar = document.createElement('div')
bar.className = 'bar'
const slider = document.createElement('input')
slider.type = 'range'
slider.min = '0'
slider.max = String(SPAN)
slider.step = String(1 / 60)
slider.value = query.get('t') ?? '0.5'
const label = document.createElement('span')
const play = document.createElement('button')
play.textContent = '▶ 流す'
bar.append(play, slider, label)
document.body.appendChild(bar)

let busy = false
let queued: number | null = null

async function show(at: number): Promise<void> {
  label.textContent = `${at.toFixed(2)} 秒`
  if (busy) {
    // 描いている間に動かされたら、**最後の 1 つだけ**やり直す
    queued = at
    return
  }
  busy = true
  await draw(at)
  busy = false
  if (queued !== null) {
    const next = queued
    queued = null
    await show(next)
  }
}

/* --- 詰め物のつまみ。**ここを動かしながら絵を見る** --- */
const KNOBS: { key: keyof typeof CLIMB_TOP_TUNING; name: string; min: number; max: number; step: number }[] = [
  { key: 'rate', name: '型の速さ', min: 0.6, max: 2.5, step: 0.05 },
  { key: 'lead', name: '入り口 (上端から m 下)', min: 0.6, max: 5, step: 0.05 },
  { key: 'heaveFrom', name: 'よいしょ始まり', min: 0, max: 1, step: 0.01 },
  { key: 'heaveTo', name: 'よいしょ終わり', min: 0, max: 1, step: 0.01 },
  { key: 'stepPhase', name: '踏み出し始まり', min: 0, max: 1, step: 0.01 },
  { key: 'step', name: '踏み出す量 (m)', min: 0, max: 1.6, step: 0.05 },
]

const knobBox = document.createElement('div')
knobBox.className = 'knobs'
const code = document.createElement('textarea')
code.className = 'code'
code.readOnly = true

function writeCode(): void {
  const span = (CLIMB_TOP_TUNING.heaveTo - CLIMB_TOP_TUNING.heaveFrom) * (4.03 / CLIMB_TOP_TUNING.rate)
  // 残りの高さは梯子ごとに違う (lead + 屋上との差)。ここでは lead で見積もる
  const total = CLIMB_TOP_TUNING.lead
  const metres = CLIMB_TOP_TUNING.riseHeave
  code.value =
    `// soldier.ts の CLIMB_TOP_TUNING へ\n` +
    KNOBS.map((k) => `  ${k.key}: ${Number(CLIMB_TOP_TUNING[k.key].toFixed(3))},`).join('\n') +
    `\n  riseClimb: ${Number(CLIMB_TOP_TUNING.riseClimb.toFixed(3))},` +
    `\n  riseHeave: ${Number(CLIMB_TOP_TUNING.riseHeave.toFixed(3))},` +
    `\n// 型の尺 ${(4.03 / CLIMB_TOP_TUNING.rate).toFixed(2)} 秒 / ` +
    `よいしょ ${span.toFixed(2)} 秒で ${metres.toFixed(2)}m 上がる / ` +
    `残り ${Math.max(0, total - CLIMB_TOP_TUNING.riseClimb - CLIMB_TOP_TUNING.riseHeave).toFixed(2)}m は足を抜きながら`
}

/*
 * 上がる量は **m で触る。** soldier.ts 側も m で持っている (riseClimb / riseHeave)。
 *
 * 上がる高さの全部は入り口 (lead) と屋上との差で決まっていて、それを
 * 「登っている間」「よいしょ」「足を抜きながら」の 3 つに割る。ここでは
 * 前の 2 つを m で触らせて、残りは自動で最後に回す。
 */
const RISE_KNOBS: { field: 'riseClimb' | 'riseHeave'; name: string }[] = [
  { field: 'riseClimb', name: 'よいしょ前に上がる量 (m)' },
  { field: 'riseHeave', name: 'よいしょで上がる量 (m)' },
]
const riseRows: { row: HTMLElement; input: HTMLInputElement; value: HTMLElement; field: 'riseClimb' | 'riseHeave' }[] = []

for (const knob of RISE_KNOBS) {
  const row = document.createElement('label')
  const name = document.createElement('span')
  const value = document.createElement('b')
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '5'
  input.step = '0.05'
  name.textContent = knob.name
  input.addEventListener('input', () => {
    const metres = Math.min(Number(input.value), CLIMB_TOP_TUNING.lead)
    CLIMB_TOP_TUNING[knob.field] = metres
    // 2 つの合計が lead を超えたら、もう片方を削る
    const other = knob.field === 'riseClimb' ? 'riseHeave' : 'riseClimb'
    const over = CLIMB_TOP_TUNING.riseClimb + CLIMB_TOP_TUNING.riseHeave - CLIMB_TOP_TUNING.lead
    if (over > 0) CLIMB_TOP_TUNING[other] = Math.max(0, CLIMB_TOP_TUNING[other] - over)
    showRises()
    writeCode()
    void show(Number(slider.value))
  })
  row.append(name, input, value)
  riseRows.push({ row, input, value, field: knob.field })
}

function showRises(): void {
  for (const r of riseRows) {
    const metres = CLIMB_TOP_TUNING[r.field]
    r.input.value = metres.toFixed(2)
    r.value.textContent = metres.toFixed(2)
  }
}

for (const knob of KNOBS) {
  const row = document.createElement('label')
  const name = document.createElement('span')
  const value = document.createElement('b')
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(knob.min)
  input.max = String(knob.max)
  input.step = String(knob.step)
  input.value = String(CLIMB_TOP_TUNING[knob.key])
  name.textContent = knob.name
  value.textContent = String(CLIMB_TOP_TUNING[knob.key])
  input.addEventListener('input', () => {
    CLIMB_TOP_TUNING[knob.key] = Number(input.value)
    value.textContent = input.value
    // 入り口を動かすと m 表示が変わる (割合は据え置き)
    showRises()
    writeCode()
    void show(Number(slider.value))
  })
  row.append(name, input, value)
  knobBox.append(row)
}
for (const r of riseRows) knobBox.append(r.row)
knobBox.append(code)
showRises()
document.body.appendChild(knobBox)
writeCode()

slider.addEventListener('input', () => void show(Number(slider.value)))
// 矢印で 1 コマずつ。**滑りは 1 コマ送りで見える**
addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 1 / 6 : 1 / 60
  if (e.key === 'ArrowRight') slider.value = String(Math.min(SPAN, Number(slider.value) + step))
  else if (e.key === 'ArrowLeft') slider.value = String(Math.max(0, Number(slider.value) - step))
  else return
  e.preventDefault()
  void show(Number(slider.value))
})

let playing = false
play.addEventListener('click', async () => {
  playing = !playing
  play.textContent = playing ? '■ 止める' : '▶ 流す'
  while (playing) {
    const next = Number(slider.value) + 1 / 30
    if (next > SPAN) {
      playing = false
      play.textContent = '▶ 流す'
      break
    }
    slider.value = String(next)
    await show(next)
  }
})

await show(Number(slider.value))
;(globalThis as unknown as { ready: boolean }).ready = true
