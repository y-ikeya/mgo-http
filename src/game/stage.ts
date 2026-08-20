import * as THREE from 'three'
import { DEFAULT_SURFACE, surfaceOf, type Surface } from '../domain/surface'
import { flagsOf } from '../domain/flags'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import {
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import type { Obstacle } from '../sim/collision'
import type { StageBox } from '../sim/vision'
import { asset, loadStage } from './assets'
import { isMesh } from './guards'

/**
 * ステージ "AA" — BoxGeometry だけのブロックアウト。
 *
 * この段階の目的は見た目ではなく、遮蔽物の配置・見通し・索敵ルートが
 * ゲームとして成立するかの検証。面白さを確認してから Blender でアートパスに入る。
 *
 * 将来的にはこのモジュールが .glb を GLTFLoader で読み込む担当になる。
 * その際も「描画用メッシュ」と「コリジョン/視線判定用メッシュ」は分離する方針で、
 * buildStage が返す collidables がその後者にあたる。
 */
export const STAGE_CODE = 'AA'

/** 地面の一辺 (m) */
const GROUND_SIZE = 120

/**
 * 天空光の強さ。日陰の明るさはこれで決まる。
 *
 * 直射 (SUN_INTENSITY) との比が、日向と日陰の差になる。比が大きいほど
 * コントラストが強く「らしく」見えるが、日陰の中の人影や遮蔽物の形が読めなくなる。
 * 索敵が成立する範囲でだけコントラストを付ける。
 */
const AMBIENT_INTENSITY = 2.6
/** 直射日光の強さ */
const SUN_INTENSITY = 2.4
/** 影の濃さ (0..1)。1 で完全に直射を遮る */
const SHADOW_INTENSITY = 0.88

/**
 * 雲の量。しきい値なので、小さいほど広く覆う。
 *
 * 0.3 で曇り、0.55 でまばらに浮かぶ晴れ、0.6 を超えるとほぼ雲が無くなる。
 */
const CLOUD_COVERAGE = 0.55

/** 調整用に控えておく空のマテリアル */
let skyCoverage: ReturnType<typeof uniform> | null = null

/** 天頂の色。真上ほど濃い青になる */
const SKY_ZENITH = 0x3f78c8
/** 地平線の色。大気の散乱で白っぽくなる。フォグもこの色に合わせる */
const SKY_HORIZON = 0xbcd2e4
/** 太陽と、そのまわりの滲み */
const SKY_SUN = 0xfff2d8

/**
 * 空のドームの半径 (m)。
 *
 * カメラの far (500) より内側で、アリーナ (80m 四方) より十分に外側。
 * プレイヤーがドームの外へ出ることはないので、カメラに追従させる必要がない。
 */
const SKY_RADIUS = 400

/**
 * 地面テクスチャ 1 枚が覆う実寸 (m)。
 *
 * 小さくすると細かく見える代わりに、遠景で繰り返しの模様が目立つ。
 * 大きくすると足元がぼやける。人の身長 1.8m に対して 2 人分くらいが目安。
 */
const GROUND_TILE_SIZE = 4

/**
 * 異方性フィルタの段数。
 *
 * 地面は視線が浅い角度で当たるので、これが無いと遠くが灰色の帯に潰れる。
 * 実際の上限は GPU 次第で、three が対応値まで切り下げる。
 */
const GROUND_ANISOTROPY = 8

/**
 * 高所へ上がる階段を段の配列にする。
 *
 * 一段を「歩いて越えられる段差」(collision.ts の STEP_UP = 0.25m) ちょうどにしてある。
 * ジャンプが無くなったので、跳ばないと登れない寸法だと高所へ到達できない。
 * 段数が増えるぶん登坂に時間がかかるので、「登る間は無防備」という設計意図はむしろ強まる。
 *
 * @param zTop 高所側の端。dir の向きへ降りていく
 * @param dir 段が下る向き (+1 / -1)
 */
function buildStairs(x: number, zTop: number, dir: 1 | -1): [number, number, number, number, number][] {
  const STEPS = 10
  const RISE = 0.25
  const DEPTH = 0.75
  const WIDTH = 4

  return Array.from({ length: STEPS }, (_, i) => [
    x,
    zTop + dir * i * DEPTH,
    WIDTH,
    (STEPS - i) * RISE,
    DEPTH,
  ])
}

/** ブロックアウトの箱。[中心x, 中心z, 幅x, 高さy, 奥行きz] */
const BLOCKS: readonly [number, number, number, number, number][] = [
  // 中央の建物。中心を通す視線を切り、ステージを東西に二分する
  [0, 0, 10, 5, 8],
  // 中央建物に取り付く前の中継ぎになる腰高カバー
  [-9, 6, 3, 1.2, 3],
  [9, -6, 3, 1.2, 3],
  [-6, -10, 2.5, 1.2, 2.5],
  [6, 10, 2.5, 1.2, 2.5],
  // 東西の長い遮蔽壁。迂回ルートと正面ルートを分岐させる
  [-16, -2, 1.2, 3.5, 14],
  [16, 2, 1.2, 3.5, 14],
  // 高所。中央を見下ろせるが、そこへ登る間は無防備という交換条件を作る
  [-20, 14, 8, 2.6, 8],
  [20, -14, 8, 2.6, 8],
  ...buildStairs(-20, 9.625, -1),
  ...buildStairs(20, -9.625, 1),
  // 外周のコンテナ群。ステージ端に沿った潜行ルート
  [-24, -16, 6, 2.4, 2.4],
  [24, 16, 6, 2.4, 2.4],
  [2, 20, 2.4, 2.4, 6],
  [-2, -20, 2.4, 2.4, 6],
]

/** 地面の一辺の半分 (m)。プレイヤーを閉じ込める外周にあたる */
export const ARENA_HALF_SIZE = GROUND_SIZE / 2

/**
 * 初期位置。原点は中央の建物の内側なので、南側の開けた場所に置いて建物を正面に見る。
 * (原点のままだと生成直後にコリジョンで建物の外へ弾き出される)
 */
/**
 * チームごとの湧き位置。**対角の角。**
 *
 * 辺の中央どうしに置いていた頃は、どちらから出ても同じ 1 本の通りを進むことに
 * なっていた。角どうしにすると**建物を斜めに横切る**ので、西のスロープから
 * 上がるか、東の階段まで回るか、地上を突っ切るかが分かれる。
 *
 * 原点を挟んで点対称なので、どちらの陣営も同じ形の地形から始まる。
 * 湧き地点の脇には L 字の遮蔽があり、出た瞬間に 2 方向から抜かれることはない
 * (tools/make_garage.py の「湧き地点の遮蔽」)。
 */
export const TEAM_SPAWNS = {
  blue: { x: -30, z: 30 },
  red: { x: 30, z: -30 },
} as const

/**
 * 基地の枠の大きさ (m)。中心から端まで。**4m 角。**
 *
 * 湧く位置は基地の中心から半径 SPAWN_SPREAD (Game.ts) の円周上に散るので、
 * **ここを縮めたら向こうも縮める**。外に立つと枠が「自分の場所」に見えない。
 */
const BASE_HALF = 2

/**
 * 枠線の太さ (m)。
 *
 * **線ではなく板で描く。** THREE.Line の linewidth は WebGL / WebGPU では
 * 効かない (常に 1px) ので、太さが欲しければ面を張るしかない。1px の線は
 * 離れると消えるし、真上から見ないと読めなかった。
 */
const BASE_LINE = 0.2

/** 枠を描く高さ (m)。地面と z 争いしない程度に浮かせる */
const BASE_Y = 0.03

/** 陣営の色。HUD の得点と揃える — 同じ物を指す色は同じにする */
const BASE_COLOR = { blue: 0x7ea6ff, red: 0xff8a72 } as const

/**
 * 陣営の基地を示す枠。
 *
 * **ここが自分の湧く場所だと、地面を見て分かるようにする。** 湧いた直後に
 * 「どちらへ進めばよいか」を向きだけで判断させると、倒された回数が増えるほど
 * 方向感覚が失われる。地面に描いてあれば、振り向いた先で常に分かる。
 *
 * 塗り潰さず枠線にするのは、床の材質 (足音が変わる) を隠さないため。
 */
export function buildBases(): THREE.Object3D {
  const group = new THREE.Group()
  for (const [team, base] of Object.entries(TEAM_SPAWNS)) {
    const frame = new THREE.Mesh(
      frameGeometry(BASE_HALF, BASE_LINE),
      // 露出に左右されない。位置を示すための印なので、明るさが変わっても読めてほしい
      new THREE.MeshBasicMaterial({
        color: BASE_COLOR[team as keyof typeof BASE_COLOR],
        transparent: true,
        opacity: 0.55,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    )
    frame.position.set(base.x, BASE_Y, base.z)
    frame.frustumCulled = false
    group.add(frame)
  }
  return group
}

/**
 * 地面に寝かせる「額縁」。中を空けた四角。
 *
 * 4 枚の板を重ねて置くと、角が二重になって半透明のそこだけ濃くなる。
 * 外周と内周の 8 点から帯を張れば、重なりが出ない。
 */
function frameGeometry(half: number, width: number): THREE.BufferGeometry {
  const inner = Math.max(0.01, half - width)
  const ring = (h: number) => [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ]
  const outer = ring(half)
  const hole = ring(inner)
  const points: number[] = []
  const push = (p: number[]) => points.push(p[0], 0, p[1])
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4
    push(outer[k]); push(outer[n]); push(hole[n])
    push(outer[k]); push(hole[n]); push(hole[k])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geometry.computeVertexNormals()
  return geometry
}

export interface Stage {
  /** 弾が当たる物。撃った先を決めるのに使う */
  readonly collidables: THREE.Object3D[]
  /** カメラが寄る物。壁抜けを防ぐ */
  readonly cameraBlockers: THREE.Object3D[]
  /** 移動判定用の XZ 平面 AABB */
  readonly obstacles: Obstacle[]
}

/**
 * ブロックアウト用のマテリアル。
 *
 * metalness をほぼ 0 にしているのが要点。glTF がマテリアルを持たないメッシュに
 * 与える既定値は metalness = 1 (完全な金属) で、金属は拡散反射を持たないため
 * 環境マップが無いと直射の当たらない面が真っ黒になる。
 * 「テクスチャが無いから暗い」のではなく「金属として扱われているから暗い」。
 *
 * テクスチャが届いたら applyStructureTexture が上書きする。
 */
function createBlockoutMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x6b7684, roughness: 0.85, metalness: 0.05 })
}

