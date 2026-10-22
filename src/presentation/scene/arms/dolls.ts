import * as THREE from 'three'
import { castStaticShadow } from '../world/liveShadow'
import { loadDoll } from '../assets'
import { refreshStaticShadows } from '../world/staticShadow'
import { LURE_RADIUS } from '../../../domain/item/doll'
import type { Team } from '../../../domain/player/player'
import { TEAM_COLOR } from '../world/stage'

/**
 * 置かれた猫 (DOLL)。**置物と、置いた本人にだけ見える円。**
 *
 * 釘付けにするのも消すのもサーバー (server/arms/doll.ts)。ここは見せるだけ。
 * 円は効く範囲 (半径 1.5m、domain/item/doll.ts)。**敵には見えない** — 見えると避けて通られる。
 * 置いた本人と味方にはうっすら見える (どこまで寄せれば掛かるかが分かる)。
 * 円は猫が消えるまで出す (掛かった後も、後から入った敵は掛かる)。
 */

/**
 * 効く範囲の濃さ。**縁ではなく円の中を塗る** (本人 2026-10-20「縁の中全部が 0.2 くらい」、見て 0.08 に)。
 * 色は**置いた人の陣営の色** (基地の枠と同じ TEAM_COLOR、露出に左右されない描き方も同じ)。
 * 置く前の予告 (placePreview.ts) も同じ物を使う
 */
export const ZONE_OPACITY = 0.08

/** 効く範囲を塗る材質。陣営ごとに 1 つ */
export function zoneMaterial(team: Team): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: TEAM_COLOR[team],
    transparent: true,
    opacity: ZONE_OPACITY,
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}
/** 床から浮かせる量 (m)。床と重なってちらつかないように */
const RING_LIFT = 0.03
/** 消える時に薄くなっていく長さ (秒)。ぱっと消さない (本人 2026-10-20「グラデーションかかって消えて」) */
const FADE_SECONDS = 0.6

interface Entry {
  group: THREE.Group
  ring: THREE.Mesh | null
}

/** 薄くなりながら消えていく猫。材質は自分用に写して薄くする (形と材質は他の猫と共有なので) */
interface Fading {
  group: THREE.Group
  materials: THREE.Material[]
  left: number
}

export class Dolls {
  private readonly entries = new Map<number, Entry>()
  private readonly fading: Fading[] = []
  private readonly ringGeometry = new THREE.CircleGeometry(LURE_RADIUS, 48)
  private readonly ringMaterials: Record<Team, THREE.MeshBasicMaterial> = {
    blue: zoneMaterial('blue'),
    red: zoneMaterial('red'),
  }

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

  /** 置く。friendly (置いた本人か味方) なら効く範囲の円も出す (置いた人の陣営 team の色) */
  place(id: number, at: readonly number[], yaw: number, friendly: boolean, team: Team): void {
    if (this.entries.has(id)) return
    const group = new THREE.Group()
    group.position.set(at[0]!, at[1]!, at[2]!)
    let ring: THREE.Mesh | null = null
    if (friendly) {
      ring = new THREE.Mesh(this.ringGeometry, this.ringMaterials[team])
      ring.rotation.x = -Math.PI / 2
      ring.position.y = RING_LIFT
      ring.renderOrder = 1
      group.add(ring)
    }
    this.entries.set(id, { group, ring })
    this.scene.add(group)
    void loadDoll().then((gltf) => {
      if (this.entries.get(id)?.group !== group) return
      // 形と材質は共有のまま (消すときに dispose しない)
      const model = gltf.scene.clone(true)
      // 模型の正面は +Z。置いた本人のほうへ向ける (yaw は -Z 正面の向き)
      model.rotation.y = yaw + Math.PI
      castStaticShadow(model)
      group.add(model)
      refreshStaticShadows() // 置いた物は影マップに焼き直す
    })
  }

  /** 消す。**薄くなりながら** (FADE_SECONDS)。fade = false ならすぐ (試合の切れ目の片付け) */
  remove(id: number, fade = true): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    if (entry.ring) entry.group.remove(entry.ring)
    if (!fade) {
      this.scene.remove(entry.group)
      refreshStaticShadows()
      return
    }
    const materials: THREE.Material[] = []
    entry.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const copy = m.clone()
        copy.transparent = true
        materials.push(copy)
        return copy
      })
      mesh.material = Array.isArray(mesh.material) ? own : own[0]!
    })
    refreshStaticShadows()
    this.fading.push({ group: entry.group, materials, left: FADE_SECONDS })
  }

  /** 1 コマぶん。消えていく猫を薄くする */
  update(dt: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const item = this.fading[i]!
      item.left -= dt
      const opacity = Math.max(0, item.left / FADE_SECONDS)
      for (const m of item.materials) m.opacity = opacity
      if (item.left > 0) continue
      this.scene.remove(item.group)
      for (const m of item.materials) m.dispose()
      this.fading.splice(i, 1)
    }
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.remove(id, false)
    this.update(FADE_SECONDS)
  }
}
