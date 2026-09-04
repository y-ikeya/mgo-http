
/**
 * 移動判定用の障害物。XZ 平面の AABB に、上面と下面の高さを添えたもの。
 *
 * 側面は「足元より高ければ壁、低ければ乗り越えられる床」として働く。
 *
 * --- 下面を持つようになった ---
 * 以前は下面が無く、どの箱も地面から上面までの**柱**だった。橋の下も、
 * アーチの下も、2 階の床の下も塞がっていて、**階のあるステージが作れない**。
 * 見た目だけ作り込んでも、通れない場所が増えるだけだった。
 *
 * 下面を持たせると、体より上に浮いている箱は壁として数えない = くぐれる。
 * 屋根も架けられる。視線判定 (vision.ts) は元から上下を見ていたので、
 * 遮蔽の側は最初から階に対応していた — 通れなかったのは移動だけ。
 */
export type { Surface } from '../../domain/stage'
import type { Surface } from '../../domain/stage'

/**
 * 位置。three の Vector3 はこの形を満たすので、呼ぶ側は今までどおり渡せる。
 *
 * three を型でも参照しないのは、サーバー (bun) がこのファイルを読むため。
 * 移動をサーバーが検証するには、同じ当たり判定をこちらでも回す必要がある。
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Obstacle {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** 上面の最高点 (m)。傾いていない箱ではこれがそのまま上面 */
  top: number
  /**
   * 上面の傾き (m/m) と、minX/minZ の角における高さ。
   *
   * 高さを 1 つの数で持っていた頃は、傾きを書く場所そのものが無かった。
   * 斜めに置いた板は「一番高い所で蓋をした直方体」になり、坂のつもりの物が
   * 壁として立ち塞がる。高さを**平面**にすれば、同じ形のまま坂を表せる。
   *
   * 箱は傾き 0 の平面なので、これまでと同じ振る舞いになる。
   */
  slopeX: number
  slopeZ: number
  /** 傾きの基準点 (minX, minZ) における上面の高さ */
  baseTop: number
  /**
   * 下面の高さ (m)。地面に置かれた箱は 0。
   *
   * これより下は空いている。頭より上に下面がある箱は壁にならない (くぐれる)。
   */
  bottom: number
  /** 上に乗ったときの足音 */
  surface: Surface
  /** 元になったオブジェクト名。書き出しの結果と突き合わせるのに使う */
  name?: string
}

/**
 * その XZ 位置における上面の高さ。
 *
 * 四角の外を指されたら縁の値を返す。円で当たりを取っている以上、
 * 体の中心が四角の外に居ながら縁に触れている場面が普通に起きる。
 */
export function topAt(o: Obstacle, x: number, z: number): number {
  if (o.slopeX === 0 && o.slopeZ === 0) return o.top
  const cx = clamp(x, o.minX, o.maxX)
  const cz = clamp(z, o.minZ, o.maxZ)
  return o.baseTop + o.slopeX * (cx - o.minX) + o.slopeZ * (cz - o.minZ)
}


/**
 * 足の真下にある坂の急さ (m/m)。坂に乗っていなければ 0。
 *
 * **坂の上では「進めばそのぶん足が上がる」**ので、少し先の面をいまの足元の
 * 高さで判じると低く見積もる。上がる面を拾うときも (groundHeight)、壁かどうかを
 * 決めるときも (resolveCircle)、この見込みを足す。
 *
 * 真下だけを見る。半径で探すと、平らな板の上に立っていても近くの坂を拾って
 * しまい、**段に乗れなくなる**。
 */
function slopeUnder(
  position: Vec3,
  obstacles: readonly Obstacle[],
  feetY: number,
  stepUp: number,
): number {
  let steepest = 0
  for (const o of obstacles) {
    if (o.slopeX === 0 && o.slopeZ === 0) continue
    if (position.x < o.minX || position.x > o.maxX) continue
    if (position.z < o.minZ || position.z > o.maxZ) continue
    const h = topAt(o, position.x, position.z)
    if (h > feetY + stepUp || h < feetY - stepUp) continue
    steepest = Math.max(steepest, Math.hypot(o.slopeX, o.slopeZ))
  }
  return steepest
}

/** ゼロ除算と、押し出し後に再び接触判定が立つのを避けるための余裕 */
const EPSILON = 1e-4
/** 押し出しの反復回数。角や複数の箱に同時に接触したときに解を収束させる */
const ITERATIONS = 3

