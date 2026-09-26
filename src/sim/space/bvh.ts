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
  /**
   * 三角 1 枚ごとの材質の番号。**足音と着弾に要る。**
   *
   * 箱で持っていた頃は Obstacle.surface が持っていた。三角へ移すときに
   * 一緒に連れて来ないと、**木の床から石の音**が鳴る。
   */
  surfaces?: Uint8Array
}

/** 押し出す向きと深さ。**球が食い込んだときに返る** */
export interface Contact {
  /** 押し出す向き (正規化済み) */
  nx: number
  ny: number
  nz: number
  /** どれだけ食い込んでいるか (m) */
  depth: number
}

/** 当たった所。**跳ね返りに要る** */
export interface SurfaceHit {
  /** 始点からの割合 (0..1) */
  t: number
  /** 面の向き。**線の来た側を向いている** */
  nx: number
  ny: number
  nz: number
  /** 当たった三角の番号。材質を引くのに使う (TriangleMesh.surfaces) */
  tri: number
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

/** segmentVisible の作業場。扇 (目と線分) と、集めた隠れる区間 */
interface Wedge {
  ex: number; ey: number; ez: number
  nX: number; nY: number; nZ: number
  aX: number; aY: number; aZ: number
  bX: number; bY: number; bZ: number
  aa: number; ab: number; bb: number
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  /**
   * 扇の 3 辺の外側を向く面 (平面の中で辺に直交する法線と、その辺の上の 1 点)。
   * 箱がどれか 1 つの面の外側に丸ごと在れば、扇に触れていない。
   */
  edges: { nx: number; ny: number; nz: number; px: number; py: number; pz: number }[]
  /** 隠れる区間 [lo, hi] の並び (平坦に 2 つずつ) */
  hidden: number[]
}

/**
 * 線分 [0, 1] を覆い切っているか。
 *
 * これより細い見え方は「見えていない」と扱う (数値の縁で瞬かないように)。
 * 立った体 1.6m なら 3mm。
 */
const VISIBLE_SLIVER = 0.002

function covers(hidden: number[]): boolean {
  const n = hidden.length / 2
  if (n === 0) return false
  const order: number[] = []
  for (let i = 0; i < n; i++) order.push(i)
  order.sort((i, j) => hidden[i * 2]! - hidden[j * 2]!)
  let reach = 0
  for (const i of order) {
    const lo = hidden[i * 2]!
    const hi = hidden[i * 2 + 1]!
    if (lo > reach + VISIBLE_SLIVER) return false
    if (hi > reach) reach = hi
  }
  return reach >= 1 - VISIBLE_SLIVER
}

/** 線が三角に当たらないと見なす平行の閾値。**0 割りを避けるためだけ** */
const PARALLEL = 1e-9

export class TriangleBvh {
  private readonly positions: Float32Array
  private readonly surfaces: Uint8Array | null
  /** 三角の索引。木を組むときに並べ替える (positions は動かさない) */
  private readonly tris: Uint32Array
  private readonly nodes: Node[] = []

