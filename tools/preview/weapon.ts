import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { Soldier } from '../../src/presentation/scene/actor/soldier'
import { WEAPON_CONFIGS, type WeaponTarget } from '../../src/presentation/scene/arms/weapon'
import { CHOICES, type WeaponId } from '../../src/domain/item/weapons'

/**
 * 武器の構えを詰める画面。**6 通りを同時に出す。**
 *
 * --- なぜ 6 枚並べるか ---
 * 対戦の中の調整パネルは 1 つの姿勢しか映らない。構えを合わせている間、
 * 脱力の型がどうなっているかは見えないので、**片方を直すともう片方が壊れる**。
 * 壊れたことに気づくのは、次に別の姿勢で撃ったときになる。
 *
 * 6 枚は 6 組の値ではない。**値は 3 組** (立ち / しゃがみ / 伏せ) で、構えて
 * いるかどうかは型が変えている。同じ握りが両方で成り立つかを見るために並べる。
 *
 * --- 部屋に入らずに見る ---
 * 対戦部屋に入ると席を 1 つ潰すし、伏せて構えるまでに何度も操作が要る。
 * ここは姿勢を直に立てる。
 */
const CELLS = [
  { label: '立ち · 脱力', crouch: false, prone: false, aim: false },
  { label: '立ち · 構え', crouch: false, prone: false, aim: true },
  { label: 'しゃがみ · 脱力', crouch: true, prone: false, aim: false },
  { label: 'しゃがみ · 構え', crouch: true, prone: false, aim: true },
  { label: '伏せ · 脱力', crouch: true, prone: true, aim: false },
  { label: '伏せ · 構え', crouch: true, prone: true, aim: true },
] as const

/** 値を持つ 3 つの姿勢。**編集するのはこの単位** */
const STANCES = [
  { key: 'stand', label: '立ち', suffix: '' },
  { key: 'crouch', label: 'しゃがみ', suffix: 'Crouch' },
  { key: 'prone', label: '伏せ', suffix: 'Prone' },
] as const

/** 何もぶつからない世界。**姿勢だけ見たいので地面は y=0 の平面 1 枚** */
const WORLD = {
  resolveHorizontal: () => {},
  groundHeight: () => 0,
  ceilingHeight: () => Number.POSITIVE_INFINITY,
}

const COLUMNS = 3
const ROWS = 2

const renderer = new WebGPURenderer({ antialias: true })
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 3.0
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
document.getElementById('views')!.appendChild(renderer.domElement)

/*
 * --- 背景 ---
 *
 * **灰色に白の格子。**
 *
 * 対戦の色 (暗い緑) をそのまま使うと、暗い装備と背景が溶けて輪郭が読めない。
 * ここで見たいのは銃と手の関係だけなので、地は無彩色で明るく取る。
 *
 * 格子は目盛りとして効く。1 マス 0.25m なので、**握りを 2cm 動かした**のが
 * どれくらいかが床と見比べて分かる。無地だと寄ったのか動かしたのか読めない。
 */
/**
 * 人を並べる間隔 (m)。**枠ごとに別のカメラで抜く**ので、隣が映り込まない程度。
 */
const SPACING = 12
/** 格子を敷く広さ。**並べた列を全部覆う** */
const GRID_SPAN = 12
const GRID_STEP = 0.25

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x585d61)
scene.add(new THREE.HemisphereLight(0xffffff, 0x6e7478, 2.2))
const sun = new THREE.DirectionalLight(0xfff6e8, 2.2)
sun.position.set(3, 6, 4)
scene.add(sun)

// 足元。影が無いと浮いて見えて、握りのずれと区別が付かない
/*
 * 床と格子は**人 1 人につき 1 枚**敷く。
 *
 * 原点まわりに 1 枚だけ敷いていて、離れた枠が床の外に出ていた (12m 間隔で
 * 並べているので 3 体目から外)。1 枚を横に伸ばすと格子の目が増えるだけなので、
 * 足元に置いて回る。
 */
