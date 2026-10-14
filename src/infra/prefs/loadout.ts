/**
 * 前回選んだ装備を覚えておく。**この端末のこの人だけの便利。**
 *
 * 次に装備の画面を開いた時、前回の物に印が付いているように (本人 2026-10-14)。
 * 初めての時は印は一覧の先頭 (P90)。部屋で持ち込めない物は呼ぶ側が丸める。
 *
 * 消えても困らない物なので、読めない・書けない時 (内緒の窓、消された保存) は黙って諦める。
 */
const KEY = 'mgo.loadout'

export interface LastLoadout {
  primary?: string | null
  secondary?: string | null
  support?: string
}

export function loadLastLoadout(): LastLoadout | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' ? (value as LastLoadout) : null
  } catch {
    return null
  }
}

export function saveLastLoadout(value: LastLoadout): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(value))
  } catch {
    // 書けなくても装備は選べている。次に開いた時に先頭へ戻るだけ
  }
}
