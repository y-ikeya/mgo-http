import * as THREE from 'three'
import { isBone } from './guards'
import { damp } from './math'
import { rootMotionStore, type RootMotionTrack } from './assets'

/** 移動の 8 方向。前を 0 として時計回り */
export const MOVE_DIRECTIONS = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'] as const
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number]

/** 下半身レイヤーの状態 = 移動アニメ */
export type Locomotion =
  | 'idle'
  | 'crouch_idle'
  // ダンボールを被っている姿勢。全身クリップなので上下を分けない
  | 'sneak'
  | 'sit'
  | 'stab'
  | 'roll'
  // 倒れるのは全身。怯みは上半身だけなので Locomotion には含めない
  // (脚まで止めると被弾のたびに 1.6 秒棒立ちになる)。
  | 'death'
  // 敬礼。全身の型なので上下を分けない
  | 'salute'
  // 爆風で倒れる / そこから立ち上がる。倒れている間も撃てるよう、
  // 下半身だけ倒れた姿勢のまま留める
  | 'sweep'
  | 'stand'
  // 落下は 3 分割。滞空時間がクリップ尺と一致しなくても破綻しない。
  | 'jump_up'
  | 'jump_loop'
  | 'jump_down'
  | `run_${MoveDirection}`
  | `crouch_${MoveDirection}`

/** 立ち / しゃがみ、それぞれの 8 方向の状態を引く */
export function locomotionFor(crouching: boolean, direction: MoveDirection): Locomotion {
  return crouching ? `crouch_${direction}` : `run_${direction}`
}

/**
 * 構えている間、腰の捻れをどれだけ打ち消すか。1 で完全に正面を向く。
 *
 * Hips は骨格のルートなので、その回転は上半身ごと持っていく。移動クリップの腰は
 * idle 基準で最大 40° ほど傾いており (run_fwd 37.6° / strafe_right 31.1°)、
 * 上半身レイヤーが構えを保っていても銃口が照準の方向を向かなくなる。
 * 弾はカメラの照準線に沿って飛ぶので、見た目と弾道が食い違って見える。
 *
 * クリップ自体を書き換えず実行時に戻しているのは、構えていないときの
 * 走りや跳躍の躍動感を残すため。効かせるのは構えている間だけでよい。
 */
const AIM_HIP_SQUARE = 0.85

/**
 * 上半身クリップの座標系ズレの打ち消し量 (0..1)。
 *
 * relaxed_idle / relaxed_run は他のクリップと 31° 違う向きで作られている
 * (腰の向きが idle -40.2° に対して -9.1° / -5.7°)。1 でその差を完全に取り除く。
 */
const UPPER_TWIST_FIX = 1

/**
 * しゃがみのときに上半身を右へ旋回させる角度 (rad)。
 *
 * この骨格の構えは体が正面を向いたままなので、支える左手が体の中心より 15.2cm 左に出る。
 * 銃を前に構えているというより、左前へ斜めに渡している形になる。
 *
 * 直し方は腕ではなく体。少し半身になれば左手は自然と体の前へ来る。
 */
const CROUCH_TORSO_YAW = (12 * Math.PI) / 180

/** 立ちとしゃがみの間で旋回を移す速さ。姿勢の変化より遅れないように */
const CROUCH_TORSO_LAMBDA = 10
/** 構えの入り抜けで腰の補正が寄る速さ */
const AIM_HIP_LAMBDA = 10

/**
 * 状態と glTF 上のクリップ名の対応。
 * 移動系はクリップ名を状態名と揃えてあるので機械的に作れる。
 */
const LOWER_CLIPS: Record<Locomotion, string> = {
  idle: 'idle',
  crouch_idle: 'crouch_idle',
  sneak: 'sneak',
  sit: 'sit',
  salute: 'salute',
  // 爆風で倒れる / 起き上がる。倒れた姿勢のまま留まるので伏せ撃ちができる。
  // 起き上がりは仰向け用 (STAND_CLIP) を引く — sweep が仰向けで終わるため
  sweep: 'sweep',
  stand: 'stand_front',
  // 刺突は全身動作。上半身だけ切り出すと腰の向きが下半身と食い違う。
  stab: 'stab',
  roll: 'roll',
  death: 'death',
  jump_up: 'jump_up',
  jump_loop: 'jump_loop',
  jump_down: 'jump_down',
  ...(Object.fromEntries(
    MOVE_DIRECTIONS.flatMap((d) => [
      [`run_${d}`, `run_${d}`],
      [`crouch_${d}`, `crouch_${d}`],
    ]),
  ) as Record<`run_${MoveDirection}` | `crouch_${MoveDirection}`, string>),
}

/**
 * 上半身レイヤーの状態。
 *
 * `stance` は「構えているかどうかで決まる待機姿勢」で、実際にどのクリップを使うかは
 * 構えの有無と現在の移動状態から毎フレーム引き直す。fire / reload はそれを上書きする。
 */
type UpperState =
  | 'stance'
  | 'fire'
  | 'throw'
  | 'reload'
  | 'stab'
  | 'roll'
  | 'death'
  | 'hit'
  | 'salute'
  | 'bolt'
  | 'sweep'
  | 'stand'

/**
 * 構えていないときの上半身。移動状態ごとに使うクリップを変える。
 * しゃがみは上半身も専用。立ち姿勢の上半身を乗せると腰の高さが噛み合わない。
 */
const RELAXED_CLIPS: Partial<Record<Locomotion, string>> = {
  idle: 'relaxed_idle',
  crouch_idle: 'crouch_idle',
  // 上半身も同じクリップから取る。全身で 1 つの型なので分けると腰で食い違う
  sneak: 'sneak',
  sit: 'sit',
  salute: 'salute',
  jump_up: 'relaxed_run',
  jump_loop: 'relaxed_run',
  jump_down: 'relaxed_run',
  ...(Object.fromEntries(
    MOVE_DIRECTIONS.flatMap((d) => [
      [`run_${d}`, 'relaxed_run'],
      [`crouch_${d}`, 'crouch_idle'],
    ]),
  ) as Record<string, string>),
}

/**
 * 構え中の上半身も、しゃがみでは専用クリップを使う。
 * 立ちの構えは腰が高い前提で背骨が付いているので、しゃがんだ腰に乗せると破綻する。
 */
const CROUCH_LOCOMOTIONS = new Set<Locomotion>([
  'crouch_idle',
  ...MOVE_DIRECTIONS.map((d) => `crouch_${d}` as Locomotion),
])

/** 落下ループの再生速度の上限。これ以上速くすると脚が忙しなく見える */
const JUMP_LOOP_MAX_SPEED = 3

/**
 * ルートモーションをそのまま位置に使うクリップ。
 *
 * 通常の移動はコード側が権威で、クリップの移動は取り除いている (足が滑らないよう
 * 再生速度のほうを合わせる)。ローリングのように加減速がある動作は、平均速度で
 * 動かすと着地して止まっているのに前へ滑る。クリップの動きをそのまま使う。
 */
const ROOT_MOTION_CLIPS = new Set(['roll'])

/** ローリングの再生速度。クリップのままだと転がりが緩慢に見える */
const ROLL_TIME_SCALE = 1.32

/**
 * ローリングで進む距離の倍率。
 *
 * 再生速度とは別に持つ必要がある。速く回せばそのぶん短い時間で終わるが、
 * クリップに焼かれた移動量は変わらないので距離は同じになる。
 * 「速くて短い」を作るには、移動そのものを削るしかない。
 */
const ROLL_DISTANCE_SCALE = 0.8
/**
 * ローリングの拘束を解く時点 (クリップ尺に対する割合)。
 *
 * 最後まで再生し切ってから移動へ戻すと、clampWhenFinished で最終ポーズに
 * 固まった状態からブレンドが始まるので、一拍止まって見える。
 * 立ち上がりに入った時点で移動側へ渡し、ローリングの尾を残したまま
 * クロスフェードさせると繋ぎが滑らかになる。
 */
const ROLL_EXIT_PHASE = 0.78

/** 一度だけ流す下半身の状態。始めるときに reset して play する */
const ONE_SHOT_LOWER = new Set<Locomotion>([
  'stab',
  'roll',
  // 倒れる / 起き上がる。留めておかないと、倒れた姿勢を保てず
  // 3 秒ごとに勝手に倒れ直す (伏せ撃ちの足場が消える)
  'sweep',
  'stand',
  'jump_up',
  'jump_down',
  'death',
  'salute',
])