function buildGround(x: number): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_SPAN, GRID_SPAN),
    // 露出が高い (3.0) ので、地の色は暗めに取らないと白く飛んで格子が消える
    new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 1 }),
  )
  floor.rotation.x = -Math.PI / 2
  // 格子と重なって縞にならないよう、僅かに下げる
  floor.position.set(x, -0.002, 0)
  scene.add(floor)

  const grid = new THREE.GridHelper(GRID_SPAN, GRID_SPAN / GRID_STEP, 0xffffff, 0xffffff)
  ;(grid.material as THREE.Material).opacity = 0.6
  ;(grid.material as THREE.Material).transparent = true
  grid.position.x = x
  scene.add(grid)
}

/** 1 体ぶん。姿勢を固定して、同じ銃を持たせる */
interface Cell {
  player: Soldier
  camera: THREE.PerspectiveCamera
  spec: (typeof CELLS)[number]
  /**
   * その枠の視点。**枠ごとに回せる。**
   *
   * 握りのずれは向きで見え方が変わる。正面からは合っているのに真横から
   * 見ると銃が手を突き抜けている、が普通に起きるので、**枠ごとに回り込める**
   * 必要がある。三面図のように、枠ごとに別の角度を出しておける。
   */
  orbit: { yaw: number; pitch: number; dist: number }
}

const cells: Cell[] = CELLS.map((spec, i) => {
  const player = new Soldier()
  player.start('soldier')
  // 横一列に並べる。1 体ずつ別のカメラで抜くので、間隔は被らない程度でよい
  player.position.set(i * SPACING, 0, 0)
  buildGround(i * SPACING)
  // -Z を向いて立つ。カメラは前方 (-Z 側) から見る
  player.yaw = 0
  scene.add(player.object)

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60)
  // 前方やや右から。伏せは体が床に付くので、少し上から見下ろす
  return {
    player,
    camera,
    spec,
    orbit: { yaw: 0.3, pitch: spec.prone ? 0.5 : 0.1, dist: 3.3 },
  }
})

/*
 * 場を外から触れるようにしておく。**背面タブでは rAF が止まる**ので、
 * 開発者ツールや自動操作から調べるときは `step()` を自分で回す:
 *   for (let i = 0; i < 240; i++) step()
 * これを知らずに測ると、6 枚とも読み込み直後の同じ姿勢が返ってくる。
 */
;(window as unknown as Record<string, unknown>).preview = { cells, scene }

/** いま調整している銃と姿勢。`?weapon=sniper` で開いた銃から始められる */
const ALL_WEAPONS: WeaponId[] = [...CHOICES.primary, ...CHOICES.secondary]
const asked = new URLSearchParams(location.search).get('weapon') as WeaponId | null
let weapon: WeaponId = asked && ALL_WEAPONS.includes(asked) ? asked : 'rifle'
let editing: (typeof STANCES)[number] = STANCES[0]

/** 編集中の値。**コードの定数を出発点に読む** */
const values = new Map<string, { grip: THREE.Vector3; rotation: THREE.Euler }>()

function keyOf(id: WeaponId, stance: (typeof STANCES)[number]): string {
  return `${id}${stance.suffix}`
}

function load(id: WeaponId): void {
  const config = WEAPON_CONFIGS[id as keyof typeof WEAPON_CONFIGS]
  for (const stance of STANCES) {
    const key = keyOf(id, stance)
    if (values.has(key)) continue
    // 書いていない姿勢は 1 つ手前を引き継ぐ (weapon.ts の既定と同じ)
    const grip =
      stance.key === 'prone'
        ? (config.proneGrip ?? config.crouchGrip ?? config.grip)
        : stance.key === 'crouch'
          ? (config.crouchGrip ?? config.grip)
          : config.grip
    const rotation =
      stance.key === 'prone'
        ? (config.proneRotation ?? config.crouchRotation ?? config.rotation)
        : stance.key === 'crouch'
          ? (config.crouchRotation ?? config.rotation)
          : config.rotation
    values.set(key, { grip: grip.clone(), rotation: rotation.clone() })
  }
}

/** 6 体すべてに、いまの値を配る */
function apply(): void {
  for (const stance of STANCES) {
    const v = values.get(keyOf(weapon, stance))!
    const target = `${weapon}${stance.suffix}` as WeaponTarget
    for (const cell of cells) cell.player.calibrateWeapon(target, v.grip, v.rotation)
  }
}

async function equipAll(id: WeaponId): Promise<void> {
  weapon = id
  load(id)
  for (const cell of cells) {
    cell.player.setHeld(id)
    await cell.player.equip(id)
  }
  apply()
  drawPanel()
}

