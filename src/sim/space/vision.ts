/**
 * 見えているかどうかの判定。
 *
 * サーバーが「見えている相手だけ配る」ために使う。ブラウザの JS は読めるので、
 * 位置を送ってしまえば壁の向こうの相手が読める。接敵するまでステルスという
 * 前提のゲームで、そこが抜けていると設計そのものが成り立たない。
 *
 * three.js に依存しない。サーバー (bun) がこのファイルをそのまま読む。
 * 同じ判定を 2 か所に書くと、必ずどちらかがずれる。
 */

import type { SurfaceHit } from './bvh'
export type { SurfaceHit } from './bvh'

import type { SurfaceFlags } from '../../domain/stage'

/** 遮蔽になる箱。ステージの書き出しが作る stage.json の中身 */
export interface StageBox {
  name: string
  min: [number, number, number]
  max: [number, number, number]
  /** 何を止めるか。無ければ全部止める面として扱う */
  flags?: SurfaceFlags
  /**
   * 上面の平面。min の角における高さ h と、x / z 方向の傾き。
   *
   * 傾いていれば、箱は「上を斜めに切り落とした楔」になる。これを見ないと、
   * 坂の上の空いている空間まで遮蔽として扱ってしまい、坂の上に立った相手が
   * 誰からも見えなくなる。
   */
  top?: {
    h: number
    dx: number
    dz: number
    /**
     * 板の厚み (m)。**上面から下へ、どこまで詰まっているか。**
     *
     * 傾いた板を箱で持つと、上を切っても**下が三角形に埋まる**。坂の脇に
     * しゃがんだ相手が誰からも見えなくなっていた — 見た目は下が空いている
     * のに、判定では詰まっている。
     *
     * 楔のように下まで詰まっている形なら、厚みは箱の高さと同じになるので
     * 今までどおり全部が塞がる。**表せない形を無理に薄くしない。**
     *
     * 無ければ min まで詰まっているものとして扱う (古い書き出しとの互換)。
     */
    thick?: number
  }
}

/**
 * 体のどこを見るか。足元からの高さの比率。**頭から順。**
 *
 * 頭だけで判定すると、頭を隠して足を出している相手が完全に消える。
 * 見えている部分があるのに映らないのは、隠れられるより困る。
 *
 * --- 3 段では隙間を取りこぼす ---
 * 長らく頭・胸・足元の 3 段だった。筏の塔の縁の板 (床から 12cm の隙間) の裏に
 * しゃがんだ相手を地面から見上げると、隙間を抜ける線が届くのは**脛から腿**
 * (高さ 0.25〜0.35m) だけで、足元 0.14 と胸 0.52 の間に落ちる。画面には脚が
 * 映っているのにサーバーは配らなかった。
 *
 * 0.15 刻み (立ちで 0.22m、しゃがみで 0.14m) にすると、板の裏にしゃがむ相手が
 * 見える組が 93 通り中 0〜2 から 14〜20 になった (手元の筏で総当たり)。
 *
 * 費用は隠れている相手にしか掛からない (通った瞬間に返る)。見えている相手は 1 本のまま。
 */
export const SAMPLE_RATIOS = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1]

/**
 * 体の幅の半分 (m)。中心線から左右へこれだけ離した点も見る。
 *
 * 中心線だけを見ていると、**角から覗いている相手が丸ごと消える**。
 * 肩と頭が壁の端から出ていても、体の中心が壁の裏にあれば通らないため。
 * 見えているのに映らないので、覗く側が一方的に得をする。
 */
const SHOULDER = 0.22

