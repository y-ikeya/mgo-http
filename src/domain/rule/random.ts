/**
 * 決定的な擬似乱数。
 *
 * --- なぜ domain に居るのか ---
 * ハッシュそのものはドメインルールではない。ここに置いてあるのは、**同じ弾から同じ散り方が
 * 出ることがドメインルールの一部**だから。撃った本人とサーバーが独立に同じ値を出せないと、
 * 「散布は当てた側の申告」になって検証しようがない。
 *
 * 層としては sim (幾何) に置きたくなるが、sim は domain から値を import しない
 * 決まりなので、**ドメインルールの側 (反動の乱れ) が使えなくなる**。両方から読める場所は
 * ここしかない。sim へは引いた値を**引数で渡す** (数字を渡すのと同じ形)。
 *
 * `Math.random()` を使わないのは、種を指定できず内部状態も読めないため、
 * クライアントとサーバーで同じ数列を再現できないから。当たり判定に関わる乱数は
 * 両者が独立に同じ値を出せる必要がある。
 *
 * 状態を持たないハッシュ方式にしてある。「今何発目まで引いたか」を同期する必要がなく、
 * パケットが落ちても順序が入れ替わっても、5 発目の乱数は常に 5 発目の乱数になる。
 * サーバーは弾の通し番号を見るだけで、その弾の散らばりを独立に再現・検証できる。
 *
 * 演算は 32bit 整数だけで閉じている。浮動小数点の丸めは言語や CPU で差が出ることが
 * あるため、Rust へ移したときに結果が変わらないようにするための制約。
 * `Math.imul` は Rust の `wrapping_mul` と同じ挙動になる。
 */

/** 乱数の用途。同じ弾でも用途ごとに独立した値を引くための識別子 */
export const RandomStream = {
  recoilPitch: 1,
  recoilYaw: 2,
  spreadAngle: 3,
  spreadRadius: 4,
  /** 散弾の粒。1 発の中で粒ごとに別の向きへ散らす */
  pelletAngle: 5,
  pelletRadius: 6,
} as const

export type RandomStream = (typeof RandomStream)[keyof typeof RandomStream]

/** splitmix32。1 つの 32bit 整数をよく混ざった 32bit 整数へ写す */
function hash32(value: number): number {
  let x = (value + 0x9e3779b9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad)
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97)
  x = x ^ (x >>> 15)
  return x >>> 0
}

/**
 * @param shot 弾の通し番号。将来はここにプレイヤー ID も混ぜる
 * @param stream 用途。同じ弾でも用途が違えば無相関な値になる
 * @returns 0 以上 1 未満
 */
export function randomUnit(shot: number, stream: RandomStream): number {
  const seed = (Math.imul(shot | 0, 0x9e3779b1) ^ Math.imul(stream, 0x85ebca6b)) | 0
  return hash32(seed) / 0x1_0000_0000
}

/** -1 以上 1 未満 */
export function randomSigned(shot: number, stream: RandomStream): number {
  return randomUnit(shot, stream) * 2 - 1
}
