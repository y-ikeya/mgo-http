import type { HitZone } from '../rule/damage'
import { POSE_CURVES, POSE_STEP } from './poseCurves'

/**
 * 型の途中の体の部位の位置 (表は poseCurves.ts、tools/measure_pose_curves.py で測った物)。
 *
 * 審判は部位を姿勢ごとの決まった高さで見ている。倒れていく・転がっている間は画面の体が
 * その高さに無いので、**その型に入ってからの時間**で表を引く
 * (2026-10-30 本人「倒れてる敵はそのモーションで当たり判定させるのはダメなの？」→ まず stun の倒れと rolling)。
 */

/** ローリングの再生速度。クリップのままだと転がりが緩慢に見える (画面 animation.ts と審判が同じ値で流す) */
export const ROLL_TIME_SCALE = 1.32

const RATE: Record<keyof typeof POSE_CURVES, number> = { sleep: 1, roll: ROLL_TIME_SCALE }

/** 部位の位置。高さは足元から、前は体の正面へ (m)。範囲は縦の筒の下端と上端 */
export interface ZoneShape {
  up: number
  forward: number
  low: number
  high: number
}

const ROWS = { HEAD: 'head', BODY: 'body', LEGS: 'legs' } as const

/** 表のある型なら、その時刻の部位の位置。無い型は null (姿勢ごとの高さで見る) */
export function zoneAt(locomotion: string, age: number, zone: HitZone): ZoneShape | null {
  if (!(locomotion in POSE_CURVES)) return null
  const name = locomotion as keyof typeof POSE_CURVES
  const curve = POSE_CURVES[name]
  const rows: readonly (readonly number[])[] = curve[ROWS[zone]]
  const t = Math.min(Math.max(0, age * RATE[name]), curve.duration) / POSE_STEP
  const i = Math.min(Math.floor(t), rows.length - 1)
  const j = Math.min(i + 1, rows.length - 1)
  const k = t - i
  const at = (n: number) => rows[i][n] + (rows[j][n] - rows[i][n]) * k
  const up = at(0)
  const forward = at(1)
  // 頭は 1 点
  return rows[i].length > 2 ? { up, forward, low: at(2), high: at(3) } : { up, forward, low: up, high: up }
}
