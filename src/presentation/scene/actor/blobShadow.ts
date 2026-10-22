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
 * 人の根 (object) の子にして、**体から日の来る向きの反対へ線を引き、最初に当たった面へ貼る**
 * (2026-10-22 本人「高台に立った時に下の階に影が投影されてないのが残念」「既存の影もその方法で」)。
 * 平らな所では足元から日の反対側へ少しずれ、高台の縁では下の階へ、壁際では壁へ落ちる。
 * 梯子・ぶら下がりも同じ道で壁へ映る (足元に付けたままだと宙に浮いていた)。
 * 体が日陰にあれば出さない。姿勢で大きさだけ変える: 伏せは体の向きに沿って長く、少し後ろへ寄せる。
 */
const RADIUS = 0.6
/**
 * **日なたでの濃さ。** 下の色を何割落とすか (黒を重ねる)。日なたの地面を、すぐ横の建物の影と
 * 同じ明るさまで落とす値に合わせる。模様 (砂の粒・タイルの目地) は残る。
 *
 * 固定の影の色と暗いほうを採る (min) 描き方を試したが、芯が影の色 1 色に置き換わって
 * 地面の模様が消え、ベタ塗りに見えた (2026-10-17 本人「自分の影の色キモくない？ベタ塗り」)
 */
const SUN_OPACITY = 0.65
/**
 * **日の当たらない所での濃さ。** 建物の影の中・部屋の中は、もう日陰の明るさなので足さない。
 *
 * 黒を同じ濃さで重ねていた頃は、暗い床の上でさらに暗い丸が浮いた (「暗い影にもさらに暗さが
 * 掛け合わさっていない？」)。影は「日の光を遮る物」なので、日の当たっていない所では何も遮らない
 */
const SHADE_OPACITY = 0
/** 日なたかを測り直す間隔 (秒)。線 1 本なので軽いが、毎コマは要らない */
const SUN_PROBE_EVERY = 0.1

/**
 * その足元に日が当たっているか。**ステージが決まってから差し込む** (setSunProbe)。
 * 届くまでは日なたとして扱う
 */
let sunlit: ((x: number, y: number, z: number) => boolean) | null = null

/** 日なたかを答える物を差し込む。ステージと太陽が置けた所で 1 度 (stage.ts の sunProbeOf) */
export function setSunProbe(probe: ((x: number, y: number, z: number) => boolean) | null): void {
  sunlit = probe
}

