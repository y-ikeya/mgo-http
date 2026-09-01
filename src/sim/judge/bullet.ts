/**
 * 弾の道。**まっすぐ飛ばず、距離に応じて落ちる。**
 *
 * ここに在るのは形だけ — 何 m/s で飛ぶか、どれだけ落ちるかは武器の性能なので
 * domain (item/weapons.ts) が持つ。**受け取った速さと重力で放物線を引く**のが
 * こちら。
 *
 * 放物線を折れ線で近似して、区間ごとに交差を調べる形にしてある。弾を実体として
 * 飛ばして毎フレーム進める方式もあるが、そちらは着弾までの時間が生まれるぶん、
 * 撃った瞬間に結果が決まらない。ラグ補正の重みが増えるので採らない。
 *
 * three にも DOM にも依存しない。**サーバーが同じ道を引ける**ようにしてある。
 */

/** 3 次元の点。three の Vector3 もそのまま渡せる形にしておく */
export interface Point3 {
  x: number
  y: number
  z: number
}

/**
 * 折れ線の分割数。
 *
 * 区間内で曲線とのずれは最大でも g·Δt²/8 で、200m を 12 分割なら 3mm。
 * 判定に影響しない一方、区間ごとに交差を調べるので費用は分割数に比例する。
 */
export const TRAJECTORY_STEPS = 12

/** その距離まで飛ぶのにかかる時間 (秒) */
export function flightTime(range: number, speed: number): number {
  return range / speed
}

/**
 * 発射から t 秒後の、銃口からの相対位置。
 *
 * @param dir 発射方向 (正規化済み)
 * @param out 書き込み先。使い回して割り当てを避ける
 */
export function bulletOffset<T extends Point3>(
  dir: Point3,
  t: number,
  speed: number,
  gravity: number,
  out: T,
): T {
  const travelled = speed * t
  out.x = dir.x * travelled
  out.y = dir.y * travelled - 0.5 * gravity * t * t
  out.z = dir.z * travelled
  return out
}

/**
 * その距離での落差 (m)。**狙点からどれだけ下に当たるか。**
 *
 * 「距離を読む」という判断が生まれるかは、この値が見て分かる大きさかどうかで
 * 決まる。武器を足すときはここで確かめる。
 */
export function bulletDrop(range: number, speed: number, gravity: number): number {
  const t = flightTime(range, speed)
  return 0.5 * gravity * t * t
}

/**
 * 弦からの最大のずれ (m)。**銃口と着弾点を直線で結んだときの膨らみ。**
 *
 * サーバーは申告を**直線で**検算している (judge/hitcheck.ts) 一方、撃った側の
 * 弾は放物線を描く。**別の道を見ている**ことになるので、その差がどれだけかを
 * ここで測れるようにしておく。
 *
 * 放物線と弦のずれは落差のちょうど 1/4 (g·t²/8)。AK47 が 80m 先を撃って 4.5cm。
 *
 * --- 膨らむのは上 ---
 * **弧は弦より上を通る。** 落ちるぶんを見越して上へ狙うので、途中は銃口と
 * 着弾点を結ぶ直線より高い所にある。放り投げた球が手と的の直線より上を通るのと
 * 同じ。
 *
 * ずれる向きが悪い側になる。直線で検算すると、**低い遮蔽を越えて届いた弾を
 * 「壁の裏」と弾く** — 当てたのに何も起きず、しかも撃った側には理由が分からない。
 *
 * 速い銃は膨らみが 5cm 未満で、検算が元から許している肩幅のぶれ (0.55m) に
 * 埋もれるので直線で足りる。**麻酔銃 (120 m/s) は 80m で 54cm** 膨らむので
 * 埋もれない。judge/hitcheck.ts はこの値を受け取って、大きいときだけ弧で調べる。
 */
export function bulletSag(range: number, speed: number, gravity: number): number {
  return bulletDrop(range, speed, gravity) / 4
}