/**
 * 構造物 (地面以外) にテクスチャを貼る。
 *
 * 地面と別に持つのは、素材が違うだけでなく貼り方が違うから。地面は 1 枚の平面なので
 * repeat で足りるが、箱は 1 つずつ大きさが違う。書き出された UV は面ごとに 0..1 なので、
 * そのまま貼ると小さい箱では拡大され、大きい箱では潰れて、同じ素材に見えなくなる。
 * UV を作り直して密度を揃える必要がある (projectWorldUv)。
 */
async function applyStructureTexture(
  material: THREE.MeshStandardMaterial,
  surface: Surface,
): Promise<void> {
  const loader = new THREE.TextureLoader()
  const prefix = SURFACE_TEXTURES[surface]

  const setup = (texture: THREE.Texture, srgb: boolean) => {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = GROUND_ANISOTROPY
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  try {
    const [diffuse, normal, roughness] = await Promise.all([
      loader.loadAsync(asset.texture(`${prefix}_diff.jpg`)),
      loader.loadAsync(asset.texture(`${prefix}_nor.jpg`)),
      loader.loadAsync(asset.texture(`${prefix}_rough.jpg`)),
    ])
    material.map = setup(diffuse, true)
    material.normalMap = setup(normal, false)
    material.roughnessMap = setup(roughness, false)
    // マップ側の値を使うので、係数は 1 にして素通しにする
    material.color.setHex(0xffffff)
    material.roughness = 1
    // 金属だけ metalness のマップを持つ。コンクリートは非金属
    if (surface === 'metal') {
      material.metalnessMap = setup(await loader.loadAsync(asset.texture(`${prefix}_metal.jpg`)), false)
      material.metalness = 1
    } else {
      material.metalness = 0
    }
    material.needsUpdate = true
  } catch (error) {
    console.error('[Stage] 構造物テクスチャの読み込みに失敗', error)
  }
}

/**
 * 頂点のワールド座標から UV を作り直す。
 *
 * 面の法線が最も向いている軸を落として、残る 2 軸をそのまま UV にする。
 * 軸に沿った箱なら投影の歪みが出ず、大きさの違う箱でも 1m が常に同じ大きさに写る。
 * (三平面投影を、動かない形状に対して読み込み時に 1 回だけやる形)
 *
 * @param tile テクスチャ 1 枚が覆う実寸 (m)
 */
function projectWorldUv(mesh: THREE.Mesh, tile: number): void {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return

  const uv = new Float32Array(position.count * 2)
  const point = new THREE.Vector3()

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    const nx = Math.abs(normal.getX(i))
    const ny = Math.abs(normal.getY(i))
    const nz = Math.abs(normal.getZ(i))

    let u: number
    let v: number
    if (ny >= nx && ny >= nz) {
      // 上下の面。真上から見た平面として貼る
      u = point.x
      v = point.z
    } else if (nx >= nz) {
      u = point.z
      v = point.y
    } else {
      u = point.x
      v = point.y
    }
    uv[i * 2] = u / tile
    uv[i * 2 + 1] = v / tile
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/**
 * 空。天頂から地平線へのグラデーションと太陽を描く。
 *
 * scene.background に色を入れるとクリアカラーになって階調が作れず、
 * テクスチャを入れるとトーンマッピングを通って露出 3.0 で白く飛ぶ。
 * ドームのメッシュにして toneMapped を切ると、露出と無関係に指定した色がそのまま出る。
 * 空は「光源」ではなく「背景」なので、露出に振り回されないほうが扱いやすい。
 *
 * @param sunDirection 太陽の向き (正規化前でよい)。平行光と揃えると影の向きと一致する
 */
function buildSky(sunDirection = new THREE.Vector3(18, 30, 12)): THREE.Mesh {
  // 調整パネルから触る値と、時間で流れる値。
  // TSL の time は描画器が毎フレーム進めるので、こちらで配線しなくてよい。
  const coverage = uniform(CLOUD_COVERAGE)
  const zenith = uniform(new THREE.Color(SKY_ZENITH))
  const horizon = uniform(new THREE.Color(SKY_HORIZON))
  const sunColor = uniform(new THREE.Color(SKY_SUN))
  const sunDir = uniform(sunDirection.clone().normalize())

  // --- 雲のための雑音 ---
  // テクスチャを持たずに済ませる。空は毎フレーム全画面を覆うので、
  // 読み込みを増やさないほうが起動が軽い。
  const hash = (input: Node<'vec2'>) => {
    const p = fract(input.mul(vec2(123.34, 456.21)))
    const q = p.add(dot(p, p.add(45.32)))
    return fract(q.x.mul(q.y))
  }

  const valueNoise = (input: Node<'vec2'>) => {
    const cell = floor(input)
    const f = fract(input)
    // 補間を滑らかにする。線形だと格子が見える
    const w = f.mul(f).mul(float(3).sub(f.mul(2)))
    const a = hash(cell)
    const b = hash(cell.add(vec2(1, 0)))
    const c = hash(cell.add(vec2(0, 1)))
    const d = hash(cell.add(vec2(1, 1)))
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y)
  }

  // 大小の雑音を重ねる。1 つだけだと粒が揃いすぎて雲に見えない。
  // 回数が決まっているので、シェーダーの中で回さず組み立てる側で展開する。
  const fbm = (input: Node<'vec2'>) => {
    let total: Node<'float'> = float(0)
    let p: Node<'vec2'> = input
    let amplitude = 0.5
    for (let i = 0; i < 5; i++) {
      total = total.add(valueNoise(p).mul(amplitude))
      p = p.mul(2.03)
      amplitude *= 0.5
    }
    return total
  }

  const dir = normalize(positionLocal)
  // 地平線付近を厚く見せる。線形に混ぜると空の上半分が一様な青になって奥行きが出ない
  const height = pow(clamp(dir.y, 0, 1), 0.42)
  const toSun = max(dot(dir, sunDir), 0)

  let color = mix(horizon, zenith, height)

  // 前方散乱。太陽のある側は空全体が白む。
  // これが無いと、どの方角も同じ色の空に太陽だけが貼り付いて見える。
  // 空気の層が厚い低空ほど強く出るので、高いほど弱める。
  const scatter = pow(toSun, 2.5).mul(0.55).mul(float(1).sub(height.mul(0.65)))
  color = mix(color, horizon.mul(1.15), clamp(scatter, 0, 1))

  // 太陽の周りの滲み。広いものと狭いものを重ねる。
  // 1 つだけだと、広ければぼやけ、狭ければ点になる。
  color = color.add(sunColor.mul(pow(toSun, 14)).mul(0.16))
  color = color.add(sunColor.mul(pow(toSun, 220)).mul(0.45))
  // 太陽そのもの。cos で 1.4 度ほどの円になる
  color = color.add(sunColor.mul(smoothstep(0.99938, 0.99972, toSun)).mul(1.1))

  // --- 雲 ---
  // 視線を雲の高さの平面へ投影する。真上は素直に、地平線へ向かうほど
  // 圧縮されて密になる。この圧縮が遠近そのものになるので、
  // 平面に貼っただけでも空を見上げている感じが出る。
  //
  // 割る値に下限を置いているのは、地平線の真上で 0 除算になるため。
  // その帯は下の smoothstep で消えるので、値そのものは何でもよい。
  const plane = dir.xz
    .div(max(dir.y, 0.015))
    .mul(0.5)
    .add(vec2(time.mul(0.004), time.mul(0.0015)))
  // しきい値で切って雲の塊にする。切りっぱなしだと縁が硬いので幅を持たせる。
  // 地平線際は大気に溶けて見えなくなる。ここを消さないと、
  // 投影が無限に伸びて縞模様になる
  const cloud = smoothstep(coverage, coverage.add(0.26), fbm(plane)).mul(
    smoothstep(0.015, 0.2, dir.y),
  )
  // 太陽の側は白く、反対側は灰色に。厚みの手掛かりになる
  const lit = mix(
    vec3(0.6, 0.64, 0.7),
    vec3(1.0, 0.98, 0.93),
    pow(toSun, 3).mul(0.7).add(0.3),
  )
  color = mix(color, lit, cloud.mul(0.88))

  // 地平線より下。地面で隠れるが、高台から見下ろすと端が見える
  color = mix(color, horizon.mul(0.82), float(1).sub(smoothstep(-0.12, 0, dir.y)))

  // 階調の段差を散らす。空はなだらかな面が広いので、
  // 8 bit で出すと縞が見える。1/255 未満の雑音を足すと目立たなくなる。
  const dither = fract(sin(dot(screenCoordinate, vec2(12.9898, 78.233))).mul(43758.5453))
  color = color.add(dither.sub(0.5).div(255))

  const material = new MeshBasicNodeMaterial()
  material.colorNode = color
  material.side = THREE.BackSide
  material.depthWrite = false
  // 露出に左右されず、指定した色をそのまま出す
  material.toneMapped = false
  material.fog = false

  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material)
  // 空はフォグも影も受けない。カリングも要らない (常に視界を覆う)
  sky.frustumCulled = false
  sky.renderOrder = -1
  skyCoverage = coverage
  return sky
}

