/**
 * 深さバッファを**逆向き** (近くが 1、遠くが 0) に持つか。
 *
 * 浮動小数の精度は 0 の近くに集まるので、逆向きにすると遠くの精度が上がる。
 * 壁から 3mm 浮かせた板 (角の欠け) は、既定の向きだと 10m 先を浅い角度で見た時に
 * 壁と深さが並んで市松に食い合った (2026-10-06 建物 3 の窪みの縁)。逆向きにすると消える。
 *
 * 一度試して戻したことがある (別の原因のチラつきを疑った時)。今回は**切り分けで
 * 効くのを確かめた上で**既定にする。`?rdepth=0` で戻せる。
 *
 * **polygonOffset の符号が裏返る。** three は値をそのまま depthBias に渡すので、
 * 「手前へ寄せる」は既定の向きでは負、逆向きでは正。足元の丸い影 (blobShadow) が使う
 */
export const REVERSED_DEPTH: boolean =
  (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('rdepth') : null) !== '0'

/** 手前へ寄せる polygonOffset の向き (倍率)。既定の深さでは -1、逆向きでは +1 */
export const TOWARD_CAMERA = REVERSED_DEPTH ? 1 : -1

/**
 * 透ける物を**後に描かせる** renderOrder の向き (倍率)。既定の深さでは +1、逆向きでは −1。
 *
 * **three (r185) は深さが逆向きの時、透ける物の描く順の一覧を丸ごと逆にする**
 * (`RenderList.sort` の `reversedDepth`)。奥→手前の並びを直すための逆転だが、renderOrder の
 * 大小まで一緒に裏返る。足元の影に renderOrder 1 を付けて「汚れの板 (0) の後に描く」つもりが、
 * 実際には先に描かれて泥の絵が上に乗った (2026-10-17 本人「デカールの下に影がでちゃってる」)
 */
export const DRAW_LATER = REVERSED_DEPTH ? -1 : 1