/** 線分と箱の交差 (slab 法)。当たれば true */
export function segmentHitsBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: StageBox,
): boolean {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az

  let near = 0
  let far = 1

  // 軸ごとに「線分がその軸の範囲に入っている区間」を求め、重なりを詰めていく。
  // 3 軸すべてで重なりが残れば、線分は箱の中を通っている。
  for (let axis = 0; axis < 3; axis++) {
    const origin = axis === 0 ? ax : axis === 1 ? ay : az
    const delta = axis === 0 ? dx : axis === 1 ? dy : dz
    const lo = box.min[axis]
    const hi = box.max[axis]

    if (Math.abs(delta) < 1e-9) {
      // その軸に進んでいない。始点が範囲の外なら永遠に入らない
      if (origin < lo || origin > hi) return false
      continue
    }

    let t0 = (lo - origin) / delta
    let t1 = (hi - origin) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]

    if (t0 > near) near = t0
    if (t1 < far) far = t1
    if (near > far) return false
  }

  // 上面が傾いていれば、箱は上を斜めに切り落とした楔になる。
  // 平面より上は空いているので、そこを通る線は遮られない。
  const top = box.top
  if (top && (top.dx !== 0 || top.dz !== 0)) {
    // 線上の各点で「上面からの高さ」も t の一次式になる。もう一枚の板として詰める
    const at0 = ay - (top.h + top.dx * (ax - box.min[0]) + top.dz * (az - box.min[2]))
    const rate = dy - (top.dx * dx + top.dz * dz)

    if (Math.abs(rate) < 1e-9) {
      // 上面と平行に進んでいる。始点が上なら、ずっと上
      if (at0 > 0) return false
    } else {
      const cross = -at0 / rate
      // rate > 0 なら進むほど上へ抜ける → cross より手前だけが中身
      if (rate > 0) {
        if (cross < far) far = cross
      } else if (cross > near) {
        near = cross
      }
      if (near > far) return false
    }

    /*
     * 下面。**厚みぶんだけ下も切る。**
     *
     * 上と同じ平面を厚みだけ下げた物。ここを切らないと、坂の下の空いている
     * 所が詰まったままになる (坂の脇にしゃがむと消える)。
     */
    const thick = top.thick
    if (thick !== undefined && thick > 0) {
      const below0 = at0 + thick
      if (Math.abs(rate) < 1e-9) {
        if (below0 < 0) return false
      } else {
        const cross = -below0 / rate
        // rate < 0 なら進むほど下へ抜ける → cross より手前だけが中身
        if (rate < 0) {
          if (cross < far) far = cross
        } else if (cross > near) {
          near = cross
        }
        if (near > far) return false
      }
    }
  }

  return true
}

/**
 * a から b が見えるか。
 *
 * 目の位置から相手の体の数点へ線を引き、1 本でも通れば見えているとする。
 *
 * @param boxes 遮蔽になる箱。ステージ全体を毎回なめる素朴な実装だが、
 *   1 回あたり 53 箱で、まず線分の AABB で弾くので実測 0.01ms 以下だった。
 *   人数が増えて足りなくなったら、そのとき空間分割を入れる。
 */
/**
 * 線が通るか答えられる物。**世界の形を問わない。**
 *
 * 判定する側 (verifyHit / hasLineOfSight) が箱の一覧を直に受け取っていた頃は、
 * **世界が箱でできていることを知っていた。** 三角の網へ移すのに、判定の側まで
 * 書き換えることになる。
 *
 * 問いは 1 つで足りる。箱の一覧でも、三角の木 (bvh.ts の TriangleBvh) でも、
 * 高さマップでも差し込める。**移行の間は両方を動かして、答えを突き合わせられる。**
 */
export interface SightBlocker {
  /** a から b へ線が通るか */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean
  /**
   * 目 e から線分 ab の**どこかが見えているか**。三角の網は厳密に解く
   * (bvh.ts の segmentVisible)。無ければ線分の上を何点か刻んで clear で見る。
   */
  segmentVisible?(
    ex: number, ey: number, ez: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): boolean
}

/** 線分の上を刻む数 (segmentVisible を持たない世界の代用)。立った体で 10cm 刻み */
const SEGMENT_SAMPLES = 16