/** 雲の量の調整用。確定したら CLOUD_COVERAGE へ焼き込む */
export function setCloudCoverage(coverage: number): void {
  if (skyCoverage) skyCoverage.value = coverage
}

/**
 * stage.json の箱。
 *
 * サーバーが読んでいるものと同じファイル。**同じ数字を両側が読む**ことが要る用途に使う —
 * 坂の傾きと、手榴弾が跳ねる面がこれにあたる。描画用のメッシュから測り直すと、
 * 見えている場所と爆ぜる場所がずれる。
 */
let stageBoxes: Promise<StageBox[]> | null = null

export function loadStageBoxes(): Promise<StageBox[]> {
  if (!stageBoxes) {
    const url = asset.model('stage.json')
    stageBoxes = fetch(url)
      .then((res) => res.json() as Promise<{ boxes: StageBox[] }>)
      .then((data) => data.boxes)
      .catch((error) => {
        // 読めなくても遊べる。坂が壁に戻り、手榴弾は地面だけで跳ねる
        console.warn('[Stage] stage.json が読めない', error)
        return []
      })
  }
  return stageBoxes
}

/**
 * 上面の傾きを書き出しの結果から重ねる。
 *
 * glb から測れるのは箱の外形だけで、上面がどちらへ傾いているかは頂点を
 * 見ないと分からない。Blender 側は頂点を持っているので、そちらで測って
 * stage.json に書いてある。ここでは名前で突き合わせるだけ。
 *
 * 読めなくても平らな箱として成立する。坂が壁に戻るだけで、遊べなくはならない。
 */
