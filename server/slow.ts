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

import { readFileSync } from 'node:fs'

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

/**
 * 前の刻みからの CPU の使われ方。**止まっていた間に何をしていたか**を分ける (2026-11-09)。
 *
 * 13:33 にサーバーが 22.7 秒止まり、全員の往復が数秒に延びて 1 人切られた。1 通ごとの
 * 処理は軽く (通信重い は 20〜50ms)、heap も 120MB のまま。止まっていた間に
 *
 *     JS が CPU を使い続けていた (cpu ≒ 止まっていた長さ) → 測っていない所で回っている
 *     ほとんど使っていない (cpu ≒ 0)                      → OS / 仮想機械に待たされた
 *
 * のどちらかを、遅れの行に一緒に出す。steal は仮想機械の CPU を他に取られた時間
 * (Lightsail の CPU の使用枠を使い切ると増える)。Linux の /proc/stat から読み、無ければ出さない
 */
let previousCpu = process.cpuUsage()
let previousSteal = readSteal()

/** 全 CPU の steal の累計 (ms)。読めなければ null */
function readSteal(): number | null {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0] as string
    // cpu  user nice system idle iowait irq softirq steal ...  (単位は 1/100 秒)
    const steal = Number(line.trim().split(/\s+/)[8])
    return Number.isFinite(steal) ? steal * 10 : null
  } catch {
    return null
  }
}

/**
 * 刻みの外でした仕事 (届いた通信・HTTP) の、種類ごとの数と時間。**刻みが遅れた時の内訳に出す** (2026-11-20)。
 *
 * 11/19 23:55 に刻みが 10 秒ほど 1 秒ずつ遅れ (CPU は使い切り、steal 0)、kome27 が遅延で切られた。
 * 1 通ごとの処理は 20ms を超えず「通信重い」に出なかったので、何が CPU を使っていたか読めなかった。
 * 軽い 1 通が大量に来たのか、測っていない所で回っているのかを、ここで分ける
 */
const work = new Map<string, { count: number; ms: number }>()

export function noteWork(kind: string, ms: number): void {
  const entry = work.get(kind)
  if (entry) {
    entry.count++
    entry.ms += ms
  } else work.set(kind, { count: 1, ms })
}

/**
 * 溜めた仕事の内訳 (重い順に 6 つ)。**CPU の使用量から測った分を引いた残り**も出す — 残りが大きければ
 * コードの外 (Bun 自身の送受信・GC・await の後の続き) で使っている
 */
function workLine(usedMs: number): string {
  const entries = [...work].sort((a, b) => b[1].ms - a[1].ms)
  const total = entries.reduce((sum, [, e]) => sum + e.ms, 0)
  const top = entries.slice(0, 6).map(([kind, e]) => `${kind} ${e.count}回 ${Math.round(e.ms)}ms`)
  return ` 内訳 測った分 ${Math.round(total)}ms (${top.join(' / ') || 'なし'}) 測っていない ${Math.max(0, Math.round(usedMs - total))}ms`
}

/**
 * メモリの取り合い。**このプロセスがディスクから読み直した回数 (majflt) と、機械がメモリを空けるために
 * 探した頁 (pgscan)** の累計。機械は 911MB しかなく交換領域も無い。11/19 の詰まりが入った 10 分 (sar) には
 * 頁の回収が出ていた (2026-11-20)。詰まった時にそれが重なっていたかを、遅れの行に一緒に出す。読めなければ null
 */
function readMemoryPressure(): { majflt: number; pgscan: number } | null {
  try {
    // /proc/self/stat の 12 番目が majflt (名前に空白が入り得るので、閉じ括弧の後から数える)
    const stat = readFileSync('/proc/self/stat', 'utf8')
    const majflt = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[9])
    let pgscan = 0
    for (const line of readFileSync('/proc/vmstat', 'utf8').split('\n')) {
      if (line.startsWith('pgscan_kswapd ') || line.startsWith('pgscan_direct ')) pgscan += Number(line.split(' ')[1])
    }
    return Number.isFinite(majflt) ? { majflt, pgscan } : null
  } catch {
    return null
  }
}
let previousMemory = readMemoryPressure()

/** 刻みが始まった時刻を受けて、予定より遅れていれば出す */
export function noteTickStart(startedAt: number, previousStartedAt: number, tickMs: number, heapMb: () => number): void {
  const cpu = process.cpuUsage(previousCpu)
  previousCpu = process.cpuUsage()
  const steal = readSteal()
  const stolen = steal !== null && previousSteal !== null ? steal - previousSteal : null
  previousSteal = steal
  const memory = readMemoryPressure()
  const memoryLine =
    memory && previousMemory
      ? ` 読み直し ${memory.majflt - previousMemory.majflt} 回 頁の回収 ${memory.pgscan - previousMemory.pgscan} 頁`
      : ''
  previousMemory = memory
  if (previousStartedAt === 0) return
  const late = startedAt - previousStartedAt - tickMs
  if (late >= LATE_TICK_MS) {
    const used = Math.round((cpu.user + cpu.system) / 1000)
    reportSlow(
      'late',
      () =>
        `[刻み遅れ] ${Math.round(late)}ms 遅れて始まった (刻みの外で止まっていた) heap ${heapMb()}MB` +
        ` その間の CPU ${used}ms${stolen !== null ? ` steal ${stolen}ms` : ''}` +
        memoryLine +
        workLine(used),
    )
  }
  work.clear()
}