/** 目から線分のどこかが見えているか。厳密に解ける世界ならそちら、無ければ刻む */
export function segmentVisibleIn(
  world: SightBlocker,
  ex: number, ey: number, ez: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): boolean {
  if (world.segmentVisible) return world.segmentVisible(ex, ey, ez, ax, ay, az, bx, by, bz)
  for (let i = 0; i <= SEGMENT_SAMPLES; i++) {
    const t = i / SEGMENT_SAMPLES
    if (world.clear(ex, ey, ez, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)) return true
  }
  return false
}

/** 体を包む箱の寸法。domain/player/stance.ts の BodyBox と同じ形 (値は受け取る) */
export interface BodyExtent {
  halfWidth: number
  back: number
  front: number
  height: number
}

/**
 * 体が見えているか。**箱の 12 辺を線分として見る。**
 *
 * 点 (頭・胸・足元 …) で見ると、点の間隔より細い隙間から見えている体を
 * 取りこぼして、相手が急に現れたり消えたりする。箱の辺なら間隔が無い。
 * 箱は体より少し大きいので送る側に倒れる (迷ったら送る側)。
 *
 * 縦の辺 4 本を先に見る (立った体はたいていそこで通る)。1 本でも通れば返す。
 *
 * @param yaw 体の向き (rad)。前は forwardOf と同じ (-sin, -cos)
 */
export function bodyVisible(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  x: number,
  feetY: number,
  z: number,
  yaw: number,
  box: BodyExtent,
  world: SightBlocker,
): boolean {
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  // 右向き。前 × 上
  const rx = -fz
  const rz = fx
  // 底面の 4 隅: 前右・前左・後右・後左
  const corners: [number, number][] = [
    [x + fx * box.front + rx * box.halfWidth, z + fz * box.front + rz * box.halfWidth],
    [x + fx * box.front - rx * box.halfWidth, z + fz * box.front - rz * box.halfWidth],
    [x - fx * box.back + rx * box.halfWidth, z - fz * box.back + rz * box.halfWidth],
    [x - fx * box.back - rx * box.halfWidth, z - fz * box.back - rz * box.halfWidth],
  ]
  const top = feetY + box.height
  // 縦の辺
  for (const [cx, cz] of corners) {
    if (segmentVisibleIn(world, eyeX, eyeY, eyeZ, cx, feetY, cz, cx, top, cz)) return true
  }
  // 上面と底面の辺 (前・後・右・左)
  const rings: [number, number][] = [[0, 1], [2, 3], [0, 2], [1, 3]]
  for (const y of [top, feetY]) {
    for (const [i, j] of rings) {
      const [ax, az] = corners[i]!
      const [bx, bz] = corners[j]!
      if (segmentVisibleIn(world, eyeX, eyeY, eyeZ, ax, y, az, bx, y, bz)) return true
    }
  }
  return false
}

/**
 * 線分で掃いて、**最初に当たった面**を返せる物。
 *
 * SightBlocker (通るかどうか) では足りない場面のため。跳ね返りには面の向きが
 * 要るし、カメラを壁の手前へ寄せるには距離が要る。
 *
 * TriangleBvh がそのまま満たす。箱の側は包みを作る (ballistic.ts の boxSolid)。
 */
export interface SolidWorld {
  hit(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): SurfaceHit | null
}

/**
 * 何も遮らない世界。
 *
 * 地形が読めなかったときに使う。**null を配り歩かない** — 受け取る側が
 * 「地形が無いなら判定を飛ばす」を毎回書くと、書き忘れた所だけ落ちる。
 * 全部素通しの世界を 1 つ渡せば、判定はいつもどおり走って全部通る。
 */
export const OPEN_SIGHT: SightBlocker = { clear: () => true }

