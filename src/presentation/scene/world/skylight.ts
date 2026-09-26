import * as THREE from 'three'
import type { TriangleBvh } from '../../../sim/space/bvh'

/**
 * **その場所からどれだけ空が見えるか。** 人の明るさに掛ける。
 *
 * 地形は「空の見え方」を頂点に焼いてある (tools/bake_stage.py) ので、建物の奥は
 * 暗い。人には焼けない (動くので) から、居る場所で毎コマ測る。焼き方と同じ考え
 * — 上半球へ光線を飛ばして、遮られなかった割合。真上を厚く見る (空は上に広い)。
 *
 * 測るのは体の真ん中 (足元 + SKY_PROBE_HEIGHT)。足元だと床に潜って全部遮られる。
 */

/** 一番暗い所の明るさ。地形の焼き込み (bake_stage.py の FLOOR) と揃える */
export const SKY_FLOOR = 0.3
/** 足元から測る点までの高さ (m) */
export const SKY_PROBE_HEIGHT = 1.0
/** 光線の長さ (m)。建物の屋根を抜けて空まで届けば十分 */
const REACH = 60
/** 場所が変わったときに明るさが追いつく速さ (1/s)。戸口で明滅させない */
const FOLLOW_RATE = 6

// 真上と、斜め 45 度を 8 方向。地面の焼き方 (stage.ts の bakeGroundSky) と同じ
const RAYS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0],
  ...Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2
    return [Math.cos(angle) * 0.7, 0.7, Math.sin(angle) * 0.7] as const
  }),
]
const WEIGHT = RAYS.reduce((sum, r) => sum + r[1], 0)

/** 空の見え方 (SKY_FLOOR〜1)。sight は視線を止める三角の網 (Stage.sightWorld) */
export function skyAt(sight: TriangleBvh, x: number, y: number, z: number): number {
  let open = 0
  for (const [dx, dy, dz] of RAYS) {
    if (sight.clear(x, y, z, x + dx * REACH, y + dy * REACH, z + dz * REACH)) open += dy
  }
  return SKY_FLOOR + (1 - SKY_FLOOR) * (open / WEIGHT)
}

/**
 * 人の明るさ。**材質の色に掛ける**ので、材質は人ごとの複製であること。
 *
 * 元の色は最初に控えて、毎回そこから掛け直す (掛けた物にまた掛けると消える)。
 */
export class SkyLight {
  private value = 1
  private readonly materials: THREE.MeshStandardMaterial[] = []

  /** 掛ける相手。色を持つ材質だけ */
  add(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial)) return
    if (!material.userData.baseColor) material.userData.baseColor = material.color.clone()
    this.materials.push(material)
  }

  /** 目標へ寄せて掛ける。dt は秒 */
  follow(target: number, dt: number): void {
    this.value += (target - this.value) * Math.min(1, dt * FOLLOW_RATE)
    for (const material of this.materials) {
      material.color.copy(material.userData.baseColor as THREE.Color).multiplyScalar(this.value)
    }
  }
}