  constructor(mesh: TriangleMesh) {
    this.positions = mesh.positions
    this.surfaces = mesh.surfaces ?? null
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
        best = { t, tri: this.tris[i]!, ...this.normalOf(this.tris[i]!, dx, dy, dz) }
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

  /** その三角の材質の番号。持っていなければ null */
  surfaceOf(tri: number): number | null {
    return this.surfaces ? (this.surfaces[tri] ?? null) : null
  }

  /**
   * 球に食い込んでいる三角を訪ねる。
   *
   * --- なぜ線では足りないか ---
   * 線は**点が通るか**しか答えない。人は太さを持っていて、壁に埋まったら
   * 外へ押し出す必要がある。押し出す向きと深さは「球の中心に一番近い面の点」
   * から出るので、面までの距離が要る。
   *
   * 箱でやっていた頃 (resolveCircle) は、四角の一番近い辺へ押していた。
   * 同じことを三角に対してやる。
   *
   * @param visit 食い込むたびに呼ばれる。**押し出す量は呼ぶ側が決める** —
   *   壁と床で扱いが違う (床に押し戻されると坂を登れない)
   */
  touching(
    x: number,
    y: number,
    z: number,
    radius: number,
    visit: (contact: Contact, tri: number) => void,
  ): void {
    if (this.nodes.length === 0) return
    this.sphere(0, x, y, z, radius, radius * radius, visit)
  }

  private sphere(
    at: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    radiusSq: number,
    visit: (contact: Contact, tri: number) => void,
  ): void {
    const node = this.nodes[at]!
    if (!sphereHitsBounds(node, x, y, z, radius)) return
    if (node.count > 0) {
      for (let i = node.from; i < node.from + node.count; i++) {
        const tri = this.tris[i]!
        const contact = this.contactWith(tri, x, y, z, radiusSq)
        if (contact) visit(contact, tri)
      }
      return
    }
    this.sphere(node.left, x, y, z, radius, radiusSq, visit)
    this.sphere(node.right, x, y, z, radius, radiusSq, visit)
  }

  /**
   * 球とその三角の当たり。**面の上の一番近い点から向きを出す。**
   *
   * 面の向き (法線) をそのまま使わないのは、角や辺に触れたときに嘘になるから。
   * 面の内側で触れていれば法線と一致し、辺に触れていれば辺から外向きになる —
   * どちらも「一番近い点から中心へ」で表せる。
   */
  private contactWith(
    tri: number,
    x: number,
    y: number,
    z: number,
    radiusSq: number,
  ): Contact | null {
    const p = this.positions
    const o = tri * 9
    const [cx, cy, cz] = closestOnTriangle(
      x, y, z,
      p[o]!, p[o + 1]!, p[o + 2]!,
      p[o + 3]!, p[o + 4]!, p[o + 5]!,
      p[o + 6]!, p[o + 7]!, p[o + 8]!,
    )
    const dx = x - cx
    const dy = y - cy
    const dz = z - cz
    const distSq = dx * dx + dy * dy + dz * dz
    /*
     * **数でなければ触れていない。** 面積の無い三角 (3 点が一直線) は最寄り点の
     * 計算が 0 で割って NaN になる。`>=` で見ると NaN が素通りして、押し戻す量が
     * NaN になり位置ごと壊れた (画面が真っ暗、サーバーは「数でない座標」で却下)。
     * 書き出しでも捨てているが、ここでも通さない
     */
    if (!(distSq < radiusSq)) return null
    const dist = Math.sqrt(distSq)
    // 面の上にちょうど乗っている。**向きが出せないので面の法線へ逃がす**
    if (dist < PARALLEL) {
      const n = this.normalOf(tri, 0, -1, 0)
      if (!Number.isFinite(n.nx) || !Number.isFinite(n.ny) || !Number.isFinite(n.nz)) return null
      return { nx: n.nx, ny: n.ny, nz: n.nz, depth: Math.sqrt(radiusSq) }
    }
    return {
      nx: dx / dist,
      ny: dy / dist,
      nz: dz / dist,
      depth: Math.sqrt(radiusSq) - dist,
    }
  }

  /**
   * a から b へ線が通るか。**遮る三角が 1 枚でもあれば false。**
   *
   * どこで当たったかは返さない。遮蔽の判定に要るのは通るかどうかだけで、
   * 位置が要る場面 (カメラを壁の手前へ寄せる) は別に用意する。
   */
  /**
   * 目 E から線分 AB の**どこかが見えているか**。
   *
   * --- 点ではなく線分で見る ---
   * 体の上の何点かへ光線を引く形だと、点の間隔より細い隙間から見えている体を
   * 取りこぼす — 相手が急に現れたり消えたりする。線分にすれば間隔という物が
   * 無くなり、隙間の細さに関係なく厳密になる。
   *
   * --- どう解くか ---
   * E と A と B の作る三角形 (扇) を遮る三角ごとに、**線分のどの区間を隠すか**
   * を出して集める。区間の和が線分 [0, 1] を覆い切っていなければ見えている。
   *
   * 扇の平面で遮る三角を切ると線分 Q1Q2 になる。平面の中の点 Q は
   * E + s·(A + t·(B−A) − E) と書けて、s < 1 なら AB より手前、t が AB の上の
   * 位置。Q1Q2 を手前 (0 < s < 1) に切り詰めてから両端の t を取れば、その間が
   * 隠れる区間 (透視の射影は線分の上で単調なので、両端だけで足りる)。
   *
   * 木の枝は扇の外接箱で捨てるので、費用は光線 1 本と同じ桁。
   */
  segmentVisible(
    ex: number, ey: number, ez: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): boolean {
    if (this.nodes.length === 0) return true
    // 平面の基底: a = A − E, b = B − A。法線 n = a × (B − E)
    const aX = ax - ex, aY = ay - ey, aZ = az - ez
    const bX = bx - ax, bY = by - ay, bZ = bz - az
    const vX = bx - ex, vY = by - ey, vZ = bz - ez
    const nX = aY * vZ - aZ * vY
    const nY = aZ * vX - aX * vZ
    const nZ = aX * vY - aY * vX
    const nLen = Math.hypot(nX, nY, nZ)
    // 目が線分の延長線上に居る (扇が潰れている)。線 1 本で見る
    if (nLen < 1e-9) return this.clear(ex, ey, ez, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
    const wedge: Wedge = {
      ex, ey, ez,
      nX: nX / nLen, nY: nY / nLen, nZ: nZ / nLen,
      aX, aY, aZ, bX, bY, bZ,
      aa: aX * aX + aY * aY + aZ * aZ,
      ab: aX * bX + aY * bY + aZ * bZ,
      bb: bX * bX + bY * bY + bZ * bZ,
      minX: Math.min(ex, ax, bx), minY: Math.min(ey, ay, by), minZ: Math.min(ez, az, bz),
      maxX: Math.max(ex, ax, bx), maxY: Math.max(ey, ay, by), maxZ: Math.max(ez, az, bz),
      edges: [],
      hidden: [],
    }
    // 3 辺の外向きの面。辺 × 法線 が平面の中で辺に直交する向き。向きは 3 つ目の頂点で正す
    const corners: [number, number, number][] = [[ex, ey, ez], [ax, ay, az], [bx, by, bz]]
    for (let i = 0; i < 3; i++) {
      const [px, py, pz] = corners[i]!
      const [qx, qy, qz] = corners[(i + 1) % 3]!
      const [ox, oy, oz] = corners[(i + 2) % 3]!
      const eX = qx - px, eY = qy - py, eZ = qz - pz
      let mx = eY * wedge.nZ - eZ * wedge.nY
      let my = eZ * wedge.nX - eX * wedge.nZ
      let mz = eX * wedge.nY - eY * wedge.nX
      // 残りの頂点が内側 (負) になるように
      if ((ox - px) * mx + (oy - py) * my + (oz - pz) * mz > 0) { mx = -mx; my = -my; mz = -mz }
      wedge.edges.push({ nx: mx, ny: my, nz: mz, px, py, pz })
    }
    this.shade(0, wedge)
    return !covers(wedge.hidden)
  }

  private shade(at: number, w: Wedge): void {
    const node = this.nodes[at]!
    if (
      node.maxX < w.minX || node.minX > w.maxX ||
      node.maxY < w.minY || node.minY > w.maxY ||
      node.maxZ < w.minZ || node.minZ > w.maxZ
    ) {
      return
    }
    /*
     * **扇の平面の片側に丸ごと在る枝は捨てる。**
     *
     * 扇は細長いので外接箱だけで刈ると、遠くの相手へ引いた扇が地図の大半の枝に
     * 触れて、1 組 0.8ms かかった。平面は薄いので、箱の中心の平面からの距離が
     * 箱の半径 (法線方向の射影) を超えていれば、その枝の三角は平面と交わらない。
     */
    const cx = (node.minX + node.maxX) / 2 - w.ex
    const cy = (node.minY + node.maxY) / 2 - w.ey
    const cz = (node.minZ + node.maxZ) / 2 - w.ez
    const reach =
      Math.abs(w.nX) * (node.maxX - node.minX) / 2 +
      Math.abs(w.nY) * (node.maxY - node.minY) / 2 +
      Math.abs(w.nZ) * (node.maxZ - node.minZ) / 2
    if (Math.abs(cx * w.nX + cy * w.nY + cz * w.nZ) > reach) return
    // 扇の 3 辺の外側に丸ごと在る枝も捨てる。細長い扇の帯の大半はここで落ちる
    for (const e of w.edges) {
      const dc = ((node.minX + node.maxX) / 2 - e.px) * e.nx + ((node.minY + node.maxY) / 2 - e.py) * e.ny + ((node.minZ + node.maxZ) / 2 - e.pz) * e.nz
      const r =
        Math.abs(e.nx) * (node.maxX - node.minX) / 2 +
        Math.abs(e.ny) * (node.maxY - node.minY) / 2 +
        Math.abs(e.nz) * (node.maxZ - node.minZ) / 2
      if (dc > r) return
    }
    if (node.count > 0) {
      for (let i = node.from; i < node.from + node.count; i++) this.shadeTriangle(this.tris[i]!, w)
      return
    }
    this.shade(node.left, w)
    this.shade(node.right, w)
  }

  /** 三角 1 枚が扇の平面と交わる線分を取り、線分 AB の隠れる区間を足す */
  private shadeTriangle(tri: number, w: Wedge): void {
    const p = this.positions
    const o = tri * 9
    // 各頂点の、平面からの符号付き距離
    const d0 = (p[o]! - w.ex) * w.nX + (p[o + 1]! - w.ey) * w.nY + (p[o + 2]! - w.ez) * w.nZ
    const d1 = (p[o + 3]! - w.ex) * w.nX + (p[o + 4]! - w.ey) * w.nY + (p[o + 5]! - w.ez) * w.nZ
    const d2 = (p[o + 6]! - w.ex) * w.nX + (p[o + 7]! - w.ey) * w.nY + (p[o + 8]! - w.ez) * w.nZ
    const s0 = d0 > 0, s1 = d1 > 0, s2 = d2 > 0
    if (s0 === s1 && s1 === s2) return
    // 符号の変わる辺 2 本で、平面との交点を取る
    const q: number[] = []
    const cross = (i: number, j: number, di: number, dj: number) => {
      const f = di / (di - dj)
      q.push(
        p[o + i * 3]! + (p[o + j * 3]! - p[o + i * 3]!) * f,
        p[o + i * 3 + 1]! + (p[o + j * 3 + 1]! - p[o + i * 3 + 1]!) * f,
        p[o + i * 3 + 2]! + (p[o + j * 3 + 2]! - p[o + i * 3 + 2]!) * f,
      )
    }
    if (s0 !== s1) cross(0, 1, d0, d1)
    if (s1 !== s2) cross(1, 2, d1, d2)
    if (s2 !== s0) cross(2, 0, d2, d0)
    if (q.length < 6) return

    // 平面の中の座標 (s, st) へ。d = s·a + st·b を a·, b· との内積で解く
    const det = w.aa * w.bb - w.ab * w.ab
    if (Math.abs(det) < 1e-12) return
    const solve = (x: number, y: number, z: number): [number, number] => {
      const dx = x - w.ex, dy = y - w.ey, dz = z - w.ez
      const da = dx * w.aX + dy * w.aY + dz * w.aZ
      const db = dx * w.bX + dy * w.bY + dz * w.bZ
      return [(da * w.bb - db * w.ab) / det, (w.aa * db - w.ab * da) / det]
    }
    let [sA, tA] = solve(q[0]!, q[1]!, q[2]!)
    let [sB, tB] = solve(q[3]!, q[4]!, q[5]!)
    // 手前 (0 < s < 1) に切り詰める。s は線分の上で線形
    const LOW = 1e-4, HIGH = 1 - 1e-4
    if ((sA <= LOW && sB <= LOW) || (sA >= HIGH && sB >= HIGH)) return
    const clip = (sFrom: number, tFrom: number, sTo: number, tTo: number, bound: number): [number, number] => {
      const f = (bound - sFrom) / (sTo - sFrom)
      return [bound, tFrom + (tTo - tFrom) * f]
    }
    if (sA < LOW) [sA, tA] = clip(sA, tA, sB, tB, LOW)
    else if (sA > HIGH) [sA, tA] = clip(sA, tA, sB, tB, HIGH)
    if (sB < LOW) [sB, tB] = clip(sB, tB, sA, tA, LOW)
    else if (sB > HIGH) [sB, tB] = clip(sB, tB, sA, tA, HIGH)
    // t = st / s。両端の間が隠れる
    const t0 = tA / sA
    const t1 = tB / sB
    const lo = Math.max(0, Math.min(t0, t1))
    const hi = Math.min(1, Math.max(t0, t1))
    if (hi <= lo) return
    w.hidden.push(lo, hi)
  }

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

/** 球がその箱に届くか。**枝を捨てるためだけ** (近似ではなく保証) */
function sphereHitsBounds(
  node: Node,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  const dx = x - clampTo(x, node.minX, node.maxX)
  const dy = y - clampTo(y, node.minY, node.maxY)
  const dz = z - clampTo(z, node.minZ, node.maxZ)
  return dx * dx + dy * dy + dz * dz < radius * radius
}

function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/**
 * 三角の上で、その点に一番近い所。
 *
 * 面の内側なら垂線の足、辺の外なら辺の上、角の外なら角そのもの。
 * 重心座標の符号で 7 つの領域に分けて決める (Ericson の手順)。
 *
 * **押し出す向きはここから出る。** 面の法線をそのまま使うと、角に触れた
 * ときに面の裏側へ押し出してしまう。
 */
function closestOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az

  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az]

  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz]

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [ax + abx * v, ay + aby * v, az + abz * v]
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz]

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [ax + acx * w, ay + acy * w, az + acz * w]
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w]
  }

  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w]
}
