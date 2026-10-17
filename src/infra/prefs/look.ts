/**
 * 視点の感度。**マウスとパッド、構えていない時と構えている時の 4 本** (本人 2026-10-15)。
 *
 * どれも倍率で、1 が既定。マウスとパッドはちょうどよい速さが大きく違うので分けて持つ。
 * この端末のこの人だけの好みなので、ここ (ブラウザ) に覚える。読めなければ既定。
 */
const KEY = 'mgo.look'

export interface LookScale {
  mouseHip: number
  mouseAim: number
  padHip: number
  padAim: number
  /** 武器の一覧を右スティックで送る向きを逆にする (本人 2026-10-16) */
  listInvert: boolean
}

export const DEFAULT_LOOK_SCALE: LookScale = { mouseHip: 1, mouseAim: 1, padHip: 1, padAim: 1, listInvert: false }

/** 選べる幅。0 にすると向きが変えられなくなる */
export const LOOK_SCALE_MIN = 0.2
export const LOOK_SCALE_MAX = 3

const clamp = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(LOOK_SCALE_MAX, Math.max(LOOK_SCALE_MIN, v)) : 1

export function loadLookScale(): LookScale {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const value = raw ? (JSON.parse(raw) as Partial<LookScale>) : {}
    return {
      mouseHip: clamp(value.mouseHip),
      mouseAim: clamp(value.mouseAim),
      padHip: clamp(value.padHip),
      padAim: clamp(value.padAim),
      listInvert: value.listInvert === true,
    }
  } catch {
    return { ...DEFAULT_LOOK_SCALE }
  }
}

export function saveLookScale(value: LookScale): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(value))
  } catch {
    // 書けなくても今の試合には効いている。次に開いた時に既定へ戻るだけ
  }
}
