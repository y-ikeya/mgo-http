/**
 * 姿勢の規則。
 *
 * 「いまどのモーションであるべきか」と「そのモーションが何を意味するか」を
 * ここにまとめる。three.js に依存しないので、サーバー (bun) がそのまま読める。
 *
 * --- なぜ 1 本にするか ---
 * 姿勢は 3 か所で解釈されている。動かす側 (player)、映す側 (remotePlayer)、
 * 判定する側 (server)。同じ名前の状態を別の意味で読むと、片方だけ壊れる。
 *
 * 実際に起きた: 敬礼は送る側では「途中で止めて挙げ続ける」全身動作だったのに、
 * 受け取る側では移動モーションとして扱われ、挙げて下ろしてを繰り返した。
 * 同じ規則を 2 か所に書いたことが原因で、名前は合っているのに意味が違った。
 *
 * 頭の高さも同じ形の穴だった。遮蔽の判定に使う 1.47 / 0.94 は
 * クリップから実測した値なのに、モーションを差し替えても黙って古いままになる。
 */

import { locomotionFor, MOVE_DIRECTIONS, type Locomotion } from './locomotion'

/**
 * 体の構え。頭の高さと足音の届く距離がこれで決まる。
 *
 * 8 方向の区別は含めない。向きは「どちらへ歩いているか」であって構えではない。
 */
export type Stance = 'stand' | 'crouch' | 'box' | 'prone' | 'down'

/**
 * 全身の型。上下のレイヤーを分けず、頭から流して終わるまで戻さない動作。
 *
 * 受け取る側はこの集合を見て「切り替わった瞬間に再生し直す」を決める。
 * 移動モーションと同じ扱いにすると、ループして永久に繰り返す。
 */
export const WHOLE_BODY: ReadonlySet<Locomotion> = new Set<Locomotion>([
  'roll',
  'stab',
  'death',
  'salute',
  'jump_down',
  'sweep',
  'stand',
  // 切れた人の姿。上半身だけ別の型を重ねると、銃を構えたまま固まる
  'away',
  // クレイモアを置く。かがむので上下を分けられない
  'claymore_windup',
  'claymore_place',
])

/** そのモーションのときの構え */
export function stanceOf(locomotion: Locomotion): Stance {
  if (locomotion === 'death') return 'down'
  // 爆風で倒れている間。起き上がりの途中も含めて低い姿勢として扱う
  if (locomotion === 'sweep' || locomotion === 'stand') return 'prone'
  if (locomotion === 'sneak' || locomotion === 'sit') return 'box'
  // クレイモアはかがんで置く。頭が下がるので、見つかりにくさもしゃがみと同じ
  if (locomotion === 'claymore_windup' || locomotion === 'claymore_place') return 'crouch'
  if (locomotion === 'crouch_idle' || locomotion.startsWith('crouch_')) return 'crouch'
  return 'stand'
}

/**
 * 構えごとの頭の高さ (m)。tools/measure/crouch_size.js の実測値。
 *
 * ダンボールで静止すると 0.59m まで下がるが、遮蔽の判定では採らない。
 * 見えるはずの相手を送り忘れると「居るのに映らない」になるのに対し、
 * 見えない相手を送ってしまうのは覗き見の余地が少し残るだけで済む。
 * 迷ったら送る側に倒す。
 */
export const HEAD_HEIGHT: Record<Stance, number> = {
  stand: 1.47,
  crouch: 0.94,
  box: 0.94,
  // 伏せている間。実測で頭が 0.11m まで下がるが、起き上がりの途中は上がるので
  // その中間を採る。低く採りすぎると「見えているのに映らない」が起きる
  prone: 0.5,
  down: 0.3,
}

/** そのモーションのときの頭の高さ */
export function headHeightOf(locomotion: Locomotion): number {
  return HEAD_HEIGHT[stanceOf(locomotion)]
}

/**
 * 止まったと見なす速さ / 動き出したと見なす速さ (m/s)。
 *
 * 入りと出でしきい値を変える。1 つだと境目で毎フレーム切り替わって足踏みになる。
 */
export const IDLE_ENTER_SPEED = 0.2
export const IDLE_EXIT_SPEED = 0.6

