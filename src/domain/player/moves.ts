/**
 * **その動作ができるか。** 体の状態を 1 つの構造体で受けて、表 (MOVES) で決める。
 *
 * --- なぜ表か ---
 * 動作ごとの入口 (roll / vault / setProne / stab / grabLadder …) に条件を手書き
 * していた頃は、動作を 1 つ足すたびに他の全部の入口へ if を足しに行くことになり、
 * 抜けた。ぶら下がりを足したときは「転がり中」の旗にぶら下がりを混ぜて全部の
 * 入口を塞ぐ、という雑な繋ぎ方をした。「何ができるか」を読む場所も、遊びを変える
 * ときに触る場所も、ここ 1 か所にする。
 *
 * --- 書き方 ---
 * needs は**全部立っている**必要がある旗、not は**1 つでも立っていたら**できない旗。
 * 旗の名前は体 (presentation の soldier) が持っている語をそのまま使う。
 * 位置に依る条件 (目の前に枠があるか、下が深いか) は表に書かない — それは
 * 「できるか」ではなく「そこにあるか」なので、呼ぶ側が地形に聞く。
 */

import { MOVE_RULES } from './movesTable'

/** 体の状態。soldier が持っている旗を 1 つにまとめた物 */
export interface BodyState {
  /** 足が地面に着いている */
  onGround: boolean
  /** 倒された (死んでいる) */
  dead: boolean
  /** 爆風で倒れている */
  downed: boolean
  /** 倒れから立ち上がっている最中 */
  standingUp: boolean
  /** 麻酔で眠っている */
  sleeping: boolean
  /** ダンボールを被っている */
  boxed: boolean
  /** 箱を落とされて棒立ちの間 */
  bumping: boolean
  /** 敬礼している */
  saluting: boolean
  /** 刺している */
  stabbing: boolean
  /** 転がっている */
  rolling: boolean
  /** 窓枠を跳び越えている (乗るも含む) */
  vaulting: boolean
  /** 縁にぶら下がっている (落ちる途中・登る途中も) */
  hanging: boolean
  /** 梯子に居る */
  onLadder: boolean
  /** 伏せている (入る途中・起きる途中も) */
  prone: boolean
  /** 着地の硬直中 */
  landing: boolean
  /** 水の中 */
  inWater: boolean
  /** 構えている */
  aiming: boolean
  /** しゃがんでいる (伏せは prone) */
  crouching: boolean
  /** CQC で投げている / 空振りしている (domain/player/cqc.ts)。全身の型 */
  cqc: boolean
  /** 猫に釘付けになっている (解けて戻る途中も。domain/item/doll.ts) */
  trapped: boolean
  /** 構えたまま一歩下がっている (step_back) */
  stepping: boolean
  /** 撃たれて怯んでいる (FLINCH_SECONDS)。動けず、構えられず、転がれず、箱も被れない */
  flinching: boolean
  /** 伏せて這っている (止まって伏せているだけなら立たない) */
  crawling: boolean
  /** 伏せへの出入り・寝返りの型の最中 (prone_down / prone_rise / prone_roll_down) */
  proneShifting: boolean
}

export type Flag = keyof BodyState

export type Move =
  | 'roll'
  | 'vault'
  | 'hang'
  | 'prone'
  | 'crouch'
  | 'stab'
  | 'salute'
  | 'ladder'
  | 'box'
  | 'aim'
  | 'throw'
  | 'place'
  | 'sleep'
  | 'struggle'
  | 'pat'
  | 'cqc'
  | 'swap'
  | 'step'
  | 'fire'
  | 'reload'

export interface Rule {
  needs: readonly Flag[]
  not: readonly Flag[]
}

/**
 * 表の中身。**正はスプレッドシート** (tools/moves_sheet.ts、2026-11-02 本人「その表を見ながらそれを正としながら実装をする」)。
 * 升目を変えたいときはシートを直して `bun tools/moves_sheet.ts import`。理由はシートの「メモ」の行と movesTable.ts の注
 */
export const MOVES: Record<Move, Rule> = MOVE_RULES

/** その動作を始められるか */
export function can(body: BodyState, move: Move): boolean {
  return blocker(body, move) === null
}

/**
 * 何に阻まれているか (無ければ null)。**表示と調べ物のため** — 「押したのに
 * 動かない」を追うとき、旗の名前で分かる。
 */
export function blocker(body: BodyState, move: Move): Flag | null {
  const rule = MOVES[move]
  for (const flag of rule.needs) if (!body[flag]) return flag
  for (const flag of rule.not) if (body[flag]) return flag
  return null
}
