import * as THREE from 'three'

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
const OPACITY = 0.62

let sharedTexture: THREE.Texture | null = null

function texture(): THREE.Texture {
  if (sharedTexture) return sharedTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.75)')
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
      // 地面と同じ深さなので、比べ合いで地面に勝つ側へ寄せる
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0.02
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    // 親のスキニングと同じ理由で、画面端で消えないように
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
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
