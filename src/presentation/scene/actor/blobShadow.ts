import * as THREE from 'three'
import { DRAW_LATER, TOWARD_CAMERA } from '../util/depth'

/**
 * 人の影。**体の 3 か所 (足元・腰・胸) から日の向きに沿って落とす、ぼやっとした丸。**
 *
 * 太陽の影マップは動かない物だけを 1 度焼く (world/staticShadow.ts) ので、人は
 * 影マップに入らない。代わりに柔らかい丸を貼る。毎フレーム影マップを描き直す代償
 * (街を光の視点からも全部描く) に比べて十分に安い。
 *
 * 3 か所それぞれから日の来る向きの反対へ線を引き、最初に当たった面へ貼る
 * (2026-10-22 本人)。平らな所では足元から日の反対側へ伸びる人らしい影になり、高台の
 * 縁では**足の側は上の床に残って、上の側から順に下の階へこぼれる** — 1 点から 1 枚を
 * 落としていた頃は、縁で影がまとめて壁を滑り落ちて見えた (「シュッとスライド」)。
 * 壁際・梯子・ぶら下がりでは壁へ落ちる。足元が一番濃く、胸が一番薄い (本人)。
 *
 * 体が日陰にあれば出さない。姿勢で高さと大きさを変える: 伏せは体の向きに沿って長く、少し後ろへ寄せる。
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

/**
 * 影を落とす 3 か所。**足元・腰・胸。**
 *
 *     height   足元からの高さ (m)。姿勢ごと
 *     size     丸の大きさ (姿勢の形 target に掛ける)
 *     weight   濃さ (日なたの濃さ SUN_OPACITY に掛ける)。重なった所は掛け合わさって濃くなるので控えめに
 */
const SAMPLES = [
  { height: { stand: 0.2, crouch: 0.15, prone: 0.08 }, size: 0.85, weight: 0.85 },
  { height: { stand: 0.9, crouch: 0.55, prone: 0.18 }, size: 0.7, weight: 0.5 },
  { height: { stand: 1.4, crouch: 0.85, prone: 0.28 }, size: 0.55, weight: 0.3 },
] as const
/** 日なたかを測る高さ (足元から、m)。体の真ん中。姿勢で変える */
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

/** 1 か所ぶんの丸 */
interface Patch {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly sample: (typeof SAMPLES)[number]
  /** 落ちる面が見つかったか。無ければ出さない (線の届く先が空) */
  landed: boolean
}

export class BlobShadow {
  private readonly patches: Patch[]
  // 姿勢が変わっても形は一瞬で変えず、追いかける (ぱっと切り替わると影が跳ねて見える)
  private readonly target = { x: RADIUS * 2, z: RADIUS * 2, offset: 0 }
  private stance: BlobStance = 'stand'
  /** 今の形 (target を追いかける) */
  private readonly shape = { x: RADIUS * 2, z: RADIUS * 2, offset: 0 }
  /** 目指す濃さ。日なたなら SUN_OPACITY、日の当たらない所なら SHADE_OPACITY */
  private targetOpacity = SUN_OPACITY
  private probeLeft = 0
  private readonly at = new THREE.Vector3()
  private readonly landingAt = new THREE.Vector3()
  private readonly normal = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly basis = new THREE.Matrix4()
  private readonly parentQuat = new THREE.Quaternion()
  private readonly inverseQuat = new THREE.Quaternion()
  private parent: THREE.Object3D | null = null

