/**
 * 前回選んだ声を覚えておく。**この端末のこの人だけの便利** (装備の prefs と同じ)。
 *
 * 生のまま読んで、丸めるのは呼ぶ側 (domain の fitVoice)。ここは保存と
 * 取り出しだけ。消えても困らない物なので、読めない・書けない時は黙って諦める。
 */
const KEY = 'mgo.voice'

export function loadLastVoice(): { style?: unknown; pitch?: unknown } | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' ? (value as { style?: unknown; pitch?: unknown }) : null
  } catch {
    return null
  }
}

export function saveLastVoice(value: { style: string; pitch: number }): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(value))
  } catch {
    // 書けなくても声は選べている。次に開いた時に既定へ戻るだけ
  }
}