// --- 画面 ---

const panel = document.getElementById('panel')!

function slider(
  name: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (next: number) => void,
): HTMLElement {
  const row = document.createElement('label')
  const tag = document.createElement('span')
  tag.textContent = name
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  const out = document.createElement('output')
  out.textContent = value.toFixed(3)
  input.addEventListener('input', () => {
    const next = Number(input.value)
    out.textContent = next.toFixed(3)
    onInput(next)
    apply()
    dump()
  })
  row.append(tag, input, out)
  return row
}

const code = document.createElement('pre')

/** そのまま weapon.ts へ貼れる形。**手で書き写す所を作らない** */
function dump(): void {
  const lines: string[] = []
  for (const stance of STANCES) {
    const v = values.get(keyOf(weapon, stance))!
    const d = (r: number) => Math.round(THREE.MathUtils.radToDeg(r))
    const g = `${v.grip.x.toFixed(3)}, ${v.grip.y.toFixed(3)}, ${v.grip.z.toFixed(3)}`
    const prefix = stance.key === 'stand' ? '' : stance.key
    const grip = prefix ? `${prefix}Grip` : 'grip'
    const rot = prefix ? `${prefix}Rotation` : 'rotation'
    lines.push(`${grip}: new THREE.Vector3(${g}),`)
    lines.push(
      `${rot}: new THREE.Euler(degrees(${d(v.rotation.x)}), degrees(${d(v.rotation.y)}), degrees(${d(v.rotation.z)})),`,
    )
  }
  code.textContent = lines.join('\n') + '\n\n' + aimReport()
}

/**
 * 銃口がどちらを向いているか。**枠ごとに数字で出す。**
 *
 * 絵だけで詰めると、真上寄りの視点では銃身のねじれが読めない。体の正面を
 * +前 として、前 / 右 / 上 の成分で出す。伏せなら前が 1 に近く、上が 0 付近。
 */
/**
 * 銃口がどちらを向いているか。**枠ごとに数字で出す。**
 *
 * 絵だけで詰めると読み違える。伏せの握りを 2 度続けて「良さそう」と見て、
 * 実際には**銃口が水平から 60° 上を向いていた** (前 0.18 / 上 0.90)。
 * 伏せの枠はカメラが上から見下ろすので、上を向いた銃身が画面では手前へ
 * 伸びて見える。数字なら一目で分かる。
 *
 * 体の正面を「前」として、前 / 右 / 上 に分けて出す。構えているなら
 * 前が 1 に近く、上は 0 付近になるはず。
 */
function aimReport(): string {
  const out: string[] = ['銃口 (前, 右, 上)']
  for (const cell of cells) {
    cell.player.object.updateMatrixWorld(true)
    // 右手ボーンにぶら下がっている、ボーンでない子が銃。
    // 私物 (private) を覗くと読み込み前の値を掴むので、場に出ている物から取る
    let hand: THREE.Object3D | null = null
    cell.player.object.traverse((o) => {
      if (!hand && o.name.endsWith('RightHand') && !o.name.includes('End')) hand = o
    })
    const gun = hand
      ? ((hand as THREE.Object3D).children.find((c) => !(c as THREE.Bone).isBone) ?? null)
      : null
    if (!gun) {
      out.push(`${cell.spec.label} まだ読み込み中`)
      continue
    }
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()))
      .normalize()
    // 並べた 6 体は yaw = 0。キャラの正面はワールドの -Z
    out.push(
      `${cell.spec.label.padEnd(9, '\u3000')} ` +
        `${(-dir.z).toFixed(2)}, ${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}`,
    )
  }
  return out.join('\n')
}

