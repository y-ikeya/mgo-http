import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { HeldId } from '../domain/item/held'
import { loadGrenade, loadPistol, loadRifle, loadSmg, loadSniper, loadClaymore } from './assets'

/**
 * 地面に落ちている武器。
 *
 * **浮かせて回す。** 地面に寝かせて置くと、駐車場の床の模様に紛れて見つからない。
 * 拾える物であることが遠目にも分かってほしいので、少し浮かせてゆっくり回す。
 * 落ちている物が目印になれば、そこで撃ち合いがあったことも読める。
 *
 * 位置を決めているのはサーバー。ここは配られた場所に置いて回すだけで、
 * 誰が拾えるかの判定も持たない。
 */

/** 浮かせる高さ (m)。足元より上、腰より下 */
const FLOAT_HEIGHT = 0.55
/** 上下に揺れる幅 (m) と周期 (秒) */
const BOB_RANGE = 0.06
const BOB_PERIOD = 2.4
/** 回る速さ (rad/秒)。1 周およそ 6 秒 */
const SPIN_RATE = Math.PI / 3

const LOADERS: Partial<Record<HeldId, () => Promise<{ scene: THREE.Object3D }>>> = {
  rifle: loadRifle,
  sniper: loadSniper,
  pistol: loadPistol,
  smg: loadSmg,
  grenade: loadGrenade,
  claymore: loadClaymore,
  // 弾倉のモデルは持っていない。仮の箱で置く (thrown.ts と同じ扱い)
}

/** モデルが届くまでの仮の姿。無いよりは在り処が分かる */
function fallbackMesh(): THREE.Object3D {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.08, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.6, metalness: 0.2 }),
  )
}

interface Drop {
  id: number
  object: THREE.Object3D
  /** 揺れの位相。**物ごとにずらす** — 揃うと機械仕掛けに見える */
  phase: number
  baseY: number
}

export class Drops {
  private readonly scene: THREE.Scene
  private readonly items = new Map<number, Drop>()
  private elapsed = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  place(id: number, weapon: HeldId, at: readonly number[], yaw: number): void {
    if (this.items.has(id)) return
    const holder = new THREE.Group()
    holder.position.set(at[0], at[1] + FLOAT_HEIGHT, at[2])
    holder.rotation.y = yaw
    const placeholder = fallbackMesh()
    holder.add(placeholder)
    this.scene.add(holder)
    this.items.set(id, {
      id,
      object: holder,
      // id から決める。落ちるたびに違う位相で、同じ物は繋ぎ直しても同じ揺れ方
      phase: (id % 10) * 0.63,
      baseY: at[1] + FLOAT_HEIGHT,
    })

    const load = LOADERS[weapon]
    if (!load) return
    void load().then((gltf) => {
      // 拾われたあとに届くことがある。その場合は捨てる
      if (!this.items.has(id)) return
      holder.remove(placeholder)
      const model = cloneSkinned(gltf.scene)
      // 銃口が -Z を向いているので、横倒しにして「落ちている」形にする
      model.rotation.z = Math.PI / 2
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true
      })
      holder.add(model)
    })
  }

  remove(id: number): void {
    const item = this.items.get(id)
    if (!item) return
    this.scene.remove(item.object)
    this.items.delete(id)
  }

  /** 位置。拾える距離の判断や、音を鳴らす場所に使う */
  positionOf(id: number): THREE.Vector3 | null {
    return this.items.get(id)?.object.position ?? null
  }

  /** 一番近い物との距離 (m)。何も無ければ Infinity */
  nearest(from: THREE.Vector3): number {
    let best = Infinity
    for (const item of this.items.values()) {
      const dx = item.object.position.x - from.x
      const dz = item.object.position.z - from.z
      best = Math.min(best, Math.hypot(dx, dz))
    }
    return best
  }

  clear(): void {
    for (const item of this.items.values()) this.scene.remove(item.object)
    this.items.clear()
  }

  update(dt: number): void {
    this.elapsed += dt
    for (const item of this.items.values()) {
      item.object.rotation.y += SPIN_RATE * dt
      const wave = Math.sin(((this.elapsed + item.phase) / BOB_PERIOD) * Math.PI * 2)
      item.object.position.y = item.baseY + wave * BOB_RANGE
    }
  }
}
