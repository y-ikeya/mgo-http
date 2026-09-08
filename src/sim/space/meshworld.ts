/**
 * 三角の網の上を歩く。**箱で持っていた当たり判定を面へ移す。**
 *
 * --- なぜ移すか ---
 * 箱 (collision.ts の Obstacle) は XZ の四角 + 上面の平面で、**軸に沿った物しか
 * 表せない。** 斜めに置いた壁は回す前の箱になり、アーチはくぐれず、坂は
 * 0.25m 刻みの段を積むしかなかった。ステージを作るたびにこの形へ合わせて
 * いたので、**縛っていたのは判定のほう**だった。
 *
 * 面をそのまま持てばその縛りが消える。見えている形と当たる形も一致する。
 *
 * --- 口は変えない ---
 * movement.ts の MoveWorld は 3 つのメソッドしか無く、箱かどうかを知らない。
 * 段差 (STEP_UP) も接地の吸い付き (GROUND_SNAP) も向こう側にあるので、
 * ここで書くのは「押し戻す・足が着く高さ・頭がぶつかる高さ」の 3 つだけ。
 *
 * --- 何を三角にしないか ---
 * 手すりのように**絵として細かく、ぶつかる形は単純**な物は、書き出しの側で
 * 向き付きの箱 12 枚に置き換えてある (export_stage.py の PLAYER_TRI_LIMIT)。
 * そのままだと手すりだけで 72 万枚になり、配れない。
 */

import type { MoveWorld } from './movement'
import type { Vec3 } from './collision'
import { TriangleBvh } from './bvh'

/**
 * 押し戻しを何回まで繰り返すか。
 *
 * 1 回では角で足りない。押し出した先がまた別の面に食い込むことがあるので、
 * 落ち着くまで繰り返す。箱のときと同じ理由・同じ回数。
 */
const ITERATIONS = 4

/**
 * 立てる面の傾き。**これより急なら壁として押し返す。**
 *
 * 法線の Y 成分で見る (1 = 真上を向いた床、0 = 垂直の壁)。0.5 はおよそ 60°。
 *
 * ここで分けないと、**坂に押し返されて登れない。** 坂は水平に押されると
 * 進めないので、押し戻しからは外して足元 (groundHeight) に任せる。
 */
const WALKABLE_Y = 0.5

/**
 * 体を何段の球で見るか。
 *
 * 1 つだと、腰の高さの手すりをまたいだり、頭の高さの梁をすり抜けたりする。
 * 足元・腰・胸の 3 段で、円柱を粗く近似する。**段を増やすほど正しいが、
 * そのぶん引く回数が増える** — 3 段で毎フレーム 3 回。
 */
const BODY_SLICES: number = 3

/**
 * 坂の急さを測る点の数。**上り切る所で引っかからないために要る。**
 *
 * 体の周りをなぞって、中心より高い所を探す。詳しくは resolveHorizontal。
 */
const SLOPE_SAMPLES = 4

/** 足元を探すときに、どれだけ上から線を下ろすか (m) */
const PROBE_UP = 0.6

/** 足元を探す線の長さ (m)。これより下に何も無ければ 0 (水面 / 地面) */
const PROBE_DOWN = 40

/**
 * 足が着く高さを、体の周りの何点で見るか。
 *
 * 中心だけだと、**縁に立ったときに落ちる。** 箱のときは四角の重なりで見て
 * いたので、円周を数点でなぞって一番高い所を採る。
 */
const GROUND_SAMPLES = 5

export interface MeshWorldOptions {
  /** 体の高さ (m)。頭がぶつかる位置を決める */
  height: number
  /** 乗り越えられる段差 (m)。これ以下の出っ張りは押し返さない */
  stepUp: number
}

export class MeshMoveWorld implements MoveWorld {
  private readonly solid: TriangleBvh
  private readonly height: number
  private readonly stepUp: number