function drawPanel(): void {
  panel.replaceChildren()

  const title = document.createElement('h1')
  title.textContent = '構えを詰める'
  panel.append(title)

  const pick = document.createElement('select')
  for (const id of ALL_WEAPONS) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = id
    option.selected = id === weapon
    pick.append(option)
  }
  pick.addEventListener('change', () => void equipAll(pick.value as WeaponId))
  panel.append(pick)

  const tabs = document.createElement('div')
  tabs.className = 'tabs'
  for (const stance of STANCES) {
    const button = document.createElement('button')
    button.textContent = stance.label
    button.dataset.on = String(stance.key === editing.key)
    button.addEventListener('click', () => {
      editing = stance
      drawPanel()
    })
    tabs.append(button)
  }
  panel.append(tabs)

  const v = values.get(keyOf(weapon, editing))!
  const group = document.createElement('div')
  group.className = 'group'
  group.append(
    slider('x', v.grip.x, -0.4, 0.4, 0.005, (n) => (v.grip.x = n)),
    slider('y', v.grip.y, -0.4, 0.4, 0.005, (n) => (v.grip.y = n)),
    slider('z', v.grip.z, -0.6, 0.6, 0.005, (n) => (v.grip.z = n)),
  )
  panel.append(group)

  const turn = document.createElement('div')
  turn.className = 'group'
  const deg = (r: number) => THREE.MathUtils.radToDeg(r)
  turn.append(
    slider('P', deg(v.rotation.x), -180, 180, 1, (n) => (v.rotation.x = THREE.MathUtils.degToRad(n))),
    slider('Y', deg(v.rotation.y), -180, 180, 1, (n) => (v.rotation.y = THREE.MathUtils.degToRad(n))),
    slider('R', deg(v.rotation.z), -180, 180, 1, (n) => (v.rotation.z = THREE.MathUtils.degToRad(n))),
  )
  panel.append(turn)

  /*
   * 視点の操作。**画面の上で直に動かす** ので、ここは説明と切り替えだけ。
   */
  const link = document.createElement('button')
  link.textContent = linked ? '6 枚を一緒に動かす' : '1 枚だけ動かす'
  link.addEventListener('click', () => {
    linked = !linked
    drawPanel()
  })
  panel.append(link)

  const how = document.createElement('div')
  how.style.cssText = 'opacity:.6;font-size:11px;margin:6px 0 10px;line-height:1.6'
  how.textContent = '枠をドラッグで回る / ホイールで寄る'
  panel.append(how)

  panel.append(code)
  dump()
}

// --- 回す ---

const ZERO = new THREE.Vector3()
const labels: HTMLDivElement[] = []

function layout(): void {
  const width = window.innerWidth - 320
  const height = window.innerHeight
  renderer.setSize(width, height)
  for (const [i, cell] of cells.entries()) {
    cell.camera.aspect = width / COLUMNS / (height / ROWS)
    cell.camera.updateProjectionMatrix()
    const label = labels[i]
    label.style.left = `${(i % COLUMNS) * (width / COLUMNS) + 10}px`
    label.style.top = `${Math.floor(i / COLUMNS) * (height / ROWS) + 8}px`
  }
}

for (const cell of cells) {
  const label = document.createElement('div')
  label.textContent = cell.spec.label
  label.style.cssText =
    'position:fixed;font-size:11px;letter-spacing:.14em;color:#9ab88c;pointer-events:none'
  document.body.append(label)
  labels.push(label)
}

/**
 * どの枠の上に居るか。**画面の座標から逆に引く。**
 *
 * 6 枚は 1 枚の canvas を切り分けて描いているので、DOM の要素では拾えない。
 */
function cellAt(clientX: number, clientY: number): number | null {
  const box = renderer.domElement.getBoundingClientRect()
  const col = Math.floor(((clientX - box.left) / box.width) * COLUMNS)
  const row = Math.floor(((clientY - box.top) / box.height) * ROWS)
  if (col < 0 || col >= COLUMNS || row < 0 || row >= ROWS) return null
  const index = row * COLUMNS + col
  return index < cells.length ? index : null
}

/**
 * 6 枚を一緒に動かすか。**既定は一緒。**
 *
 * 並べている理由が「同じ握りが全部の姿勢で成り立つか」なので、普段は同じ
 * 角度から見比べたい。1 枚だけ回して確かめたいときに外す。
 */
let linked = true

let dragging: number | null = null
let lastX = 0
let lastY = 0

renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = cellAt(event.clientX, event.clientY)
  lastX = event.clientX
  lastY = event.clientY
  renderer.domElement.setPointerCapture(event.pointerId)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (dragging === null) return
  const dx = (event.clientX - lastX) * 0.008
  const dy = (event.clientY - lastY) * 0.008
  lastX = event.clientX
  lastY = event.clientY
  for (const [i, cell] of cells.entries()) {
    if (!linked && i !== dragging) continue
    cell.orbit.yaw += dx
    // 真上と真下は越えない。越えると上下が反転して操作が読めなくなる
    cell.orbit.pitch = Math.max(-1.3, Math.min(1.3, cell.orbit.pitch + dy))
  }
})