/** 上半身レイヤーの action を引くキー。移動状態ごとに別 action を持つため文字列にする */
const AIM_KEY = 'aim'
const CROUCH_AIM_KEY = 'crouch_aim'
const FIRE_KEY = 'fire'
const RELOAD_KEY = 'reload'
const STAB_KEY = 'stab'
/** ボルト操作。1 発ごとに薬室へ送る動作で、その間は撃てない */
const BOLT_KEY = 'bolt'
/** 爆風で吹き飛ばされる。倒れた姿勢で終わる */
const SWEEP_KEY = 'sweep'
/**
 * 吹き飛ばされる型の再生速度。
 *
 * クリップは 3.07 秒だが、**飛ばされて落ちるのは最初の 0.92 秒**で、
 * 残りは寝たまま体を整える尺 (実測)。等速で流すと落ちるまでが 0.92 秒になる。
 */
const SWEEP_RATE = 1

/**
 * 吹き飛ばされてから背中が地面に着くまで (秒、クリップ内の時刻)。実測値。
 *
 * クリップ全体の長さとは別に持つ。着地したかどうかで構えを解禁しているので、
 * 全体の尺を使うと、寝たまま整えている 2 秒のあいだ撃てなくなる。
 */
const SWEEP_LAND = 0.92
/** 伏せた所から立ち上がる */
const STAND_KEY = 'stand'
/**
 * 起き上がりに使うクリップ。
 *
 * 吹き飛ばされる型 (sweep) は**仰向け**で終わる (実測: 胸の向き y=+0.33)。
 * うつ伏せから起きる `stand` を繋ぐと、地面にめり込んで一回転する。
 *
 * `stand` も glb に残してある。うつ伏せで終わる倒れ方を足すときに要る。
 */
const STAND_CLIP = 'stand_front'
/**
 * 起き上がる型の再生速度。
 *
 * 仰向けから起きる型 (stand_front) は 2.40 秒。中断できない時間なので、
 * 等速だと撃たれるのを待つだけの間が長すぎる。速めて 1.5 秒ほどにする。
 */
const STAND_RATE = 1.2
/** 手榴弾を投げる。上半身だけで済むので走りながらでも投げられる */
const THROW_KEY = 'throw'
const ROLL_KEY = 'roll'
const DEATH_KEY = 'death'
const HIT_KEY = 'hit'
const SALUTE_KEY = 'salute'
/**
 * 敬礼を止めておく位置 (クリップ尺に対する割合)。
 *
 * 実測で手は 33% で最高点に達し、50% あたりまで保たれて 60% から下り始める。
 * その保たれている区間の真ん中で止めると、手を挙げたまま静止した形になる。
 * 早すぎるとまだ上げている途中、遅いと下ろし始めた姿勢で固まる。
 */
const SALUTE_HOLD_PHASE = 0.45
const relaxedKey = (state: Locomotion) => `relaxed:${state}`
/** 一度だけ流す上半身。起動時から回さず、始める側で play する */
const UPPER_ONE_SHOT: ReadonlySet<string> = new Set([
  RELOAD_KEY,
  STAB_KEY,
  BOLT_KEY,
  SWEEP_KEY,
  STAND_KEY,
  THROW_KEY,
  ROLL_KEY,
  DEATH_KEY,
  HIT_KEY,
  SALUTE_KEY,
])

/**
 * 下半身に割り当てるボーン。これ以外は全て上半身として扱う。
 *
 * Hips は骨格のルートで全身の位置と向きを運ぶので下半身側に置く。
 * (上半身レイヤーが Hips を持つと、移動中に腰から下が置いていかれる)
 */
const LOWER_BODY_BONE = /Hips|UpLeg|Leg|Foot|Toe/

/**
 * クリップ本来の移動速度 (m/s)。Blender でルートモーションを実測した値。
 *
 * 再生速度をこれで割って実際の移動速度に合わせることで、足が滑るのを原理的に消す。
 * ProRiflePack は 8 方向すべて同じ速度・同じ尺で作られているので、方向を変えても
 * 補正倍率が変わらず、足の接地位相も揃ったままになる。
 * (Shooter Pack の 4 方向は 2.55〜3.26 m/s とばらついており、方向ごとに倍率が違った)
 * 別のクリップに差し替えるときは必ず測り直すこと。
 */
const RUN_CLIP_SPEED = 4.76
const CROUCH_CLIP_SPEED = 2.02
/**
 * sneak クリップ本来の速度 (m/s)。
 *
 * その場歩きで書き出されているので移動量から測れず、歩幅 0.81m と
 * 周期 1.30s から出した推定値。同じ方法で crouch_f を測ると実測との誤差は 5% だった
 * (歩行は両足が離れる瞬間が無いので歩幅が実移動とほぼ一致する)。
 */
const SNEAK_CLIP_SPEED = 1.3
const CLIP_SPEED: Partial<Record<Locomotion, number>> = {
  sneak: SNEAK_CLIP_SPEED,
  ...(Object.fromEntries(
    MOVE_DIRECTIONS.flatMap((d) => [
      [`run_${d}`, RUN_CLIP_SPEED],
      // 後退だけ僅かに遅い
      [`crouch_${d}`, d === 'b' ? 1.95 : CROUCH_CLIP_SPEED],
    ]),
  ) as Partial<Record<Locomotion, number>>),
}

/** レイヤー内で状態が切り替わるときの重みの寄り速さ。大きいほど速い */
const LOWER_BLEND_LAMBDA = 12
/**
 * ジャンプの局面が切り替わるときの寄り速さ。
 *
 * 通常のブレンド (lambda 12) は収束まで約 0.25 秒かかる。一方で上昇は 0.35 秒、
 * 下降は 0.26 秒しかないので、どのポーズも出来上がる前に次へ移ってしまい、
 * 混ざった中間姿勢が続く。「上昇でも下降でもない滞空」に見えるのはこれが原因。
 * 局面の長さより十分速く切り替える必要がある。
 */
const JUMP_BLEND_LAMBDA = 30

/** ジャンプの 3 局面。ブレンドを速める判定に使う */
const JUMP_STATES = new Set<Locomotion>(['jump_up', 'jump_loop', 'jump_down'])
const UPPER_BLEND_LAMBDA = 16
/** これ以下の重みは 0 と見なす。使っていないクリップが微量に混ざり続けるのを防ぐ */
const WEIGHT_EPSILON = 1e-3

/**
 * 照準の上下を背骨の連鎖に配分する比率。合計 1.0。
 *
 * 1 本のボーンで全部曲げると首だけ折れたような絵になるので、腰から頭まで分散させる。
 * (本来は上向き/下向きの専用クリップを加算合成するのが正攻法だが、
 *  そのクリップが手元に無いため手続き的に回している)
 */
/**
 * 照準角に対する上半身の曲がり具合。実機で合わせた値。
 * カメラの pitch をそのまま流すと体の反応が足りず、2 倍でようやく見た目が合う。
 */
const AIM_PITCH_GAIN = 2

/**
 * 曲げ角の上限 (rad)。
 *
 * カメラは -1.1 rad (-63°) まで見下ろせるので、GAIN 2 倍をそのまま適用すると
 * -126° になり体が折り畳まれる。弾道はカメラの照準線で決まっていて
 * この曲げは見た目にしか効かないため、破綻する手前で止めてよい。
 */
const MAX_AIM_BEND = 1.0


/** 照準角が目標へ寄る速さ。構えの入り抜けの滑らかさを決める */
const AIM_PITCH_LAMBDA = 12

/**
 * 構えていないときに上体を前へ倒す角度 (rad)。
 *
 * 銃を下ろした姿勢は直立に近く、そのままだと的のように棒立ちに見える。
 * 少し前のめりにすると重心が前に乗って、警戒しながら移動している兵士らしくなる。
 * 見た目の好みなので実機で決める値。
 */
const RELAXED_LEAN = THREE.MathUtils.degToRad(17)

/**
 * ダンボールを被って移動する間の追加の前傾。
 *
 * sneak クリップの頭は 1.17m あって箱に収まらない。箱を大きくすれば収まるが、
 * それでは「人が入れる最小の箱」という見た目から離れる。体を丸めて頭を下げる。
 *
 * 背骨を折るので頭は前へも出る。曲げすぎると膝より前に頭が来て潜っている風に
 * 見えなくなるため、40° 前後が上限。
 *
 * 掛けるのは移動中だけ。座り姿勢は頭が 0.59m しかなく、そもそも箱に収まっている。
 * そこへ同じ角度を足すと、収める必要のない体をただ折り畳むことになる。
 */
const BOX_LEAN = THREE.MathUtils.degToRad(34)