async function applySlopes(obstacles: Obstacle[]): Promise<void> {
  const boxes = await loadStageBoxes()
  if (boxes.length === 0) return

  const byName = new Map(boxes.map((b) => [b.name, b]))
  let slopes = 0
  for (const obstacle of obstacles) {
    if (!obstacle.name) continue
    const top = byName.get(obstacle.name)?.top
    if (!top || (top.dx === 0 && top.dz === 0)) continue
    obstacle.slopeX = top.dx
    obstacle.slopeZ = top.dz
    obstacle.baseTop = top.h
    slopes++
  }
  if (slopes > 0) console.warn(`[Stage] 坂 ${slopes} 個を反映した`)
}

/**
 * 地面にテクスチャを貼る。
 *
 * 1 枚を敷き詰めるのではなく GROUND_TILE_SIZE ごとに繰り返す。120m を 1 枚で
 * 覆うと 1 ピクセルが 6cm になり、足元がただの灰色になる。
 *
 * 読み込みに失敗しても単色のまま成立するので、握り潰してよい。
 */
async function applyGroundTexture(material: THREE.MeshStandardMaterial): Promise<void> {
  const loader = new THREE.TextureLoader()
  const repeat = GROUND_SIZE / GROUND_TILE_SIZE

  const setup = (texture: THREE.Texture, srgb: boolean) => {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat, repeat)
    texture.anisotropy = GROUND_ANISOTROPY
    // 色として扱うのは diffuse だけ。法線と粗さは数値なので変換を掛けてはいけない。
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  try {
    const [diffuse, normal, roughness] = await Promise.all([
      loader.loadAsync(asset.texture(`ground_diff.jpg`)),
      loader.loadAsync(asset.texture(`ground_nor.jpg`)),
      loader.loadAsync(asset.texture(`ground_rough.jpg`)),
    ])
    material.map = setup(diffuse, true)
    material.normalMap = setup(normal, false)
    material.roughnessMap = setup(roughness, false)
    // テクスチャの色をそのまま出す。掛け算の相手が濃いと全体が沈む。
    material.color.setHex(0xffffff)
    material.needsUpdate = true
  } catch (error) {
    console.error('[Stage] 地面テクスチャの読み込みに失敗', error)
  }
}

