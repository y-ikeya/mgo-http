/**
 * 画質。**描く細かさを、この端末に合わせて選ぶ** (本人 2026-10-19。バーで、右が細かい)。
 *
 * 値は画面の 1 画素 (CSS の 1px) に何画素描くか。高解像度の画面 (Retina、2.8K の ThinkPad) で
 * 2 倍で描くと、毎コマ 4 倍の画素を塗る。内蔵 GPU にはそれが重く、詰まって遅延で切られていた。
 * ステージは細部まで作り込んでいないので、2 倍で描いても見違えない — 既定は 1 (画面の画素のまま)。
 * 画面の細かさより上は描かない (描く側で devicePixelRatio に抑える)。
 *
 * 影の細かさは入れていない。試合中に影の画素数を変えると、three r185 の WebGPU が使用中の
 * 影の絵を捨てて、以後ずっと何も描けなくなった (Destroyed texture "ShadowDepthTexture")。
 *
 * この端末のこの人だけの好みなので、ここ (ブラウザ) に覚える。読めなければ既定。
 */
const KEY = 'mgo.quality'

export const RENDER_SCALE_MIN = 0.5
export const RENDER_SCALE_MAX = 2
export const DEFAULT_RENDER_SCALE = 1

export function loadRenderScale(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(KEY))
    return Number.isFinite(value) && value > 0
      ? Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, value))
      : DEFAULT_RENDER_SCALE
  } catch {
    return DEFAULT_RENDER_SCALE
  }
}

export function saveRenderScale(value: number): void {
  try {
    globalThis.localStorage?.setItem(KEY, String(value))
  } catch {
    // 書けなくても今の試合には効いている。次に開いた時に既定へ戻るだけ
  }
}
