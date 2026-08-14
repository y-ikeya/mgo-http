import * as THREE from 'three'

import { loadCasing } from './assets'
import { FIXED_STEP, stepProjectile, type Projectile } from '../sim/ballistic'
import type { StageBox } from '../sim/vision'

/**
 * 排莢。
 *
 * 撃ったことの手応えを増やすためだけにあり、当たり判定は無い。
 * 弾が当たったかどうかは既に十字と着弾痕が伝えているので、ここは
 * 「撃っている」という感触だけを受け持つ。
 *
 * 落ちた音は鳴らすが、届くのは足元だけ (6m)。銃声より遠くへ届くと、
 * 撃った位置を二重に知らせることになる。
 *
 * --- 通信しない ---
 * 手榴弾と違って**各クライアントが勝手に出す**。位置がずれても誰も困らないし、
 * 落ちた薬莢から誰かの居場所が割れることもない (撃った時点で銃声が全部伝えている)。
 *
 * 物理は手榴弾と同じ式を使う (sim/ballistic.ts)。跳ねて転がって止まる。
 * 揃える必要は無いが、地形の扱いを 2 つ持ちたくない。
 */

/** 同時に出せる数。撃ち続けると増え続けるので、古いものから使い回す */
const POOL = 24

/** 落ちてから消えるまで (秒) */
const LINGER = 6

/** 排莢口から飛び出す速さ (m/s) */
const EJECT_SPEED = 2.6

/** 回る速さ (rad/m)。進んだ距離に比例させる */
const SPIN = 24

interface Shell {
  mesh: THREE.Object3D
  body: Projectile
  /** 止まってからの時間 (秒)。0 なら飛んでいる */
  age: number
  live: boolean
  /** もう落ちた音を鳴らしたか。跳ねるたびに鳴らさないための札 */
  dropped: boolean
}

export class Casings {
  private readonly scene: THREE.Scene
  private readonly shells: Shell[] = []
  private next = 0
  private accumulator = 0
  private model: THREE.Object3D | null = null

  private readonly drop = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    void loadCasing().then((gltf) => {
      this.model = gltf.scene
      // 差し替えは起きない (読み込み前に撃った分は代役のまま残る)。
      // 1 発ぶんの見た目なので、そこは追わない
      for (const shell of this.shells) {
        if (!shell.live) this.replace(shell)
      }
    })
  }

  /**
   * 1 発ぶん飛ばす。
   *
   * @param at 排莢口のワールド座標
   * @param yaw 体の向き (rad)。右へ弾くのに使う
   */
  eject(at: THREE.Vector3, yaw: number): void {
    const shell = this.take()
    shell.mesh.position.copy(at)
    shell.mesh.visible = true

    // yaw = θ のとき右は (cosθ, 0, -sinθ)。実銃と同じで右斜め後ろへ飛ばす
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    this.up.set(0, 1, 0)

    const spread = () => (Math.random() * 2 - 1) * 0.35
    shell.body.x = at.x
    shell.body.y = at.y
    shell.body.z = at.z
    shell.body.vx = this.right.x * EJECT_SPEED + spread()
    shell.body.vy = EJECT_SPEED * (0.7 + Math.random() * 0.4)
    shell.body.vz = this.right.z * EJECT_SPEED + spread()
    shell.body.bounces = 0
    shell.body.resting = false
    shell.body.rolling = false
    shell.age = 0
    shell.live = true
    shell.dropped = false
  }

  /**
   * @param onDrop 最初に地面へ当たったときに 1 回だけ呼ぶ。
   *   音を鳴らすのは呼び出し側の仕事
   */
  update(dt: number, boxes: StageBox[], onDrop: (at: THREE.Vector3) => void): void {
    // 刻みは固定。手榴弾と同じ式なので、そこだけ揃えておく
    this.accumulator = Math.min(this.accumulator + dt, 0.25)
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP
      for (const shell of this.shells) {
        if (!shell.live || shell.body.resting) continue
        stepProjectile(shell.body, boxes, TUNING)
        // 最初に当たった 1 回だけ。跳ねるたびに鳴らすと鳴りっぱなしになる
        if (!shell.dropped && shell.body.bounces > 0) {
          shell.dropped = true
          onDrop(this.drop.set(shell.body.x, shell.body.y, shell.body.z))
        }
      }
    }

    for (const shell of this.shells) {
      if (!shell.live) continue
      const moved = shell.mesh.position.distanceTo(
        this.up.set(shell.body.x, shell.body.y, shell.body.z),
      )
      shell.mesh.position.set(shell.body.x, shell.body.y, shell.body.z)
      if (moved > 1e-4) {
        shell.mesh.rotateX(moved * SPIN)
        shell.mesh.rotateZ(moved * SPIN * 0.7)
      }
      if (!shell.body.resting) continue
      shell.age += dt
      if (shell.age >= LINGER) {
        shell.live = false
        shell.mesh.visible = false
      }
    }
  }

  dispose(): void {
    for (const shell of this.shells) shell.mesh.removeFromParent()
    this.shells.length = 0
  }

  /** 空きを 1 つ取る。無ければ一番古いものを取り上げる */
  private take(): Shell {
    const free = this.shells.find((s) => !s.live)
    if (free) return free
    if (this.shells.length < POOL) {
      const shell: Shell = {
        mesh: this.build(),
        body: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, resting: false },
        age: 0,
        live: false,
        dropped: false,
      }
      this.scene.add(shell.mesh)
      this.shells.push(shell)
      return shell
    }
    const shell = this.shells[this.next]
    this.next = (this.next + 1) % POOL
    return shell
  }

  private build(): THREE.Object3D {
    if (this.model) return this.model.clone(true)
    // 読み込みが間に合わないときの代役。真鍮色の小さな筒
    return new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.02, 6),
      new THREE.MeshStandardMaterial({ color: 0xb08840, roughness: 0.4, metalness: 0.9 }),
    )
  }

  /** 代役で作った分をモデルへ差し替える */
  private replace(shell: Shell): void {
    shell.mesh.removeFromParent()
    shell.mesh = this.build()
    shell.mesh.visible = false
    this.scene.add(shell.mesh)
  }
}

/**
 * 薬莢の跳ね方。
 *
 * 手榴弾より軽くてよく跳ねるが、すぐ止まる。転がり続けると
 * 撃った場所に線を引くことになるので、そこは短く切る。
 */
const TUNING = {
  restitution: 0.42,
  friction: 0.6,
  rollFriction: 9,
  restSpeed: 0.3,
  contactSpeed: 0.7,
}