/**
 * オブジェクト名の規約。
 *
 * 何を止めるかは名前に書く (src/domain/flags.ts)。描画と判定を別のメッシュに
 * 分けるのも、金網のように「人は止めるが弾は通す」物を作るのも、同じ仕組みで表せる。
 */

/**
 * 名前の先頭に付ける材質の札。
 *
 * 見た目と足音の両方をここから決める。1 か所で宣言することで、
 * 「金属に見えるのにコンクリートの足音」が構造的に起きない。
 *
 * 札は組み合わせられる (col_metal_wall など)。Blender は複製すると名前の
 * 末尾に .001 を足すので、先頭に置くほうが壊れにくい。
 */
/** 材質ごとのテクスチャ。ファイル名の頭だけが違う */
const SURFACE_TEXTURES: Record<Surface, string> = {
  metal: 'rust',
  concrete: 'ground',
  wood: 'wood',
}

/**
 * 材質ごとのテクスチャ 1 枚が覆う実寸 (m)。
 *
 * 木は板の幅が見えるので、細かく繰り返さないと巨大な一枚板に見える。
 * コンクリートや錆びた金属は模様に決まった大きさが無いので粗くてよい。
 */
const SURFACE_TILE: Record<Surface, number> = {
  metal: 2.5,
  concrete: 2.5,
  wood: 1.2,
}

