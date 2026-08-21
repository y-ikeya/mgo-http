/**
 * どのモーションを流すか。
 *
 * --- なぜ domain に置かないか ---
 * 置き場所の基準は**触る理由** (docs/design.md の 7)。ここを触るのは
 * 「動きが変に見える」ときで、**遊びは変わらない**。段差を段と読む落差を
 * 0.15m から 0.2m にしても、誰の判断も変わらない。
 *
 * 構え (立ち / しゃがみ / 箱) は別で、あちらは頭の高さを決めるので遊びが
 * 変わる。domain/player/stance.ts に置いてある。
 *
 * --- なぜ描画から切り離してあるか ---
 * three を読まない。**姿勢を決める規則を 1 本にする**ため — 動かす側と映す側で
 * 別々に書いた頃、敬礼が送る側では「途中で止めて挙げ続ける」全身動作なのに、
 * 受け取る側では移動モーションとして扱われ、挙げて下ろしてを繰り返した。
 * 名前は合っているのに意味が違う、という壊れ方をする。
 */

import {
  locomotionFor,
  MOVE_DIRECTIONS,
  type Locomotion,
} from '../../domain/player/locomotion'

/**
 * 全身の型。上下のレイヤーを分けず、頭から流して終わるまで戻さない動作。
 *
 * 受け取る側はこの集合を見て「切り替わった瞬間に再生し直す」を決める。
 * 移動モーションと同じ扱いにすると、ループして永久に繰り返す。
 */
/**
 * 空中の型へ移るまでの猶予 (秒)。
 *
 * 段 (0.25m) を落ちる浮きは **0.17 秒**、跳躍 (0.6m) は 0.26 秒より長い。
 * その間に線を引く — **階段を下りている間ずっと空中扱い**になると、下りの型が
 * 出ないまま脚だけが宙に浮く (実際そうなっていた)。
 *
 * 0.12 秒にしていた頃は段の浮きを拾ってしまい、階段では常に空中の型が勝っていた。
 */
export const AIR_MOTION_DELAY = 0.22

/**
 * 段差とみなす 1 フレームの上がり幅 (m)。
 *
 * 越えられる段差は 0.25m (domain/player/moving.ts の STEP_UP)。坂は連続して上がるので
 * 1 フレームでは 0.02m ほどしか動かない — その間に線を引く。
 */
export const STAIR_RISE_MIN = 0.08
/**
 * 階段の型を持たせる時間 (秒)。
 *
 * 段を上がった瞬間だけだと、段の上を歩いている間に走りの型へ戻って点滅する。
 * 次の段までを繋ぐ長さにする。
 */
export const STAIR_HOLD = 0.45
/**
 * 段を下りたとみなす落差 (m)。
 *
 * **坂と分けるための下限。** 坂を下ると、地面が逃げるぶんだけ体が遅れて
 * 浮く。追いつくまでの落差は 2·v²/g で決まる — 傾き 0.275 を 3.04 m/s で
 * 下れば沈む速さは 0.84 m/s、落差は **8cm** (重力 17.6 m/s²)。
 * 段 1 つは 25cm。その間に引く。
 */
export const STAIR_DROP_MIN = 0.15
/**
 * 段を下りたとみなす落差の上限 (m)。
 *
 * 走って下りると 1 段飛ばしになるので 2 段ぶん (0.5m) は見る。それより深い
 * 落差は階段ではなく**床から落ちた**ので、着地 (受け身) に譲る。
 */
export const STAIR_DROP_MAX = 0.8

export type WholeBodyLocomotion =
  | 'roll'
  | 'fall_roll'
  | 'stab'
  | 'death'
  | 'salute'
  | 'jump_down'
  | 'sweep'
  | 'stand'
  | 'away'
  | 'claymore_windup'
  | 'claymore_place'

export const WHOLE_BODY: ReadonlySet<Locomotion> = new Set<WholeBodyLocomotion>([
  'roll',
  // 受け身。転がるので上半身だけ別の型は重ねられない
  'fall_roll',
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

/**
 * 全身の型か。**型を絞る形で返す** — 受け取る側が「どれを流すか」の表を
 * `Record<WholeBodyLocomotion, ...>` で持てるようにするため。分岐で書いていた頃、
 * クレイモアを足したときに書き忘れて、置いている人が他人の画面で T ポーズになった。
 */
export function isWholeBody(locomotion: Locomotion): locomotion is WholeBodyLocomotion {
  return WHOLE_BODY.has(locomotion)
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
  /**
   * 空中に居る時間 (秒)。0 なら接地している。
   *
   * **短い浮きを空中扱いしない**ために持つ。階段を下りると 1 段ごとに離れて
   * 着くので、そのたびに空中の型へ移ると膝を曲げる姿勢が点滅する。
   */
  airborneFor: number
  /** 階段を上り下りしてからの残り時間 (秒)。0 なら階段に居ない */
  stairFor: number
  /** その階段は下りか。上りと下りで型が違う */
  stairDown: boolean
  /**
   * 受け身の残り時間 (秒)。0 なら受け身ではない。
   *
   * ただの着地 (landing) と別に持つ。落下ダメージが入る速さで落ちたときだけで、
   * 尺もクリップに合わせて長い。
   */
  fallRoll: number
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
  // しゃがんだままなら上半身だけ。立ちの刺突は全身の型なので立ち上がってしまう
  if (input.stabbing) return input.crouching ? 'crouch_stab' : 'stab'
  if (input.rolling) return 'roll'

  // 空中では上昇と下降でモーションを分ける。クリップの終了ではなく速度で
  // 切り替えるので、滞空時間が変わっても破綻しない
  /*
   * 空中の型は**すぐには出さない** (airborneFor)。
   *
   * 階段や坂を下りると、1 段ごとに離地と接地を繰り返す。そのたびに空中の型へ
   * 移ると、**膝を大きく曲げる姿勢が点滅する**。AIR_MOTION_DELAY より短い
   * 浮きは歩いているものとして扱う。
   */
  /*
   * 上がっている間だけ跳躍の型。**落ちている間は移動の型のまま。**
   *
   * 滞空のループ (jump_loop) は、走って段から落ちる場面に合っていなかった —
   * 走っている脚が止まって空中で構え直す絵になる。落ちるのは一瞬なので、
   * 走ったまま落ちて、着地で受け止める (jump_down / fall_roll) ほうが素直。
   *
   * 型としては残してある。**通信の並びから外すと、古い版が別の姿勢を再生する。**
   */
  if (!input.onGround && input.airborneFor >= AIR_MOTION_DELAY && input.velocityY > 0) {
    return 'jump_up'
  }
  // 階段の間は専用の型。**坂は含まない** (段差が無いので走りで足りる)
  if (input.stairFor > 0) return input.stairDown ? 'down_stair' : 'up_stair'
  // 削られる高さから落ちた着地は受け身。ただの着地より長く、転がり切るまで続く
  if (input.fallRoll > 0) return 'fall_roll'
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
