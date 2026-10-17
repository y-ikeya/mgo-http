import * as THREE from 'three'
import { DRAW_LATER, TOWARD_CAMERA } from '../util/depth'

/**
 * 人の足元の丸い影。
 *
 * 太陽の影マップは動かない物だけを 1 度焼く (world/staticShadow.ts) ので、人は
 * 影マップに入らない。代わりに足元へ柔らかい丸を敷く。壁に伸びる影は出ないが、
 * 毎フレーム影マップを描き直す代償 (街を光の視点からも全部描く) に比べて
 * 十分に安く、地面に立っている手応えはこれで足りる。
 *
 * 人の根 (object) の子にして、位置と向きは親に任せる。姿勢で大きさだけ変える:
 * 伏せは向きに沿って長く、少し前 (頭の側) へ寄せる (伏せた体は中心の 0.5m 前に頭)。
 */
const RADIUS = 0.7
/**
 * **影の色 (画面に出る色、固定)。** 下の色と比べて**暗いほうを採る** (min)。
 *
 * 黒を重ねていた頃は「下の色の何割か」まで落としていたので、もう暗い床 (建物の中・日陰) の
 * 上ではさらに暗い丸が浮いた (2026-10-17 本人「暗い影にもさらに暗さが掛け合わさっていない？」)。
 * 固定の色との min なら、日なたの床はこの暗さまで落ち、これより暗い床は何も変わらない。
 * 日陰の地面と同じくらいの暗さに置く。**比べるのは露出・色調の補正の前の明るさ** なので、
 * 画面で見える日陰の色 (#3a2f1e くらい) よりずっと暗い値になる。環境光 (stage.ts の
 * AMBIENT_INTENSITY) を動かしたら、補正前の明るさで同じ割合だけ動かす (0.7 で #120e08、0.9 で #16110a、1.2 で #1a150d)
 */
export const SHADOW_COLOR = '#1a150d'

let sharedTexture: THREE.Texture | null = null

function texture(shade: string): THREE.Texture {
  if (!sharedTexture) sharedTexture = shadowTexture(shade)
  return sharedTexture
}

/**
 * 影の色 (真ん中) から白 (縁) へ。白は min で何も変えないので、縁がなだらかに消える。
 *
 * **ぼかしは光の量で等比に伸ばす。** min は露出・色調の補正をかける前の明るさ (地面は 0.01 前後)
 * で比べるので、画面の色で真っ直ぐ白へ移すと、地面の明るさを越える所が芯のすぐ外に来て縁が
 * くっきり切れた。影の色から 1 まで、補正前の明るさの比で少しずつ上げる
 */
export function shadowTexture(shade: string): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const base = new THREE.Color(shade) // 線形の値で持つ (three の Color は線形)
  const channels = [base.r, base.g, base.b].map((c) => Math.max(c, 1e-4))
  const darkest = Math.min(...channels)
  const image = ctx.createImageData(size, size)
  const color = new THREE.Color()
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)
      // 芯 (半径の 3 割) は影の色のまま、そこから縁へ
      const t = Math.min(1, Math.max(0, (r - 0.3) / 0.7))
      const k = t * t * (3 - 2 * t)
      // **3 色とも同じ比で上げる。** 色ごとに別の速さで白へ寄せると、地面の色との比べ合いで
      // 縁に緑の輪が出た
      const gain = Math.pow(1 / darkest, k)
      color.setRGB(
        Math.min(1, channels[0] * gain),
        Math.min(1, channels[1] * gain),
        Math.min(1, channels[2] * gain),
      )
      const at = (y * size + x) * 4
      const srgb = color.clone().convertLinearToSRGB()
      image.data[at] = Math.round(srgb.r * 255)
      image.data[at + 1] = Math.round(srgb.g * 255)
      image.data[at + 2] = Math.round(srgb.b * 255)
      image.data[at + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const made = new THREE.CanvasTexture(canvas)
  made.colorSpace = THREE.SRGBColorSpace
  return made
}

export type BlobStance = 'stand' | 'crouch' | 'prone'

export class BlobShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  // 姿勢が変わっても形は一瞬で変えず、追いかける (ぱっと切り替わると影が跳ねて見える)
  private readonly target = { x: RADIUS * 2, z: RADIUS * 2, offset: 0 }

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      map: texture(SHADOW_COLOR),
      transparent: true,
      depthWrite: false,
      // **画面の色のまま比べる。** 露出や色調の補正を通すと、屋内 (露出が上がる) で影の色まで明るくなる
      toneMapped: false,
      // 下の色と暗いほうを採る (min)。WebGPU の min は係数を 1 にしないと通らない
      blending: THREE.CustomBlending,
      blendEquation: THREE.MinEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // 地面と同じ深さなので、比べ合いで地面に勝つ側へ寄せる (向きは深さの持ち方で裏返る。util/depth.ts)
      polygonOffset: true,
      polygonOffsetFactor: 2 * TOWARD_CAMERA,
      polygonOffsetUnits: 2 * TOWARD_CAMERA,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0.02
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    // 親のスキニングと同じ理由で、画面端で消えないように
    this.mesh.frustumCulled = false
    /*
     * **汚れの板 (0) より後に描く。** どちらも深さを書かないので、後に描いた物が上に乗る。
     * 先に描くと泥の絵が影を塗りつぶして、泥の上に立つと影が消えた (2026-10-17 本人)。
     * 向きは深さの持ち方で裏返る (util/depth.ts の DRAW_LATER)
     */
    this.mesh.renderOrder = DRAW_LATER
    this.set('stand')
    this.mesh.scale.set(this.target.x, this.target.z, 1)
  }

  /**
   * 姿勢に合わせた形の目標。親の向きの前が −z。
   *
   * 伏せた体は位置の 0.95m 後ろから 0.65m 前まで (domain/player/stance.ts の PRONE_BODY) なので、
   * 楕円は長さ 1.9m を位置の少し後ろ (+0.15) に置く
   */
  set(stance: BlobStance): void {
    if (stance === 'prone') {
      this.target.x = 1.0
      this.target.z = 1.9
      this.target.offset = 0.15
    } else if (stance === 'crouch') {
      this.target.x = RADIUS * 2 * 1.25
      this.target.z = RADIUS * 2 * 1.25
      this.target.offset = -0.05
    } else {
      this.target.x = RADIUS * 2
      this.target.z = RADIUS * 2
      this.target.offset = 0
    }
  }

  /** 目標へなだらかに寄せる。0.15 秒ほどで追いつく */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10)
    const s = this.mesh.scale
    s.x += (this.target.x - s.x) * k
    s.y += (this.target.z - s.y) * k   // 平面を倒しているので、奥行きは scale.y
    this.mesh.position.z += (this.target.offset - this.mesh.position.z) * k
  }

  set visible(value: boolean) {
    this.mesh.visible = value
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh.removeFromParent()
  }
}
