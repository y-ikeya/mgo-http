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
  /**
   * しゃがみ (Space / ✕) の長押しと見なす時間 (秒)。越えたら転がる・伏せる。
   * 短いほどしゃがもうとして転がりやすい (本人 2026-11-16「シビアすぎる」)
   */
  longPress: number
}

export const DEFAULT_LOOK_SCALE: LookScale = { mouseHip: 1, mouseAim: 1, padHip: 1, padAim: 1, listInvert: false, longPress: 0.17 }

/** 選べる幅。0 にすると向きが変えられなくなる */
export const LOOK_SCALE_MIN = 0.2
export const LOOK_SCALE_MAX = 3
/** 長押しの時間の幅 (秒)。人がキーを叩く時間はおよそ 0.1 秒なので、それより下は単押しが転がる */
export const LONG_PRESS_MIN = 0.12
export const LONG_PRESS_MAX = 0.45

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
      longPress:
        typeof value.longPress === 'number' && Number.isFinite(value.longPress)
          ? Math.min(LONG_PRESS_MAX, Math.max(LONG_PRESS_MIN, value.longPress))
          : DEFAULT_LOOK_SCALE.longPress,
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
