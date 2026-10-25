import * as THREE from 'three'
import { castMovingShadow } from './liveShadow'

import { loadTarget } from '../assets'

/**
 * TSNE のターゲット (人形) の見た目。**位置と誰が運んでいるかはサーバーが決める** (server/target.ts)。
 *
 *     置いてある / 落ちている   その場で 1m 浮いて、ゆっくり回る
 *     運ばれている             運ぶ人の頭の少し上に浮く — 守る側には運ぶ人の場所が分かる
 *     どちらの画面でも         **いつも光って見える (壁越しでも)**。光りは攻める側の色
 *                              (2026-10-25 本人「offence にも発光して見えていい、色は攻める側のチーム」)
 *
 * 光りは人形を少し大きくした写しで、深さを見ずに最後に描く (壁の手前に透けて出る)。
 */

/** 運ばれている時、足元からどれだけ上に浮かせるか (m)。立った人の頭 (1.7m) の少し上 */
const CARRY_HEIGHT = 2.0
/** 置いてある / 落ちている時に浮かせる高さ (m)。地面に転がすより目に付く (本人 2026-10-20) */
const REST_HEIGHT = 1.0
/** 回る速さ (rad/秒)。ゆっくり — 置いてあることが遠目に分かる程度 */
const SPIN = 0.9
/**
 * 光りの濃さ。0.45 では光りすぎて、ターゲットが何の形かが見えなかった (2026-10-25 本人)
 */
const GLOW_OPACITY = 0.2
/** 位置の追いかけ (1/秒)。配られる位置は飛び飛びなので、滑らかに寄せる */
const FOLLOW = 12

export interface TargetView {
  x: number
  y: number
  z: number
  carrier: string | null
}

export class TsneTarget {
  readonly object = new THREE.Group()
  private readonly glow = new THREE.Group()
  private spin = 0
  private placed = false
  /** 光りの材質 (読み込み後に作る)。色は攻める側で変わる */
  private glowMaterial: THREE.MeshBasicMaterial | null = null
  private glowColor = 0xffffff

  constructor(scene: THREE.Scene) {
    this.object.visible = false
    scene.add(this.object)
    void loadTarget().then((gltf) => {
      const model = gltf.scene.clone(true)
      castMovingShadow(model)
      this.object.add(model)
      // 光り。同じ形を少し大きくして、深さを見ずに最後に描く
      const halo = gltf.scene.clone(true)
      const material = this.glowMaterial = new THREE.MeshBasicMaterial({
        color: this.glowColor,
        transparent: true,
        opacity: GLOW_OPACITY,
        depthTest: false,
        depthWrite: false,
      })
      halo.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.material = material
        mesh.renderOrder = 999
      })
      halo.scale.setScalar(1.06)
      this.glow.add(halo)
      this.glow.visible = false
      this.object.add(this.glow)
    })
  }

  /**
   * 1 コマぶん。view はサーバーから届いた状態 (無ければ隠す)。carrierAt は運ぶ人の足元
   * (手元で見えていればその位置、見えていなければ届いた位置)。glow は光りの色 (攻める側の色)、
   * 光らせないなら null
   */
  update(dt: number, view: TargetView | null, carrierAt: THREE.Vector3 | null, glow: number | null): void {
    if (!view) {
      this.object.visible = false
      this.placed = false
      return
    }
    this.object.visible = true
    this.glow.visible = glow !== null
    if (glow !== null && glow !== this.glowColor) {
      this.glowColor = glow
      this.glowMaterial?.color.setHex(glow)
    }
    const x = carrierAt ? carrierAt.x : view.x
    const z = carrierAt ? carrierAt.z : view.z
    const y = (carrierAt ? carrierAt.y : view.y) + (view.carrier ? CARRY_HEIGHT : REST_HEIGHT)
    if (!this.placed) {
      this.object.position.set(x, y, z)
      this.placed = true
    } else {
      const k = 1 - Math.exp(-FOLLOW * dt)
      this.object.position.x += (x - this.object.position.x) * k
      this.object.position.y += (y - this.object.position.y) * k
      this.object.position.z += (z - this.object.position.z) * k
    }
    this.spin += SPIN * dt
    this.object.rotation.y = this.spin
  }
}
