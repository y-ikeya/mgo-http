import * as THREE from 'three'
import { findBoneBySuffix } from './animation'
import type { HitZone } from '../../../domain/rule/damage'

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
 * 頭の球を、実際の頭より何割大きく取るか。
 *
 * 小さいほど技量が要るが、小さすぎると**当たったように見えて外れる**。
 * 見た目と結果を一致させるほうへ倒して、少しだけ大きく取る。
 */
const HEAD_MARGIN = 1.06

/**
 * 大きさと位置が測れなかったときの逃げ道 (m)。
 *
 * 骨だけは在ってメッシュが読めない、という形になったときでも判定は要る。
 * 頭ボーンから少し上に、頭ほどの球を置く。
 */
const HEAD_FALLBACK_RADIUS = 0.14
const HEAD_FALLBACK_OFFSET = 0.18

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

  /**
   * 頭の球の中心。**頭ボーンのローカル座標で持つ。**
   *
   * 世界の上方向へずらす形にしていて、**頭を実物の 10cm 下に置いていた** —
   * 実測すると頭のメッシュは 1.512〜1.793m なのに、球は 1.418〜1.678m。
   * 首を撃っても頭になり、頭のてっぺんは当たらない。
   *
   * 数字を手で置き直すのではなく、**読み込んだモデルから測る** (measureHead)。
   * 骨のローカルで持つので、見上げても倒れても頭に付いて回る — 世界の上へ
   * ずらす形だと、寝ている相手の球が体の上に浮く。
   */
  private readonly headLocal = new THREE.Vector3(0, HEAD_FALLBACK_OFFSET, 0)
  /** 頭の球の半径 (m)。**モデルから測る** (measureHead) */
  headRadius = HEAD_FALLBACK_RADIUS
  /** モデルから測れたか。測れなければ世界の上へずらす昔の形で動く */
  private measured = false

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
    if (this.head) this.measureHead(root, this.head)
    return this.resolved
  }

  /**
   * 頭の球の中心と大きさを、**モデルの頂点から測る**。読み込み時に 1 回だけ。
   *
   * 手で置いた数字 (頭ボーンから 0.08m 上、半径 0.13m) は 10cm 低く、頭の
   * てっぺんにも届いていなかった。モデルを差し替えたときに黙ってずれる形でも
   * あるので、**在る物から測る**。
   *
   * 頭に 5 割以上の重みが乗っている頂点だけを見る。首や肩に引っ張られた
   * 頂点を混ぜると、球が下へ伸びて首まで頭になる。
   *
   * 中心は**外接箱の真ん中**。頂点の重心だと、顔の細かい頂点が下に多いぶん
   * 引っ張られて、球が首まで落ちる (実測で 7cm 下がった)。
   *
   * 半径は外接箱の**一番長い辺の半分**。頭は縦長 (0.28 × 0.18 ほど) なので、
   * 縦を覆えば横は余る。余るほうへ倒すのは、足りないと**当たったように見えて
   * 外れる**から。
   */
  private measureHead(root: THREE.Object3D, head: THREE.Bone): void {
    let mesh: THREE.SkinnedMesh | null = null
    root.traverse((o) => {
      if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh
    })
    if (!mesh) return
    const skinned = mesh as THREE.SkinnedMesh
    // **名前で突き合わせる。** clone した骨格は別の実体になるので、
    // 同一性で引くと必ず外れる (実際に外れて、逃げ道の値のまま動いていた)
    const index = skinned.skeleton.bones.findIndex((b) => b.name === head.name)
    if (index < 0) {
      console.warn('[Hitbox] 頭のボーンが骨格に無い。頭の判定は逃げ道の値になる')
      return
    }

    const position = skinned.geometry.attributes.position
    const skinIndex = skinned.geometry.attributes.skinIndex
    const skinWeight = skinned.geometry.attributes.skinWeight
    if (!position || !skinIndex || !skinWeight) return

    root.updateMatrixWorld(true)
    const point = new THREE.Vector3()
    const bounds = new THREE.Box3()
    let found = 0
    for (let i = 0; i < position.count; i++) {
      let weight = 0
      for (let k = 0; k < 4; k++) {
        if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k)
      }
      if (weight < 0.5) continue
      // **生の position は使えない。** スキン前の空間なので、そのまま世界へ
      // 移すと 1/100 の大きさになる (実際に半径 2mm の球ができた)。
      // getVertexPosition が bind 行列と骨の行列を通したあとを返す
      skinned.getVertexPosition(i, point)
      skinned.localToWorld(point)
      // **骨のローカルで囲う。** 世界で囲って後から移すと、測ったときの姿勢と
      // 使うときの姿勢の差がそのままずれになる (実測で 6cm 落ちた)
      head.worldToLocal(point)
      bounds.expandByPoint(point)
      found++
    }
    if (found < 32) {
      console.warn(`[Hitbox] 頭の頂点が足りない (${found})。頭の判定は逃げ道の値になる`)
      return
    }

    const size = bounds.getSize(point)
    // 骨の尺度は 1/100 (Armature) なので、長さは世界の縮尺へ戻す
    const scale = new THREE.Vector3().setFromMatrixScale(head.matrixWorld).x || 1
    this.headRadius = (Math.max(size.x, size.y, size.z) / 2) * scale * HEAD_MARGIN
    bounds.getCenter(this.headLocal)
    this.measured = true
  }

  /** 頭の中心 (ワールド)。カメラの注視点などにも使える */
  headPosition(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.head) return null
    if (this.measured) return out.copy(this.headLocal).applyMatrix4(this.head.matrixWorld)
    // 測れなかったとき。**骨のローカルは使えない** (骨の尺度が 1/100 なので
    // そのまま乗せると 1.8mm しか上がらない)。世界の上へずらす
    out.setFromMatrixPosition(this.head.matrixWorld)
    out.y += HEAD_FALLBACK_OFFSET
    return out
  }

  /**
   * 射線との交差を調べる。
   *
   * 呼ぶ前にワールド行列が更新されていること。
   *
   * --- 頭に当たったら頭 ---
   * 「頭を先に見る」と書いてあったが、**実際は近いほうが勝つ形**だった。
   * 胴の球は首 (Neck) を中心に半径 0.20m あるので上端が 1.61m まで届き、
   * 頭の球 (1.42〜1.68m) の**下 15cm を食っていた**。後ろから撃つと、
   * 頭のボーンより 12cm 上 — 頭骨のてっぺん — でないと HEAD にならない。
   * うなじの上を撃っても胴、という形で出る。
   *
   * 重なった所は頭にする。**代償**は、胴を貫いた先に頭がある角度 (下から
   * 見上げて撃つ) で頭になること。弾は当たった所で止まるので厳密ではないが、
   * 「頭を撃ったのに胴になる」ほうが遊ぶ側から見て理不尽なので、そちらへ倒す。
   *
   * --- ただし首から下は頭にしない ---
   * 優先させただけだと逆に食い過ぎた。頭の球は下端が 1.416m で、**首のボーン
   * (1.412m) まで落ちている** — 首の下を撃っても頭になる。
   *
   * 球を小さくして重なりを消す手もあるが、それは**当たったように見えて外れる**
   * を増やす。判定は見た目より気持ち大きく、が元の方針 (HEAD_RADIUS)。
   * 代わりに**当たった点の高さ**で切る。首のボーンが体の上での境目そのもの
   * なので、姿勢が変わっても一緒に動く (しゃがんでも倒れても正しい所で切れる)。
   *
   * @param dir 正規化済みの方向
   * @param maxDistance これより遠い交差は無視する。手前の地形で遮られている場合に渡す
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): HitboxHit | null {
    if (!this.resolved) return null

    this.neckPos.setFromMatrixPosition(this.neck!.matrixWorld)
    this.hipsPos.setFromMatrixPosition(this.hips!.matrixWorld)

    if (this.headPosition(this.headCenter)) {
      const t = raySphere(origin, dir, this.headCenter, this.headRadius, maxDistance)
      // **当たった点が首より上なら頭。** 頭に当たったら胴に譲らない
      if (t !== null && origin.y + dir.y * t >= this.neckPos.y) {
        return { zone: 'HEAD', distance: t }
      }
    }

    this.footPos.setFromMatrixPosition(this.foot!.matrixWorld)

    // 頭でなければ、胴と脚は**近いほう**。あちらは重なっても意味が変わらない
    // (腰のあたりで胴と脚が重なるが、どちらを取っても威力の帯は隣り合っている)
    const body = this.raySpheres(origin, dir, this.hipsPos, this.neckPos, BODY_RADIUS, BODY_SEGMENTS, maxDistance)
    const legs = this.raySpheres(origin, dir, this.footPos, this.hipsPos, LEG_RADIUS, LEG_SEGMENTS, maxDistance)
    if (body === null && legs === null) return null
    if (legs === null || (body !== null && body <= legs)) {
      return { zone: 'BODY', distance: body! }
    }
    return { zone: 'LEGS', distance: legs }
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