for (const name of ['pointerup', 'pointercancel'] as const) {
  renderer.domElement.addEventListener(name, () => {
    dragging = null
  })
}

renderer.domElement.addEventListener(
  'wheel',
  (event) => {
    const at = cellAt(event.clientX, event.clientY)
    if (at === null) return
    event.preventDefault()
    const scale = Math.exp(event.deltaY * 0.001)
    for (const [i, cell] of cells.entries()) {
      if (!linked && i !== at) continue
      cell.orbit.dist = Math.max(0.4, Math.min(8, cell.orbit.dist * scale))
    }
  },
  { passive: false },
)

await renderer.init()
await equipAll(weapon)
layout()
window.addEventListener('resize', layout)

const clock = new THREE.Clock()

let sinceDump = 0

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05)
  // 銃口の向きは数フレームおきに出し直す。**秒で間引かない** —
  // 仮想時計や背面タブでは dt がほぼ 0 になり、読み込み前の 1 回で止まる
  sinceDump += 1
  if (sinceDump % 15 === 0) dump()

  for (const cell of cells) {
    /*
     * 姿勢を作る。**押しっぱなしにする口が無い**ので、状態を見て 1 回だけ切り替える。
     * (対戦では Ctrl の押下で toggleCrouch、Space の長押しで setProne)
     */
    /*
     * **合っていなければ押す。両方向。**
     *
     * 「しゃがみたい時だけ押す」と書いていて、立ちの枠が戻らなかった
     * (既定がどちらであれ、片道では揃わない)。いまの状態と欲しい状態を
     * 見比べて、違えば 1 回押す。
     */
    if (cell.spec.prone) cell.player.setProne(true)
    else cell.player.setProne(false)
    if (!cell.spec.prone && cell.player.isCrouching !== cell.spec.crouch) {
      cell.player.toggleCrouch()
    }
    cell.player.setAiming(cell.spec.aim)
    cell.player.update(dt, ZERO, cell.player.yaw, 0, WORLD)
  }

  const width = renderer.domElement.width / renderer.getPixelRatio()
  const height = renderer.domElement.height / renderer.getPixelRatio()
  const cw = width / COLUMNS
  const ch = height / ROWS

  renderer.setScissorTest(true)
  for (const [i, cell] of cells.entries()) {
    const x = (i % COLUMNS) * cw
    /*
     * **左上が原点。**
     *
     * WebGL は左下原点なので `height - (row+1)*ch` と書くのが癖になっているが、
     * WebGPU は左上。そのまま書いたら**上下の段が入れ替わって**、下段の伏せが
     * 上段の「立ち」の枠に出ていた。札と絵が食い違うので、値をいじっても
     * どの姿勢を直しているのか分からなくなる。
     */
    const y = Math.floor(i / COLUMNS) * ch
    renderer.setViewport(x, y, cw, ch)
    renderer.setScissor(x, y, cw, ch)

    /*
     * 見る先は**握りのあたり**。そこを枠の真ん中に置いて、周りを回る。
     * 伏せは体が床に付くので、見る高さも下げる。
     */
    const p = cell.player.position
    /*
     * 見る高さ。**姿勢ごとに下げる。**
     *
     * 立ちの高さのまま屈むと、画面の上半分が空になって体が下へ寄る。
     * 手の高さに合わせる (立ち 1.25 / しゃがみ 0.8 / 伏せ 0.35)。
     */
    const eye = cell.spec.prone ? 0.35 : cell.spec.crouch ? 0.8 : 1.25
    const focus = new THREE.Vector3(p.x, p.y + eye, p.z)
    const { yaw, pitch, dist } = cell.orbit
    cell.camera.position.set(
      focus.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      focus.y + Math.sin(pitch) * dist,
      focus.z - Math.cos(yaw) * Math.cos(pitch) * dist,
    )
    cell.camera.lookAt(focus)
    renderer.render(scene, cell.camera)
  }
  renderer.setScissorTest(false)

  requestAnimationFrame(frame)
}

frame()
;(window as unknown as Record<string, unknown>).step = frame
