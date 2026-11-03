/**
 * **その動作ができるか。** 体の状態を **4 つの軸** (姿勢・動作中・倒れ・手) の値にして、表 (MOVES) で決める。
 *
 * --- なぜ表か ---
 * 動作ごとの入口 (roll / vault / setProne / stab / grabLadder …) に条件を手書き
 * していた頃は、動作を 1 つ足すたびに他の全部の入口へ if を足しに行くことになり、
 * 抜けた。「何ができるか」を読む場所も、遊びを変えるときに触る場所も、ここ 1 か所にする。
 *
 * --- 正はスプレッドシート (2026-11-03 本人「星取表を実装に落とす」) ---
 * 表の中身 (movesTable.ts) はシートの軸のタブから**書き出した物**。手で直さない —
 * シートを直して `bun tools/moves_sheet.ts import`。写し (moves.csv) と表が一致しているかは
 * moves.test.ts が見るので、取り込み忘れ・手で直したのは CI で落ちる。
 *
 * --- 読み方 ---
 * 軸ごとに「その値ならできる」値の並び。**軸の中は どれか (OR)、軸どうしは 全部 (AND)。**
 * 軸が書いていなければ関係ない。旗 (BodyState) は体が持っている語のまま受けて、ここで軸の値に直す
 * (axesOf)。位置に依る条件 (目の前に枠があるか、下が深いか) や時間の縛り (倒れて背中が着くまで
 * 構えない) は表に書かない — 表は「してはいけない」を決め、入口はその上で自分の条件を見る
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

/**
 * 軸と、その値。**1 つの軸の中では必ずどれか 1 つだけが当てはまる** (MECE)。
 * 名前の日本語 (シートの見出し) との対応は tools/moves_sheet.ts
 */
export const AXES = {
  posture: ['stand', 'crouch', 'prone', 'box', 'ladder', 'hang', 'air', 'water'],
  action: ['none', 'roll', 'vault', 'proneShift', 'crawl', 'stab', 'cqc', 'step', 'landing', 'salute', 'bump', 'flinch'],
  down: ['none', 'downed', 'standingUp', 'sleep', 'trapped', 'dead'],
  hand: ['aiming', 'relaxed'],
} as const

export type Axis = keyof typeof AXES
export type AxisValue<A extends Axis> = (typeof AXES)[A][number]
export type BodyAxes = { [A in Axis]: AxisValue<A> }

/**
 * 旗から軸の値へ。**旗は同時に立つことがあるので、強い方を取る順に並べてある。**
 *
 *   倒れ   死 > 眠り > 釘付け > 立ち直り中 > 倒れている
 *   姿勢   梯子 > ぶら下がり > 箱 > 水中 > 伏せ > 空中 > しゃがみ > 立ち
 *   動作中 CQC > 転がり > 跳び越え > 一歩下がる > 刺突 > 伏せへの出入り > 着地 > 怯み > 棒立ち > 敬礼 > 這い
 */
export function axesOf(body: BodyState): BodyAxes {
  const down: BodyAxes['down'] = body.dead
    ? 'dead'
    : body.sleeping
      ? 'sleep'
      : body.trapped
        ? 'trapped'
        : body.standingUp
          ? 'standingUp'
          : body.downed
            ? 'downed'
            : 'none'
  const posture: BodyAxes['posture'] = body.onLadder
    ? 'ladder'
    : body.hanging
      ? 'hang'
      : body.boxed
        ? 'box'
        : body.inWater
          ? 'water'
          : body.prone
            ? 'prone'
            : !body.onGround
              ? 'air'
              : body.crouching
                ? 'crouch'
                : 'stand'
  const action: BodyAxes['action'] = body.cqc
    ? 'cqc'
    : body.rolling
      ? 'roll'
      : body.vaulting
        ? 'vault'
        : body.stepping
          ? 'step'
          : body.stabbing
            ? 'stab'
            : body.proneShifting
              ? 'proneShift'
              : body.landing
                ? 'landing'
                : body.flinching
                  ? 'flinch'
                  : body.bumping
                    ? 'bump'
                    : body.saluting
                      ? 'salute'
                      : body.crawling
                        ? 'crawl'
                        : 'none'
  return { posture, action, down, hand: body.aiming ? 'aiming' : 'relaxed' }
}

export type Move =
  | 'roll'
  | 'vault'
  | 'hang'
  | 'prone'
  | 'rise'
  | 'crouch'
  | 'standUp'
  | 'box'
  | 'unbox'
  | 'ladder'
  | 'aim'
  | 'fire'
  | 'reload'
  | 'stab'
  | 'throw'
  | 'place'
  | 'cqc'
  | 'swap'
  | 'step'
  | 'salute'
  | 'pat'
  | 'struggle'

/** 1 つの動作の決まり。軸ごとに「その値ならできる」並び。**書いていない軸は関係ない** */
export type Rule = { readonly [A in Axis]?: readonly AxisValue<A>[] }

/** 表の中身。シートから書き出した物 (movesTable.ts) */
export const MOVES: Record<Move, Rule> = MOVE_RULES

/** その動作を始められるか */
export function can(body: BodyState, move: Move): boolean {
  return blocker(body, move) === null
}

/**
 * 何に阻まれているか (無ければ null)。**表示と調べ物のため** — 「押したのに動かない」を追うとき、
 * どの軸のどの値で止まったかが分かる (例 'down:sleep')
 */
export function blocker(body: BodyState, move: Move): string | null {
  const rule = MOVES[move]
  const axes = axesOf(body)
  for (const axis of Object.keys(AXES) as Axis[]) {
    const allowed = rule[axis] as readonly string[] | undefined
    if (allowed && !allowed.includes(axes[axis])) return `${axis}:${axes[axis]}`
  }
  return null
}
