import * as THREE from 'three'
import { findBoneBySuffix } from './animation'
import type { HitZone } from '../domain/damage'

/**
 * 当たり判定。ボーンに追従する球で表す。
 *
 * メッシュへの raycast をやめた理由が 3 つある。
 *
 *  1. 姿勢で頭の高さが変わることが、このゲームの中身そのものだから。足元からの
 *     高さで部位を決めていると、しゃがんだ相手 (頭 0.94m) の頭が「胴」の帯に入り、
 *     ヘッドショットが物理的に成立しなくなる。
 *  2. スキンメッシュの raycast は skeleton.boneMatrices を使うが、これは描画時に
 *     しか更新されない。ダンボールでキャラを隠すと更新が止まり、判定だけが
 *     過去の姿勢のまま取り残される。
 *  3. 1 体 13,000 頂点への raycast は、球 8 個の判定より桁違いに重い。
 *
 * サーバー権威に移すときも、この形 (ボーンに紐づく単純な形状) がそのまま
 * parry3d のカプセルに対応する。ここで作った境界はそのとき無駄にならない。
 */

export type { HitZone }

export interface HitboxHit {
  zone: HitZone
  /** 射線の起点からの距離 (m) */
  distance: number
}

/**
 * 頭の球の半径 (m)。
 *
 * 小さいほど技量が要るが、小さすぎると当たったように見えて外れる。
 * 頭の実寸 (幅 0.15m ほど) より気持ち大きく取って、見た目と結果を一致させる。
 */
const HEAD_RADIUS = 0.13
/**
 * 頭ボーンから球の中心までの距離 (m)。
 * 頭ボーンは首の付け根にあるので、そのままだと球が顎の位置に来る。
 */
const HEAD_OFFSET = 0.08

/** 胴と脚の太さ (m) */
const BODY_RADIUS = 0.20
const LEG_RADIUS = 0.16

/**
 * 胴・脚をいくつの球で表すか。
 *
 * 本来はカプセル (線分 + 半径) だが、球を重ねて並べても差は出ない。
 * 半径 0.2m の球を 4 個並べれば隙間なく繋がる。式が単純なぶん、
 * Rust 側へ移すときも読み替えを間違えにくい。
 */
const BODY_SEGMENTS = 4
const LEG_SEGMENTS = 3

/**
 * 1 人分の当たり判定。
 *
 * ボーンのワールド行列から毎回組み直す。姿勢が変われば判定も変わる、が要件なので
 * 位置を控えて使い回すことはしない (更新漏れがそのまま「当たらない」になる)。
 */
export class Hitbox {
  private head: THREE.Bone | null = null
  private neck: THREE.Bone | null = null
  private hips: THREE.Bone | null = null
  private foot: THREE.Bone | null = null
  private resolved = false

  private readonly headCenter = new THREE.Vector3()
  private readonly neckPos = new THREE.Vector3()
  private readonly hipsPos = new THREE.Vector3()
  private readonly footPos = new THREE.Vector3()
  private readonly sample = new THREE.Vector3()

  /**
   * 骨格を割り当てる。モデルが届いた時点で 1 回だけ呼ぶ。
   * @returns 必要なボーンが揃っていれば true
   */
  bind(root: THREE.Object3D): boolean {
    this.head = findBoneBySuffix(root, 'Head')
    this.neck = findBoneBySuffix(root, 'Neck')
    this.hips = findBoneBySuffix(root, 'Hips')
    this.foot = findBoneBySuffix(root, 'LeftFoot')
    this.resolved = !!(this.head && this.neck && this.hips && this.foot)
    if (!this.resolved) console.warn('[Hitbox] 判定に要るボーンが揃っていない')
    return this.resolved
  }

  /** 頭の中心 (ワールド)。カメラの注視点などにも使える */
  headPosition(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.head) return null
    out.setFromMatrixPosition(this.head.matrixWorld)
    out.y += HEAD_OFFSET
    return out
  }

  /**
   * 射線との交差を調べる。
   *
   * 呼ぶ前にワールド行列が更新されていること。頭を先に見るのは、頭と胴が
   * 重なる位置 (真上から撃つ場合など) で頭を優先したいため。
   *
   * @param dir 正規化済みの方向
   * @param maxDistance これより遠い交差は無視する。手前の地形で遮られている場合に渡す
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): HitboxHit | null {
    if (!this.resolved) return null

    let best: HitboxHit | null = null

    if (this.headPosition(this.headCenter)) {
      const t = raySphere(origin, dir, this.headCenter, HEAD_RADIUS, maxDistance)
      if (t !== null) best = { zone: 'HEAD', distance: t }
    }

    this.neckPos.setFromMatrixPosition(this.neck!.matrixWorld)
    this.hipsPos.setFromMatrixPosition(this.hips!.matrixWorld)
    this.footPos.setFromMatrixPosition(this.foot!.matrixWorld)

    const body = this.raySpheres(origin, dir, this.hipsPos, this.neckPos, BODY_RADIUS, BODY_SEGMENTS, maxDistance)
    if (body !== null && (!best || body < best.distance)) best = { zone: 'BODY', distance: body }

    const legs = this.raySpheres(origin, dir, this.footPos, this.hipsPos, LEG_RADIUS, LEG_SEGMENTS, maxDistance)
    if (legs !== null && (!best || legs < best.distance)) best = { zone: 'LEGS', distance: legs }

    return best
  }

  /** 2 点の間に球を並べて、最も手前の交差を返す */
  private raySpheres(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    segments: number,
    maxDistance: number,
  ): number | null {
    let nearest: number | null = null
    for (let i = 0; i < segments; i++) {
      const alpha = segments === 1 ? 0.5 : i / (segments - 1)
      this.sample.lerpVectors(from, to, alpha)
      const t = raySphere(origin, dir, this.sample, radius, maxDistance)
      if (t !== null && (nearest === null || t < nearest)) nearest = t
    }
    return nearest
  }
}

/**
 * 射線と球の交差。手前側の交点までの距離を返す。
 * 起点が球の内側にある場合は 0 を返す (至近距離で撃たれた場合)。
 */
function raySphere(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  maxDistance: number,
): number | null {
  const ox = center.x - origin.x
  const oy = center.y - origin.y
  const oz = center.z - origin.z

  // 球の中心を射線へ射影した位置
  const along = ox * dir.x + oy * dir.y + oz * dir.z
  const centerDistanceSq = ox * ox + oy * oy + oz * oz - along * along
  const radiusSq = radius * radius
  if (centerDistanceSq > radiusSq) return null

  const half = Math.sqrt(radiusSq - centerDistanceSq)
  const near = along - half
  if (near > maxDistance) return null
  if (near >= 0) return near
  // 起点が球の中にある
  return along + half >= 0 ? 0 : null
}
