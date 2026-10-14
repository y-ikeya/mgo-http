import * as THREE from 'three'
import type { CharacterAnimator } from './animation'

/**
 * 倒れる型の下がりを、模型をずらして出す。**壁があれば手前で止める。**
 *
 * 型は倒れながら 1〜2.3m 下がる (animation.ts の DEATH_SLIDE_CLIPS)。そのまま出すと、
 * 壁を背にしゃがんで正面から撃たれた体が壁にめり込む。倒れ始めた時に型の終わりまでの
 * 向きへ線を引き、当たった所 (体の厚みぶん手前) までで縮める (本人 2026-10-14)。
 *
 * 動かすのは模型だけ。体の位置 (判定・名札・カメラが見る所) はその場のまま。
 */

/** 体の向きの線が何 m 先で物に当たるか。当たらなければ max */
export type SlideBlocker = (origin: THREE.Vector3, dir: THREE.Vector3, max: number) => number

let blocker: SlideBlocker | null = null

/** 地形が届いたら Game が渡す。無い間は壁を見ずにそのまま下がる */
export function setSlideBlocker(fn: SlideBlocker | null): void {
  blocker = fn
}

/** 壁から離しておく量 (m)。倒れた体の厚みの半分 */
const BODY_RADIUS = 0.3
/** 線を引く高さ (m、足元から)。倒れていく腰の高さ */
const PROBE_HEIGHT = 0.5

export class DeathSlide {
  private clip: string | null = null
  /** 型の下がりのうち、出す割合 (0..1) */
  private fraction = 1
  private readonly offset = new THREE.Vector3()
  private readonly end = new THREE.Vector3()
  private readonly origin = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly turn = new THREE.Quaternion()

  /**
   * 型を流した後に毎コマ呼ぶ。
   *
   * @param object 体 (向き = yaw を持つ)
   * @param model 型を流している模型 (object の子)
   */
  update(animator: CharacterAnimator, object: THREE.Object3D, model: THREE.Object3D): void {
    const clip = animator.deathSlide(this.offset)
    if (!clip) {
      if (this.clip !== null) model.position.set(0, 0, 0)
      this.clip = null
      return
    }
    if (clip !== this.clip) {
      this.clip = clip
      this.fraction = 1
      animator.deathSlide(this.end, true)
      const length = this.end.length()
      if (blocker && length > 1e-3) {
        // 模型の空間 → 世界。模型は体の子で、体ごと回っている
        this.dir.copy(this.end).applyQuaternion(model.quaternion).applyQuaternion(object.getWorldQuaternion(this.turn)).normalize()
        object.getWorldPosition(this.origin)
        this.origin.y += PROBE_HEIGHT
        const free = blocker(this.origin, this.dir, length + BODY_RADIUS)
        this.fraction = THREE.MathUtils.clamp((free - BODY_RADIUS) / length, 0, 1)
      }
    }
    // 模型の空間の量を、体の空間 (模型の親) へ
    model.position.copy(this.offset).multiplyScalar(this.fraction).applyQuaternion(model.quaternion)
  }
}
