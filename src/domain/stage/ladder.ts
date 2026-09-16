/**
 * 梯子。**掴んで上下にだけ動ける場所。**
 *
 * ステージの札 (`ladder_`) で宣言して、書き出しが縦の範囲と厚みの向きを出す
 * (tools/export_stage.py)。形からは決めない — 板は壁にも床にもあるので、
 * 「細長い板は梯子」と決めると手すりまで登れてしまう。
 *
 * --- どちら側からでも掴める ---
 * 面の向きは持たない。裏から登れないと、追われて回り込んだときに登れない
 * 梯子ができる。掴むと体は梯子のほうを向く。
 *
 * --- 登っている間は無防備 ---
 * 両手が塞がるので撃てないし持ち替えもできない。**そこを渡るかどうかが賭け**
 * になるのが梯子の役目で、登りながら撃てると渡る危険が消える。
 */

/** 書き出しが出す 1 本。積んである板は 1 本に繋いである */
export interface Ladder {
  name: string
  min: [number, number, number]
  max: [number, number, number]
  /** 厚みのある向き。掴んで登る面の法線 */
  axis: 'x' | 'z'
}

/** 掴める距離 (m)。梯子の面から手が届く範囲 */
export const LADDER_REACH = 0.85

/**
 * 掴んだときに面から離れて立つ距離 (m)。
 *
 * **型の手が届く所に置く。** 0.42 では手が桟の手前で空を掻いていた
 * (試写 tools/preview/ladder.html で見た)。体が板に埋まらない範囲で寄せる。
 */
export const LADDER_STANDOFF = 0.26

/**
 * 登り降りの速さ (m/s)。**歩くより遅い。**
 *
 * 梯子は渡っている間が危ないのが値打ちで、さっと登れてしまうと危なくない。
 * 11.7m の梯子で 12 秒ほどかかる。
 *
 * これは**素の速さ**。FAST MOVE (runner) の倍率が掛かるので、極めた人は
 * 1.16 倍で登る — 走る速さと同じ札が効く。持っている物の重さは掛けない
 * (腕で登るので、背負った銃の重さで登る速さは変わらない)。
 *
 * 型の波でさらに速くなったり緩んだりする (motion.ts の climbSurge)。
 * 均せばこの値。
 */
export const LADDER_SPEED = 1.0

/**
 * 掴める梯子を探す。**足が届く高さに居ることまで見る。**
 *
 * @param x,y,z いまの足元
 * @param height 体の高さ。頭が梯子の下端より上に無ければ掴めない
 */
export function ladderAt(
  ladders: readonly Ladder[],
  x: number,
  y: number,
  z: number,
  height: number,
): Ladder | null {
  for (const ladder of ladders) {
    // 縦。**下端より下や上端より上では掴めない** (空を掴むことになる)
    if (y + height < ladder.min[1] || y > ladder.max[1]) continue

    const alongIsX = ladder.axis === 'z'
    const along = alongIsX ? x : z
    const across = alongIsX ? z : x
    const alongMin = alongIsX ? ladder.min[0] : ladder.min[2]
    const alongMax = alongIsX ? ladder.max[0] : ladder.max[2]
    const acrossMin = alongIsX ? ladder.min[2] : ladder.min[0]
    const acrossMax = alongIsX ? ladder.max[2] : ladder.max[0]

    // 横。梯子の幅の中に居るか (端は少しだけ甘く)
    if (along < alongMin - 0.25 || along > alongMax + 0.25) continue

    // 正面。板からどれだけ離れているか。**どちら側でもよい**
    const middle = (acrossMin + acrossMax) / 2
    if (Math.abs(across - middle) > LADDER_REACH) continue

    return ladder
  }
  return null
}

/**
 * 掴んだときに立つ場所。梯子の幅の中央、面から少し離れた所。
 *
 * @param side どちら側に立つか。**掴んだ時に決めて、以後は渡し続ける** —
 *   毎回その場の座標から決め直すと、何かの拍子に裏側へ回り込む。
 *   省けばいまの位置から決める。
 */
export function ladderGrip(
  ladder: Ladder,
  x: number,
  z: number,
  side?: 1 | -1,
): { x: number; z: number; yaw: number } {
  const alongIsX = ladder.axis === 'z'
  const middleAcross = alongIsX
    ? (ladder.min[2] + ladder.max[2]) / 2
    : (ladder.min[0] + ladder.max[0]) / 2
  const middleAlong = alongIsX
    ? (ladder.min[0] + ladder.max[0]) / 2
    : (ladder.min[2] + ladder.max[2]) / 2
  const across = alongIsX ? z : x
  // 居る側へ立つ。**裏から掴んだら裏に立つ**
  const stand = side ?? (across >= middleAcross ? 1 : -1)
  const standAcross = middleAcross + stand * LADDER_STANDOFF

  /*
   * 向き。**梯子を向く。**
   *
   * yaw = θ のとき体のローカル -Z が (-sinθ, 0, -cosθ) を向く (soldier.ts と
   * 同じ決めごと)。梯子へ向かう向きをその式から逆算する。
   */
  const toX = alongIsX ? 0 : -stand
  const toZ = alongIsX ? -stand : 0
  return {
    x: alongIsX ? middleAlong : standAcross,
    z: alongIsX ? standAcross : middleAlong,
    yaw: Math.atan2(-toX, -toZ),
  }
}