/** 体の影が落ちる所 (面の点と向き)。足元に床が無い間だけ使う */
type ShadowCaster = (x: number, y: number, z: number) => { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null
let caster: ShadowCaster | null = null

/** 影の落ちる所を答える物を差し込む。setSunProbe と同じ所で 1 度 (stage.ts の sunCastOf) */
export function setSunCaster(cast: ShadowCaster | null): void {
  caster = cast
}

/** 体の影を落とす高さ (足元から、m)。体の真ん中。姿勢で変える */
const BODY_CENTER = { stand: 0.9, crouch: 0.55, prone: 0.25 } as const
/** 映した面から浮かせる量 (m)。面と同じ深さで描くと、ちらつく */
const LANDING_LIFT = 0.02
const FORWARD = new THREE.Vector3(0, 0, -1)
const SIDEWAYS = new THREE.Vector3(1, 0, 0)

let sharedTexture: THREE.Texture | null = null

function texture(): THREE.Texture {
  if (sharedTexture) return sharedTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // 芯を広く残し、縁だけぼかす
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(0.5, 'rgba(0,0,0,0.9)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  sharedTexture = new THREE.CanvasTexture(canvas)
  sharedTexture.colorSpace = THREE.NoColorSpace
  return sharedTexture
}

export type BlobStance = 'stand' | 'crouch' | 'prone'

export class BlobShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  // 姿勢が変わっても形は一瞬で変えず、追いかける (ぱっと切り替わると影が跳ねて見える)
  private readonly target = { x: RADIUS * 2, z: RADIUS * 2, offset: 0, height: BODY_CENTER.stand as number }
  /** 体の向きに沿った寄せ (m、後ろが +)。target.offset を追いかける */
  private offset = 0
  /** 目指す濃さ。日なたなら SUN_OPACITY、日の当たらない所なら SHADE_OPACITY */
  private targetOpacity = SUN_OPACITY
  private probeLeft = 0
  private readonly at = new THREE.Vector3()
  /** 影の落ちる面が見つかったか。無ければ出さない (線の届く先が空) */
  private landed = false
  private readonly landingAt = new THREE.Vector3()
  private readonly normal = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly basis = new THREE.Matrix4()
  private readonly parentQuat = new THREE.Quaternion()

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      map: texture(),
      color: 0x000000,
      transparent: true,
      opacity: SUN_OPACITY,
      depthWrite: false,
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
    this.target.height = BODY_CENTER[stance]
  }

  /** 目標へなだらかに寄せる。0.15 秒ほどで追いつく */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10)
    const s = this.mesh.scale
    s.x += (this.target.x - s.x) * k
    s.y += (this.target.z - s.y) * k
    this.offset += (this.target.offset - this.offset) * k
    this.project()
    // 体が日なたか。**体の所で測る** — 影の落ちた先は体の影の中なので、そこで測ると必ず日陰になる。
    // 影の境をまたぐ時にぱっと変わらないよう、濃さも追いかける
    this.probeLeft -= dt
    if (this.probeLeft <= 0 && sunlit) {
      this.probeLeft = SUN_PROBE_EVERY
      this.bodyCenter(this.at)
      this.targetOpacity = sunlit(this.at.x, this.at.y, this.at.z) ? SUN_OPACITY : SHADE_OPACITY
    }
    const material = this.mesh.material
    const target = this.landed ? this.targetOpacity : 0
    material.opacity += (target - material.opacity) * (1 - Math.exp(-dt * 8))
  }

  /** 体の真ん中 (世界の座標)。親 (人の根) は足元にある */
  private bodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const parent = this.mesh.parent
    if (parent) parent.getWorldPosition(out)
    else out.set(0, 0, 0)
    out.y += this.target.height
    return out
  }

  /**
   * 体の影を、日の向きに沿って最初に当たる面へ貼る。**毎コマ** (動き続けるので)。線 1 本なので軽い。
   *
   * 板の向きは、法線を面に、縦 (伏せで長い向き) を**体の前を面へ倒した向き**に合わせる。
   * 地面なら今までの「寝かせた板」と同じ向きになる
   */
  private project(): void {
    const parent = this.mesh.parent
    if (!parent || !caster) {
      this.landed = false
      return
    }
    const hit = caster(...this.bodyCenter(this.at).toArray())
    this.landed = hit !== null
    if (!hit) return
    this.normal.set(hit.nx, hit.ny, hit.nz).normalize()
    parent.updateWorldMatrix(true, false)
    parent.getWorldQuaternion(this.parentQuat)
    // 体の前を面へ倒す。真上から見下ろす面 (体の前と法線が揃う) なら横を使う
    this.ahead.copy(FORWARD).applyQuaternion(this.parentQuat)
    this.ahead.addScaledVector(this.normal, -this.ahead.dot(this.normal))
    if (this.ahead.lengthSq() < 1e-6) this.ahead.copy(SIDEWAYS).applyQuaternion(this.parentQuat)
    this.ahead.normalize()
    this.side.crossVectors(this.ahead, this.normal)
    this.basis.makeBasis(this.side, this.ahead, this.normal)
    this.mesh.quaternion.setFromRotationMatrix(this.basis).premultiply(this.parentQuat.invert())
    // 置き場所。面から少し浮かせ、姿勢の寄せ (後ろが +) を面の上で足す
    this.landingAt
      .set(hit.x, hit.y, hit.z)
      .addScaledVector(this.normal, LANDING_LIFT)
      .addScaledVector(this.ahead, -this.offset)
    this.mesh.position.copy(parent.worldToLocal(this.landingAt))
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
