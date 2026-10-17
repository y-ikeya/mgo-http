import * as THREE from 'three'
import { TOWARD_CAMERA } from '../util/depth'

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
const RADIUS = 0.55
/**
 * 濃さ。**汚れの板 (デカール) の上でも黒く見えるくらい。**
 *
 * STEALTH で体が消えている相手は、足元の影がほぼ唯一の手掛かりになる (2026-10-17 本人)。
 * 0.62 では入り口の泥の上で溶けて見えなかった
 */
const OPACITY = 0.9

let sharedTexture: THREE.Texture | null = null

function texture(): THREE.Texture {
  if (sharedTexture) return sharedTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // 芯を広く濃く残し、縁だけぼかす
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.9)')
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
  private readonly target = { x: RADIUS * 2, z: RADIUS * 2, offset: 0 }

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      map: texture(),
      color: 0x000000,
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      // 地面と同じ深さなので、比べ合いで地面に勝つ側へ寄せる (向きは深さの持ち方で裏返る。util/depth.ts)。
      // **汚れの板 (4) より強く寄せる** — 板の上でも影が負けないように (stage.ts の decal)
      polygonOffset: true,
      polygonOffsetFactor: 8 * TOWARD_CAMERA,
      polygonOffsetUnits: 8 * TOWARD_CAMERA,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0.02
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    // 親のスキニングと同じ理由で、画面端で消えないように
    this.mesh.frustumCulled = false
    // 汚れの板 (0) より後に描く。透ける物同士は描いた順に重なるので、後に描いた影が上に乗る
    this.mesh.renderOrder = 2
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