  constructor(solid: TriangleBvh, options: MeshWorldOptions) {
    this.solid = solid
    this.height = options.height
    this.stepUp = options.stepUp
  }

  /**
   * 壁の外へ押し戻す。**床と坂には押し返させない。**
   *
   * 体を 3 段の球で見て、食い込んだぶんだけ外へ出す。上下には動かさない —
   * 高さを決めるのは groundHeight の仕事で、ここで持ち上げると壁に触れた
   * 瞬間に体が浮く。
   */
  resolveHorizontal(position: Vec3, radius: number, feetY: number): void {
    /*
     * **体の下端を段差の上に置く。**
     *
     * 足元から見ている球が低いと、乗り越えられるはずの縁を壁として押し返す。
     * 下端をちょうど段差 (STEP_UP) に置けば、それ以下の出っ張りには触れない
     * — 乗り越える判断は movement 側の仕事なので、ここでは邪魔をしない。
     *
     * **さらに、坂の上では進むぶん足が上がることを見込む。**
     *
     * 坂を上り切る所で床が待っていると、足がまだ低いうちに体の縁が床へ触れる。
     * いまの足元で判じると「乗り越えられない高さ」= 壁になり、**坂の一番上
     * から出られない。** 箱でも同じことが起きて、同じ手当てが入っている
     * (collision.ts の slopeUnder) — 三角へ移すときに写し忘れていた。
     *
     * 見込む量は「体の周りで一番高い所と足元の差」。実際にそこへ着いたときの
     * 高さそのものなので、届かない高さまで許すことにはならない。
     */
    const rise = this.riseAhead(position, radius, feetY)
    const bottom = feetY + this.stepUp + rise + radius
    const top = feetY + this.height - radius

    for (let round = 0; round < ITERATIONS; round++) {
      let pushX = 0
      let pushZ = 0
      let touched = false
      for (let slice = 0; slice < BODY_SLICES; slice++) {
        const ratio = BODY_SLICES === 1 ? 0 : slice / (BODY_SLICES - 1)
        const y = bottom + Math.max(0, top - bottom) * ratio
        this.solid.touching(position.x, y, position.z, radius, (contact) => {
          // 登れる面は押し返さない。坂の上で水平に押されると進めなくなる
          if (Math.abs(contact.ny) >= WALKABLE_Y) return
          // 水平だけ取り出して押す。**上下は足元の仕事**
          const flat = Math.hypot(contact.nx, contact.nz)
          if (flat < 1e-6) return
          const nx = contact.nx / flat
          const nz = contact.nz / flat
          /*
           * **足し合わせない。まだ足りないぶんだけ足す。**
           *
           * 1 枚の壁は三角 2 枚でできている。真ん中に立つと両方が「0.25m
           * 押し出せ」と言うので、素直に足すと 2 倍出る。しかも 2 枚目は
           * 対角線の辺から押すので、横へ 4cm ずれた。
           *
           * 既に押した量をその向きへ投げて、**残りだけ**足す。角では 2 つの
           * 向きが噛み合わないので、両方ぶんが正しく積まれる。
           */
          const already = pushX * nx + pushZ * nz
          const need = contact.depth - already
          if (need <= 0) return
          touched = true
          pushX += nx * need
          pushZ += nz * need
        })
      }
      if (!touched) return
      position.x += pushX
      position.z += pushZ
    }
  }

