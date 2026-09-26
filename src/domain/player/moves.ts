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

interface Rule {
  needs: readonly Flag[]
  not: readonly Flag[]
}

/** 全身の型で体を占める動作。これらの最中は、他の全身の動作を始められない */
const WHOLE_BODY: readonly Flag[] = ['rolling', 'vaulting', 'hanging', 'stabbing']
/** 倒れている・眠っている。何もできない */
const HELPLESS: readonly Flag[] = ['dead', 'downed', 'standingUp', 'sleeping']

export const MOVES: Record<Move, Rule> = {
  // 前へ転がる。伏せからは起き上がる一手を挟ませる。箱を落とされた直後は棒立ち
  roll: {
    needs: ['onGround'],
    not: [...HELPLESS, ...WHOLE_BODY, 'boxed', 'saluting', 'bumping', 'prone', 'onLadder'],
  },
  // 窓枠を跳び越える / 一段上へ乗る。転がりと同じ縛り
  vault: {
    needs: ['onGround'],
    not: [...HELPLESS, ...WHOLE_BODY, 'boxed', 'saluting', 'bumping', 'prone', 'onLadder'],
  },
  // 歩いて縁から出たときに縁へ掴まる。転がり・跳び越え・梯子・水・伏せからは落ちる
  hang: {
    needs: [],
    not: [...HELPLESS, ...WHOLE_BODY, 'onLadder', 'inWater', 'prone', 'boxed'],
  },
  // 伏せる。刺突は全身の型なので、伏せに入る型と同時には流せない
  prone: {
    needs: ['onGround'],
    not: [...HELPLESS, 'boxed', 'stabbing', 'vaulting', 'hanging', 'onLadder', 'prone'],
  },
  // しゃがみの切り替え。倒れ・箱・伏せは呼ぶ側で別の動作 (起きる・脱ぐ・起き上がる) に振る
  crouch: {
    needs: ['onGround'],
    not: ['dead', 'saluting', 'standingUp', 'vaulting', 'hanging'],
  },
  // ナイフで刺す。伏せたままでも刺せる (prone_stab)
  stab: {
    needs: [],
    not: [...HELPLESS, 'boxed', 'saluting', 'bumping', 'rolling', 'vaulting', 'hanging', 'onLadder'],
  },
  // 敬礼。構えている間はしない
  salute: {
    needs: [],
    not: [...HELPLESS, 'boxed', 'rolling', 'stabbing', 'vaulting', 'hanging', 'aiming', 'bumping', 'onLadder'],
  },
  // 梯子を掴む。受け身の最中は掴めない
  ladder: {
    needs: [],
    not: [...HELPLESS, 'onLadder', 'boxed', 'rolling', 'vaulting', 'hanging', 'prone', 'saluting', 'bumping', 'landing'],
  },
  // ダンボールを被る。箱はしゃがんだ体に被せてあるので伏せたままは被れない
  box: {
    needs: ['onGround'],
    not: [...HELPLESS, ...WHOLE_BODY, 'bumping', 'prone', 'saluting', 'onLadder'],
  },
  // 構える。全身の型の最中は構えの上半身を乗せられない
  aim: {
    needs: [],
    not: [...HELPLESS, 'saluting', 'rolling', 'vaulting', 'hanging'],
  },
  // 投げる (手榴弾・デコイ)。梯子と箱は両手が塞がっている。転がりは全身の型
  throw: {
    needs: [],
    not: [...HELPLESS, 'boxed', 'onLadder', 'rolling', 'vaulting', 'hanging'],
  },
  // 置く (クレイモア)。投げると同じ
  place: {
    needs: [],
    not: [...HELPLESS, 'boxed', 'onLadder', 'rolling', 'vaulting', 'hanging'],
  },
  // 麻酔で眠る。倒れている体には効かせない (もう倒れている)
  sleep: {
    needs: [],
    not: ['dead', 'downed'],
  },
}

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
