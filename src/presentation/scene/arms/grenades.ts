import * as THREE from 'three'

import { loadGrenade } from '../assets'
import { FIXED_STEP, stepProjectile, throwVelocity, type Projectile } from '../../../sim/judge/ballistic'
import type { Water } from '../../../domain/stage'
import type { SolidWorld } from '../../../sim/space/vision'
import { THROW_LOFT } from '../../../domain/item/grenade'
import { TOWARD_CAMERA } from '../util/depth'

/**
 * 手榴弾。
 *
 * --- 投げた弾倉 (thrown.ts) と何が違うか ---
 * 形は似ているが、決めている場所が正反対にある。
 *
 * 弾倉は**各クライアントが解く**。音を鳴らすだけで誰も傷つかないので、
 * 少しずれても困らない。サーバーは地形を持っていなかった。
 *
 * 手榴弾は**サーバーが飛ばす**。爆風で人が死ぬ以上、爆ぜた場所は 1 か所しか
 * あってはいけない。ここが描くのは、サーバーが解いているのと同じ軌道のレプリカでしかない。
 * 位置は毎フレーム来ない — 初速だけ受け取って、同じ物理 (sim/ballistic.ts) を
 * 同じ刻みで解く。
 *
 * --- 見え方 ---
 * 弾倉と違って**全員に見せる**。あちらは軌跡が見えたら「そこから投げた奴が居る」と
 * 割れて逆効果になるが、手榴弾は落ちてきたことに気付けないと逃げる手が無い。
 * 投げた場所が割れるのは、この場合は正しい代償になる。
 */

/** 落ちて止まってから消えるまで (秒)。爆発すれば即座に消えるので、取りこぼしの保険 */
const LINGER = 8

/** 転がっている間の回転の速さ (rad/m)。進んだ距離に比例させる */
const SPIN = 6

/**
 * 予測線の刻み数。
 *
 * 最初に当たる所までしか見せない。転がる先まで引くと線が地面を這って読めなくなるし、
 * **どこへ落とすか**が手であって、そこから先は投げた側にも読めない方がいい。
 */
const PREVIEW_STEPS = 90
/** 線の頭を手から本当の軌道へ寄せる点の数。短いと折れて見え、長いと落ちる所まで嘘になる */
const PREVIEW_HAND_BLEND = 12

const UP = new THREE.Vector3(0, 1, 0)

/** 落下点の地面の光の半径 (m) */
const GLOW_RADIUS = 0.7
/** 光の脈打ちの速さ (回/秒) と、明るさの振れ幅 */
const GLOW_PULSE_HZ = 1.6
const GLOW_PULSE = 0.3

/**
 * 地面の光の絵。中心が明るく、縁へ向けて消える丸。**一度だけ作って使い回す**
 */
function glowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  const r = size / 2
  const fill = g.createRadialGradient(r, r, 0, r, r, r)
  fill.addColorStop(0, 'rgba(255,255,255,1)')
  fill.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  fill.addColorStop(0.55, 'rgba(255,255,255,0.3)')
  fill.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = fill
  g.fillRect(0, 0, size, size)
  // 縁に細い輪。広がりの境が読める
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.lineWidth = 3
  g.beginPath()
  g.arc(r, r, r * 0.86, 0, Math.PI * 2)
  g.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export interface Bounce {
  position: THREE.Vector3
  /** 当たりの強さ (0..1)。垂直に叩きつけるほど大きい */
  strength: number
}

interface Live {
  id: number
  mesh: THREE.Object3D
  body: Projectile
  /** 止まってからの時間 (秒) */
  age: number
  bounces: number
}

export class Grenades {
  private readonly scene: THREE.Scene
  private readonly live: Live[] = []
  private model: THREE.Object3D | null = null
  /** 固定刻みで進めるための余り */
  private accumulator = 0

  private readonly preview: THREE.Line
  private readonly marker: THREE.Mesh
  /** 落下点に置く光。当たった面 (床・壁) に貼る (2026-11-20 本人「爆発地点の地面が光って表示することできる？」「壁に当たるんだったら circle は壁に垂直に」) */
  private readonly glow: THREE.Mesh
  private readonly glowNormal = new THREE.Vector3()
  private readonly previewPoints: Float32Array
  private readonly bounce: Bounce = { position: new THREE.Vector3(), strength: 0 }
  private readonly launch = { x: 0, y: 0, z: 0 }
  private readonly probe: Projectile = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, resting: false,
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene

