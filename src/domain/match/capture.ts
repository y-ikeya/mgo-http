import type { Team } from '../player/player'
import type { Zone } from '../stage'

/**
 * CAP (キャプチャー) の決まり。**target を 1 つ両陣営で取り合い、自陣の設置ポイントで持ち続ける。**
 *
 * 本人 2026-10-26 (MGO2 の CAP から):
 *
 *     target       1 つ。置き場所は blend の meta_cap_target*。取り方・落とし方・30 秒で戻るのは
 *                  TSNE のターゲットと同じ (domain/match/target.ts)。両陣営が取れる
 *     設置ポイント  陣営ごとに 1 つ (meta_cap_base_blue / _red、4m × 4m)。**相手の陣地の近く**に置く
 *                  — 相手は湧いてすぐ取り返しに来られるので、持ち込んだ側も油断できない
 *     カウント     陣営ごとに 60 秒。target を持った人が自陣の設置ポイントに居る間だけ減る
 *                  (置く物ではない。出る・落とすと止まる)
 *     勝ち         先に 0 にした側。時間切れは多く減らした側、同じならサドンデス
 *                  (先にカウントを進めた側の勝ち)
 *     復活         何度でも。倒されるたびに倒れたままの時間が延びる (lifecycle.ts の downSeconds)
 *
 * ここは決まりだけ。いつ問うかはサーバー (server/capture.ts) が決める。
 */

/** 陣営ごとのカウント (ms) */
export const CAP_COUNT_MS = 60_000

/**
 * 設置ポイントの床からどこまでを「中に居る」とするか (m)。上は頭より上まで (跳んでも出ない)、
 * 下は段差ほど。**上の階・下の階から設置ポイントの真上 / 真下に立っても数えない**
 */
const GOAL_ABOVE = 2.5
const GOAL_BELOW = 0.3

export interface Capture {
  /** 残りのカウント (ms)。0 にした側の勝ち */
  count: Record<Team, number>
  /** 時間切れで並んだ。以後、先にカウントを進めた側の勝ち */
  suddenDeath: boolean
  /** いまカウントを進めている陣営 (target を持った人が自陣の設置ポイントに居る)。居なければ null */
  holding: Team | null
}

export function newCapture(): Capture {
  return { count: { blue: CAP_COUNT_MS, red: CAP_COUNT_MS }, suddenDeath: false, holding: null }
}

/** その足元が設置ポイントの中か */
export function inGoal(zone: Zone, x: number, y: number, z: number): boolean {
  return (
    Math.abs(x - zone.x) <= zone.halfX &&
    Math.abs(z - zone.z) <= zone.halfZ &&
    y >= zone.y - GOAL_BELOW &&
    y <= zone.y + GOAL_ABOVE
  )
}

/** dt (ms) 進める。**持っている陣営のカウントだけ減る** (0 で止まる) */
export function countDown(capture: Capture, holding: Team | null, dt: number): Capture {
  if (!holding) return capture.holding === null ? capture : { ...capture, holding: null }
  const count = { ...capture.count, [holding]: Math.max(0, capture.count[holding] - dt) }
  return { ...capture, count, holding }
}

/**
 * 決着したか。**決まっていなければ null** (続ける)。
 *
 *   どちらかが 0          その側の勝ち
 *   サドンデス中に差が付いた  減らした側の勝ち
 *   時間切れで差がある      減らした側 (残りの少ない側) の勝ち
 *   時間切れで並んだ        null (呼ぶ側がサドンデスに入れる)
 */
export function captureWinner(capture: Capture, timeUp: boolean): Team | null {
  const { blue, red } = capture.count
  if (blue <= 0) return 'blue'
  if (red <= 0) return 'red'
  if (!capture.suddenDeath && !timeUp) return null
  if (blue === red) return null
  return blue < red ? 'blue' : 'red'
}
