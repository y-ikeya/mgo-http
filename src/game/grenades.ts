import * as THREE from 'three'

import { loadGrenade } from './assets'
import { FIXED_STEP, stepProjectile, type Projectile } from '../sim/ballistic'
import type { StageBox } from '../sim/vision'

/**
 * 手榴弾。
 *
 * --- 弾倉の囮 (thrown.ts) と何が違うか ---
 * 形は似ているが、決めている場所が正反対にある。
 *
 * 囮は**各クライアントが解く**。音を鳴らすだけで誰も傷つかないので、
 * 少しずれても困らない。サーバーは地形を持っていなかった。
 *
 * 手榴弾は**サーバーが飛ばす**。爆風で人が死ぬ以上、爆ぜた場所は 1 か所しか
 * あってはいけない。ここが描くのは、サーバーが解いているのと同じ軌道の写しでしかない。
 * 位置は毎フレーム来ない — 初速だけ受け取って、同じ物理 (sim/ballistic.ts) を
 * 同じ刻みで解く。
 *
 * --- 見え方 ---
 * 囮と違って**全員に見せる**。囮は軌跡が見えたら「そこから投げた奴が居る」と
 * 割れて逆効果になるが、手榴弾は落ちてきたことに気付けないと逃げる手が無い。
 * 投げた場所が割れるのは、この場合は正しい代償になる。
 */

/** 落ちて止まってから消えるまで (秒)。爆発すれば即座に消えるので、取りこぼしの保険 */
const LINGER = 8

/** 転がっている間の回転の速さ (rad/m)。進んだ距離に比例させる */
const SPIN = 6

/** 予測線の刻み数 */
const PREVIEW_STEPS = 90

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
  private readonly previewPoints: Float32Array
  private readonly bounce: Bounce = { position: new THREE.Vector3(), strength: 0 }
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

    void loadGrenade().then((gltf) => {
      this.model = gltf.scene
      this.model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) obj.castShadow = true
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
  update(dt: number, boxes: StageBox[], onBounce: (bounce: Bounce) => void): void {
    // 刻みはサーバーと同じ固定値。フレーム間隔で解くと軌道がずれる
    this.accumulator = Math.min(this.accumulator + dt, 0.25)
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP
      for (const item of this.live) {
        if (item.body.resting) continue
        const before = Math.hypot(item.body.vx, item.body.vy, item.body.vz)
        stepProjectile(item.body, boxes)
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
  showPreview(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, boxes: StageBox[]): void {
    const p = this.probe
    p.x = origin.x
    p.y = origin.y
    p.z = origin.z
    p.vx = direction.x * speed
    p.vy = direction.y * speed
    p.vz = direction.z * speed
    p.bounces = 0
    p.resting = false

    let count = 0
    for (let i = 0; i < PREVIEW_STEPS; i++) {
      this.previewPoints[i * 3] = p.x
      this.previewPoints[i * 3 + 1] = p.y
      this.previewPoints[i * 3 + 2] = p.z
      count = i + 1
      // 最初に当たるところまで。跳ねた先まで見せると線が読めなくなる
      if (p.bounces > 0) break
      stepProjectile(p, boxes)
    }
    // 使わなかった残りは最後の点に畳む (別の場所へ線が伸びないように)
    for (let i = count; i < PREVIEW_STEPS; i++) {
      this.previewPoints[i * 3] = p.x
      this.previewPoints[i * 3 + 1] = p.y
      this.previewPoints[i * 3 + 2] = p.z
    }
    this.preview.geometry.attributes.position.needsUpdate = true
    this.preview.visible = true
    this.marker.position.set(p.x, p.y, p.z)
    this.marker.visible = true
  }

  hidePreview(): void {
    this.preview.visible = false
    this.marker.visible = false
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
  }
}

/** モデルが間に合わなかったときの代役。見えないより転がっているほうがまだ分かる */
function fallbackMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.7, metalness: 0.3 }),
  )
}
