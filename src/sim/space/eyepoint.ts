/**
 * 「どこから見ているか」。
 *
 * --- なぜ目の位置ではないのか ---
 * 三人称なので、画面に映るものを決めているのは**カメラの位置**であって
 * キャラの目ではない。カメラは腰だめで 4.2m 後ろ・肩へ 0.75m ずれた所にある。
 *
 * 目から線を引いて可視を決めていると、遮蔽の裏にしゃがんだ相手が
 * 「カメラからは見えているのに送られてこない」ことになる。実際にそうなっていた:
 * 物陰でしゃがんだ相手が画面から消え、立つと戻る。
 *
 * 目で見える範囲を含むわけではない。**狭くなる場合もある** — 近くの低い遮蔽を
 * 覗き込むとき、カメラは 4.2m 後ろにあるぶん角度が浅くなって越えられない
 * (実測: 高さ 1.0m の遮蔽ごしに 3m 先のしゃがみを見ると、目は越えるがカメラは越えない)。
 *
 * それでよい。カメラから見えないなら画面上でも遮蔽の裏に隠れて描かれないので、
 * 送らないのが正しい。判定の基準は「目に見えるか」ではなく
 * **「画面に映るか」**であって、そこが今まで食い違っていた。
 *
 * --- 壁に寄せるのは必須 ---
 * 実際のカメラは壁に当たると手前へ寄る。これを省くと、**壁を背にした瞬間に
 * カメラが壁の中へ入り、全方位が見えなくなる**。ステージは高さ 3.2m の壁で
 * 囲まれているので、端に立つだけで起きる (実際に起きた: 端の敵が消え、
 * 近づくと見える)。
 *
 * 描画メッシュではなく箱で寄せるので、クライアントの結果と完全には一致しない。
 * 箱のほうが粗い = 少し手前で止まる = カメラが近くなる = 見える範囲が狭くなる。
 * 送り忘れる側なので、そこは箱と描画の差が開かないよう見ておく必要がある。
 *
 * three.js に依存しない。camera.ts の値をここへ持ってきているので、
 * あちらを変えたらここも変える。
 */

import { firstBlockedAt, type StageBox } from './vision'

/** 腰だめのカメラ。camera.ts の HIP_VIEW と揃える */
const HIP = { distance: 4.2, shoulder: 0.75 }
/** 構えたときのカメラ。camera.ts の AIM_VIEW と揃える */
const AIM = { distance: 1.35, shoulder: 0.42 }

/** カメラが地面へ潜らない下限 (m)。camera.ts の MIN_CAMERA_Y と揃える */
const MIN_Y = 0.4

/** 壁からどれだけ手前に置くか (m)。camera.ts の OCCLUSION_PADDING と揃える */
const PADDING = 0.28

/**
 * 壁に当たったら**必ず手前で止める**。
 *
 * camera.ts には MIN_OCCLUDED_DISTANCE = 0.45 があって、そこまでしか寄らない。
 * 描画ならそれでよい (near 平面で切れるだけ) が、こちらは線分の始点になるので
 * 壁の中に入ると**全部遮られたことになる**。壁に密着した人だけ何も見えなくなる。
 *
 * 見る点が頭まで戻るだけなので、寄せ切って困ることはない。
 */

/**
 * 視線の向き (単位ベクトル)。camera.ts は euler(pitch, yaw, 0) を (0,0,-1) に
 * 掛けている。**カメラの位置を出すのにも、照準が誰を捉えているかを見るのにも**
 * 同じ向きを使う。
 */
export function viewDirection(yaw: number, pitch: number): [number, number, number] {
  const cosPitch = Math.cos(pitch)
  return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch]
}

export interface ViewPoint {
  x: number
  y: number
  z: number
}

/**
 * その人の画面がどこから世界を見ているか。
 *
 * @param feetY 足元の高さ
 * @param pitch 見上げ / 見下ろし (rad)
 * @param yaw 体ではなく視点の向き (rad)
 * @param viewHeight 注視点の高さ (足元から)。**姿勢で変わる**ので呼ぶ側が渡す
 *   (domain/player/stance.ts の VIEW_HEIGHT)。camera.ts は頭の実測 + 0.1m
 */
