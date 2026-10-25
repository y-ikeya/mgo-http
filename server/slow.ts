/**
 * サーバーが**詰まった瞬間**をログに残す。
 *
 * /health の刻みの重さは「いま」しか見えない。city で 2 人が同時に往復 600ms を超えて
 * 切られた時 (2026-10-25)、画面はどちらも滑らかで、サーバーが詰まったのか回線なのかを
 * 後から読めなかった。詰まった時だけ、何に何 ms かかったかを残す。
 *
 *     刻みが重い      1 回の刻みが SLOW_TICK_MS を超えた。部屋ごとの内訳を付ける
 *     刻みが遅れた    次の刻みが予定より LATE_TICK_MS 以上遅れて始まった
 *                     (刻みの外 — 届いた通信の処理や GC — で止まっていた)
 *     通信が重い      届いた 1 通の処理が SLOW_MESSAGE_MS を超えた
 *
 * 溢れないように、種類ごとに 1 秒に 1 回まで。間に起きた回数は次の 1 行に数えて出す。
 */

/** これを超えた刻みを出す (ms)。64Hz の 1 刻みは 15.6ms */
export const SLOW_TICK_MS = 50
/** 刻みがこれ以上遅れて始まったら出す (ms) */
export const LATE_TICK_MS = 100
/** これを超えた 1 通の処理を出す (ms) */
export const SLOW_MESSAGE_MS = 20
/** 同じ種類を出す間隔 (ms) */
const QUIET_MS = 1000

const lastAt = new Map<string, number>()
const skipped = new Map<string, number>()

/** 種類 (kind) ごとに 1 秒に 1 回まで出す。出さなかった回数は次の行に添える */
export function reportSlow(kind: string, line: () => string, now = Date.now()): void {
  const last = lastAt.get(kind) ?? 0
  if (now - last < QUIET_MS) {
    skipped.set(kind, (skipped.get(kind) ?? 0) + 1)
    return
  }
  const more = skipped.get(kind) ?? 0
  lastAt.set(kind, now)
  skipped.set(kind, 0)
  console.warn(`${line()}${more > 0 ? ` (この 1 秒で他に ${more} 回)` : ''}`)
}

/** 刻みが始まった時刻を受けて、予定より遅れていれば出す */
export function noteTickStart(startedAt: number, previousStartedAt: number, tickMs: number, heapMb: () => number): void {
  if (previousStartedAt === 0) return
  const late = startedAt - previousStartedAt - tickMs
  if (late >= LATE_TICK_MS) {
    reportSlow('late', () => `[刻み遅れ] ${Math.round(late)}ms 遅れて始まった (刻みの外で止まっていた) heap ${heapMb()}MB`)
  }
}