  /**
   * 足が着く高さ。**上から線を下ろして探す。**
   *
   * 中心 1 本では縁で落ちるので、体の周りも見て一番高い所を採る。
   * 始点を足元より少し上に置くのは、**坂の中に足がめり込んでいるとき**に
   * 下向きの線が面を素通りするのを防ぐため。
   */
  groundHeight(position: Vec3, radius: number, feetY: number): number {
    const from = feetY + Math.max(PROBE_UP, this.stepUp + 0.05)
    const limit = feetY + this.stepUp

    /*
     * **真ん中が着いているなら、その高さ。**
     *
     * 周りも見て一番高い所を採ると、坂の上で**登り側の縁の高さ**になって
     * 体が浮く (半径 0.35m・傾き 1/4 の坂で 7cm)。箱のときも高さは中心で
     * 引いていた (topAt)。周りを見るのは「乗っているか」を決めるため。
     */
    const center = this.probe(position.x, position.z, from, limit)
    if (center !== null) return center

    /*
     * 真ん中が外れた。**体が縁に乗っていれば落とさない。**
     *
     * 中心 1 本だけだと、床の縁に半分乗っている人が落ちる。円周をなぞって
     * 一番高い所を採る — こちらは高さの正しさより「立てるかどうか」。
     */
    let best = 0
    for (let i = 1; i < GROUND_SAMPLES; i++) {
      const angle = ((i - 1) / (GROUND_SAMPLES - 1)) * Math.PI * 2
      const x = position.x + Math.cos(angle) * radius * 0.8
      const z = position.z + Math.sin(angle) * radius * 0.8
      const y = this.probe(x, z, from, limit)
      if (y !== null && y > best) best = y
    }
    return best
  }

  /**
   * 体の周りで、足元よりどれだけ高い所があるか。**坂の上りを見込むのに使う。**
   *
   * 段差より高い所は見ない — あれは壁であって坂ではない。
   */
  private riseAhead(position: Vec3, radius: number, feetY: number): number {
    const from = feetY + Math.max(PROBE_UP, this.stepUp + 0.05)
    const limit = feetY + this.stepUp
    let rise = 0
    for (let i = 0; i < SLOPE_SAMPLES; i++) {
      const angle = (i / SLOPE_SAMPLES) * Math.PI * 2
      const x = position.x + Math.cos(angle) * radius
      const z = position.z + Math.sin(angle) * radius
      const y = this.probe(x, z, from, limit)
      if (y !== null && y - feetY > rise) rise = y - feetY
    }
    return rise
  }

  /** その 1 点で足が着く高さ。段差より上にしか無ければ null */
  private probe(x: number, z: number, from: number, limit: number): number | null {
    const found = this.solid.hit(x, from, z, x, from - PROBE_DOWN, z)
    if (!found) return null
    const y = from - found.t * PROBE_DOWN
    // 段差より上に見つかったものは足場ではない (乗り越える判断は movement 側)
    return y > limit ? null : y
  }

  /**
   * 頭がぶつかる高さ。何も無ければ Infinity。
   *
   * 足元より上だけを見る。**乗っている床を天井として拾わない**ため、
   * 始点を少し持ち上げる。
   */
  ceilingHeight(position: Vec3, radius: number, feetY: number): number {
    const from = feetY + this.stepUp + 0.05
    let best = Infinity
    for (let i = 0; i < GROUND_SAMPLES; i++) {
      const angle = ((i - 1) / (GROUND_SAMPLES - 1)) * Math.PI * 2
      const spread = i === 0 ? 0 : radius * 0.8
      const x = position.x + Math.cos(angle) * spread
      const z = position.z + Math.sin(angle) * spread
      const reach = this.height + 1
      const found = this.solid.hit(x, from, z, x, from + reach, z)
      if (!found) continue
      const y = from + found.t * reach
      if (y < best) best = y
    }
    return best
  }

  /**
   * 足元の面の材質。**足音と着弾に使う。**
   *
   * 箱では Obstacle.surface が持っていた。三角では当たった 1 枚から引く。
   * 見つからなければ null — 呼ぶ側が既定へ落とす。
   */
  surfaceUnder(position: Vec3, feetY: number): number | null {
    const from = feetY + Math.max(PROBE_UP, this.stepUp + 0.05)
    const found = this.solid.hit(
      position.x, from, position.z,
      position.x, from - PROBE_DOWN, position.z,
    )
    return found ? this.solid.surfaceOf(found.tri) : null
  }
}