  constructor() {
    this.patches = SAMPLES.map((sample) => {
      const material = new THREE.MeshBasicMaterial({
        map: texture(),
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        // 面と同じ深さなので、比べ合いで面に勝つ側へ寄せる (向きは深さの持ち方で裏返る。util/depth.ts)
        polygonOffset: true,
        polygonOffsetFactor: 2 * TOWARD_CAMERA,
        polygonOffsetUnits: 2 * TOWARD_CAMERA,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
      mesh.castShadow = false
      mesh.receiveShadow = false
      // 親のスキニングと同じ理由で、画面端で消えないように
      mesh.frustumCulled = false
      /*
       * **汚れの板 (0) より後に描く。** どちらも深さを書かないので、後に描いた物が上に乗る。
       * 先に描くと泥の絵が影を塗りつぶして、泥の上に立つと影が消えた (2026-10-17 本人)。
       * 向きは深さの持ち方で裏返る (util/depth.ts の DRAW_LATER)
       */
      mesh.renderOrder = DRAW_LATER
      return { mesh, sample, landed: false }
    })
    this.set('stand')
  }

  /** 人の根 (足元) に付ける。置き場所と向きは毎コマ世界の座標から直す */
  attach(parent: THREE.Object3D): void {
    this.parent = parent
    for (const patch of this.patches) parent.add(patch.mesh)
  }

  /**
   * 姿勢に合わせた形の目標。
   *
   * 伏せた体は位置の 0.95m 後ろから 0.65m 前まで (domain/player/stance.ts の PRONE_BODY) なので、
   * 楕円は長さ 1.9m を位置の少し後ろ (+0.15) に置く
   */
  set(stance: BlobStance): void {
    this.stance = stance
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
    this.shape.x += (this.target.x - this.shape.x) * k
    this.shape.z += (this.target.z - this.shape.z) * k
    this.shape.offset += (this.target.offset - this.shape.offset) * k
    const parent = this.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      parent.getWorldQuaternion(this.parentQuat)
      this.inverseQuat.copy(this.parentQuat).invert()
    }
    for (const patch of this.patches) this.project(patch)
    // 体が日なたか。**体の所で測る** — 影の落ちた先は体の影の中なので、そこで測ると必ず日陰になる。
    // 影の境をまたぐ時にぱっと変わらないよう、濃さも追いかける
    this.probeLeft -= dt
    if (this.probeLeft <= 0 && sunlit) {
      this.probeLeft = SUN_PROBE_EVERY
      this.bodyPoint(BODY_CENTER[this.stance], this.at)
      this.targetOpacity = sunlit(this.at.x, this.at.y, this.at.z) ? SUN_OPACITY : SHADE_OPACITY
    }
    const fade = 1 - Math.exp(-dt * 8)
    for (const patch of this.patches) {
      const material = patch.mesh.material
      const target = patch.landed ? this.targetOpacity * patch.sample.weight : 0
      material.opacity += (target - material.opacity) * fade
    }
  }

  /** 体のその高さの点 (世界の座標)。親 (人の根) は足元にある */
  private bodyPoint(height: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.parent) this.parent.getWorldPosition(out)
    else out.set(0, 0, 0)
    out.y += height
    return out
  }

  /**
   * その 1 か所の影を、日の向きに沿って最初に当たる面へ貼る。**毎コマ** (動き続けるので)。線 1 本。
   *
   * 板の向きは、法線を面に、縦 (伏せで長い向き) を**体の前を面へ倒した向き**に合わせる。
   * 地面なら今までの「寝かせた板」と同じ向きになる
   */
  private project(patch: Patch): void {
    const parent = this.parent
    if (!parent || !caster) {
      patch.landed = false
      return
    }
    const hit = caster(...this.bodyPoint(patch.sample.height[this.stance], this.at).toArray())
    patch.landed = hit !== null
    if (!hit) return
    const mesh = patch.mesh
    this.normal.set(hit.nx, hit.ny, hit.nz).normalize()
    // 体の前を面へ倒す。体の前と法線が揃う面なら横を使う
    this.ahead.copy(FORWARD).applyQuaternion(this.parentQuat)
    this.ahead.addScaledVector(this.normal, -this.ahead.dot(this.normal))
    if (this.ahead.lengthSq() < 1e-6) this.ahead.copy(SIDEWAYS).applyQuaternion(this.parentQuat)
    this.ahead.normalize()
    this.side.crossVectors(this.ahead, this.normal)
    this.basis.makeBasis(this.side, this.ahead, this.normal)
    mesh.quaternion.setFromRotationMatrix(this.basis).premultiply(this.inverseQuat)
    mesh.scale.set(this.shape.x * patch.sample.size, this.shape.z * patch.sample.size, 1)
    // 置き場所。面から少し浮かせ、姿勢の寄せ (後ろが +) を面の上で足す
    this.landingAt
      .set(hit.x, hit.y, hit.z)
      .addScaledVector(this.normal, LANDING_LIFT)
      .addScaledVector(this.ahead, -this.shape.offset)
    mesh.position.copy(parent.worldToLocal(this.landingAt))
  }

  set visible(value: boolean) {
    for (const patch of this.patches) patch.mesh.visible = value
  }

  dispose(): void {
    for (const patch of this.patches) {
      patch.mesh.geometry.dispose()
      patch.mesh.material.dispose()
      patch.mesh.removeFromParent()
    }
  }
}