/**
 * XZ 平面上の円として位置を障害物の外へ押し出す。position は破壊的に書き換える。
 *
 * 掃引 (swept) ではなく貫入深度の解決。1 フレームの最大移動量
 * (3.0 m/s × 最大 dt 1/20 s = 0.15 m) が最も薄い箱の厚み 1.2 m を大きく下回るため、
 * すり抜けは起きない。移動速度か MAX_DT を大きく変える場合はここを見直すこと。
 *
 * @param feetY 足元の高さ。これより低い障害物は床として扱い、壁とは見なさない
 * @param bodyHeight 体の高さ (m)。**しゃがんだ高さは渡さない** — 低い隙間へ
 *   もぐり込めるようになる代わりに、そこで立ち上がると天井にめり込む。
 *   押し戻す先が横だけなので、まだ受けきれない
 */
export function resolveCircle(
  position: Vec3,
  radius: number,
  obstacles: readonly Obstacle[],
  feetY: number,
  bodyHeight: number,
  stepUp: number,
): void {
  const radiusSq = radius * radius
  /*
   * 坂の上に居るなら、**進むぶん足が上がることを見込む。**
   *
   * 坂を上り切る所で板が待っていると、足がまだ低いうちに体の縁が板へ触れる。
   * いまの足元で判じると「乗り越えられない高さ」= 壁になり、**8cm 幅の帯から
   * 出られなくなる** — 庭園で 2 階から 3 階へ上がれなかったのはこれ。
   *
   * 見込む量は「坂の急さ × その面までの距離」。実際にそこへ着いたときの高さ
   * そのものなので、届かない高さまで許すことにはならない。
   */
  const slope = slopeUnder(position, obstacles, feetY, stepUp)

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    let touched = false

    for (const o of obstacles) {
      // 最高点でも足元より低ければ、触れる前から壁になりようがない
      if (o.top <= feetY + stepUp + slope * radius) continue
      // 下面が頭より上にある = くぐれる。橋の下、アーチ、2 階の床
      if (o.bottom >= feetY + bodyHeight) continue

      // AABB 上で円の中心に最も近い点
      const nearX = clamp(position.x, o.minX, o.maxX)
      const nearZ = clamp(position.z, o.minZ, o.maxZ)

      const dx = position.x - nearX
      const dz = position.z - nearZ
      const distSq = dx * dx + dz * dz

      if (distSq >= radiusSq) continue

      // 壁かどうかは「触れている場所の高さ」で決める。坂の上を歩いているとき、
      // 遠くの高い側を見て壁と判断すると、坂に乗った瞬間に押し戻される。
      // 坂の上では、そこへ着くまでに上がるぶんを見込む (slope)
      const reach = feetY + stepUp + slope * Math.sqrt(distSq)
      if (topAt(o, nearX, nearZ) <= reach) continue

      if (distSq > EPSILON) {
        // 外側で食い込んでいる: 最近接点から見て外向きに、めり込んだ分だけ戻す
        const dist = Math.sqrt(distSq)
        const push = radius - dist
        position.x += (dx / dist) * push
        position.z += (dz / dist) * push
      } else {
        // 中心が箱の内部にある (角ですれ違った等)。最も近い面へ吐き出す。
        const toMinX = position.x - o.minX
        const toMaxX = o.maxX - position.x
        const toMinZ = position.z - o.minZ
        const toMaxZ = o.maxZ - position.z
        const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ)
        if (nearest === toMinX) position.x = o.minX - radius
        else if (nearest === toMaxX) position.x = o.maxX + radius
        else if (nearest === toMinZ) position.z = o.minZ - radius
        else position.z = o.maxZ + radius
      }

      touched = true
    }

    if (!touched) break
  }
}

/**
 * その XZ 位置で足が着く高さを返す。何にも乗っていなければ 0 (地面)。
 *
 * @param feetY 現在の足元の高さ。ここより十分高い箱は「まだ登れていない」ので
 *              床の候補から外す。これが無いと壁に触れただけで上へ吸い上げられる。
 */
/**
 * その位置で足が乗っている面の材質。
 *
 * 高さで判別していたのを置き換えたもの。「地面は y=0 の平面ひとつ」という
 * 前提に寄りかかっていたので、高い位置にコンクリートを置いた瞬間に破綻していた。
 *
 * 毎フレームではなく足を踏んだ瞬間にだけ呼ぶので、探索し直して構わない。
 */