const AIM_PITCH_CHAIN: { suffix: string; weight: number; yaw: number }[] = [
  // yaw は、しゃがみのときに半身へ構えるための左右の配分。
  // 首から上を負にしてあるのは、子が親の回転を継ぐため。背骨を 0.7 回した
  // ぶんをそのまま戻すので、体は半身でも目線は狙っている方向に残る。
  { suffix: 'Spine', weight: 0.2, yaw: 0.2 },
  { suffix: 'Spine1', weight: 0.25, yaw: 0.25 },
  { suffix: 'Spine2', weight: 0.25, yaw: 0.25 },
  { suffix: 'Neck', weight: 0.15, yaw: -0.35 },
  { suffix: 'Head', weight: 0.15, yaw: -0.35 },
]

/**
 * キャラクターのアニメーション。上半身と下半身を独立したレイヤーとして扱う。
 *
 * 1 つの mixer で複数の action を同時再生すると、同じボーンに対しては重みで
 * 混ざってしまい「上書き」にならない。そこでクリップ自体をボーン単位で分割し、
 * 下半身レイヤーと上半身レイヤーが触るボーンを重複させないことで解決している。
 *
 * これにより「走りながら撃つ」「走りながらリロードする」が両立する。
 */
export class CharacterAnimator {
  /** リロードクリップの尺 (秒)。0 ならクリップが無い */
  readonly reloadDuration: number
  /** 刺突クリップの尺 (秒)。0 ならクリップが無い */
  readonly stabDuration: number
  /** ボルト操作の尺 (秒)。モデル未着なら 0 */
  boltDuration = 0
  /** 吹き飛ばされる尺 (秒)。再生速度を掛けたあとの実際の長さ */
  sweepDuration = 0
  /** 起き上がる尺 (秒)。再生速度を掛けたあとの実際の長さ */
  standDuration = 0
  /** 投擲の尺 (秒) */
  throwDuration = 0

  /** 吹き飛ばされる型の再生速度 (調整用)。着地の時刻もこれで割る */
  sweepRate = SWEEP_RATE
  /** 起き上がる型の再生速度 (調整用) */
  standRate = STAND_RATE
  /** 起き上がる型の素の長さ (秒)。速度を変えたときに尺を出し直すのに使う */
  private standClipDuration = 0

  /** ローリングの尺 (秒)。0 ならクリップが無い */
  readonly rollDuration: number
  /** 倒れるモーションの尺 (秒)。0 ならクリップが無い */
  readonly deathDuration: number
  /** 怯みモーションの尺 (秒)。0 ならクリップが無い */
  readonly hitDuration: number
  /** 敬礼の尺 (秒)。0 ならクリップが無い */
  readonly saluteDuration: number

  /** 照準角の効き具合。0 で無効、負で反転 */
  aimPitchGain = AIM_PITCH_GAIN

  /**
   * 上半身クリップの座標系ズレをどれだけ打ち消すか (0..1)。
   *
   * 0 = クリップの向きをそのまま使う (relaxed 系は 37° 捻れる)
   * 1 = ズレを完全に除去し、上半身を腰に合わせる
   */
  upperTwistFix = UPPER_TWIST_FIX

  /** しゃがみのときに上半身を右へ旋回させる角度 (rad、調整用) */
  crouchTorsoYaw = CROUCH_TORSO_YAW

  private readonly torsoYawScratch = new THREE.Quaternion()
  /** しゃがみ具合 (0..1)。姿勢の切り替えでいきなり体が振れないよう均す */
  private crouchBlend = 0

  private readonly root: THREE.Object3D
  private readonly mixer: THREE.AnimationMixer
  private readonly lower = new Map<Locomotion, THREE.AnimationAction>()
  private readonly upper = new Map<string, THREE.AnimationAction>()

  private locomotion: Locomotion = 'idle'
  /** 前フレームの状態。抜ける側もジャンプならブレンドを速いままにする */
  private previousLocomotion: Locomotion = 'idle'
  private upperState: UpperState = 'stance'
  /** 上昇クリップの尺 (秒)。実際の上昇時間に合わせて再生速度を出すのに使う */
  private jumpUpDuration = 0
  /** 落下ループの尺 (秒)。落下時間に合わせて再生速度を出すのに使う */
  private jumpLoopDuration = 0
  /** 現在の移動速度 (m/s)。クリップの再生速度補正の分母になる */
  private moveSpeed: number
  /** 各レイヤーの現在の重み。合計が必ず 1 になるよう正規化してから action に流す */
  private readonly lowerWeights = new Map<Locomotion, number>()
  private readonly upperWeights = new Map<string, number>()

  /** 照準の上下 (rad)。構えを解いた瞬間に体が跳ねないよう、目標へ補間して追う */
  private aimPitchTarget = 0
  private aimPitch = 0
  /**
   * 背骨の各ボーンにおける「キャラの右方向」を、そのボーンのローカル座標で表したもの。
   * 曲げる軸そのもの。ボーンの向きは骨格ごとに違うので、決め打ちせず構えのポーズから求める。
   */
  private aimAxes: AimAxis[] | null = null

  /** 腰のボーンと、構えの基準になる向き。移動クリップの捻れをここへ戻す */
  private hipsBone: THREE.Bone | null = null
  private readonly uprightHips = new THREE.Quaternion()
  private readonly hipsBase = new THREE.Quaternion()
  private hipsCaptured = false
  /**
   * 上半身クリップごとの腰の回転トラック。
   *
   * 上半身と下半身を別のクリップから取ると、背骨は自分のクリップの腰を前提に
   * 角度が付いているのに、実際には別のクリップの腰の上に乗る。その差を打ち消す。
   *
   * 先頭フレームの値ではなく**トラックそのもの**を持つ。刺突はクリップ内で腰が
   * 65° 振れるので、1 点を基準にすると振れた分がそのまま背骨の捻れとして出る。
   * (静止系は腰がほぼ動かないので、以前は問題として現れなかった)
   */
  private readonly upperHipsTracks = new Map<string, THREE.QuaternionKeyframeTrack>()
  /**
   * 上半身クリップごとの、そのクリップ自身の腰の基準 (先頭フレーム)。
   *
   * クリップは同じ骨格でも、作られた向きが揃っているとは限らない。実測では
   * relaxed_idle / relaxed_run の腰が他のクリップより 31° 回っていた
   * (idle -40.2° に対して -9.1° / -5.7°)。この差はポーズではなく
   * 「そのクリップの座標系」なので、上半身へ持ち込んではいけない。
   */
  private readonly upperHipsNeutrals = new Map<string, THREE.Quaternion>()
  /**
   * 上半身レイヤーのキーごとの、元になったクリップ名。
   *
   * 下半身と同じクリップから取っている場合 (刺突・ローリング・座り・sneak など
   * 全身で 1 つの型を持つもの) は、上下の間に食い違いが存在しないので
   * 腰の補正を掛けてはいけない。掛けると、そのクリップ固有の腰の向きを
   * リグの基準へ引き戻す動きが、そのまま上半身の捻れになる。
   */
  private readonly upperClipNames = new Map<string, string>()
  /** idle から腰の基準が取れたか。取れていなければ載せ替えはしない */
  private uprightHipsKnown = false
  private readonly neutralScratch = new THREE.Quaternion()
  /** 取り除く前のルートモーション。位置に使うクリップだけ控えておく */
  private readonly rootMotion = new Map<string, RootMotionTrack>()
  /** 前フレームに読んだルートモーションの値。差分を出すのに使う */
  private readonly lastRootSample = new THREE.Vector3()
  private rootSampleValid = false
  /** 骨格のスケール (Armature の 0.01)。トラックの単位をメートルに直すのに使う */
  private skeletonScale = 0
  private readonly referenceHips = new THREE.Quaternion()
  private readonly sampleScratch = new THREE.Quaternion()
  private spineBone: THREE.Bone | null = null
  /** 頭ボーン。カメラの注視点をアニメーションの姿勢から決めるのに使う */
  private headBone: THREE.Bone | null = null
  private headResolved = false
  /** 構えているか (目標) と、実際に効いている補正量 (0..1) */
  private aiming = false
  private hipSquare = 0
  /** 非構え時の前傾。切り替わりで跳ねないよう補間して追う */
  relaxedLean = RELAXED_LEAN
  private lean = 0
  /** ダンボールを被っているか。前傾を深くして頭を下げる */
  private boxed = false
  /** 敬礼を保っているか。手を挙げた位置で再生を止める */
  private saluteHeld = false

  private readonly scratchVector = new THREE.Vector3()
  private readonly scratchQuat = new THREE.Quaternion()
  private readonly scratchRotation = new THREE.Quaternion()

