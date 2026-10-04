import * as THREE from 'three'

import { TRIGGER_COS, TRIGGER_RANGE } from '../../../domain/item/claymore'
import type { PlaceSpot } from '../../../sim/judge/claymore'

/**
 * 置く物の予告。**どこに置かれて、どこまで見張るか。**
 *
 * 手榴弾の落下点 (grenades.ts の showPreview) と同じ役目。置く場所は足元の前と
 * 決まっていて狙う余地は無いが、**置けるかどうか**と**扇がどちらを向くか**は
 * 置く前に見えないと分からない。壁際では黙って弾かれる (sim/judge/claymore.ts の
 * canPlaceAt) ので、弾かれる所では赤い印だけを出して、押しても置く型に入らない
 * ことを先に伝える。
 *
 * 扇はクレイモアだけ。decoy は見張らないので印だけ。
 *
 * 数字はドメインから引く (TRIGGER_RANGE / TRIGGER_COS)。ここで別に持つと、
 * 見えている扇と実際に反応する扇が食い違う。
 */

/** 扇の弧を何本の線で描くか */
const ARC_STEPS = 24
/** 地面から浮かせる量 (m)。面と重なるとちらつく */
const LIFT = 0.03
/** 印の大きさ (m)。本体 (21.6 × 16.6cm) より少し大きい輪 */
const MARK_INNER = 0.11
const MARK_OUTER = 0.15

const OK_COLOR = 0xffd0a0
const NG_COLOR = 0xff5a4a

export class PlacePreview {
  private readonly mark: THREE.Mesh
  private readonly fan: THREE.Mesh
  private readonly rim: THREE.Line
  private readonly fanPoints: Float32Array
  private readonly rimPoints: Float32Array
  private readonly markMaterial: THREE.MeshBasicMaterial

  constructor(scene: THREE.Scene) {
    // 露出に左右されない。狙いを付けるための印なので明るさが変わっても読めてほしい
    this.markMaterial = new THREE.MeshBasicMaterial({
      color: OK_COLOR,
      transparent: true,
      opacity: 0.8,
      toneMapped: false,
      depthWrite: false,
      // **壁の中でも見せる。** 置けない時の印はたいてい壁の中に在る (そこが置く所
      // だから)。深さで消えると、置けない理由が画面に出ない
      depthTest: false,
      side: THREE.DoubleSide,
    })
    this.mark = new THREE.Mesh(new THREE.RingGeometry(MARK_INNER, MARK_OUTER, 24), this.markMaterial)
    this.mark.rotation.x = -Math.PI / 2
    this.mark.renderOrder = 10
    this.mark.visible = false
    this.mark.frustumCulled = false
    scene.add(this.mark)

    // 扇。中心 + 弧の点で三角を張る
    this.fanPoints = new Float32Array((ARC_STEPS + 2) * 3)
    const fanGeometry = new THREE.BufferGeometry()
    fanGeometry.setAttribute('position', new THREE.BufferAttribute(this.fanPoints, 3))
    const index: number[] = []
    for (let i = 1; i <= ARC_STEPS; i++) index.push(0, i, i + 1)
    fanGeometry.setIndex(index)
    this.fan = new THREE.Mesh(
      fanGeometry,
      new THREE.MeshBasicMaterial({
        color: OK_COLOR,
        transparent: true,
        opacity: 0.18,
        toneMapped: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.fan.visible = false
    this.fan.frustumCulled = false
    scene.add(this.fan)

    // 扇の縁。面だけだと端が読めない
    this.rimPoints = new Float32Array((ARC_STEPS + 3) * 3)
    const rimGeometry = new THREE.BufferGeometry()
    rimGeometry.setAttribute('position', new THREE.BufferAttribute(this.rimPoints, 3))
    this.rim = new THREE.Line(
      rimGeometry,
      new THREE.LineBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.7, toneMapped: false }),
    )
    this.rim.visible = false
    this.rim.frustumCulled = false
    scene.add(this.rim)
  }

  /**
   * 置く所を描く。
   *
   * @param spot placeSpot の結果。ok でなければ赤い印だけ
   * @param yaw 置く人の向き。クレイモアの正面はこれと同じ (server/arms/claymore.ts)
   * @param fan 扇を描くか (クレイモアだけ)
   */
  show(spot: PlaceSpot, yaw: number, fan: boolean): void {
    const y = spot.y + LIFT
    this.mark.position.set(spot.x, y, spot.z)
    this.markMaterial.color.setHex(spot.ok ? OK_COLOR : NG_COLOR)
    this.mark.visible = true

    if (!spot.ok || !fan) {
      this.fan.visible = false
      this.rim.visible = false
      return
    }
    // 正面から左右へ、反応する角度まで。cos から戻す (角度そのものは domain が持たない)
    const half = Math.acos(TRIGGER_COS)
    this.fanPoints[0] = spot.x
    this.fanPoints[1] = y
    this.fanPoints[2] = spot.z
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = yaw - half + (2 * half * i) / ARC_STEPS
      // yaw = θ のとき前方は (-sinθ, -cosθ) — hitcheck と同じ規約
      const x = spot.x - Math.sin(a) * TRIGGER_RANGE
      const z = spot.z - Math.cos(a) * TRIGGER_RANGE
      const at = (i + 1) * 3
      this.fanPoints[at] = x
      this.fanPoints[at + 1] = y
      this.fanPoints[at + 2] = z
      this.rimPoints[at] = x
      this.rimPoints[at + 1] = y
      this.rimPoints[at + 2] = z
    }
    // 縁は中心から出て弧を回って中心へ戻る
    this.rimPoints[0] = spot.x
    this.rimPoints[1] = y
    this.rimPoints[2] = spot.z
    const last = (ARC_STEPS + 2) * 3
    this.rimPoints[last] = spot.x
    this.rimPoints[last + 1] = y
    this.rimPoints[last + 2] = spot.z
    this.fan.geometry.attributes.position.needsUpdate = true
    this.rim.geometry.attributes.position.needsUpdate = true
    this.fan.visible = true
    this.rim.visible = true
  }

  hide(): void {
    this.mark.visible = false
    this.fan.visible = false
    this.rim.visible = false
  }
}
