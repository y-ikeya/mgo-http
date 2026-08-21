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

/** 注視点の高さ。camera.ts の viewHeight (PLAYER_HEIGHT * 0.85) と揃える */
const VIEW_HEIGHT = 1.53

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
 */
export function cameraPoint(
  x: number,
  feetY: number,
  z: number,
  yaw: number,
  pitch: number,
  aiming: boolean,
  boxes: StageBox[] = [],
  out: ViewPoint = { x: 0, y: 0, z: 0 },
): ViewPoint {
  const view = aiming ? AIM : HIP

  // 視線の向き。camera.ts は euler(pitch, yaw, 0) を (0,0,-1) に掛けている
  const cosPitch = Math.cos(pitch)
  const dirX = -Math.sin(yaw) * cosPitch
  const dirY = Math.sin(pitch)
  const dirZ = -Math.cos(yaw) * cosPitch

  // 肩へのずれは水平だけ (pitch で肩越しの左右がブレないように)
  const pivotX = x + Math.cos(yaw) * view.shoulder
  const pivotY = feetY + VIEW_HEIGHT
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
    out.y = feetY + VIEW_HEIGHT
    out.z = z
  }
  return out
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