    this.previewPoints = new Float32Array(PREVIEW_STEPS * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.previewPoints, 3))
    this.preview = new THREE.Line(
      geometry,
      // 露出に左右されない。狙いを付けるための線なので明るさが変わっても読めてほしい
      new THREE.LineBasicMaterial({
        color: 0xffd0a0,
        transparent: true,
        opacity: 0.75,
        toneMapped: false,
      }),
    )
    this.preview.visible = false
    this.preview.frustumCulled = false
    scene.add(this.preview)

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd0a0,
        transparent: true,
        opacity: 0.55,
        toneMapped: false,
      }),
    )
    this.marker.visible = false
    scene.add(this.marker)

    /*
     * 落下点の地面の光。**足し合わせ (加算) で描く** — 暗い屋内でも明るい屋外でも、地面の上に
     * 光が乗って見える。深さには書かず、地面へ少し手前寄せして沈まないようにする (util/depth.ts)。
     * 露出 (トーンマップ) に左右させない。狙いの印なので明るさで読めなくなっては困る
     */
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(GLOW_RADIUS, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: 0xffa040,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: TOWARD_CAMERA * 2,
        polygonOffsetUnits: TOWARD_CAMERA * 2,
      }),
    )
    this.glow.visible = false
    this.glow.frustumCulled = false
    scene.add(this.glow)

    void loadGrenade().then((gltf) => {
      this.model = gltf.scene
      this.model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) obj.castShadow = false   // 動く物は影マップに入れない (world/staticShadow.ts)
      })
    })
  }

  /**
   * サーバーが投げた手榴弾を出す。
   *
   * 位置も速度もサーバーが決めた値をそのまま使う。自分が投げたものも例外にしない —
   * 手元で先に飛ばして後から合わせると、見えている場所と爆ぜる場所がずれる。
   */
  spawn(id: number, from: readonly number[], velocity: readonly number[]): void {
    const mesh = this.model ? this.model.clone(true) : fallbackMesh()
    mesh.position.set(from[0], from[1], from[2])
    this.scene.add(mesh)
    this.live.push({
      id,
      mesh,
      body: {
        x: from[0], y: from[1], z: from[2],
        vx: velocity[0], vy: velocity[1], vz: velocity[2],
        bounces: 0,
        resting: false,
      },
      age: 0,
      bounces: 0,
    })
  }

  /** 爆発した。消すだけ (音と光は呼び出し側の仕事) */
  remove(id: number): THREE.Vector3 | null {
    const index = this.live.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [item] = this.live.splice(index, 1)
    const at = item.mesh.position.clone()
    item.mesh.removeFromParent()
    return at
  }

  /**
   * 飛ばす。
   *
   * @param onBounce 跳ねるたびに呼ぶ。音を鳴らすのは呼び出し側の仕事
   */
  update(
    dt: number,
    world: SolidWorld,
    water: Water | null,
    onBounce: (bounce: Bounce) => void,
  ): void {
    // 刻みはサーバーと同じ固定値。フレーム間隔で解くと軌道がずれる
    this.accumulator = Math.min(this.accumulator + dt, 0.25)
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP
      for (const item of this.live) {
        if (item.body.resting) continue
        const before = Math.hypot(item.body.vx, item.body.vy, item.body.vz)
        stepProjectile(item.body, world, undefined, water)
        if (item.body.bounces > item.bounces) {
          item.bounces = item.body.bounces
          this.bounce.position.set(item.body.x, item.body.y, item.body.z)
          // 失った速さを当たりの強さにする。転がり際の接触で毎回鳴らない
          const after = Math.hypot(item.body.vx, item.body.vy, item.body.vz)
          this.bounce.strength = Math.min(1, Math.max(0, (before - after) / 12))
          if (this.bounce.strength > 0.08) onBounce(this.bounce)
        }
      }
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const item = this.live[i]
      /*
       * 水に入ったら**消す。**
       *
       * 堀の底は水面の 2cm 下にある (歩く床は水の下の地面のまま) ので、沈み
       * 切っても手榴弾の半分が水面から出たままだった。水は不透明なので、
       * 本来なら水中の物は見えない。深さを持たせる代わりにここで隠す。
       *
       * 消えた瞬間に水しぶきが上がっているので、**どこへ落ちたかは見える**。
       * 玉そのものは、爆ぜるまで水面の下にある。
       */
      if (item.body.sunk) item.mesh.visible = false

      const previous = item.mesh.position.clone()
      item.mesh.position.set(item.body.x, item.body.y, item.body.z)
      // 進んだぶんだけ転がす。速度から角速度を作ると、跳ねた瞬間に不自然に回る
      const moved = item.mesh.position.distanceTo(previous)
      if (moved > 1e-4) {
        item.mesh.rotateX(moved * SPIN)
        item.mesh.rotateZ(moved * SPIN * 0.6)
      }
      if (!item.body.resting) continue
      item.age += dt
      if (item.age >= LINGER) {
        item.mesh.removeFromParent()
        this.live.splice(i, 1)
      }
    }
  }

  /**
   * 構えている間の予測線。
   *
   * 落下点を見てから離せるようにする。押した瞬間に飛ぶ形だと、狙った場所へ
   * 落とすのが運になる。手榴弾は「そこへ落とす」判断そのものが手なので、
   * 見せないと成立しない。
   */
  showPreview(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    world: SolidWorld,
    water: Water | null,
    /** 投げ出す速さ。**スキルを掛けた後の値を渡す** (domain の throwSpeedOf) */
    speed: number,
    /**
     * 線の見た目の始点 (振りかぶった右手)。**軌道そのものは origin から** —
     * 落ちる所はサーバーと同じ式で決まるので、線の頭だけを手から出して、
     * 途中で本当の軌道へ寄せる。無ければ origin から
     */
    handStart?: THREE.Vector3,
  ): void {
    const p = this.probe
    p.x = origin.x
    p.y = origin.y
    p.z = origin.z
    // 初速はサーバーと同じ式で、同じ数字で作る。**どちらも domain から引く** —
    // ここで別に持つと、見えている軌道と実際に飛ぶ軌道が食い違う
    throwVelocity(
      direction.x,
      direction.y,
      direction.z,
      speed,
      THROW_LOFT,
      this.launch,
    )
    p.vx = this.launch.x
    p.vy = this.launch.y
    p.vz = this.launch.z
    p.bounces = 0
    p.resting = false
    p.sunk = false
    p.normal = undefined

    let count = 0
    for (let i = 0; i < PREVIEW_STEPS; i++) {
      this.previewPoints[i * 3] = p.x
      this.previewPoints[i * 3 + 1] = p.y
      this.previewPoints[i * 3 + 2] = p.z
      count = i + 1
      // 最初に当たるところまで。跳ねた先まで見せると線が読めなくなる
      if (p.bounces > 0) break
      stepProjectile(p, world, undefined, water)
    }
    // 使わなかった残りは最後の点に畳む (別の場所へ線が伸びないように)
    for (let i = count; i < PREVIEW_STEPS; i++) {
      this.previewPoints[i * 3] = p.x
      this.previewPoints[i * 3 + 1] = p.y
      this.previewPoints[i * 3 + 2] = p.z
    }
    // 線の頭を手へ。手と軌道の始点のずれを、最初の PREVIEW_HAND_BLEND 点で 0 まで減らす
    if (handStart) {
      const dx = handStart.x - origin.x
      const dy = handStart.y - origin.y
      const dz = handStart.z - origin.z
      const blend = Math.min(PREVIEW_HAND_BLEND, count)
      for (let i = 0; i < blend; i++) {
        const k = 1 - i / blend
        this.previewPoints[i * 3] += dx * k
        this.previewPoints[i * 3 + 1] += dy * k
        this.previewPoints[i * 3 + 2] += dz * k
      }
    }
    this.preview.geometry.attributes.position.needsUpdate = true
    this.preview.visible = true
    this.marker.position.set(p.x, p.y, p.z)
    this.marker.visible = true
    // 光は当たった面に貼る。床なら水平、壁なら壁に沿って立てる (円の表は面の外向き)
    const n = p.normal ?? { x: 0, y: 1, z: 0 }
    this.glowNormal.set(n.x, n.y, n.z)
    this.glow.quaternion.setFromUnitVectors(UP, this.glowNormal)
    this.glow.position.set(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02)
    const pulse = 1 - GLOW_PULSE * 0.5 * (1 + Math.sin((performance.now() / 1000) * Math.PI * 2 * GLOW_PULSE_HZ))
    ;(this.glow.material as THREE.MeshBasicMaterial).opacity = 0.9 * pulse
    this.glow.visible = true
  }

  hidePreview(): void {
    this.preview.visible = false
    this.marker.visible = false
    this.glow.visible = false
  }

  /** 試合が切り替わったら全部消す。前の試合の手榴弾が残っていると混乱する */
  clear(): void {
    for (const item of this.live) item.mesh.removeFromParent()
    this.live.length = 0
  }

  dispose(): void {
    this.clear()
    this.preview.removeFromParent()
    this.preview.geometry.dispose()
    ;(this.preview.material as THREE.Material).dispose()
    this.marker.removeFromParent()
    this.marker.geometry.dispose()
    ;(this.marker.material as THREE.Material).dispose()
    this.glow.removeFromParent()
    this.glow.geometry.dispose()
    ;(this.glow.material as THREE.MeshBasicMaterial).map?.dispose()
    ;(this.glow.material as THREE.Material).dispose()
  }
}

/** モデルが間に合わなかったときの代役。見えないより転がっているほうがまだ分かる */
function fallbackMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.7, metalness: 0.3 }),
  )
}
