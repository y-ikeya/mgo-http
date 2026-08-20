
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
export type { Surface } from '../domain/surface'
import type { Surface } from '../domain/surface'

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
 * 歩いたまま乗り越えられる段差 (m)。
 *
 * これを超える段差はジャンプしないと登れない。階段の一段をこの値より高く作れば
 * 「ジャンプで登る階段」になり、低く作れば「歩いて登れるスロープ」になる。
 */
const STEP_UP = 0.25

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
): void {
  const radiusSq = radius * radius

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    let touched = false

    for (const o of obstacles) {
      // 最高点でも足元より低ければ、触れる前から壁になりようがない
      if (o.top <= feetY + STEP_UP) continue
      // 下面が頭より上にある = くぐれる。橋の下、アーチ、2 階の床
      if (o.bottom >= feetY + bodyHeight) continue

      // AABB 上で円の中心に最も近い点
      const nearX = clamp(position.x, o.minX, o.maxX)
      const nearZ = clamp(position.z, o.minZ, o.maxZ)

      // 壁かどうかは「触れている場所の高さ」で決める。坂の上を歩いているとき、
      // 遠くの高い側を見て壁と判断すると、坂に乗った瞬間に押し戻される。
      if (topAt(o, nearX, nearZ) <= feetY + STEP_UP) continue

      const dx = position.x - nearX
      const dz = position.z - nearZ
      const distSq = dx * dx + dz * dz

      if (distSq >= radiusSq) continue

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
): Surface {
  let best = 0
  let surface: Surface = 'concrete'
  for (const obstacle of obstacles) {
    if (obstacle.top < best) continue
    if (position.x + radius < obstacle.minX || position.x - radius > obstacle.maxX) continue
    if (position.z + radius < obstacle.minZ || position.z - radius > obstacle.maxZ) continue
    const height = topAt(obstacle, position.x, position.z)
    if (height > feetY + STEP_UP) continue
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
): number {
  const radiusSq = radius * radius
  let ground = 0

  for (const o of obstacles) {
    // 最高点でも今の床より低ければ見るまでもない
    if (o.top <= ground) continue

    const nearX = clamp(position.x, o.minX, o.maxX)
    const nearZ = clamp(position.z, o.minZ, o.maxZ)
    const dx = position.x - nearX
    const dz = position.z - nearZ
    if (dx * dx + dz * dz >= radiusSq) continue

    // 高さは足の真下で測る。坂では一歩ごとに変わる
    const height = topAt(o, position.x, position.z)
    if (height <= ground) continue
    if (height > feetY + STEP_UP) continue

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
  feetY: number,
): number {
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