/**
 * ステージを組む。
 *
 * `stage.glb` があればそれを使い、無ければコード側のブロックアウトで動く。
 * glb の読み込みは非同期なので、先にブロックアウトを出しておいて、
 * 届いた時点で差し替える。Game 側は Stage の配列を都度読むので入れ替えが効く。
 */
export function buildStage(scene: THREE.Scene): Stage {
  scene.add(buildSky())
  // フォグは空の地平線側と同じ色にする。違うと遠景が地平線で不自然に切れる。
  // 開始距離を遠くしてあるのは、近すぎると中距離の遮蔽物まで白んで索敵の判断材料が減るため。
  scene.fog = new THREE.Fog(new THREE.Color(SKY_HORIZON), 55, 135)

  const collidables: THREE.Object3D[] = []
  const cameraBlockers: THREE.Object3D[] = []
  const obstacles: Obstacle[] = []

  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x424b57,
    roughness: 0.95,
    metalness: 0,
  })
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    groundMaterial,
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  collidables.push(ground)
  // テクスチャは非同期。届くまでは単色のまま出しておく。
  void applyGroundTexture(groundMaterial)

  // stage.glb が届いたら丸ごと外せるよう 1 つにまとめておく
  const blockout = new THREE.Group()
  scene.add(blockout)

  const blockMaterial = createBlockoutMaterial()

  for (const [x, z, w, h, d] of BLOCKS) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMaterial)
    block.position.set(x, h / 2, z)
    block.castShadow = true
    block.receiveShadow = true
    blockout.add(block)
    collidables.push(block)

    obstacles.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      top: h,
      slopeX: 0,
      slopeZ: 0,
      baseTop: h,
      // コード側のブロックアウトは地面に置く箱しかない
      bottom: 0,
      surface: DEFAULT_SURFACE,
    })
  }

  const stage: Stage = { collidables, cameraBlockers, obstacles }
  void replaceWithModel(scene, stage, blockout)
  return stage
}

