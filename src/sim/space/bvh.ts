/**
 * 三角の網と、それを速く引くための木 (BVH)。
 *
 * --- なぜ要るか ---
 * ステージの当たり判定は長らく**メッシュを包む直方体 1 個**だった。数字 8 個で
 * 表せてサーバー (three を積んでいない) がそのまま読めるからだが、**見えている
 * 形と当たる形が違う。** 斜めの手すりを包む箱は手すりの無い側の空間まで含むので、
 * 画面では当たっているのに木箱に遮られる、が起きる。
 *
 * 三角をそのまま持てば見た目と一致するが、素朴に全部試すと遅い。線分 1 本に
 * つき数千枚を、毎フレーム・人数ぶん見ることになる。
 *
 * --- 木にすると何が変わるか ---
 * 全部を包む箱を 1 つ作り、半分に割り、また割る。**親の箱は子を完全に包む**
 * ので、線が親に当たらなければ中の何にも当たり得ない — 枝を丸ごと捨てられる。
 * これは近似ではなく保証で、**答えは常に葉の三角が出す。**
 *
 * 粗い箱で答えを出す (いまの作り) のとは逆。あちらは置き換えなので答えが
 * 変わるが、こちらは捨てるためだけに使う。
 *
 * --- three に依存しない ---
 * サーバーがそのまま読む。数値の配列しか持たない。
 */

/**
 * 三角の網。**平らな配列で持つ。**
 *
 * 頂点をオブジェクトの配列で持つと、三角 1 枚につき 3 個・数千枚ぶんの
 * オブジェクトができる。読むのは起動時の 1 回だけだが、**触るのは毎フレーム**
 * なので、詰めて持つ。
 */
export interface TriangleMesh {
  /** 頂点。三角 1 枚につき 9 個 (x,y,z を 3 つ) */
  positions: Float32Array
}

/** 当たった所。**跳ね返りに要る** */
export interface SurfaceHit {
  /** 始点からの割合 (0..1) */
  t: number
  /** 面の向き。**線の来た側を向いている** */
  nx: number
  ny: number
  nz: number
}

/** 木の節点。葉なら三角を持ち、そうでなければ子を 2 つ持つ */
interface Node {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  /** 葉のとき。tris の中の範囲 */
  from: number
  count: number
  /** 節点のとき。子の索引 (nodes の中) */
  left: number
  right: number
}

/**
 * 葉に入れる三角の数。
 *
 * 少なくすると木が深くなって、箱を試す回数が増える。多くすると葉で総当たり
 * する枚数が増える。**4 前後がだいたいの底**で、そこから外れても効きは緩い。
 */
const LEAF_SIZE = 4

/** 線が三角に当たらないと見なす平行の閾値。**0 割りを避けるためだけ** */
const PARALLEL = 1e-9

export class TriangleBvh {
  private readonly positions: Float32Array
  /** 三角の索引。木を組むときに並べ替える (positions は動かさない) */
  private readonly tris: Uint32Array
  private readonly nodes: Node[] = []

  constructor(mesh: TriangleMesh) {
    this.positions = mesh.positions
    const count = Math.floor(mesh.positions.length / 9)
    this.tris = new Uint32Array(count)
    for (let i = 0; i < count; i++) this.tris[i] = i
    if (count > 0) this.build(0, count)
  }

  /** 三角の枚数 */
  get size(): number {
    return this.tris.length
  }

  /**
   * a から b へ線を引いて、**最初に当たった面**を返す。当たらなければ null。
   *
   * clear() と違って**どこで当たったかまで返す。** 跳ね返りには面の向き
   * (法線) が要るので、通るかどうかだけでは足りない。
   *
   * 法線は**線の来た側へ向けて返す。** 三角に表裏は無いものとして扱っている
   * ので (壁は片面しか無いことがある)、頂点の並びから出た向きが線と同じ側を
   * 向いていたら裏返す。裏返さないと、裏から当たった物が壁へ押し込まれる。
   */
  hit(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): SurfaceHit | null {
    if (this.nodes.length === 0) return null
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const found = this.nearest(0, ax, ay, az, dx, dy, dz, 1 / dx, 1 / dy, 1 / dz, null)
    return found
  }