/** 姿勢を決めるのに要るもの。どこから来た値かは問わない */
export interface StanceInput {
  /** 直前のモーション。しきい値のヒステリシスに使う */
  previous: Locomotion
  down: boolean
  boxed: boolean
  crouching: boolean
  aiming: boolean
  saluting: boolean
  stabbing: boolean
  /** クレイモアを置いている最中の姿勢。置いていなければ null */
  setting: 'claymore_windup' | 'claymore_place' | null
  /** 爆風で倒れているか */
  downed: boolean
  /**
   * 起き上がっている最中か。
   *
   * 倒れているのと分けて持つ。「直前が stand かどうか」で見分けようとすると、
   * 倒れた直後は previous が sweep なので永久に起き上がりへ移れない。
   * 実際に起きた: 下半身だけ idle に戻り、立ったまま腕を前へ伸ばす形になった
   */
  standingUp: boolean
  rolling: boolean
  onGround: boolean
  /** 着地モーションの残り時間 (秒) */
  landing: number
  /** 上下の速度 (m/s)。空中で上昇と下降を分ける */
  velocityY: number
  /** 入力された移動方向 (ワールド、正規化済み)。停止なら 0 */
  dirX: number
  dirZ: number
  /** 押し戻し後の実際の速さ (m/s)。壁に押し付けている間は 0 に近い */
  actualSpeed: number
  /** 体の向き (rad) */
  yaw: number
}

/**
 * いま再生すべきモーションを決める。
 *
 * 上から順に「他に移れない状態」を落としていく。倒れている > 箱 > 敬礼 >
 * 全身動作 > 空中 > 着地 > 停止 > 8 方向。
 */
export function resolveLocomotion(input: StanceInput): Locomotion {
  // 倒れたら他の何にも移らない
  if (input.down) return 'death'
  // 爆風で倒れている間。起き上がりは中断できないので、倒れているより先に見る
  if (input.standingUp) return 'stand'
  if (input.downed) return 'sweep'

  // ダンボールを被っている間は専用の姿勢。8 方向には分けず、動いているかだけ見る
  // (箱で隠れていて向きの違いが見えないので、方向ごとのクリップは無駄になる)。
  if (input.boxed) {
    const threshold = input.previous === 'sneak' ? IDLE_ENTER_SPEED : IDLE_EXIT_SPEED
    const moving = hasDirection(input) && input.actualSpeed >= threshold
    // 止まったら座る。頭が下がって箱の中に完全に収まる
    return moving ? 'sneak' : 'sit'
  }

  // 敬礼。動けば解ける (解く操作は呼ぶ側が行う)
  if (input.saluting && !hasDirection(input)) return 'salute'

  // 刺突・設置・ローリングは全身動作。終わるまで移動モーションに戻さない
  if (input.setting) return input.setting
  if (input.stabbing) return 'stab'
  if (input.rolling) return 'roll'

  // 空中では上昇と下降でモーションを分ける。クリップの終了ではなく速度で
  // 切り替えるので、滞空時間が変わっても破綻しない
  if (!input.onGround) return input.velocityY > 0 ? 'jump_up' : 'jump_loop'
  if (input.landing > 0) return 'jump_down'

  const stopping =
    input.previous === 'idle' || input.previous === 'crouch_idle'
      ? IDLE_EXIT_SPEED
      : IDLE_ENTER_SPEED
  if (input.actualSpeed < stopping || !hasDirection(input)) {
    return input.crouching ? 'crouch_idle' : 'idle'
  }

  return locomotionFor(input.crouching, directionOf(input.dirX, input.dirZ, input.yaw))
}

/**
 * 移動方向を体の向きから見た 8 方向へ落とす。
 *
 * 4 方向だったときは斜め 45° がちょうど 2 つの境界に乗るため、毎フレーム
 * 状態が入れ替わらないようヒステリシスを入れていた。8 方向なら斜めが
 * クリップの真ん中に来るので、その小細工が要らない。
 */
export function directionOf(dirX: number, dirZ: number, yaw: number) {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // 前方 (-sinθ, -cosθ) と右 (cosθ, -sinθ) への射影
  const forward = dirX * -sin + dirZ * -cos
  const right = dirX * cos + dirZ * -sin
  const step = Math.PI / 4
  return MOVE_DIRECTIONS[Math.round(Math.atan2(right, forward) / step) & 7]
}

function hasDirection(input: StanceInput): boolean {
  return input.dirX * input.dirX + input.dirZ * input.dirZ > 1e-6
}