  private readonly onFinished = (event: { action: THREE.AnimationAction }) => {
    // ワンショット (リロード) が終わったら構えに戻す
    const finished = event.action
    // 倒れたときだけは戻さない。最終ポーズのまま留める。
    if (
      finished === this.upper.get(RELOAD_KEY) ||
      finished === this.upper.get(STAB_KEY) ||
      finished === this.upper.get(ROLL_KEY) ||
      finished === this.upper.get(HIT_KEY) ||
      finished === this.upper.get(SALUTE_KEY) ||
      finished === this.upper.get(BOLT_KEY) ||
      finished === this.upper.get(SWEEP_KEY) ||
      finished === this.upper.get(STAND_KEY) ||
      finished === this.upper.get(THROW_KEY)
    ) {
      this.upperState = 'stance'
    }
  }

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], moveSpeed: number) {
    this.root = root
    this.moveSpeed = moveSpeed
    this.mixer = new THREE.AnimationMixer(root)

    const rootBone = findRootBone(root)
    if (!rootBone) {
      console.warn('[Animator] ルートボーンが見つからない。ルートモーションを除去できない')
    }

    // 腰の水平位置をどこに揃えるか。
    //
    // クリップごとに腰の原点が違う (実測: idle は 3.11、寝ている sweep は -0.18、
    // 起き上がる stand_front は -60.51)。それぞれの 0 フレーム目で潰すと、
    // クリップが切り替わった瞬間に体がその差だけ動く。実際に起きた:
    // 起き上がりで 60cm 後ろへ跳び、立ち終わって idle へ戻るときに前へ滑った。
    //
    // 全部を idle の原点へ揃える。位置はコード側が権威なので、
    // クリップが腰をどこに置いていたかは持ち込ませない。
    const restBase = rootBone ? hipsRestOf(clips, LOWER_CLIPS.idle, rootBone.name) : null

    const byName = new Map<string, THREE.AnimationClip>()
    for (const clip of clips) {
      // 取り除く前に控える。後からでは値が潰れている。
      // クリップは全員で共有しているので、控えも共有の置き場に持つ。
      // ここで自分の Map にだけ控えると、2 人目は潰れたあとを控えてしまう。
      if (rootBone && ROOT_MOTION_CLIPS.has(clip.name)) {
        let stored = rootMotionStore.get(clip)
        if (!stored) {
          const track = clip.tracks.find(
            (t) => t.name.endsWith('.position') && sameNode(t.name, rootBone.name),
          )
          if (track) {
            stored = {
              times: Float32Array.from(track.times),
              values: Float32Array.from(track.values),
            }
            rootMotionStore.set(clip, stored)
          }
        }
        if (stored) this.rootMotion.set(clip.name, stored)
      }
      if (rootBone) stripRootMotion(clip, rootBone.name, restBase)
      byName.set(clip.name, clip)
    }

    // 構え中に腰を戻す先として、idle の腰の向きを控えておく
    const uprightClip = byName.get(LOWER_CLIPS.idle)
    const uprightTrack = uprightClip?.tracks.find(
      (t) => t.name.endsWith('.quaternion') && rootBone && sameNode(t.name, rootBone.name),
    )
    if (rootBone && uprightTrack) {
      const v = uprightTrack.values
      this.hipsBone = rootBone
      this.uprightHips.set(v[0], v[1], v[2], v[3])
      this.uprightHipsKnown = true
    } else {
      console.warn('[Animator] 腰の基準姿勢が取れない。構え中の腰の補正は効かない')
    }

    // --- 下半身レイヤー ---
    for (const state of Object.keys(LOWER_CLIPS) as Locomotion[]) {
      const clip = byName.get(LOWER_CLIPS[state])
      if (!clip) {
        console.warn(`[Animator] クリップが無い: ${LOWER_CLIPS[state]}`)
        continue
      }
      const action = this.mixer.clipAction(splitClip(clip, 'lower'))
      if (ONE_SHOT_LOWER.has(state)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      // 上昇時間に合わせて速度を変えるので尺を控えておく
      if (state === 'jump_up') this.jumpUpDuration = clip.duration
      if (state === 'jump_loop') this.jumpLoopDuration = clip.duration
      this.lower.set(state, action)
    }
    this.applyLocomotionTimeScales()

    // --- 上半身レイヤー ---
    // 構えは idle の上半身。移動中も銃を構えた姿勢を保つ。
    const registerUpper = (key: string, clip: THREE.AnimationClip): THREE.AnimationAction => {
      const action = this.mixer.clipAction(splitClip(clip, 'upper', key))
      this.upper.set(key, action)
      // この上半身が本来乗るはずの腰の動き。下半身が別クリップでもズレを消せる
      this.upperClipNames.set(key, clip.name)
      const hips = rootBone && hipsTrackOf(clip, rootBone.name)
      if (hips) {
        this.upperHipsTracks.set(key, hips)
        const v = hips.values
        this.upperHipsNeutrals.set(key, new THREE.Quaternion(v[0], v[1], v[2], v[3]))
      }
      return action
    }

    const aim = byName.get('idle')
    if (aim) registerUpper(AIM_KEY, aim)

    const crouchAim = byName.get('crouch_aim')
    if (crouchAim) registerUpper(CROUCH_AIM_KEY, crouchAim)

    // 構えていないときは銃を下ろした姿勢。移動状態ごとに別のクリップを使う。
    for (const [state, clipName] of Object.entries(RELAXED_CLIPS) as [Locomotion, string][]) {
      const clip = byName.get(clipName)
      if (clip) registerUpper(relaxedKey(state), clip)
    }

    const fire = byName.get('fire')
    if (fire) registerUpper(FIRE_KEY, fire)

    const reload = byName.get('reload')
    if (reload) {
      const action = registerUpper(RELOAD_KEY, reload)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.reloadDuration = reload?.duration ?? 0

    for (const [key, name] of [
      [SWEEP_KEY, 'sweep'],
      [STAND_KEY, STAND_CLIP],
    ] as const) {
      const clip = byName.get(name)
      if (!clip) continue
      const action = registerUpper(key, clip)
      action.setLoop(THREE.LoopOnce, 1)
      // 倒れた姿勢 / 立った姿勢のまま留める。次の動作が引き取る
      action.clampWhenFinished = true
    }
    // 着地までの時間。全体の尺ではない (寝てから整える尺が後ろに付いている)
    this.standClipDuration = byName.get(STAND_CLIP)?.duration ?? 0
    this.refreshKnockdownRates()

    const grenade = byName.get('throw')
    if (grenade) {
      const action = registerUpper(THROW_KEY, grenade)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.throwDuration = grenade?.duration ?? 0

    const bolt = byName.get('bolt')
    if (bolt) {
      const action = registerUpper(BOLT_KEY, bolt)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.boltDuration = bolt?.duration ?? 0

    const stab = byName.get('stab')
    if (stab) {
      const action = registerUpper(STAB_KEY, stab)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.stabDuration = stab?.duration ?? 0

    const roll = byName.get('roll')
    if (roll) {
      const action = registerUpper(ROLL_KEY, roll)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.rollDuration = roll?.duration ?? 0

    const death = byName.get('death')
    if (death) {
      const action = registerUpper(DEATH_KEY, death)
      action.setLoop(THREE.LoopOnce, 1)
      // 倒れた姿勢のまま留める。ここを緩めると死体が立ち上がる。
      action.clampWhenFinished = true
    }
    this.deathDuration = death?.duration ?? 0

    const salute = byName.get('salute')
    if (salute) {
      const action = registerUpper(SALUTE_KEY, salute)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.saluteDuration = salute?.duration ?? 0

    // 怯みは上半身だけ。走りながら上体だけが跳ねる形になり、被弾で足が止まらない。
    const hit = byName.get('hit')
    if (hit) {
      const action = registerUpper(HIT_KEY, hit)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.hitDuration = hit?.duration ?? 0

    // 全 action を常時再生しておき、見せ方は重みだけで決める。
    // 必要になってから play() すると、その瞬間だけ重みの合計が 1 を割る。
    // (reload はワンショットなので playReload() の中で始める)
    for (const [state, action] of this.lower) {
      // ワンショットは再生を始める側で play する
      if (!ONE_SHOT_LOWER.has(state)) action.play()
      this.lowerWeights.set(state, state === 'idle' ? 1 : 0)
    }
    for (const [key, action] of this.upper) {
      // ワンショットは再生を始める側で play する
      if (!UPPER_ONE_SHOT.has(key)) action.play()
      this.upperWeights.set(key, key === AIM_KEY ? 1 : 0)
    }

    this.mixer.addEventListener('finished', this.onFinished)
  }

  update(dt: number): void {
    this.releaseRollIfSettling()
    this.updateSalute()

    // 前フレームの上乗せを取り消してから mixer を回す。
    // three が書き込みを省略した回でも、ボーンが素のアニメ値から始まることを保証する。
    if (this.aimAxes) {
      for (const entry of this.aimAxes) {
        if (entry.captured) entry.bone.quaternion.copy(entry.base)
      }
    }
    if (this.hipsCaptured && this.hipsBone) this.hipsBone.quaternion.copy(this.hipsBase)

    // ジャンプの局面は短いので、出入りのブレンドを速くする
    const lowerLambda =
      JUMP_STATES.has(this.locomotion) || JUMP_STATES.has(this.previousLocomotion)
        ? JUMP_BLEND_LAMBDA
        : LOWER_BLEND_LAMBDA
    this.blend(this.lower, this.lowerWeights, this.locomotion, lowerLambda, dt)
    this.previousLocomotion = this.locomotion
    this.blend(this.upper, this.upperWeights, this.resolveUpperKey(), UPPER_BLEND_LAMBDA, dt)
    // 全身の型が決まっている動作では、照準由来の補正を掛けると崩れる
    const committed =
      this.upperState === 'stab' ||
      this.upperState === 'salute' ||
      this.upperState === 'roll' ||
      this.upperState === 'death' ||
      this.upperState === 'hit'
    this.aimPitch = damp(this.aimPitch, committed ? 0 : this.aimPitchTarget, AIM_PITCH_LAMBDA, dt)
    this.hipSquare = damp(
      this.hipSquare,
      this.aiming && !committed ? AIM_HIP_SQUARE : 0,
      AIM_HIP_LAMBDA,
      dt,
    )
    // 箱の中を移動する間だけ深く丸める。構えの解除と同じ経路で補間するので、
    // 座りとの行き来でも跳ねない。
    const leanTarget = this.boxed
      ? this.relaxedLean + (this.locomotion === 'sneak' ? BOX_LEAN : 0)
      : this.aiming || committed
        ? 0
        : this.relaxedLean
    this.lean = damp(this.lean, leanTarget, AIM_PITCH_LAMBDA, dt)
    this.mixer.update(dt)

    // mixer がボーンの回転を書き換えた「後」に上乗せする。順序を逆にすると毎フレーム消える。
    this.squareHips()
    this.captureUpperBases()
    this.alignSpineToUpperClip()
    this.applyAimPitch()
    this.turnTorso(dt)
  }

  /**
   * しゃがみのときだけ上半身を右へ旋回させる。
   *
   * この骨格の構えは体を正面へ向けたまま銃を持つので、支える左手が体の中心より
   * 15cm も左に出て、銃を左前へ渡した形に見える。
   *
   * 腕だけを動かして直そうとすると、肩・肘・手首の辻褄が合わなくなって不自然になる。
   * 実際の射撃姿勢と同じで、体ごと少し半身になれば左手は自然と体の前へ来る。
   */
  private turnTorso(dt: number): void {
    const axes = this.aimAxes ?? this.resolveAimAxes()
    if (!axes.length) return

    const target = CROUCH_LOCOMOTIONS.has(this.locomotion) ? 1 : 0
    this.crouchBlend = damp(this.crouchBlend, target, CROUCH_TORSO_LAMBDA, dt)

    // 上向きの軸に対して正が左回りなので、右へ回すには符号を反転する
    const total = -this.crouchTorsoYaw * this.crouchBlend
    if (Math.abs(total) < 0.001) return

    for (const entry of axes) {
      this.torsoYawScratch.setFromAxisAngle(entry.yawAxis, total * entry.yawWeight)
      entry.bone.quaternion.multiply(this.torsoYawScratch)
    }
  }

  /**
   * 腰の捻れを構えの基準姿勢へ寄せる。
   * 上げ下げは squareHips より先。ここで戻した腰の上に照準の曲げが乗る。
   */
  private squareHips(): void {
    const bone = this.hipsBone
    if (!bone) return

    // 上乗せ前の値を控える。次フレームの書き戻しに使う (three は差分でしか書かない)
    this.hipsBase.copy(bone.quaternion)
    this.hipsCaptured = true

    if (this.hipSquare < 1e-3) return
    bone.quaternion.slerp(this.uprightHips, this.hipSquare)
  }

  /**
   * レイヤー内の重みを現在の状態へ寄せ、合計が 1 になるよう正規化して action に反映する。
   *
   * 正規化が肝心。three.js は同じボーンに効く重みの合計が 1 を下回ると、
   * 不足分をバインドポーズ (T ポーズ) で埋める仕様のため
   * (PropertyMixer.apply の `if (weight < 1)`)、
   * クロスフェード中にさらに状態が変わると一瞬だけ姿勢が初期化されて見える。
   */
  private blend<K extends string>(
    actions: Map<K, THREE.AnimationAction>,
    weights: Map<K, number>,
    active: K,
    lambda: number,
    dt: number,
  ): void {
    let sum = 0
    for (const key of actions.keys()) {
      const target = key === active ? 1 : 0
      let next = dt > 0 ? damp(weights.get(key) ?? target, target, lambda, dt) : target
      if (target === 0 && next < WEIGHT_EPSILON) next = 0
      weights.set(key, next)
      sum += next
    }

    if (sum < WEIGHT_EPSILON) {
      // 想定外だが、ここで抜けるとバインドポーズが出るので現在の状態に全振りする
      for (const [key, action] of actions) action.setEffectiveWeight(key === active ? 1 : 0)
      weights.set(active, 1)
      return
    }

    for (const [key, action] of actions) {
      action.setEffectiveWeight((weights.get(key) ?? 0) / sum)
    }
  }

  /**
   * 足元から頭までの高さ (m)。姿勢もアニメーションの上下動も含んだ実測値。
   *
   * カメラの注視点をこれ基準にすると、しゃがみ・立ち・伏せ・クリップ差を
   * 姿勢ごとの定数無しで吸収できる。ワールド行列が更新された後に読むこと。
   */
  headHeight(): number | null {
    if (!this.headResolved) {
      this.headResolved = true
      this.headBone = findBoneBySuffix(this.root, 'Head')
      if (!this.headBone) console.warn('[Animator] 頭ボーンが無い。注視点を姿勢から決められない')
    }
    if (!this.headBone) return null
    return this.headBone.matrixWorld.elements[13] - this.root.matrixWorld.elements[13]
  }

  /** 照準の上下 (rad)。カメラの pitch を渡す。構えていないときは 0 */
  setAimPitch(pitch: number): void {
    this.aimPitchTarget = pitch
  }

  /** 構えている間だけ腰の捻れを打ち消し、銃口を照準の方向へ揃える */
  setAiming(aiming: boolean): void {
    this.aiming = aiming
  }


  /** 上乗せする前の値を控える。次フレームの書き戻しに使う */
  private captureUpperBases(): void {
    const axes = this.aimAxes ?? this.resolveAimAxes()
    for (const entry of axes) {
      entry.base.copy(entry.bone.quaternion)
      entry.captured = true
    }
  }

  /**
   * 背骨の付け根を、上半身クリップが前提としている腰の向きへ合わせる。
   *
   * 背骨の角度は「自分のクリップの腰」の上に乗る前提で付いている。下半身が
   * 別のクリップだと、その差の分だけ上体が反ったり折れたりする。
   * 親 (腰) の空間で前から掛けることで、背骨のワールド姿勢を本来の向きに戻す。
   */
  private alignSpineToUpperClip(): void {
    const spine = this.spineBone
    const hips = this.hipsBone
    if (!spine || !hips) return

    const key = this.resolveUpperKey()

    // 上下が同じクリップなら食い違いようがない。補正は掛けない。
    if (this.upperClipNames.get(key) === LOWER_CLIPS[this.locomotion]) return

    const track = this.upperHipsTracks.get(key)
    const action = this.upper.get(key)
    if (!track || !action) return

    // 「今このフレームで本来あるべき腰の向き」を、再生位置に合わせて取り出す
    sampleQuaternionTrack(track, action.time, this.referenceHips, this.sampleScratch)

    // クリップ固有の座標系を取り除き、リグの基準 (idle の腰) へ載せ替える。
    //
    // 欲しいのは「そのクリップの中で腰がどれだけ振れたか」であって、
    // そのクリップがどの向きで作られたかではない。絶対値のまま使うと、
    // 作られた向きの差がそのまま上半身の捻れになる (実測 37.4°)。
    //
    // ただし「作られた向きの差」と「本来のポーズ」は自動では切り分けられない。
    // 両端はどちらも測って意味のある姿勢なので、その間を補間できるようにして
    // 効き具合は目で決める (upperTwistFix)。
    //
    // idle を上半身に使う構えの姿勢では neutral = uprightHips なので、
    // どちらの端でも恒等変換になり、構え中の挙動は変わらない。
    const neutral = this.upperHipsNeutrals.get(key)
    if (neutral && this.uprightHipsKnown && this.upperTwistFix > 0) {
      this.neutralScratch
        .copy(neutral)
        .invert()
        .premultiply(this.uprightHips)
        .multiply(this.referenceHips)
      this.referenceHips.slerp(this.neutralScratch, this.upperTwistFix)
    }

    // 現在の腰の逆 × 本来の腰 = 打ち消すべき差分
    this.scratchRotation.copy(hips.quaternion).invert().multiply(this.referenceHips)
    spine.quaternion.premultiply(this.scratchRotation)
  }

  private applyAimPitch(): void {
    const axes = this.aimAxes ?? this.resolveAimAxes()
    if (!axes.length) return

    // 構えていないときは前傾を上乗せする。照準の曲げとは符号が逆 (下向き)。
    const total =
      THREE.MathUtils.clamp(this.aimPitch * this.aimPitchGain, -MAX_AIM_BEND, MAX_AIM_BEND) -
      this.lean
    if (total === 0) return

    for (const entry of axes) {
      this.scratchRotation.setFromAxisAngle(entry.axis, total * entry.weight)
      entry.bone.quaternion.multiply(this.scratchRotation)
    }
  }

  private resolveAimAxes(): AimAxis[] {
    // キャラの右方向 = 親 (Player のルート) のローカル +X をワールドへ写したもの
    const right = new THREE.Vector3(1, 0, 0)
    const parent = this.root.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      right.applyQuaternion(parent.getWorldQuaternion(this.scratchQuat))
    }

    const resolved: AimAxis[] = []
    for (const { suffix, weight, yaw } of AIM_PITCH_CHAIN) {
      const bone = findBoneBySuffix(this.root, suffix)
      if (!bone) continue
      bone.updateWorldMatrix(true, false)
      // ワールドの右方向をボーンのローカルへ引き戻す
      const inverse = bone.getWorldQuaternion(this.scratchQuat).invert()
      const axis = right.clone().applyQuaternion(inverse).normalize()
      // ワールドの上方向も同じように引き戻す。旋回はこちらを軸にする
      const yawAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(inverse).normalize()
      if (suffix === 'Spine') this.spineBone = bone
      resolved.push({
        bone,
        weight,
        axis,
        yawAxis,
        yawWeight: yaw,
        base: new THREE.Quaternion(),
        captured: false,
      })
    }
    this.aimAxes = resolved
    return resolved
  }

  /** 移動速度が変わったら、足が滑らないよう再生速度を引き直す */
  setMoveSpeed(speed: number): void {
    this.moveSpeed = speed
    this.applyLocomotionTimeScales()
  }

  /** クリップ本来の速度で割って、歩幅と実際の移動速度を一致させる */
  private applyLocomotionTimeScales(): void {
    for (const [state, clipSpeed] of Object.entries(CLIP_SPEED)) {
      if (!clipSpeed) continue
      this.lower.get(state as Locomotion)?.setEffectiveTimeScale(this.moveSpeed / clipSpeed)
    }
  }

  setLocomotion(next: Locomotion): void {
    // 倒れたら他の状態を一切受け付けない。死体が走り出さないため。
    if (this.dead) return
    // 実際の切り替えは重みの補間に任せる。ここは目標を記録するだけ。
    if (this.lower.has(next)) this.locomotion = next
  }

  /** ダンボールを被っているか。深く丸めて頭を下げる */
  setBoxed(boxed: boolean): void {
    this.boxed = boxed
  }

  /** 倒れているか。死亡モーションに入ったら二度と戻らない */
  get dead(): boolean {
    return this.upperState === 'death'
  }

  /** 敬礼中か */
  get saluting(): boolean {
    return this.upperState === 'salute'
  }

  /**
   * 敬礼を保つかどうか。
   *
   * true の間は手を挙げた位置で止まり、false になると残りを流して下ろす。
   * 押した瞬間に離せば止まる前に通り過ぎるので、そのまま一度だけ流れる。
   * 「長押しで保つ / 短押しで一礼」が同じ 1 本のクリップで成り立つ。
   */
  setSaluteHeld(held: boolean): void {
    this.saluteHeld = held
  }

  /**
   * 敬礼する。全身の型なので上下を同時に流す。
   *
   * クリップが無ければ何も起きない。Mixamo の Salute を取り込むまでは
   * 押しても反応しないが、仕組みだけ先に通してある。
   */
  playSalute(): void {
    if (this.dead) return
    const upper = this.upper.get(SALUTE_KEY)
    const lower = this.lower.get('salute')
    if (!upper || !lower) return
    upper.setEffectiveTimeScale(1)
    lower.setEffectiveTimeScale(1)
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'salute'
    this.locomotion = 'salute'
  }

  /** 敬礼をやめる。動いたら途中でも解ける */
  cancelSalute(): void {
    if (this.upperState !== 'salute') return
    this.upperState = 'stance'
    this.saluteHeld = false
    this.upper.get(SALUTE_KEY)?.setEffectiveTimeScale(1)
    this.lower.get('salute')?.setEffectiveTimeScale(1)
  }

  /**
   * 敬礼の再生位置を見て、保つ位置に来たら止める。
   *
   * 再生速度を 0 にして固める。クリップを切り分けたり別の姿勢を作ったりせず、
   * 1 本のクリップの途中で止めるだけで「挙げ続ける」が作れる。
   */
  private updateSalute(): void {
    if (this.upperState !== 'salute') return
    const upper = this.upper.get(SALUTE_KEY)
    const lower = this.lower.get('salute')
    if (!upper || !lower) return

    const hold = this.saluteHeld && upper.time >= this.saluteDuration * SALUTE_HOLD_PHASE
    const scale = hold ? 0 : 1
    upper.setEffectiveTimeScale(scale)
    lower.setEffectiveTimeScale(scale)
  }

  /** 怯み中か。被弾リアクションの再生中 */
  get flinching(): boolean {
    return this.upperState === 'hit'
  }

  /**
   * 倒れる。全身動作なので上下を同時に流し、最終ポーズで固める。
   * clampWhenFinished を外すと死体が立ち上がる。
   */
  playDeath(): void {
    const upper = this.upper.get(DEATH_KEY)
    const lower = this.lower.get('death')
    if (!upper || !lower) return
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'death'
    this.locomotion = 'death'
  }

  /**
   * 怯む。倒れない被弾で流す。
   *
   * 撃たれるたびに出すと連射の間ずっと怯み続けて棒立ちになるので、
   * どの被弾で呼ぶかは呼び出し側が絞る。
   */
  playHit(): void {
    if (this.dead) return
    const upper = this.upper.get(HIT_KEY)
    if (!upper) return
    upper.reset().play()
    this.upperState = 'hit'
  }

  /**
   * 復帰する。倒れた姿勢から待機へ戻す。
   *
   * 重みの補間はそのままなので、その場で起き上がる形になる。
   * 復帰地点へ跳ばすなら Player 側で位置も動かすこと。
   */
  revive(): void {
    this.upper.get(DEATH_KEY)?.stop()
    this.lower.get('death')?.stop()
    this.upperState = 'stance'
    this.locomotion = 'idle'
  }

  /** 発砲中は撃つモーション、やめたら待機姿勢に戻る。リロード中は無視する */
  setFiring(firing: boolean): void {
    if (this.upperState !== 'stance' && this.upperState !== 'fire') return
    this.upperState = firing ? 'fire' : 'stance'
  }

  /**
   * 実際に再生する上半身の action キー。
   * 待機姿勢は「構えているか」と「今どう動いているか」の両方で決まる。
   */
  private resolveUpperKey(): string {
    if (this.upperState === 'fire' && this.upper.has(FIRE_KEY)) return FIRE_KEY
    if (this.upperState === 'reload' && this.upper.has(RELOAD_KEY)) return RELOAD_KEY
    // 倒れている間は他の何よりも優先する
    if (this.upperState === 'death' && this.upper.has(DEATH_KEY)) return DEATH_KEY
    if (this.upperState === 'hit' && this.upper.has(HIT_KEY)) return HIT_KEY
    if (this.upperState === 'salute' && this.upper.has(SALUTE_KEY)) return SALUTE_KEY
    if (this.upperState === 'stab' && this.upper.has(STAB_KEY)) return STAB_KEY
    // ボルト操作は構えを解いても最後まで流す。1 発ごとに必ず起きる動作なので、
    // 途中で切れると「撃ったのに動作していない」が頻繁に見える
    if (this.upperState === 'bolt' && this.upper.has(BOLT_KEY)) return BOLT_KEY
    if (this.upperState === 'sweep' && this.upper.has(SWEEP_KEY)) return SWEEP_KEY
    if (this.upperState === 'throw' && this.upper.has(THROW_KEY)) return THROW_KEY
    // 起き上がりは中断できない。撃つ操作より優先する
    if (this.upperState === 'stand' && this.upper.has(STAND_KEY)) return STAND_KEY
    if (this.upperState === 'roll' && this.upper.has(ROLL_KEY)) return ROLL_KEY

    // 伏せている間、構えていなければ倒れた姿勢のまま。
    //
    // 非構えのクリップがこの姿勢に無いので、既定の代用に任せると
    // **構えの上半身**が出る。倒れた直後に何もしていないのに銃を構え直して見えた。
    // 吹き飛ばされる型は最終姿勢で留まっているので、それをそのまま使う。
    if (!this.aiming && this.locomotion === 'sweep' && this.upper.has(SWEEP_KEY)) {
      return SWEEP_KEY
    }

    if (this.aiming) {
      const crouching = CROUCH_LOCOMOTIONS.has(this.locomotion)
      if (crouching && this.upper.has(CROUCH_AIM_KEY)) return CROUCH_AIM_KEY
      return AIM_KEY
    }
    // 該当する非構えクリップが無ければ構えの姿勢で代用する
    const key = relaxedKey(this.locomotion)
    return this.upper.has(key) ? key : AIM_KEY
  }

  /**
   * 踏み切りのモーション。
   *
   * @param riseTime 上昇にかかる時間 (秒)。踏み切りの型がその間に収まるよう速度を合わせる。
   *   滞空全体ではなく上昇だけに合わせるのは、下降は jump_loop が受け持つため。
   */
  playJumpUp(riseTime: number): void {
    const action = this.lower.get('jump_up')
    if (!action) return
    if (riseTime > 0 && this.jumpUpDuration > 0) {
      action.setEffectiveTimeScale(this.jumpUpDuration / riseTime)
    }
    action.reset().play()
    this.locomotion = 'jump_up'
  }

  /** 着地のモーション。頭から流す */
  playLanding(): void {
    const action = this.lower.get('jump_down')
    if (!action) return
    action.reset().play()
    this.locomotion = 'jump_down'
  }

  /**
   * 滞空中のループ。上昇の型が終わったらここへ移る。
   *
   * 入るたびに頭から流し直す。ループ用の action は起動時からずっと回っている
   * (重みが 0 なだけ) ので、そのままだと「たまたまその瞬間の位相」のポーズが出る。
   * 下降の入りは必ずクリップの先頭であってほしい。
   *
   * @param fallTime 想定される落下時間 (秒)。クリップ 1 周をこれに収める。
   *   落下ループは「膝を抱える → 着地へ向けて脚を伸ばす」という流れで作られており、
   *   0.93 秒のクリップを 0.26 秒の落下で流すと先頭 28% しか見えない。
   *   膝を抱えたまま固まって見えるのはそのため。
   */
  enterJumpLoop(fallTime: number): void {
    const action = this.lower.get('jump_loop')
    if (!action) return
    if (this.locomotion !== 'jump_loop') {
      if (fallTime > 0 && this.jumpLoopDuration > 0) {
        // 速くしすぎると脚が忙しなく回るので上限を設ける。
        // 長い落下 (段差から飛び降りるなど) では等速のままループさせる。
        const scale = THREE.MathUtils.clamp(this.jumpLoopDuration / fallTime, 1, JUMP_LOOP_MAX_SPEED)
        action.setEffectiveTimeScale(scale)
      }
      action.reset().play()
    }
    this.locomotion = 'jump_loop'
  }

  /** 刺突モーションを頭から再生する。終わると自動で待機姿勢に戻る */
  /**
   * ボルトを操作する。上半身だけ流す。
   *
   * 全身動作にしないのは、撃った後も足は動かせるため。狙撃銃を撃った直後に
   * その場から動けないと、撃った位置に釘付けになる。
   */
  /**
   * 投げる。
   *
   * 上半身だけなので、走りながらでも投げられる。手榴弾は退きながら足元へ
   * 落とすのが使い方の一つなので、投げるために止まらせない。
   */
  playThrow(): void {
    if (this.dead) return
    const upper = this.upper.get(THROW_KEY)
    if (!upper) return
    upper.reset().play()
    this.upperState = 'throw'
  }

  playBolt(): void {
    if (this.dead) return
    const upper = this.upper.get(BOLT_KEY)
    if (!upper) return
    upper.reset().play()
    this.upperState = 'bolt'
  }

  /**
   * 爆風で吹き飛ばす。全身で流して、倒れた姿勢のまま留める。
   *
   * 上半身は終わったら 'stance' へ戻る (finished の扱いは他の一発物と同じ)。
   * **下半身は倒れたまま留まる**ので、伏せた体の上で構えて撃てる。
   * 上下を分けてあるのがそのまま伏せ撃ちになる。
   */
  /** 再生速度から尺を出し直す。呼ぶ側が速度と尺の食い違いを気にせずに済む */
  refreshKnockdownRates(): void {
    this.sweepDuration = SWEEP_LAND / this.sweepRate
    this.standDuration = this.standClipDuration / this.standRate
  }

  playSweep(): void {
    if (this.dead) return
    const upper = this.upper.get(SWEEP_KEY)
    const lower = this.lower.get('sweep')
    if (!upper || !lower) return
    upper.reset().setEffectiveTimeScale(this.sweepRate).play()
    lower.reset().setEffectiveTimeScale(this.sweepRate).play()
    this.upperState = 'sweep'
    this.locomotion = 'sweep'
  }

  /** 伏せた所から立ち上がる。途中で止められない */
  playStand(): void {
    if (this.dead) return
    const upper = this.upper.get(STAND_KEY)
    const lower = this.lower.get('stand')
    if (!upper || !lower) return
    upper.reset().setEffectiveTimeScale(this.standRate).play()
    lower.reset().setEffectiveTimeScale(this.standRate).play()
    this.upperState = 'stand'
    this.locomotion = 'stand'
  }

  playStab(): void {
    if (this.dead) return
    const upper = this.upper.get(STAB_KEY)
    const lower = this.lower.get('stab')
    if (!upper || !lower) return
    // 上下を同時に頭から流す。同じクリップなので腰の向きが食い違わない。
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'stab'
    this.locomotion = 'stab'
  }

  /** ローリングを頭から再生する。全身動作なので上下を同時に流す */
  playRoll(): void {
    if (this.dead) return
    const upper = this.upper.get(ROLL_KEY)
    const lower = this.lower.get('roll')
    if (!upper || !lower) return
    upper.setEffectiveTimeScale(ROLL_TIME_SCALE)
    lower.setEffectiveTimeScale(ROLL_TIME_SCALE)
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'roll'
    this.locomotion = 'roll'
    this.rootSampleValid = false
  }

  /**
   * ローリングのルートモーションを、前回呼んだときからの差分で返す。
   *
   * 返すのはモデル空間の水平移動 (メートル)。上下はコード側の重力と接地判定に
   * 任せるので捨てる。再生速度を変えれば差分も自動的に変わるので、
   * 「速く転がる = 速く進む」が勝手に噛み合う。
   *
   * @returns 差分が取れたら true
   */
  consumeRootMotion(out: THREE.Vector3): boolean {
    const stored = this.rootMotion.get('roll')
    const action = this.lower.get('roll')
    if (!stored || !action || this.locomotion !== 'roll') return false

    if (this.skeletonScale === 0) {
      const armature = this.hipsBone?.parent
      if (!armature) return false
      this.skeletonScale = armature.getWorldScale(this.scratchVector).x
    }

    sampleVectorTrack(stored.times, stored.values, action.time, this.scratchVector)
    if (!this.rootSampleValid) {
      this.lastRootSample.copy(this.scratchVector)
      this.rootSampleValid = true
      return false
    }

    // トラック空間は X/Y が水平、Z が上下 (Armature の +90°X 回転のため)。
    // モデル空間では armature ローカルの +Y が前方 (+Z) に対応する。
    const scale = this.skeletonScale * ROLL_DISTANCE_SCALE
    out.set(
      (this.scratchVector.x - this.lastRootSample.x) * scale,
      0,
      (this.scratchVector.y - this.lastRootSample.y) * scale,
    )
    this.lastRootSample.copy(this.scratchVector)
    return true
  }

  get rolling(): boolean {
    return this.upperState === 'roll'
  }

  /** 終盤に入ったら拘束を解く。クリップ自体は流れ続け、重みで抜けていく */
  private releaseRollIfSettling(): void {
    if (this.upperState !== 'roll') return
    const action = this.lower.get('roll')
    if (!action) return
    const duration = action.getClip().duration
    if (duration > 0 && action.time >= duration * ROLL_EXIT_PHASE) {
      this.upperState = 'stance'
    }
  }

  /** ナイフを振っている間か。武器の持ち替えに使う */
  get stabbing(): boolean {
    return this.upperState === 'stab'
  }

  /** リロードモーションを頭から再生する。終わると自動で構えに戻る */
  playReload(): void {
    if (this.dead) return
    const action = this.upper.get(RELOAD_KEY)
    if (!action) return
    action.reset().play()
    this.upperState = 'reload'
  }

  dispose(): void {
    this.mixer.removeEventListener('finished', this.onFinished)
    this.mixer.stopAllAction()
  }

}

/**
 * クリップをボーン単位で上下に分割する。
 * 両レイヤーが触るボーンが重ならないので、重みで混ざらず上書きとして働く。
 */
function splitClip(
  clip: THREE.AnimationClip,
  part: 'lower' | 'upper',
  name = `${clip.name}_${part}`,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter((track) => {
    const isLower = LOWER_BODY_BONE.test(nodeNameOf(track.name))
    return part === 'lower' ? isLower : !isLower
  })
  return new THREE.AnimationClip(name, clip.duration, tracks)
}

/** `mixamorigHips.position` -> `mixamorigHips` */
function nodeNameOf(trackName: string): string {
  return trackName.slice(0, trackName.lastIndexOf('.'))
}

interface AimAxis {
  bone: THREE.Bone
  weight: number
  /** ボーンのローカル座標で表した回転軸 (上下の曲げ用 = キャラの右方向) */
  axis: THREE.Vector3
  /** 同じくローカル座標での上方向。左右の旋回に使う */
  yawAxis: THREE.Vector3
  /** 旋回の配分。首から上は負で、背骨が回したぶんを打ち消す */
  yawWeight: number
  /**
   * 上乗せする前、mixer が書き込んだ状態のローカル回転。
   *
   * three.js は前フレームと同じ値になったボーンへの書き込みを省略するため
   * (PropertyMixer.apply の末尾にある差分チェック)、こちらの上乗せが残ったまま
   * 次のフレームでもう一度上乗せされる回がある。それを防ぐために保存して書き戻す。
   */
  base: THREE.Quaternion
  captured: boolean
}

/**
 * 名前の末尾でボーンを探す。GLTFLoader がノード名を正規化するため
 * (`mixamorig:Spine1` -> `mixamorigSpine1`) 完全一致では引けない。
 * 末尾一致なので `Spine` は `Spine1` に、`Head` は `HeadTop_End` に誤ヒットしない。
 */
export function findBoneBySuffix(root: THREE.Object3D, suffix: string): THREE.Bone | null {
  let found: THREE.Bone | null = null
  root.traverse((obj) => {
    if (found) return
    if (isBone(obj) && obj.name.endsWith(suffix)) found = obj
  })
  return found
}

/** 親が Bone でない最初の Bone = 骨格のルート (mixamorig:Hips) */
function findRootBone(root: THREE.Object3D): THREE.Bone | null {
  let found: THREE.Bone | null = null
  root.traverse((obj) => {
    if (found) return
    if (isBone(obj) && !(obj.parent && isBone(obj.parent))) found = obj
  })
  return found
}

/**
 * ルートボーンの水平移動をクリップから取り除く。
 *
 * 位置はコード側が権威なので、クリップに焼き込まれた移動をそのまま再生すると
 * 二重に動いてキャラが足元から離れていく。上下方向は歩行の揺れなので残す。
 *
 * 軸の対応はこのモデル実測: トラック空間で X/Y が水平、Z が上下。
 * (Armature ノードが +90°X 回転を持つため、glTF ワールドの Y 上方向とは一致しない)
 */
function stripRootMotion(
  clip: THREE.AnimationClip,
  rootBoneName: string,
  rest: { x: number; y: number } | null,
): void {
  const track = clip.tracks.find(
    (t) => t.name.endsWith('.position') && sameNode(t.name, rootBoneName),
  )
  if (!track) return

  const values = track.values
  // 揃える先が取れなければ、そのクリップ自身の先頭で潰す (元の挙動)
  const restX = rest ? rest.x : values[0]
  const restY = rest ? rest.y : values[1]
  for (let i = 0; i < values.length; i += 3) {
    values[i] = restX
    values[i + 1] = restY
  }
}

/** そのクリップの腰の水平位置 (先頭フレーム)。全クリップを揃える基準に使う */
function hipsRestOf(
  clips: THREE.AnimationClip[],
  clipName: string,
  rootBoneName: string,
): { x: number; y: number } | null {
  const clip = clips.find((c) => c.name === clipName)
  const track = clip?.tracks.find(
    (t) => t.name.endsWith('.position') && sameNode(t.name, rootBoneName),
  )
  if (!track) {
    console.warn(`[Animator] ${clipName} の腰の位置が取れない。姿勢の切り替えで体がずれる`)
    return null
  }
  return { x: track.values[0], y: track.values[1] }
}

/** 腰の回転トラック。上半身が前提とする腰の動きとして使う */
function hipsTrackOf(
  clip: THREE.AnimationClip,
  rootBoneName: string,
): THREE.QuaternionKeyframeTrack | null {
  const track = clip.tracks.find(
    (t) => t.name.endsWith('.quaternion') && sameNode(t.name, rootBoneName),
  )
  return (track as THREE.QuaternionKeyframeTrack) ?? null
}

/** 位置トラックを任意の時刻で線形補間して取り出す */
function sampleVectorTrack(
  times: Float32Array,
  values: Float32Array,
  time: number,
  out: THREE.Vector3,
): void {
  const count = times.length
  if (count === 0) return
  if (time <= times[0]) {
    out.fromArray(values, 0)
    return
  }
  const last = count - 1
  if (time >= times[last]) {
    out.fromArray(values, last * 3)
    return
  }
  let k = 0
  while (k < last && times[k + 1] < time) k++
  const span = times[k + 1] - times[k]
  const alpha = span > 0 ? (time - times[k]) / span : 0
  out.set(
    values[k * 3] + (values[(k + 1) * 3] - values[k * 3]) * alpha,
    values[k * 3 + 1] + (values[(k + 1) * 3 + 1] - values[k * 3 + 1]) * alpha,
    values[k * 3 + 2] + (values[(k + 1) * 3 + 2] - values[k * 3 + 2]) * alpha,
  )
}

/**
 * クォータニオントラックを任意の時刻で取り出す。
 * three の Interpolant を使わないのは、action の再生位置に対して
 * 都度 1 点だけ引きたいだけで、内部状態を持つ必要がないため。
 */
function sampleQuaternionTrack(
  track: THREE.QuaternionKeyframeTrack,
  time: number,
  out: THREE.Quaternion,
  scratch: THREE.Quaternion,
): void {
  const times = track.times
  const values = track.values
  const count = times.length
  if (count === 0) return

  if (time <= times[0]) {
    out.fromArray(values, 0)
    return
  }
  const last = count - 1
  if (time >= times[last]) {
    out.fromArray(values, last * 4)
    return
  }

  let k = 0
  while (k < last && times[k + 1] < time) k++
  const span = times[k + 1] - times[k]
  const alpha = span > 0 ? (time - times[k]) / span : 0
  out.fromArray(values, k * 4)
  scratch.fromArray(values, (k + 1) * 4)
  out.slerp(scratch, alpha)
}

/**
 * トラック名の対象ノードがこのボーンか。
 *
 * GLTFLoader はノード名にもトラック名にも PropertyBinding.sanitizeNodeName を通すので
 * (`mixamorig:Hips` -> `mixamorigHips`) 通常は単純比較で一致する。
 * 別経路で読み込んだモデルでもズレないよう、同じ規則で正規化してから比べる。
 */
function sameNode(trackName: string, boneName: string): boolean {
  // three.js の sanitizeNodeName と同じ規則: 空白は _、[ ] . : / は除去
  const normalize = (value: string) => value.replace(/\s/g, '_').replace(/[[\].:/]/g, '')
  return normalize(nodeNameOf(trackName)) === normalize(boneName)
}