  /** その枝の中で一番手前の当たりを探す */
  private nearest(
    at: number,
    ax: number,
    ay: number,
    az: number,
    dx: number,
    dy: number,
    dz: number,
    invX: number,
    invY: number,
    invZ: number,
    best: SurfaceHit | null,
  ): SurfaceHit | null {
    const node = this.nodes[at]!
    if (!segmentHitsBounds(node, ax, ay, az, invX, invY, invZ)) return best
    if (node.count > 0) {
      for (let i = node.from; i < node.from + node.count; i++) {
        const t = this.triangleDistance(this.tris[i]!, ax, ay, az, dx, dy, dz)
        if (t === null || (best && t >= best.t)) continue
        best = { t, ...this.normalOf(this.tris[i]!, dx, dy, dz) }
      }
      return best
    }
    best = this.nearest(node.left, ax, ay, az, dx, dy, dz, invX, invY, invZ, best)
    return this.nearest(node.right, ax, ay, az, dx, dy, dz, invX, invY, invZ, best)
  }

  /** その三角の面の向き。**線の来た側へ向ける** */
  private normalOf(
    tri: number,
    dx: number,
    dy: number,
    dz: number,
  ): { nx: number; ny: number; nz: number } {
    const p = this.positions
    const o = tri * 9
    const e1x = p[o + 3]! - p[o]!
    const e1y = p[o + 4]! - p[o + 1]!
    const e1z = p[o + 5]! - p[o + 2]!
    const e2x = p[o + 6]! - p[o]!
    const e2y = p[o + 7]! - p[o + 1]!
    const e2z = p[o + 8]! - p[o + 2]!
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    // 線と同じ側を向いていたら裏返す
    if (nx * dx + ny * dy + nz * dz > 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    return { nx, ny, nz }
  }

  /**
   * a から b へ線が通るか。**遮る三角が 1 枚でもあれば false。**
   *
   * どこで当たったかは返さない。遮蔽の判定に要るのは通るかどうかだけで、
   * 位置が要る場面 (カメラを壁の手前へ寄せる) は別に用意する。
   */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (this.nodes.length === 0) return true
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    // 箱を試すのに逆数を使う。**0 で割ると無限になるが、それで正しく働く**
    // (その軸に平行なら、範囲の内か外かだけで決まる)
    const invX = 1 / dx
    const invY = 1 / dy
    const invZ = 1 / dz
    return !this.hits(0, ax, ay, az, dx, dy, dz, invX, invY, invZ)
  }

  /** その枝の中に遮る三角があるか。**再帰で降りる** */
  private hits(
    at: number,
    ax: number,
    ay: number,
    az: number,
    dx: number,
    dy: number,
    dz: number,
    invX: number,
    invY: number,
    invZ: number,
  ): boolean {
    const node = this.nodes[at]!
    if (!segmentHitsBounds(node, ax, ay, az, invX, invY, invZ)) return false
    if (node.count > 0) {
      for (let i = node.from; i < node.from + node.count; i++) {
        if (this.hitsTriangle(this.tris[i]!, ax, ay, az, dx, dy, dz)) return true
      }
      return false
    }
    return (
      this.hits(node.left, ax, ay, az, dx, dy, dz, invX, invY, invZ) ||
      this.hits(node.right, ax, ay, az, dx, dy, dz, invX, invY, invZ)
    )
  }

  /** 線分がその三角を貫くか。通るかどうかだけ要るときの近道 */
  private hitsTriangle(
    tri: number,
    ax: number,
    ay: number,
    az: number,
    dx: number,
    dy: number,
    dz: number,
  ): boolean {
    return this.triangleDistance(tri, ax, ay, az, dx, dy, dz) !== null
  }

  /**
   * 線分がその三角を貫くなら、始点からの割合 (0..1) を返す。
   *
   * **表裏を区別しない。** 壁は片面しか無いことがあるので、裏から当てた弾が
   * 素通りすると「後ろから撃つと壁を抜ける」になる。
   */
  private triangleDistance(
    tri: number,
    ax: number,
    ay: number,
    az: number,
    dx: number,
    dy: number,
    dz: number,
  ): number | null {
    const p = this.positions
    const o = tri * 9
    const e1x = p[o + 3]! - p[o]!
    const e1y = p[o + 4]! - p[o + 1]!
    const e1z = p[o + 5]! - p[o + 2]!
    const e2x = p[o + 6]! - p[o]!
    const e2y = p[o + 7]! - p[o + 1]!
    const e2z = p[o + 8]! - p[o + 2]!

    const hx = dy * e2z - dz * e2y
    const hy = dz * e2x - dx * e2z
    const hz = dx * e2y - dy * e2x
    const det = e1x * hx + e1y * hy + e1z * hz
    if (det > -PARALLEL && det < PARALLEL) return null

    const inv = 1 / det
    const sx = ax - p[o]!
    const sy = ay - p[o + 1]!
    const sz = az - p[o + 2]!
    const u = inv * (sx * hx + sy * hy + sz * hz)
    if (u < 0 || u > 1) return null

    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const v = inv * (dx * qx + dy * qy + dz * qz)
    if (v < 0 || u + v > 1) return null

    // 線分の内側か。**外は当たらない** — 的の向こう側の壁で遮られたことにしない
    const t = inv * (e2x * qx + e2y * qy + e2z * qz)
    return t > PARALLEL && t < 1 ? t : null
  }

