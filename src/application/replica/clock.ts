/**
 * サーバーの時計と手元の時計のずれ。**一番早く届いた報せで測る。**
 *
 * サーバーは時刻付きの報せ (試合の知らせの sentAt、往復を測る ping の at) を 1 秒ごとに送る。
 * 「届いた手元の時刻 − 送ったサーバーの時刻」は、時計のずれ + 届くまでの遅れ。遅れは 0 以上で、
 * 一番早く届いた物がずれに一番近い。
 *
 * --- なぜ一番早い物か ---
 * 前は直近の 1 通で直していた (届いた時刻 + 送った時の残り)。**届くのが遅れた 1 通があると、
 * その遅れの分だけ残り時間が長く出る** — 画面が詰まる機械 (1 コマ数秒) や、送り出しの待ち行列が
 * 溜まった時に、残り 12 秒の表示のまま試合が終わった (2026-10-19 本人)。
 *
 * 直近 30 秒の中の一番早い物を使う。手元の時計が合わせ直されても 30 秒で追いつく。
 */
export const CLOCK_WINDOW_MS = 30_000

export interface ServerClock {
  /** 届いた手元の時刻と、そのときの「手元 − サーバー」 */
  samples: { at: number; offset: number }[]
}

export function newServerClock(): ServerClock {
  return { samples: [] }
}

/** サーバーの時刻付きの報せが届いた */
export function observeClock(clock: ServerClock, serverAt: number, localNow: number): void {
  if (!(serverAt > 0)) return
  clock.samples.push({ at: localNow, offset: localNow - serverAt })
  while (clock.samples.length > 0 && clock.samples[0]!.at < localNow - CLOCK_WINDOW_MS) clock.samples.shift()
}

/** サーバーの時刻を手元の時刻へ直す。まだ何も届いていなければそのまま */
export function toLocal(clock: ServerClock, serverTime: number): number {
  if (clock.samples.length === 0) return serverTime
  let offset = Number.POSITIVE_INFINITY
  for (const sample of clock.samples) if (sample.offset < offset) offset = sample.offset
  return serverTime + offset
}
