/**
 * 点と Lv。
 *
 * --- 陣営の勝敗とは別のもの ---
 * TDM の勝敗は**残機の削り合い**で決まる (server/index.ts の TICKETS)。
 * 点はそこに関わらない。**個人に紐づく経験値**で、積み上がると Lv が上がる。
 *
 * 一度は点で勝敗を決めていたが、やめた。理由は 2 つ:
 *
 *   - 勝ち方が読みにくい。「あと何点で勝ち」は「あと何人倒せば勝ち」より遠い
 *   - 自死の扱いが歪む。点だと「自死は敵に渡さないぶん得」が成り立ってしまい、
 *     -5 のような重い罰で塞ぐしかなかった。残機なら**死因を問わず 1 減る**ので、
 *     どう死んでも自陣の損は同じ・敵の得も同じ (ゼロ) で、抜け道が最初から無い
 *
 * 点のほうは「その人がどれだけやったか」を測るものとして残す。ここでは
 * 自死を重く見る意味があるので -5 のまま — Lv は腕前の看板なので、
 * 自分で死んだぶんは重く引く。
 */

/** 倒したとき入る点 */
export const KILL_POINTS = 3

/** 倒されたとき引く点 */
export const DEATH_POINTS = -2

/**
 * 自分で死んだときに引く点。
 *
 * 倒されると自分 -2 / 相手 +3 で差が 5 開く。自死を -2 で済ませると差が 2 に
 * しかならず、**Lv を上げる上では自死のほうが得**になる。-5 なら差が揃う。
 */
export const SUICIDE_POINTS = DEATH_POINTS - KILL_POINTS

/**
 * その人の点。
 *
 * **自死を別に受け取る。** deaths には自死も含まれているので、引き算で
 * 「倒された数」を出す。これが無いと自死の重みが二重に効く。
 */
export function pointsOf(record: {
  kills: number
  deaths: number
  suicides: number
}): number {
  const killed = record.deaths - record.suicides
  return record.kills * KILL_POINTS + killed * DEATH_POINTS + record.suicides * SUICIDE_POINTS
}

/**
 * Lv が 1 上がるのに要る点の刻み。
 *
 * Lv L に届く点は `LEVEL_STEP × L × (L-1)` — 上がるほど必要な点が増える。
 *
 *   Lv2 = 50 / Lv3 = 150 / Lv4 = 300 / Lv5 = 500 / Lv10 = 2250
 *
 * 良い試合 1 回でおよそ +14 点 (10 キル 8 デス) なので、Lv2 まで数試合、
 * Lv10 は相当遊んだ人、くらいの見当。**回してから詰める数字**。
 */
export const LEVEL_STEP = 25

/** その Lv に届くのに要る通算点 */
export function pointsForLevel(level: number): number {
  return LEVEL_STEP * level * (level - 1)
}

/**
 * 通算点から Lv。**下限は 1。**
 *
 * 点はマイナスにもなる (負け続ければ減る)。Lv 1 より下は作らない —
 * 「マイナス Lv」に意味を持たせようがないし、始めたばかりの人と区別も付かない。
 */
export function levelOf(points: number): number {
  if (points <= 0) return 1
  // pointsForLevel の逆。25L² - 25L - points = 0 を解く
  return Math.floor(
    (LEVEL_STEP + Math.sqrt(LEVEL_STEP * LEVEL_STEP + 4 * LEVEL_STEP * points)) / (2 * LEVEL_STEP),
  )
}

/** いまの Lv の中でどこまで来たか。0..1。次の Lv までの帯に使う */
export function levelProgress(points: number): number {
  const level = levelOf(points)
  const from = pointsForLevel(level)
  const to = pointsForLevel(level + 1)
  if (to <= from) return 0
  return Math.min(1, Math.max(0, (points - from) / (to - from)))
}