/**
 * glb のメッシュから当たり判定を起こしてステージを差し替える。
 *
 * 箱を軸に平行に置いている限り、各メッシュのワールド AABB がそのまま
 * Obstacle になる。Y 軸回りに回すと AABB が外接箱になって実際より大きくなるので、
 * ブロックアウトの間は回転させない運用にする。
 */
async function replaceWithModel(
  scene: THREE.Scene,
  stage: Stage,
  blockout: THREE.Group,
): Promise<void> {
  let gltf
  try {
    gltf = await loadStage()
  } catch {
    // stage.glb が無いのは異常ではない。コード側のブロックアウトで動く。
    return
  }

  const model = gltf.scene
  model.updateMatrixWorld(true)

  const collidables: THREE.Object3D[] = []
  const cameraBlockers: THREE.Object3D[] = []
  const obstacles: Obstacle[] = []
  const bounds = new THREE.Box3()
  // 材質ごとに 1 つずつ共有する。同じ材質の箱がいくつあっても増えない
  // (UV を頂点側で作り直すので、大きさが違っても 1 つで足りる)
  const materials = new Map<Surface, THREE.MeshStandardMaterial>()
  const materialFor = (surface: Surface) => {
    let material = materials.get(surface)
    if (!material) {
      material = createBlockoutMaterial()
      void applyStructureTexture(material, surface)
      materials.set(surface, material)
    }
    return material
  }

  model.traverse((obj) => {
    if (!isMesh(obj)) return
    const name = obj.name

    // テクスチャを持たないメッシュはブロックアウトとみなしてマテリアルを差し替える。
    // glTF の既定マテリアル (metalness = 1) のままだと陰の面が真っ黒になる。
    // アートが入ったメッシュはテクスチャを持つので、そちらはそのまま残る。
    const current = Array.isArray(obj.material) ? obj.material[0] : obj.material
    if (!(current as THREE.MeshStandardMaterial)?.map) {
      const replaced = Array.isArray(obj.material) ? obj.material : [obj.material]
      const surface = surfaceOf(name)
      obj.material = materialFor(surface)
      for (const material of new Set(replaced)) material.dispose()
      projectWorldUv(obj, SURFACE_TILE[surface])
    }

    const flags = flagsOf(name)

    if (flags.draw) {
      obj.castShadow = true
      obj.receiveShadow = true
    } else {
      obj.visible = false
    }

    // 止める対象ごとに別の一覧へ。1 つの札で全部を決めない
    if (flags.bullet) collidables.push(obj)
    if (flags.camera) cameraBlockers.push(obj)
    if (!flags.player) return
    bounds.setFromObject(obj)
    // 上面の傾きは頂点を見ないと分からないので、書き出しが測った値を後から重ねる。
    // ここでは平らな箱として置いておく
    obstacles.push({
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
      top: bounds.max.y,
      slopeX: 0,
      slopeZ: 0,
      baseTop: bounds.max.y,
      // **浮いている物はここで初めて浮く。** 以前は下面を捨てて地面からの柱に
      // していたので、橋を架けても下が塞がっていた
      bottom: bounds.min.y,
      surface: surfaceOf(name),
      name,
    })
  })

  await applySlopes(obstacles)

  let meshCount = 0
  model.traverse((obj) => {
    if (isMesh(obj)) meshCount++
  })
  if (meshCount === 0) {
    console.warn('[Stage] stage.glb にメッシュが無い。ブロックアウトのまま続行する')
    return
  }

  // 描画だけのモデル (vis_ ばかりの環境など) でも表示はする。
  // 判定が 0 個でも「読めていない」わけではない。
  scene.add(model)

  // 地面は残したまま、コード側の箱を差し替える
  const groundCollidables = stage.collidables.filter((obj) => !isBlockoutChild(obj, blockout))
  stage.collidables.length = 0
  stage.collidables.push(...groundCollidables, ...collidables)
  const groundCamera = stage.cameraBlockers.filter((obj) => !isBlockoutChild(obj, blockout))
  stage.cameraBlockers.length = 0
  stage.cameraBlockers.push(...groundCamera, ...cameraBlockers)
  stage.obstacles.length = 0
  stage.obstacles.push(...obstacles)
  disposeGroup(blockout)

  console.warn(
    `[Stage] stage.glb を読み込み: メッシュ ${meshCount} 個 / 判定 ${collidables.length} 個` +
      (collidables.length === 0 ? ' (描画のみ。col_ の箱を置くまで素通りする)' : ''),
  )
}

