import * as THREE from 'three'
import { loadCat } from '../assets'
import { refreshStaticShadows } from '../world/staticShadow'
import { LURE_RADIUS } from '../../../domain/item/cat'

/**
 * 置かれた猫 (CAT)。**置物と、置いた本人にだけ見える円。**
 *
 * 釘付けにするのも消すのもサーバー (server/arms/cat.ts)。ここは見せるだけ。
 * 円は効く範囲 (半径 1.5m、domain/item/cat.ts)。**敵には見えない** — 見えると避けて通られる。
 * 置いた本人にはうっすら見える (どこまで寄せれば掛かるかが分かる)。
 * 誰かが掛かったら円は消す (もう誰も掛からない)。
 */

/** 円の濃さ。**うっすら** (本人 2026-10-20) */
const RING_OPACITY = 0.07
/** 円の縁の太さ (m) */
const RING_WIDTH = 0.06
/** 床から浮かせる量 (m)。床と重なってちらつかないように */
const RING_LIFT = 0.03

interface Entry {
  group: THREE.Group
  ring: THREE.Mesh | null
}

export class Cats {
  private readonly entries = new Map<number, Entry>()
  private readonly ringGeometry = new THREE.RingGeometry(LURE_RADIUS - RING_WIDTH, LURE_RADIUS, 64)
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: RING_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  has(id: number): boolean {
    return this.entries.has(id)
  }

  /** 置いてある所 (足元)。無ければ null */
  positionOf(id: number): THREE.Vector3 | null {
    return this.entries.get(id)?.group.position ?? null
  }

  /** 置く。mine なら効く範囲の円も出す */
  place(id: number, at: readonly number[], yaw: number, mine: boolean): void {
    if (this.entries.has(id)) return
    const group = new THREE.Group()
    group.position.set(at[0]!, at[1]!, at[2]!)
    let ring: THREE.Mesh | null = null
    if (mine) {
      ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = RING_LIFT
      ring.renderOrder = 1
      group.add(ring)
    }
    this.entries.set(id, { group, ring })
    this.scene.add(group)
    void loadCat().then((gltf) => {
      if (this.entries.get(id)?.group !== group) return
      // 形と材質は共有のまま (消すときに dispose しない)
      const model = gltf.scene.clone(true)
      // 模型の正面は +Z。置いた本人のほうへ向ける (yaw は -Z 正面の向き)
      model.rotation.y = yaw + Math.PI
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true
      })
      group.add(model)
      refreshStaticShadows() // 置いた物は影マップに焼き直す
    })
  }

  /** 誰かが掛かった。円を消す (もう誰も掛からない) */
  sprung(id: number): void {
    const entry = this.entries.get(id)
    if (!entry?.ring) return
    entry.group.remove(entry.ring)
    entry.ring = null
  }

  remove(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.scene.remove(entry.group)
    refreshStaticShadows()
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.remove(id)
  }
}