  /**
   * 木を組む。**一番長い軸の真ん中で割る。**
   *
   * 表面積で評価する組み方 (SAH) のほうが良い木になるが、組むのに時間がかかる。
   * ここは起動時に 1 回組むだけなので速さは要らない一方、**この規模では引く
   * 速さの差も小さい。** 素直な割り方から始める。
   */
  private build(from: number, count: number): number {
    const at = this.nodes.length
    const node: Node = {
      minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
      from, count, left: -1, right: -1,
    }
    this.nodes.push(node)

    for (let i = from; i < from + count; i++) {
      const o = this.tris[i]! * 9
      for (let v = 0; v < 3; v++) {
        const x = this.positions[o + v * 3]!
        const y = this.positions[o + v * 3 + 1]!
        const z = this.positions[o + v * 3 + 2]!
        if (x < node.minX) node.minX = x
        if (y < node.minY) node.minY = y
        if (z < node.minZ) node.minZ = z
        if (x > node.maxX) node.maxX = x
        if (y > node.maxY) node.maxY = y
        if (z > node.maxZ) node.maxZ = z
      }
    }

    if (count <= LEAF_SIZE) return at

    const spanX = node.maxX - node.minX
    const spanY = node.maxY - node.minY
    const spanZ = node.maxZ - node.minZ
    const axis = spanX >= spanY && spanX >= spanZ ? 0 : spanY >= spanZ ? 1 : 2
    const middle = (this.min(node, axis) + this.max(node, axis)) / 2

    // 真ん中より手前と奥に分ける
    let split = from
    for (let i = from; i < from + count; i++) {
      if (this.centre(this.tris[i]!, axis) < middle) {
        const swap = this.tris[i]!
        this.tris[i] = this.tris[split]!
        this.tris[split] = swap
        split++
      }
    }
    // **どちらかが空になったら真ん中で割る。** 同じ位置に固まっていると起きる
    if (split === from || split === from + count) split = from + (count >> 1)

    node.count = 0
    node.left = this.build(from, split - from)
    node.right = this.build(split, from + count - split)
    return at
  }

  private min(node: Node, axis: number): number {
    return axis === 0 ? node.minX : axis === 1 ? node.minY : node.minZ
  }

  private max(node: Node, axis: number): number {
    return axis === 0 ? node.maxX : axis === 1 ? node.maxY : node.maxZ
  }

  /** その三角の重心の、その軸の値 */
  private centre(tri: number, axis: number): number {
    const o = tri * 9 + axis
    return (this.positions[o]! + this.positions[o + 3]! + this.positions[o + 6]!) / 3
  }
}

/**
 * 線分がその箱に触れるか (slab)。
 *
 * **触れるかどうかだけ。** 木を降りるかを決めるのに使うので、どこで触れたかは
 * 要らない。
 */
function segmentHitsBounds(
  node: Node,
  ax: number,
  ay: number,
  az: number,
  invX: number,
  invY: number,
  invZ: number,
): boolean {
  let near = 0
  let far = 1

  let t1 = (node.minX - ax) * invX
  let t2 = (node.maxX - ax) * invX
  if (t1 > t2) [t1, t2] = [t2, t1]
  if (t1 > near) near = t1
  if (t2 < far) far = t2
  if (near > far) return false

  t1 = (node.minY - ay) * invY
  t2 = (node.maxY - ay) * invY
  if (t1 > t2) [t1, t2] = [t2, t1]
  if (t1 > near) near = t1
  if (t2 < far) far = t2
  if (near > far) return false

  t1 = (node.minZ - az) * invZ
  t2 = (node.maxZ - az) * invZ
  if (t1 > t2) [t1, t2] = [t2, t1]
  if (t1 > near) near = t1
  if (t2 < far) far = t2
  return near <= far
}