function isBlockoutChild(obj: THREE.Object3D, blockout: THREE.Group): boolean {
  for (let node: THREE.Object3D | null = obj; node; node = node.parent) {
    if (node === blockout) return true
  }
  return false
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (!isMesh(obj)) return
    obj.geometry.dispose()
    const material = obj.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material.dispose()
  })
  group.removeFromParent()
}

/**
 * 影を落とす範囲の半径 (m)。
 *
 * 影の解像度は「範囲 ÷ シャドウマップの画素数」で決まるので、
 * ステージ全体を覆おうとすると影がぼやける。プレイヤーの周りだけに絞って
 * 光源ごと追従させることで、広いステージでも解像度を保てる。
 */
const SHADOW_RADIUS = 45

/** 調整用に控えておく天空光。日陰の明るさを実機で決めるため */
let ambient: THREE.HemisphereLight | null = null

/** 日陰の明るさを変える (調整用)。確定したら AMBIENT_INTENSITY へ焼き込む */
export function setAmbientIntensity(intensity: number): void {
  if (ambient) ambient.intensity = intensity
}

export function buildLights(scene: THREE.Scene): THREE.DirectionalLight {
  // 全方向から一様に当たる AmbientLight ではなく、空と地面で色を分けた HemisphereLight。
  // 上面と下面に差が出るので、同じ明るさでも立体が潰れず遮蔽物の形が読める。
  //
  // これが日陰の明るさそのものになる。日陰は「光が無い場所」ではなく
  // 「直射が無く、空全体からの光だけが届く場所」なので、暗くはあっても黒くはならない。
  // 空の色と揃えてあるのは、青空の下の日陰が青みを帯びるのと同じ理屈。
  const sky = new THREE.HemisphereLight(SKY_HORIZON, 0x6b6055, AMBIENT_INTENSITY)
  scene.add(sky)
  ambient = sky

  const sun = new THREE.DirectionalLight(0xfff4e6, SUN_INTENSITY)
  // 闘技場の真ん中に固定する。動かさない。
  //
  // 追従させると、**エリア中の影が一斉にプレイヤーへ付いてくる**。
  // 影マップは光から見た固定の格子に地形を焼き付けたもので、範囲を動かすと
  // 焼き付けの位置がずれる。升目に丸めても完全には止まらなかった。
  //
  // 壁が ±40m、影の範囲が ±45m なので、**最初から全域が入っている**。
  // 動かす理由が無かった。ステージがこれより広くなったら、そのときは
  // 追従ではなく影マップを分ける (カスケード) 方を考える。
  sun.position.set(18, 30, 12)
  sun.target.position.set(0, 0, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // 影の濃さ。1 で完全に直射を遮る。
  // わずかに緩めてあるのは、現実の影も周囲からの反射で少し起きているため。
  sun.shadow.intensity = SHADOW_INTENSITY

  // 影のカバー範囲。広すぎると解像度が落ちるので地面全体ではなくプレイエリア相当に絞る。
  const cam = sun.shadow.camera
  cam.left = -SHADOW_RADIUS
  cam.right = SHADOW_RADIUS
  cam.top = SHADOW_RADIUS
  cam.bottom = -SHADOW_RADIUS
  cam.near = 1
  cam.far = 200
  cam.updateProjectionMatrix()

  scene.add(sun)
  scene.add(sun.target)
  return sun
}