export function cameraPoint(
  x: number,
  feetY: number,
  z: number,
  yaw: number,
  pitch: number,
  aiming: boolean,
  viewHeight: number,
  boxes: StageBox[] = [],
  out: ViewPoint = { x: 0, y: 0, z: 0 },
): ViewPoint {
  const view = aiming ? AIM : HIP

  const [dirX, dirY, dirZ] = viewDirection(yaw, pitch)

  // 肩へのずれは水平だけ (pitch で肩越しの左右がブレないように)
  const pivotX = x + Math.cos(yaw) * view.shoulder
  const pivotY = feetY + viewHeight
  const pivotZ = z + -Math.sin(yaw) * view.shoulder

  // 視線の逆へ引く。途中に壁があればそこまで
  let distance = view.distance
  if (boxes.length > 0) {
    const t = firstBlockedAt(
      pivotX,
      pivotY,
      pivotZ,
      pivotX - dirX * distance,
      pivotY - dirY * distance,
      pivotZ - dirZ * distance,
      boxes,
    )
    if (t !== null) distance = Math.max(0, t * distance - PADDING)
  }

  out.x = pivotX - dirX * distance
  out.y = pivotY - dirY * distance
  out.z = pivotZ - dirZ * distance
  if (out.y < MIN_Y) out.y = MIN_Y

  // それでも壁の中なら、肩のずれを捨てて頭へ戻す。
  //
  // 肩へのずれは 0.75m あるので、壁に体の側面を付けると**注視点そのもの**が
  // 壁にめり込む。そこから引いた線は何も通らない。
  if (insideAny(out.x, out.y, out.z, boxes)) {
    out.x = x
    out.y = feetY + viewHeight
    out.z = z
  }
  return out
}

/** 見る人。位置と向きと構え。MatchPlayer がそのまま当てはまる */
export interface Viewer {
  x: number
  y: number
  z: number
  cameraYaw: number
  pitch: number
  aiming: boolean
}

/**
 * その人の画面に、相手が映るか。**注視点の高さの幅の両端で引く。**
 *
 * 画面のカメラの高さは骨の実測で決まっていて、サーバーには分からない。
 * 幅 (domain/player/stance.ts の VIEW_HEIGHT) の低いほうと高いほうにカメラを
 * 置き、どちらかから見えれば映っているとする — 迷ったら送る側に倒す。
 *
 * 何が見えるかは呼ぶ側が渡す (visibleFrom)。人なら体の箱の辺 (vision.ts の
 * bodyVisible)、置き物なら 1 本の柱。2 度目を試すのは 1 度目が通らなかったときだけ。
 */
export function seesFromCamera(
  viewer: Viewer,
  viewHeights: readonly [number, number],
  cameraBoxes: StageBox[],
  visibleFrom: (eyeX: number, eyeY: number, eyeZ: number) => boolean,
  scratch: ViewPoint = { x: 0, y: 0, z: 0 },
): boolean {
  const [low, high] = viewHeights
  for (const height of low === high ? [low] : [low, high]) {
    const eye = cameraPoint(
      viewer.x, viewer.y, viewer.z,
      viewer.cameraYaw, viewer.pitch, viewer.aiming,
      height, cameraBoxes, scratch,
    )
    if (visibleFrom(eye.x, eye.y, eye.z)) return true

    /*
     * 構えている間は**注視点そのもの**の線も試す (引きも肩のずれも 0)。
     *
     * --- なぜ要るか ---
     * スコープを覗くと、画面のカメラは体の位置へ寄る (Game.ts の
     * applyWeaponView が `{distance: 0, shoulder: 0}` を渡す)。ところが
     * **覗いているかは送られてこない**ので、ここは肩越しの構え (AIM) のまま
     * 線を引いていた。狭い穴から狙撃すると、**画面では相手が見えているのに
     * 判定は穴の縁に当たって「見えない」**になる。
     *
     * 実測 (筏、81m の狙撃): 同じ立ち位置で腰だめと覗きで答えが変わり、
     * 俯角 5° と 10° でも切り替わっていた。カメラは覗くと前へ寄り、
     * 見下ろすと持ち上がるので、**目が 10cm 動くだけで線が切れる**。
     *
     * --- 抜け道にならない理由 ---
     * 注視点は**体の中**にある。角の裏に隠れたまま覗ける線ではないので、
     * 体が出ていない相手が見えるようにはならない。撃つ側の判定
     * (sim/judge/hitcheck.ts) が同じ理屈で既にこの線を試している。
     */
    if (viewer.aiming && visibleFrom(viewer.x, viewer.y + height, viewer.z)) return true
  }
  return false
}

/** その点が箱の中にあるか */
function insideAny(x: number, y: number, z: number, boxes: StageBox[]): boolean {
  for (const box of boxes) {
    if (
      x > box.min[0] && x < box.max[0] &&
      y > box.min[1] && y < box.max[1] &&
      z > box.min[2] && z < box.max[2]
    ) {
      return true
    }
  }
  return false
}