export function surfaceAt(
  position: Vec3,
  radius: number,
  obstacles: readonly Obstacle[],
  feetY: number,
  stepUp: number,
): Surface {
  let best = 0
  let surface: Surface = 'concrete'
  for (const obstacle of obstacles) {
    if (obstacle.top < best) continue
    if (position.x + radius < obstacle.minX || position.x - radius > obstacle.maxX) continue
    if (position.z + radius < obstacle.minZ || position.z - radius > obstacle.maxZ) continue
    const height = topAt(obstacle, position.x, position.z)
    if (height > feetY + stepUp) continue
    if (height < best) continue
    best = height
    surface = obstacle.surface
  }
  return surface
}

export function groundHeight(
  position: Vec3,
  radius: number,
  obstacles: readonly Obstacle[],
  feetY: number,
  stepUp: number,
): number {
  const radiusSq = radius * radius
  let ground = 0

  // 坂の上に居るか。抑えるかどうかをこれで決める
  const onSlope = slopeUnder(position, obstacles, feetY, stepUp) > 0

  for (const o of obstacles) {
    // 最高点でも今の床より低ければ見るまでもない
    if (o.top <= ground) continue

    const nearX = clamp(position.x, o.minX, o.maxX)
    const nearZ = clamp(position.z, o.minZ, o.maxZ)
    const dx = position.x - nearX
    const dz = position.z - nearZ
    const distSq = dx * dx + dz * dz
    if (distSq >= radiusSq) continue

    // 高さは足の真下で測る。坂では一歩ごとに変わる
    const raw = topAt(o, position.x, position.z)
    if (raw <= ground) continue

    /*
     * --- 足より上の面は、丸い底で拾う ---
     *
     * **支えるのは足の裏、上がるのは体の前。**
     *
     * 足より下にある面は、そのままの高さで支える (底が平らな筒)。板の縁に
     * 半分乗っていても沈まない — 庭園のように**落ちたら死ぬ**細い板の上では、
     * 縁で沈むのは危ないほうへ働く。
     *
     * **坂の上に居るときだけ、上の面を「近づいた分」に抑える。**
     *
     * 坂を上っている間は体の前が常に自分より高い所にある。そのまま拾うと
     * 板の縁に届いた瞬間に「体の幅 × 坂の傾き」だけ跳ね上がる — 庭園の 32° の
     * 坂で 0.22m になり、**見た目は坂の途中なのに階段のモーションが出て**いた。
     *
     * 平らな所に立っているときは今までどおり。段に乗れるのは「届いた面まで
     * 足が上がる」からで、そこを削ると段が壁になる (実際、常に抑える形にしたら
     * 3 階へ上がれなくなった)。**坂と段は別の話**として分ける。
     *
     * これが無いと、**坂を上っている間ずっと隣の板を掴む**。体は太さ 0.35m
     * あるので、坂の面が板より低い所に居ても体の前は板に触れていて、そちらへ
     * 引き上げられる。跳ぶ幅は「半径 × 坂の傾き」で決まり、庭園の 32° の坂では
     * 0.22m — 乗り越えられる段差 (0.25m) の内側なので上れてしまい、
     * **見えない段を上りながら階段のモーションが出る**という形で出ていた。
     */
    const height = onSlope && raw > feetY ? raw - Math.sqrt(distSq) : raw
    if (height <= ground) continue
    if (height > feetY + stepUp) continue

    ground = height
  }

  return ground
}

/**
 * その XZ 位置で頭がぶつかる高さを返す。何も無ければ Infinity。
 *
 * 跳ねて上がったときに、橋や 2 階の床を突き抜けないようにするためのもの。
 * 下面を持たせた以上、**上にも止まる面がある**。
 *
 * 足元より下にある箱は見ない。乗っている床そのものを天井として拾ってしまう。
 */
export function ceilingHeight(
  position: Vec3,
  radius: number,
  obstacles: readonly Obstacle[],
  feetY: number,): number {
  const radiusSq = radius * radius
  let ceiling = Infinity

  for (const o of obstacles) {
    // 足元と同じか下にある物は天井ではない。乗っている床がこれ
    if (o.bottom <= feetY + EPSILON) continue
    if (o.bottom >= ceiling) continue

    const nearX = clamp(position.x, o.minX, o.maxX)
    const nearZ = clamp(position.z, o.minZ, o.maxZ)
    const dx = position.x - nearX
    const dz = position.z - nearZ
    if (dx * dx + dz * dz >= radiusSq) continue

    ceiling = o.bottom
  }

  return ceiling
}

/** ステージ外周から出ないように閉じ込める */
export function clampToArena(position: Vec3, radius: number, halfSize: number): void {
  const limit = halfSize - radius
  position.x = clamp(position.x, -limit, limit)
  position.z = clamp(position.z, -limit, limit)
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