/** 箱の一覧を SightBlocker として見せる。**古い形をそのまま包むだけ** */
export function boxSight(boxes: StageBox[]): SightBlocker {
  return {
    clear: (ax, ay, az, bx, by, bz) => isPathClear(ax, ay, az, bx, by, bz, boxes),
    // 箱の世界は線分を刻んで見る (segmentVisibleIn の代用の道)
  }
}

export function hasLineOfSight(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetFeetY: number,
  targetZ: number,
  targetHead: number,
  world: SightBlocker,
): boolean {
  // 見る方向に対して横向きの単位ベクトル。肩の位置を出すのに使う
  const dx = targetX - eyeX
  const dz = targetZ - eyeZ
  const length = Math.hypot(dx, dz)
  const sideX = length > 1e-6 ? (-dz / length) * SHOULDER : SHOULDER
  const sideZ = length > 1e-6 ? (dx / length) * SHOULDER : 0

  // 中心線を先に見る。通れば即座に返るので、見えている相手の費用は 1 本のまま。
  // 増えた点の費用を払うのは、隠れている相手を確かめるときだけ
  for (const ratio of SAMPLE_RATIOS) {
    const ty = targetFeetY + targetHead * ratio
    if (world.clear(eyeX, eyeY, eyeZ, targetX, ty, targetZ)) return true
  }

  // 左右の肩。頭と胸の高さだけ見る (足は幅が無い)
  for (const ratio of [1, 0.55]) {
    const ty = targetFeetY + targetHead * ratio
    if (world.clear(eyeX, eyeY, eyeZ, targetX + sideX, ty, targetZ + sideZ)) return true
    if (world.clear(eyeX, eyeY, eyeZ, targetX - sideX, ty, targetZ - sideZ)) return true
  }
  return false
}

/**
 * 線分が最初に箱へ入る位置 (0..1)。遮る物が無ければ null。
 *
 * isPathClear は「遮られたか」しか返さないが、カメラを壁の手前へ寄せるには
 * **どこで当たったか**が要る。
 */
export function firstBlockedAt(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: StageBox[],
): number | null {
  const origin = [ax, ay, az]
  const delta = [bx - ax, by - ay, bz - az]
  let best: number | null = null

  for (const box of boxes) {
    let near = 0
    let far = 1
    let miss = false
    for (let i = 0; i < 3; i++) {
      if (Math.abs(delta[i]) < 1e-9) {
        if (origin[i] < box.min[i] || origin[i] > box.max[i]) {
          miss = true
          break
        }
        continue
      }
      const inv = 1 / delta[i]
      let t0 = (box.min[i] - origin[i]) * inv
      let t1 = (box.max[i] - origin[i]) * inv
      if (t0 > t1) {
        const tmp = t0
        t0 = t1
        t1 = tmp
      }
      if (t0 > near) near = t0
      if (t1 < far) far = t1
      if (near > far) {
        miss = true
        break
      }
    }
    if (miss) continue
    if (best === null || near < best) best = near
  }
  return best
}

/** 2 点を結ぶ線分を遮る箱が 1 つも無いか */
export function isPathClear(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: StageBox[],
): boolean {
  // 線分自体の範囲。箱がここから外れていれば交差の計算に入らない
  const loX = Math.min(ax, bx)
  const hiX = Math.max(ax, bx)
  const loY = Math.min(ay, by)
  const hiY = Math.max(ay, by)
  const loZ = Math.min(az, bz)
  const hiZ = Math.max(az, bz)

  for (const box of boxes) {
    if (box.max[0] < loX || box.min[0] > hiX) continue
    if (box.max[1] < loY || box.min[1] > hiY) continue
    if (box.max[2] < loZ || box.min[2] > hiZ) continue
    if (segmentHitsBox(ax, ay, az, bx, by, bz, box)) return false
  }
  return true
}

/** 視線を止める面だけを残す。金網も茂みも見通せる面は数に入れない */
export function sightBlockers(boxes: StageBox[]): StageBox[] {
  return boxes.filter((box) => box.flags?.eye !== false && sane(box))
}

