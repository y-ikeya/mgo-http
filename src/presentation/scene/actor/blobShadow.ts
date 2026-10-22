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
/** 足元のどれだけ上から線を引くか (m)。地面そのものに当たらないように */
const SUN_PROBE_LIFT = 0.3

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

/** 体の影を落とす高さ (足元から、m)。体の真ん中 */
const BODY_CENTER = 0.9
/** 映した面から浮かせる量 (m)。面と同じ深さで描くと、ちらつく */
const LANDING_LIFT = 0.02
const PLANE_FACING = new THREE.Vector3(0, 0, 1)

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

/**
 * **足元に床が無い型。** 梯子を登っている間とぶら下がっている間は、体の真下が床ではない。
 * 丸い影を足元に付けたままだと宙に浮いて見えた (2026-10-22 本人「梯子登ってる時に自分の
 * キャラの下の方に影が浮いてない？」) ので、**日の向きに沿って壁や地面へ映す** (BlobShadow.lifted)。
 * 消すだけにすると、TSNE で梯子の途中の人を影で見つけられなくなる (同日 本人)。
 * 他人の画面は送られてくる型でしか分からないので、型で決める
 */
const OFF_FLOOR = new Set(['climb', 'climb_top', 'hang', 'hang_drop', 'hang_climb', 'hang_left', 'hang_right'])

/** その型で足元に床があるか (丸い影を出すか) */
export function blobOnFloor(locomotion: string): boolean {
  return !OFF_FLOOR.has(locomotion)
}

export class BlobShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  // 姿勢が変わっても形は一瞬で変えず、追いかける (ぱっと切り替わると影が跳ねて見える)
  private readonly target = { x: RADIUS * 2, z: RADIUS * 2, offset: 0 }
  /** 目指す濃さ。日なたなら SUN_OPACITY、日の当たらない所なら SHADE_OPACITY */
  private targetOpacity = SUN_OPACITY
  /**
   * 足元に床が無い (梯子・ぶら下がり、blobOnFloor)。**体から日の向きに沿って、最初に当たる
   * 壁や地面へ映す。** 体が日陰にあれば影は出ない (地面の時と同じ)
   */
  lifted = false
  private probeLeft = 0
  private readonly at = new THREE.Vector3()
  /** 映す先が見つかったか (足元に床が無い間だけ見る) */
  private landed = false
  private readonly landingAt = new THREE.Vector3()
  private readonly landingNormal = new THREE.Vector3()
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
  }

  /** 目標へなだらかに寄せる。0.15 秒ほどで追いつく */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10)
    const s = this.mesh.scale
    s.x += (this.target.x - s.x) * k
    s.y += (this.target.z - s.y) * k   // 平面を倒しているので、奥行きは scale.y
    if (this.lifted) {
      this.project()
    } else {
      // 足元へ戻す (映していた向きを解く)
      this.mesh.rotation.set(-Math.PI / 2, 0, 0)
      this.mesh.position.x = 0
      this.mesh.position.y = 0.02
      this.mesh.position.z += (this.target.offset - this.mesh.position.z) * k
    }
    // 日なたか。影の境をまたぐ時にぱっと変わらないよう、濃さも追いかける。
    // **映している間は体の所で測る** — 映した先は体の影の中なので、そこで測ると必ず日陰になる
    this.probeLeft -= dt
    if (this.probeLeft <= 0 && sunlit) {
      this.probeLeft = SUN_PROBE_EVERY
      if (this.lifted) this.bodyCenter(this.at)
      else {
        this.mesh.getWorldPosition(this.at)
        this.at.y += SUN_PROBE_LIFT
      }
      this.targetOpacity = sunlit(this.at.x, this.at.y, this.at.z) ? SUN_OPACITY : SHADE_OPACITY
    }
    const material = this.mesh.material
    const target = this.lifted && !this.landed ? 0 : this.targetOpacity
    material.opacity += (target - material.opacity) * (1 - Math.exp(-dt * 8))
  }

  /** 体の真ん中 (世界の座標)。親 (人の根) は足元にある */
  private bodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const parent = this.mesh.parent
    if (parent) parent.getWorldPosition(out)
    else out.set(0, 0, 0)
    out.y += BODY_CENTER
    return out
  }

  /**
   * 体の影を、日の向きに沿って最初に当たる面へ映す。**毎コマ** (梯子を登る間は動き続ける)。
   * 線 1 本なので軽い
   */
  private project(): void {
    const parent = this.mesh.parent
    const hit = parent && caster ? caster(...this.bodyCenter(this.at).toArray()) : null
    this.landed = hit !== null
    if (!hit || !parent) return
    this.landingNormal.set(hit.nx, hit.ny, hit.nz).normalize()
    this.landingAt.set(hit.x, hit.y, hit.z).addScaledVector(this.landingNormal, LANDING_LIFT)
    // 世界の置き場所と向きを、親 (人の根) から見た値へ直す
    parent.updateWorldMatrix(true, false)
    this.mesh.position.copy(parent.worldToLocal(this.landingAt))
    parent.getWorldQuaternion(this.parentQuat).invert()
    this.mesh.quaternion.setFromUnitVectors(PLANE_FACING, this.landingNormal).premultiply(this.parentQuat)
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