/**
 * 正気でない高さ (m)。**これを超えた箱は書き出しの事故として捨てる。**
 *
 * 遊べる範囲は ±40m ほどで、一番高い塔でも 22m しかない。60m を超える箱は
 * 地形ではなく、**壊れた形が 1 つ紛れ込んだ**ことを意味する。
 */
export const SANE_HEIGHT = 60

/** 一度警告した名前。毎フレームではないが、読み込みのたびに出ると埋もれる */
const warned = new Set<string>()

/**
 * 壊れた形を取り込まない。
 *
 * --- なぜ要るか ---
 * 筏の梯子に付いている落下防止の輪 (BézierCircle) が、**真上へ 3km 伸びた箱**
 * として書き出されていた。名前に印が無いので全部を止める扱いになり、
 *
 *   - 梯子を登っている間ずっとカメラが遮られて、寄り引きを繰り返す
 *   - 梯子の周りで弾が消え、視線も切れる (そこに居る敵が見えない)
 *
 * という形で出た。**1 つの壊れた形が、その一帯の遊びを壊す。**
 *
 * 直すのは書き出し側 (元の形) だが、黙って取り込むと次に同じことが起きても
 * 気づけない。ここで落として名前を出す。
 */
function sane(box: StageBox): boolean {
  const height = box.max[1] - box.min[1]
  if (height <= SANE_HEIGHT) return true
  if (!warned.has(box.name)) {
    warned.add(box.name)
    console.warn(
      `[地形] ${box.name} は高さ ${height.toFixed(0)}m。書き出しの事故として判定から外す`,
    )
  }
  return false
}

/**
 * 物がぶつかる箱だけを残す。
 *
 * 遮蔽 (sightBlockers) とは別の集合になる。当たり判定専用のブロック (col_) は
 * 視線を止めないので遮蔽から外れるが、体も手榴弾もそこで止まる。
 * 逆に見えない壁 (vis_) は視線を止めるだけで、物は通り抜ける。
 *
 * 片方で済ませると、手榴弾が床を突き抜けて地面の下で爆発する。
 */
/**
 * カメラが入れない箱だけを残す。
 *
 * 遮蔽 (sightBlockers) とも、物がぶつかる面 (solidBlockers) とも別の集合。
 * 飾りはカメラを通すし、見えない壁 (vis_) はカメラも止める。
 *
 * **箱のまま。** カメラを壁の手前へ寄せるには「どこで当たったか」が要るので、
 * 通るかどうかしか答えない SightBlocker では足りない。
 */
export function cameraBlockers(boxes: StageBox[]): StageBox[] {
  return boxes.filter((box) => box.flags?.camera !== false && sane(box))
}

export function solidBlockers(boxes: StageBox[]): StageBox[] {
  return boxes.filter((box) => box.flags?.player !== false && sane(box))
}

/**
 * その XZ 位置で足が乗っている面の高さと材質。
 *
 * サーバーが見えない相手の足音を配るのに要る。何の上を歩いているかは
 * 位置と地形から決まるので、こちらで出せる。申告させるものではない。
 *
 * @param feetY 足元の高さ。これより十分高い箱は「まだ登っていない」ので床に数えない
 */
export function groundUnder(
  x: number,
  z: number,
  feetY: number,
  boxes: StageBox[],
  stepUp: number,
): { top: number; name: string } {
  let best = 0
  let name = ''
  for (const box of boxes) {
    if (x < box.min[0] || x > box.max[0]) continue
    if (z < box.min[2] || z > box.max[2]) continue

    const top = box.top
    const height =
      top && (top.dx !== 0 || top.dz !== 0)
        ? top.h + top.dx * (x - box.min[0]) + top.dz * (z - box.min[2])
        : box.max[1]

    if (height > feetY + stepUp) continue
    if (height <= best) continue
    best = height
    name = box.name
  }
  return { top: best, name }
}
