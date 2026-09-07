import * as THREE from 'three'
import { isBone } from '../util/guards'
import { damp } from '../util/math'
import { rootMotionStore, type RootMotionTrack } from '../assets'
// 状態そのものは共有の層が持つ。ここが持つのはクリップとの対応だけ
import { MOVE_DIRECTIONS, type Locomotion, type MoveDirection } from '../../../domain/player/locomotion'


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
  // 落下の受け身。着地 (jump_down) とは別のクリップ
  hard_land: 'hard_land',
  // 階段を上る。**下半身だけ** — 上は構えたまま上れる
  up_stair: 'up_stair',
  // 階段を下りる。上りとは別のクリップ
  down_stair: 'down_stair',
  crouch_idle: 'crouch_idle',
  sneak: 'sneak',
  sit: 'sit',
  salute: 'salute',
  // 接続が切れた人の姿。全身 1 枚の静止ポーズ
  away: 'away',
  // クレイモア。かがむ全身の型なので、上半身も同じクリップから取る
  claymore_windup: 'claymore_windup',
  claymore_place: 'claymore_place',
  // 爆風で倒れる / 起き上がる。倒れた姿勢のまま留まるので伏せ撃ちができる。
  // 起き上がりは仰向け用 (STAND_CLIP) を引く — sweep が仰向けで終わるため
  sweep: 'sweep',
  stand: 'stand_front',
  // ダンボールで敵にぶつかった型。全身なので上半身も同じクリップから取る
  bump: 'bump',
  /*
   * 伏せ。**止まっている姿も這う型から取る。**
   *
   * 素材が這う 1 本しかないので、止まっている姿は再生を止めて作る
   * (FROZEN_CLIPS)。専用のクリップが手に入ったら差し替えるだけで済む。
   */
  prone_idle: 'crawl_f',
  crawl_f: 'crawl_f',
  // 伏せたまま後ろへ。**前と対で 2 本だけ** (横は無い)
  crawl_b: 'crawl_b',
  // 伏せたまま倒された。立ちの型で倒れると、一度立ち上がってから崩れる
  prone_death: 'prone_death',
  // 伏せへの出入り。全身の型なので上半身も同じクリップから取る
  prone_down: 'prone_down',
  prone_rise: 'prone_rise',
  prone_roll_down: 'prone_roll_down',
  // 刺突は全身動作。上半身だけ切り出すと腰の向きが下半身と食い違う。
  stab: 'stab',
  // しゃがんだまま刺す。**下半身はしゃがみのまま** — 立ちの刺突を流すと立ち上がる
  crouch_stab: 'crouch_idle',
  roll: 'roll',
  death: 'death',
  // 倒れる向き。**背後から撃たれたら前へ、正面からなら後ろへ**
  death_front: 'death_front',
  death_back: 'death_back',
  // 麻酔で眠っている。倒れているのとは別の姿。**起きるので死体ではない**
  sleep: 'sleep',
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
  | 'crouch_stab'
  | 'roll'
  | 'hard_land'
  // 伏せへの出入り
  | 'prone_down'
  | 'prone_rise'
  // ダンボールで敵にぶつかって、箱が落ちた
  | 'bump'
  | 'death'
  // 麻酔で眠っている。**倒れるのと同じで、全身の型を頭から流す**
  | 'sleep'
  | 'hit'
  | 'salute'
  | 'bolt'
  | 'sweep'
  | 'stand'
  // 接続が切れた人の姿
  | 'away'

/**
 * 構えていないときの上半身。移動状態ごとに使うクリップを変える。
 * しゃがみは上半身も専用。立ち姿勢の上半身を乗せると腰の高さが噛み合わない。
 *
 * **しゃがみは 1 本のクリップ (kneeAim) の両端を使う。**
 *
 * 始まりが銃を下ろした形、終わりが構え。以前は `crouch_idle` を脱力に当てて
 * いたが、あれ自体が既に構えた型で、脱力と構えで手が 5cm しか動かなかった
 * (立ちは 29cm 動く) — しゃがむと構えを解いても銃を下ろさなかった。
 */
const RELAXED_CLIPS: Partial<Record<Locomotion, string>> = {
  idle: 'relaxed_idle',
  crouch_idle: 'knee_relaxed',
  // 上半身も同じクリップから取る。全身で 1 つの型なので分けると腰で食い違う
  sneak: 'sneak',
  sit: 'sit',
  bump: 'bump',
  // 伏せは上半身も同じクリップから。**構えれば上だけ差し替わる** —
  // 伏せ撃ちは爆風で倒れている間と同じ仕組みに乗る
  prone_idle: 'crawl_f',
  crawl_f: 'crawl_f',
  crawl_b: 'crawl_b',
  prone_death: 'prone_death',
  prone_down: 'prone_down',
  prone_rise: 'prone_rise',
  prone_roll_down: 'prone_roll_down',
  salute: 'salute',
  away: 'away',
  claymore_windup: 'claymore_windup',
  claymore_place: 'claymore_place',
  jump_up: 'relaxed_run',
  jump_loop: 'relaxed_run',
  jump_down: 'relaxed_run',
  /*
   * 階段。**上半身は走りと同じ。**
   *
   * 階段のクリップ自体は素手で上る動きで、腕が空で振れている (実測: 両手の間
   * 0.38m / 手の高さ 0.07m。銃を持つ relaxed_run は 0.32m / 0.21m)。
   *
   * **ここに無いと構えの型で代用される** (resolveUpperKey の最後)。抜けていた
   * ので、坂を上り切る継ぎ目の段差を踏むたびに勝手に銃を構えていた。
   */
  up_stair: 'relaxed_run',
  down_stair: 'relaxed_run',
  /*
   * 落下の受け身。**全身で 1 つの型**なので上半身も同じクリップから取る。
   *
   * ここに無いと構えの型 (aim) が出る。上半身の状態が hard_land の間は専用の
   * 型が流れるが、**状態が先に終わって姿勢だけ残る**と素通りして、坂を下りて
   * 着地した一瞬だけ銃を構えて見えた。
   */
  hard_land: 'hard_land',
  ...(Object.fromEntries(
    MOVE_DIRECTIONS.flatMap((d) => [
      [`run_${d}`, 'relaxed_run'],
      [`crouch_${d}`, 'knee_relaxed'],
    ]),
  ) as Record<string, string>),
}

/**
 * 構え中の上半身も、しゃがみでは専用クリップを使う。
 * 立ちの構えは腰が高い前提で背骨が付いているので、しゃがんだ腰に乗せると破綻する。
 */
/**
 * 姿勢だけを取り出したクリップ。**流さず頭で止める。**
 *
 * kneeAim の両端を 3 標本ずつ切り出したもの。3 標本でも中身は動いていて
 * (首が 1 コマ 2°)、0.067 秒で回すと 15Hz の震えになる。実測で手が 1 コマ
 * 6.8mm 動いていた (立ちは 0.12mm)。
 */
const POSE_ONLY_CLIPS = new Set(['knee_relaxed', 'knee_ready'])

const CROUCH_LOCOMOTIONS = new Set<Locomotion>([
  'crouch_idle',
  ...MOVE_DIRECTIONS.map((d) => `crouch_${d}` as Locomotion),
])

/**
 * 伏せている間の状態。**上半身に立ち姿のクリップを載せない。**
 *
 * 腰が水平なので、立ち姿を前提に作られた上半身を載せると背骨の補正が
 * 効きすぎて暴れる。出入りの繋ぎ (prone_down / prone_rise) は全身の型として
 * 最後まで流れるので、ここには含めない。
 */
const PRONE_LOCOMOTIONS = new Set<Locomotion>(['prone_idle', 'crawl_f', 'crawl_b'])

/** 落下ループの再生速度の上限。これ以上速くすると脚が忙しなく見える */
const JUMP_LOOP_MAX_SPEED = 3

/**
 * ルートモーションをそのまま位置に使うクリップ。
 *
 * 通常の移動はコード側が権威で、クリップの移動は取り除いている (足が滑らないよう
 * 再生速度のほうを合わせる)。ローリングのように加減速がある動作は、平均速度で
 * 動かすと着地して止まっているのに前へ滑る。クリップの動きをそのまま使う。
 */
/**
 * クリップに焼かれた移動をそのまま辿る型。
 *
 * **着地は入れない。** 転がる型だった頃は 3m 進む必要があったが、いまの
 * 着地 (hard_land) は膝を突いて堪える動きで、その場から動かない。
 */
const ROOT_MOTION_CLIPS = new Set(['roll', 'prone_roll_down'])

/** ローリングの再生速度。クリップのままだと転がりが緩慢に見える */
const ROLL_TIME_SCALE = 1.32

/**
 * 全身で転がる型が、クリップに焼かれた移動をどれだけ辿るか。
 *
 * 再生速度とは別に持つ必要がある。速く回せばそのぶん短い時間で終わるが、
 * クリップに焼かれた移動量は変わらないので距離は同じになる。
 * 「速くて短い」を作るには、移動そのものを削るしかない。
 *
 * --- 受け身にも要る ---
 * 長らく roll だけだった。**受け身はその場で回っていた** — 焼かれた移動を
 * 誰も読まないので、腰が 179 度振れるだけで 1 ミリも進まない。高い所から
 * 落ちた人がその場でくるりと回る、という絵になっていた。
 *
 * 受け身は 1.0 = **クリップに焼かれた通り**で 3.1m。倍率を掛けないので
 * 足が滑らない (回避ローリングは 0.8 なので 2 割ぶん滑っている)。
 * 落ちた勢いが前へ流れて消える、という絵がそのまま出る。
 *
 * --- 伏せたまま横へ転がるのも同じ ---
 * 半回転で**横へ 0.56m** 焼き込まれている。倍率を掛けないのは受け身と同じ
 * 理由で、寝た体が地面を擦って進む型なので、少しでも滑ると気づく。
 */
const ROOT_DISTANCE_SCALE: Record<string, number> = { roll: 0.8 }
/**
 * ローリングの**操作ロック**を解く時点 (クリップ尺に対する割合)。
 *
 * ロック = 撃てず、向きも変えられない時間。ポインタロック (infra/input) とは
 * 別物で、こちらは動きが操作を受け付けない、という意味。
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
  /*
   * 落下の受け身。**ここに無くて、下半身だけループしていた。**
   *
   * 尺 (1.67 秒) とロック (HARD_LAND_TIME) がほぼ同時なので、絵の上では
   * 気づけない。焼かれた移動を辿るようにした途端に出た — クリップが頭へ
   * 戻ると根元の位置も頭へ戻るので、**1 フレームで 3m 引き戻される**。
   * 「進んでから着地点へ滑って戻る」という形で、しかも競り合いなので毎回は出ない。
   */
  'hard_land',
  // ダンボールが落ちた反応。留めないと 1.47 秒ごとに驚き直す
  'bump',
  // 伏せへの出入り。留めないと、伏せた瞬間にまた膝立ちから伏せ直す
  'prone_down',
  'prone_rise',
  'prone_roll_down',
  // 倒れる / 起き上がる。留めておかないと、倒れた姿勢を保てず
  // 3 秒ごとに勝手に倒れ直す (伏せ撃ちの足場が消える)
  'sweep',
  'stand',
  'jump_up',
  'jump_down',
  'death',
  'death_front',
  'death_back',
  // 眠り。**最後の姿勢で止める** — 流し直すと 30 秒の間ずっと倒れ直す
  'sleep',
  'salute',
  // クレイモアを置く型。**構えは最後のフレームで止める** —
  // 一度だけにしないと 1.77 秒で頭から流れ直して、かがむ動作を繰り返す
  'claymore_windup',
  'claymore_place',
  // 切れた人の姿。1 枚の静止ポーズなので、流したところで留める
  'away',
])

/** 上半身レイヤーの action を引くキー。移動状態ごとに別 action を持つため文字列にする */
const AIM_KEY = 'aim'
const CROUCH_AIM_KEY = 'crouch_aim'
const FIRE_KEY = 'fire'
/**
 * 拳銃の型。
 *
 * 銃ごとに構えが要る。ライフルの構えで拳銃を持つと両手で握ることになり、
 * 手の位置も銃の長さも合わない。狙撃銃はまだ専用の構えが無く、
 * ライフルのものを流用している (左手が合わない、として残っている問題)。
 */
const PISTOL_AIM_KEY = 'pistol_aim'
const PISTOL_CROUCH_AIM_KEY = 'pistol_crouch_aim'
const PISTOL_FIRE_KEY = 'pistol_fire'
/** 拳銃のリロード。弾倉を抜いて差し込む片手の型 */
const PISTOL_RELOAD_KEY = 'pistol_reload'

/**
 * 拳銃のリロードの再生速度。
 *
 * クリップは 3.73 秒。等速だと長物より遅くなって、副武器として持つ意味が薄れる。
 * 1.7 倍 = 約 2.2 秒。
 *
 * 音 (1.18 秒) より長い。音が先に終わるが、そこは合わせない —
 * 速めると動きが破綻するほうが目立つ。
 */
const PISTOL_RELOAD_RATE = 1.7
/**
 * 拳銃を構えていないときの姿勢。ホルスターに納めた手ぶらの型。
 *
 * 移動中も要る。止まっているときだけ差し替えると、走った瞬間に
 * 長物を提げた型に落ちて、**拳銃を選んだのに突撃銃を構えて見える**。
 */
const PISTOL_RELAXED: Partial<Record<Locomotion, string>> = {
  idle: 'pistol_relaxed',
  crouch_idle: 'pistol_relaxed',
  sneak: 'crouch_unarmed',
  /*
   * 階段と跳躍は走りと同じ手ぶら。
   *
   * **ここに無いと小銃の型へ落ちる。** 抜けていたので、クレイモアを持って坂を
   * 下りると一瞬 down_stair に入り、その間だけ**小銃を両手で提げた姿**になって
   * いた (relaxed_run はライフルを持つ型)。
   */
  up_stair: 'run_unarmed',
  down_stair: 'run_unarmed',
  jump_up: 'run_unarmed',
  jump_loop: 'run_unarmed',
  jump_down: 'run_unarmed',
  ...(Object.fromEntries(
    MOVE_DIRECTIONS.flatMap((d) => [
      // 手ぶらの走り。拳銃は納めているので、腕を振って走るのが正しい
      // (pistol_run は拳銃を持ったまま走る型なので、納めている間は合わない)
      [`run_${d}`, 'run_unarmed'],
      // しゃがみ移動も手ぶら。拳銃を持ったまま歩く型 (pistol_walk) は
      // 納めている間は合わない
      [`crouch_${d}`, 'crouch_unarmed'],
    ]),
  ) as Record<string, string>),
}

const pistolKey = (state: Locomotion) => `pistol_relaxed:${state}`
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
/**
 * 手榴弾を投げる。上半身だけで済むので走りながらでも投げられる。
 *
 * **2 本に割ってある** (tools/split_clip.js)。以前は 1 本のクリップを
 * 「1.5 秒の所で再生速度を 0 にして止める」形で扱っていたが、その 1.5 秒は
 * 2.33 秒のクリップを実測した値なので、**尺の違うモデルでは別の場所を指す**。
 * 移植したモデルが 25% 速かったとき、振り切ったあとを指して
 * 「押しっぱなしなのに手を振り下ろす」になった。
 *
 * 割れば止める位置は「前半クリップの終わり」になる。数字がコードから消えて
 * 資産に移り、clampWhenFinished がそのまま保持になる。
 *
 * ピンを抜いて振りかぶるまでを押している間に済ませ、離すと振り切って投げる。
 * 押している間は信管が進まない — 現実には抜いた時点で燃え始めるが、
 * 溜められると「持ったまま間合いを計る」が最善手になって読み合いが消える。
 */
const THROW_WINDUP_KEY = 'throw_windup'
const THROW_RELEASE_KEY = 'throw_release'

/**
 * 伏せたまま投げる型。**同じ 2 段を、寝た体でやる。**
 *
 * 立ちの投擲を腹這いの腰に載せると、腕だけが立ち上がって振りかぶる
 * (伏せ撃ちや伏せ装填と同じ話)。手榴弾は物陰から覗いて投げる道具なので、
 * **伏せたまま投げられないと使い所が半分になる。**
 *
 * 尺は 0.97 + 1.73 秒。立ち (1.50 + 0.83) と比べて振りかぶりが短く、
 * 振り切りが長い — 寝たまま腕を回すので、投げ終わって腕を戻すまでが長い。
 */
const PRONE_THROW_WINDUP_KEY = 'prone_throw_windup'
const PRONE_THROW_RELEASE_KEY = 'prone_throw_release'

/**
 * クレイモアを置く型。投擲と**同じ 2 段**で、押している間は構えたまま止まる。
 *
 * 尺は 1.77 秒 + 3.60 秒。投擲 (1.50 + 0.83) よりずっと長い — 置いて離れる道具は
 * 「その場に留まる時間」そのものが代償になっている。
 */
const SETUP_WINDUP_KEY = 'claymore_windup'
const SETUP_RELEASE_KEY = 'claymore_place'

/**
 * 置き切る型の再生速度。
 *
 * 素の 3.60 秒は**長すぎた**。かがんで置いて立ち上がるまでが 1 つのクリップに
 * 入っていて、後半はほぼ立ち上がるだけ。代償として払わせたいのは「その場に
 * 留まる時間」だが、置き終わってからも足が止まっているのは、代償ではなく
 * ただ操作が返ってこない時間になる。
 *
 * 振りかぶり (1.77 秒) はそのまま。押している間の話なので、長くて困らない。
 *
 * **一度 1.8 倍に速めたが戻した。** 待ち時間は縮むが、かがむ動作が早送りに
 * 見える。待ちの本体は「引き金を引いてから手が床に着くまで」で、そちらは
 * 置く瞬間を測り直して縮めてある (Game の CLAYMORE_PLACE_RATIO)。
 */
const SETUP_RELEASE_RATE = 2.2
const ROLL_KEY = 'roll'
/**
 * 落下の受け身。**上半身にも同じクリップを流す。**
 *
 * 下だけに流したら、銃を構えたまま脚だけが転がった。全身の型は上下ともに
 * 差し替えないと、腰から上が構えの姿勢のまま残る。
 */
const HARD_LAND_KEY = 'hard_land'
const DEATH_KEY = 'death'
/** 倒れる向き。撃たれた側から見て前か後ろか */
const DEATH_FRONT_KEY = 'death_front'
/** 伏せたまま倒された型。**向きは無い** — 既にその向きで寝ている */
const PRONE_DEATH_KEY = 'prone_death'
const DEATH_BACK_KEY = 'death_back'
/**
 * 麻酔で眠っている型。**上半身も要る。**
 *
 * 下半身だけ差し替えていた頃、**寝た脚の上に銃を構えた上半身**が乗っていた。
 * 全身の型は下半身の一覧 (ONE_SHOT_LOWER) に足すだけでは足りず、上半身の側にも
 * 登録して、選び分けにも書かないと繋がらない (倒れる型と同じ扱い)。
 */
const SLEEP_KEY = 'sleep'

/**
 * 接続が切れた人の姿。
 *
 * 1 枚の静止ポーズなので、流したところで留める (死体と同じ扱い)。
 */
const AWAY_KEY = 'away'
const HIT_KEY = 'hit'
/** ダンボールで敵にぶつかった反応。全身の型なので上下そろえて流す */
const BUMP_KEY = 'bump'
/** 伏せへの出入り。全身の型 */
const PRONE_DOWN_KEY = 'prone_down'
const PRONE_RISE_KEY = 'prone_rise'
/**
 * 仰向けからうつ伏せへ、横へ半回転する型 (0.50 秒、横へ 0.56m)。
 *
 * 転ぶ型 (sweep) は**仰向けで終わる**ので、そのまま這う型へ渡すと 1 フレーム
 * で裏返る。這い出すのに転がる間を挟むのは、伏せに入るのに prone_down を
 * 挟むのと同じ話。
 *
 * 素材は 1 回転 (うつ伏せ → 仰向け → うつ伏せ) の型で、その後半だけを使う。
 * 前半 (うつ伏せ → 仰向け) は取り込んでいない — 仰向けで止まれる姿勢を
 * 足すなら、そこから割り直す (tools/README.md)。
 */
const PRONE_ROLL_DOWN_KEY = 'prone_roll_down'
/**
 * 伏せ撃ち。**構えと発砲を同じクリップから作る。**
 *
 * 素材は発砲の 1 本 (0.87 秒)。頭で止めれば構えた 1 枚の姿勢になるので、
 * 待機用に止めた action と、撃つ間だけ流す action の 2 つに分ける
 * (立ちの AIM_KEY / FIRE_KEY と同じ形)。
 */
const PRONE_AIM_KEY = 'prone_aim'
const PRONE_FIRE_KEY = 'prone_fire'
/** 伏せたままの装填。立ちの型を腹這いに載せると上体だけ起き上がる */
const PRONE_RELOAD_KEY = 'prone_reload'
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
  PISTOL_RELOAD_KEY,
  PRONE_RELOAD_KEY,
  STAB_KEY,
  BOLT_KEY,
  SWEEP_KEY,
  STAND_KEY,
  THROW_WINDUP_KEY,
  THROW_RELEASE_KEY,
  PRONE_THROW_WINDUP_KEY,
  PRONE_THROW_RELEASE_KEY,
  SETUP_WINDUP_KEY,
  SETUP_RELEASE_KEY,
  ROLL_KEY,
  HARD_LAND_KEY,
  BUMP_KEY,
  DEATH_FRONT_KEY,
  DEATH_BACK_KEY,
  PRONE_DEATH_KEY,
  PRONE_DOWN_KEY,
  PRONE_RISE_KEY,
  PRONE_ROLL_DOWN_KEY,
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

/**
 * ダンボールで動くときの足の速さ (倍率)。
 *
 * 進む速さは変えず、**足の運びだけ遅くする**。歩幅に合わせて再生すると
 * 足は滑らないが、箱の中で細かく足踏みしているように見えた。
 *
 * 箱は「そこに置いてある物」に見えていてほしいので、動きは鈍いほうがいい。
 * そのぶん足は少し滑るが、箱に隠れてほとんど見えない — この姿勢に限っては
 * 足の同期より見え方を取る。
 */
const SNEAK_RATE = 0.65
/**
 * 這うクリップ本来の速度 (m/s)。**tools/measure/stride.js の実測。**
 *
 * 歩幅 0.64m を 3.90 秒で送るので 0.33 m/s。その場這いで書き出されているので
 * 移動量からは測れず、sneak と同じ方法で出している。
 */
const CRAWL_CLIP_SPEED = 0.33

/**
 * 再生を止めて 1 枚の姿勢として使う型。
 *
 * **速さ任せにできない。** 渡ってくる速さ (setMoveSpeed) はその姿勢で出せる
 * 上限であって、いま動いているかではない — 止まって伏せていても 0.85 m/s の
 * まま来る。そのまま流すと、進んでいないのに腕だけ掻き続ける。
 *
 * 止まって伏せている姿は這う型と同じクリップなので、頭で止めれば腹這いの
 * 姿勢になる。専用のクリップが手に入ったらここから外す。
 */
const FROZEN_CLIPS: readonly Locomotion[] = ['prone_idle']

/**
 * 這う型の再生倍率。**1 より小さい = 進む速さより手足の運びを遅くする。**
 *
 * 速さぴったりに合わせると (倍率 1)、腕の掻きが忙しなくて這っているように
 * 見えない。箱 (SNEAK_RATE) と同じ判断で、**足が少し滑るのを承知で見え方を
 * 取る** — 腹這いは体が地面に沈んでいるので、滑りが目に付きにくい。
 *
 * 進む速さは変えない (domain/player/stance.ts の PRONE_SPEED_SCALE)。
 */
const CRAWL_RATE = 0.75

/**
 * 起き上がる型の再生倍率。**1 より大きい = 速く流す。**
 *
 * 素の尺は 1.83 秒。伏せから戻るのにそれだけ動けないと、伏せることが
 * 「一度入ったら抜けられない」姿勢になる。動けない時間もこの倍率で縮む
 * (proneRiseDuration が割った後の値を返す)。
 */
const PRONE_RISE_RATE = 1.5

/**
 * 走りの足の回転の底上げ (倍率)。**1 で滑りゼロ、大きいほど速く回る。**
 *
 * 再生速度は「実速度 ÷ クリップ本来の速度」で決めていて、そのままなら足は
 * 地面と同じ速さで後ろへ流れる — 滑りが原理的に出ない。ただしクリップは
 * 4.76 m/s で作られていて、この遊びの走りは 3.04 m/s しかない。**素のままだと
 * 本来の 64% でしか足が回らず、間延びして見える。**
 *
 * 上げたぶんは滑りとして出る。1.31 で足が地面より 31% 速く送られる — 走りの
 * 型は接地時間が短いので、この程度なら目で追えない。
 *
 * 素の 0.64 が 0.84 になる。**目で見て決めた値** (0.80 と 0.82 では足りなかった)。
 *
 * FAST MOVE (runner) は実速度のほうを上げるので、こことは別に効く
 * (Lv3 で 1.16 倍)。**あれは速く動くから速く回る**で、こちらは**同じ速さでも
 * 足を速く送る**。
 *
 * ?cadence=1.4 のように URL から触れる (Game.ts)。
 */
const RUN_CADENCE = 1.31

const CLIP_SPEED: Partial<Record<Locomotion, number>> = {
  sneak: SNEAK_CLIP_SPEED,
  crawl_f: CRAWL_CLIP_SPEED,
  // 後退も同じ速さで作られている
  crawl_b: CRAWL_CLIP_SPEED,
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

/**
 * その glb に無い型を並べる。**代用に落ちても黙っているのを見張る。**
 *
 * 型が欠けていると、その状態のときだけ別の型が流れる。**警告が出ないので、
 * 見た目で気づくまで分からない** — 雷電に knee_relaxed / knee_ready が無く、
 * しゃがむと古い crouch_idle が流れて、そこに合わせていない握りで銃口が
 * 上を向いた。試写は別のモデルを読んでいたので、突き合わせるまで出なかった。
 *
 * 見るのは**表に書いてある名前**だけ。表を直せばここも一緒に動くので、
 * 別に一覧を持たない (持つと必ず片方が古くなる)。
 */
export function missingClips(animations: THREE.AnimationClip[]): string[] {
  const have = new Set(animations.map((clip) => clip.name))
  const want = new Set<string>([
    ...Object.values(LOWER_CLIPS),
    ...Object.values(RELAXED_CLIPS),
    ...Object.values(PISTOL_RELAXED),
  ])
  return [...want].filter((name) => !have.has(name)).sort()
}

/** 走りの 8 方向 */
const RUN_STATES = new Set<Locomotion>(MOVE_DIRECTIONS.map((d) => `run_${d}` as Locomotion))

/**
 * 構えていない間、**上下を同じクリップに揃える姿勢。**
 *
 * 素材が 2 つの家系に分かれていて、腰の向きも傾きも違う。混ぜると差がそのまま
 * 上半身に出る (登録の所に測った値がある)。
 *
 *                 X       Y      Z
 *   idle       -103.1    1.4   39.9   ← 手榴弾のときの下半身
 *   pistol_relaxed -94.5 0.1   43.1   ← そのときの上半身
 *
 * 打ち消し (alignSpineToUpperClip) は**縦軸まわりの捻れだけ**を消して、傾きは
 * 本来の姿勢として残す。なので X の差 8.6° が上体の傾きとして残り、**立って
 * いるだけで右へ 15° ほど傾いて**見えた。上下を同じクリップにすれば差が無くなる。
 */
const RELAXED_LOWER_STATES = new Set<Locomotion>([...RUN_STATES, 'idle'])

/** 脱力中の下半身を引く鍵。**元の状態と、流すクリップの組** */
function relaxedLowerKey(state: Locomotion, clip: string): string {
  return `${state}@${clip}`
}

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
  /** 拳銃のリロードの尺 (秒)。0 ならクリップが無い */
  pistolReloadDuration = 0
  /** 刺突クリップの尺 (秒)。0 ならクリップが無い */
  readonly stabDuration: number
  /** ボルト操作の尺 (秒)。モデル未着なら 0 */
  boltDuration = 0
  /** 吹き飛ばされる尺 (秒)。再生速度を掛けたあとの実際の長さ */
  sweepDuration = 0
  /** 起き上がる尺 (秒)。再生速度を掛けたあとの実際の長さ */
  standDuration = 0
  /** 投擲の尺 (秒)。振りかぶり + 投げ */
  throwDuration = 0
  /** 投げ (後半) の尺 (秒)。手を離れる瞬間をこれに対する割合で測る */
  throwReleaseDuration = 0
  /** 伏せて投げる (後半) の尺 (秒)。型が違うので、放す割合も別に持つ */
  proneThrowReleaseDuration = 0
  /** 振りかぶりで止めているか */
  /**
   * いま流している 2 段の型。振りかぶって止まり、放すと振り切る物。
   *
   * 手榴弾とクレイモアが同じ仕組みを通る。**別々に書くと片方だけ直してずれる** —
   * 実際、刺さる姿勢のドメインルールをサーバーにだけ入れて同じ形の穴を開けた。
   */
  private pair: { windup: string; release: string; held: boolean; whole: boolean } | null = null
  /** 置く型の後半の尺 (秒) */
  setupReleaseDuration = 0

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
  /** ダンボールで敵にぶつかった反応の尺 (秒)。0 ならクリップが無い */
  readonly bumpDuration: number
  /** 伏せへの出入りの尺 (秒)。0 ならクリップが無い */
  readonly proneDownDuration: number = 0
  readonly proneRiseDuration: number = 0
  /** 仰向けからうつ伏せへ転がる尺 (秒)。0 ならクリップが無い */
  readonly proneRollDownDuration: number = 0
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
  private readonly lower = new Map<string, THREE.AnimationAction>()
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
  private readonly lowerWeights = new Map<string, number>()
  /** 下半身に実際に流しているクリップの名前。上下が同じかを見るのに使う */
  private readonly lowerClipNames = new Map<string, string>()
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
  private readonly rebaseScratch = new THREE.Quaternion()
  private hipsUp: THREE.Vector3 | null = null
  /** 取り除く前のルートモーション。位置に使うクリップだけ控えておく */
  private readonly rootMotion = new Map<string, RootMotionTrack>()
  /** 前フレームに読んだルートモーションの値。差分を出すのに使う */
  private readonly lastRootSample = new THREE.Vector3()
  private rootSampleValid = false
  /** 前回どこまで再生していたか。頭へ戻ったのを見つけるのに使う */
  private lastRootTime = 0
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
    /*
     * **倒れていたら戻さない。**
     *
     * 死ぬ直前に流していた型 (受け身・転がり・刺突…) は、死んだあとも尺の
     * 分だけ動き続けて終わる。その「終わった」で構えへ戻すと、**死体の
     * 上半身だけが銃を構え直す**。落下の受け身 (1.67 秒) は死んでから終わる
     * ことが多いので、そこで必ず出ていた。
     */
    if (this.upperState === 'death') return

    /*
     * **いま上半身を動かしている物が終わったときだけ畳む。**
     *
     * 終わったのが何かを見ずに、下の一覧に載っていれば畳んでいた。**前の型が
     * 残ったまま終わると、後から始めた型まで一緒に畳まれる。**
     *
     * 高い所から落ちると下半身だけ回る、という形で出た。着地の 0.22 秒後に
     * **前の回避ローリング**が終わり、その通知で受け身の上半身が構えへ戻る。
     * 下半身は locomotion で決まるので受け身のまま残り、腰から上だけが
     * 銃を構え直して見える。
     *
     * 一覧を足し引きしても直らない — 載っている型はどれも同じ踏み方をする。
     * **持ち主かどうか**を見るのが筋で、それは今どの鍵が選ばれているかで分かる。
     */
    if (finished !== this.upper.get(this.resolveUpperKey())) return

    // 倒れたときだけは戻さない。最終ポーズのまま留める。
    if (
      finished === this.upper.get(RELOAD_KEY) ||
      finished === this.upper.get(PISTOL_RELOAD_KEY) ||
      finished === this.upper.get(PRONE_RELOAD_KEY) ||
      finished === this.upper.get(STAB_KEY) ||
      finished === this.upper.get(ROLL_KEY) ||
      finished === this.upper.get(HARD_LAND_KEY) ||
      finished === this.upper.get(BUMP_KEY) ||
      finished === this.upper.get(PRONE_DOWN_KEY) ||
      finished === this.upper.get(PRONE_RISE_KEY) ||
      finished === this.upper.get(PRONE_ROLL_DOWN_KEY) ||
      finished === this.upper.get(HIT_KEY) ||
      finished === this.upper.get(SALUTE_KEY) ||
      finished === this.upper.get(BOLT_KEY) ||
      finished === this.upper.get(SWEEP_KEY) ||
      finished === this.upper.get(STAND_KEY) ||
      finished === this.upper.get(THROW_RELEASE_KEY) ||
      finished === this.upper.get(SETUP_RELEASE_KEY)
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
      this.lowerClipNames.set(state, clip.name)
    }

    /*
     * **構えていない間の下半身。上半身と同じクリップから取る。**
     *
     * 素材は 2 つの家系に分かれている。8 方向の走り (run_f …) と idle は腰を
     * 振って作られていて (run_f −39.3°、run_r −66.6°、idle −48.2°)、その振れを
     * **自分の上半身が戻している。** 脱力の型 (relaxed_run −6.9° / run_unarmed
     * −0.0°) は正面向きで作られている。
     *
     * 混ぜると戻しだけが消えて、上半身が振れた角度そのまま捻れる — 走ると
     * 上半身が右へ 45° 向く、という形で出ていた。
     *
     * **構えている間は 8 方向が要る** (体は照準を向いたまま横へ動く) が、
     * 脱力中は体が進行方向を向くので前走りしか使わない。だから脱力の間だけ
     * 上下を同じクリップにする。上下が同じなら向きの補正も要らなくなる。
     */
    for (const [state, name] of [
      ...Object.entries(RELAXED_CLIPS).map(([k, v]) => [k, v] as const),
      ...Object.entries(PISTOL_RELAXED).map(([k, v]) => [k, v] as const),
    ]) {
      if (!RELAXED_LOWER_STATES.has(state as Locomotion)) continue
      const clip = byName.get(name)
      const key = relaxedLowerKey(state as Locomotion, name)
      if (!clip || this.lower.has(key)) continue
      const action = this.mixer.clipAction(splitClip(clip, 'lower', key))
      action.play()
      this.lower.set(key, action)
      this.lowerClipNames.set(key, clip.name)
    }

    // --- 上半身レイヤー ---
    // 構えは idle の上半身。移動中も銃を構えた姿勢を保つ。
    const registerUpper = (key: string, clip: THREE.AnimationClip): THREE.AnimationAction => {
      const action = this.mixer.clipAction(splitClip(clip, 'upper', key))
      // 姿勢だけのクリップは頭で止める。回すと震える (POSE_ONLY_CLIPS の注)
      if (POSE_ONLY_CLIPS.has(clip.name)) action.setEffectiveTimeScale(0)
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

    // しゃがみの構え。**脱力と同じ 1 本の両端から取る** (RELAXED_CLIPS の注)
    const crouchAim = byName.get('knee_ready') ?? byName.get('crouch_aim')
    if (crouchAim) registerUpper(CROUCH_AIM_KEY, crouchAim)

    // 拳銃の構えと発砲。無ければライフルの型で代用される
    for (const [key, name] of [
      [PISTOL_AIM_KEY, 'pistol_aim'],
      [PISTOL_CROUCH_AIM_KEY, 'pistol_crouch_aim'],
      [PISTOL_FIRE_KEY, 'pistol_fire'],
    ] as const) {
      const clip = byName.get(name)
      if (clip) registerUpper(key, clip)
    }

    // 拳銃のリロード。1 回きりで、終わったら構えに戻る
    const pistolReload = byName.get('pistol_reload')
    if (pistolReload) {
      const action = registerUpper(PISTOL_RELOAD_KEY, pistolReload)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.setEffectiveTimeScale(PISTOL_RELOAD_RATE)
    }
    this.pistolReloadDuration = (pistolReload?.duration ?? 0) / PISTOL_RELOAD_RATE

    // 拳銃を提げているときの姿勢。移動状態ごとに引き分ける
    for (const [state, clipName] of Object.entries(PISTOL_RELAXED) as [Locomotion, string][]) {
      const clip = byName.get(clipName)
      if (clip) registerUpper(pistolKey(state), clip)
    }

    // 構えていないときは銃を下ろした姿勢。移動状態ごとに別のクリップを使う。
    for (const [state, clipName] of Object.entries(RELAXED_CLIPS) as [Locomotion, string][]) {
      const clip = byName.get(clipName)
      if (clip) registerUpper(relaxedKey(state), clip)
    }

    /*
     * 表に無い姿勢は、**下半身と同じクリップ**で埋める。
     *
     * 埋めないと構えの型 (AIM_KEY) が出る。上半身に専用の口を持つ姿勢
     * (倒れる・転がる・受け身) でも、**状態が先に終わって姿勢だけ残る**間は
     * ここへ落ちるので、構えていないのに銃を構えて見えた。
     *
     * 表に書くのは「下半身と違うクリップを使いたいとき」だけでよくなる。
     * **姿勢を足すたびに 2 つの表へ書き足す**という段取りが要らない。
     */
    for (const state of Object.keys(LOWER_CLIPS) as Locomotion[]) {
      const key = relaxedKey(state)
      if (this.upper.has(key)) continue
      const clip = byName.get(LOWER_CLIPS[state])
      if (!clip) continue
      const action = registerUpper(key, clip)
      /*
       * 一度きりの姿勢は繰り返さない。
       *
       * 埋めた action は常時流れている (全 action を再生しておく作り) ので、
       * 繰り返すと**下半身が終わりで止まっている間に上半身だけ頭へ戻る**。
       */
      if (ONE_SHOT_LOWER.has(state)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
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

    // 振りかぶりは**終わった所で止まる**。それが保持の姿勢になる
    const windup = byName.get(THROW_WINDUP_KEY)
    if (windup) {
      const action = registerUpper(THROW_WINDUP_KEY, windup)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    const release = byName.get(THROW_RELEASE_KEY)
    if (release) {
      const action = registerUpper(THROW_RELEASE_KEY, release)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.throwDuration = (windup?.duration ?? 0) + (release?.duration ?? 0)
    this.throwReleaseDuration = release?.duration ?? 0

    // 伏せたまま投げる型。**立ちと同じ 2 段**なので同じ扱いで登録する。
    // 無ければ立ちの型へ落ちる (playThrow が持っているかを見る)
    for (const key of [PRONE_THROW_WINDUP_KEY, PRONE_THROW_RELEASE_KEY]) {
      const clip = byName.get(key)
      if (!clip) continue
      const action = registerUpper(key, clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.proneThrowReleaseDuration = byName.get(PRONE_THROW_RELEASE_KEY)?.duration ?? 0

    // クレイモアも同じ 2 段。**同じ仕組みを通す** — 別々に書くと、
    // 片方だけ直したときに静かにずれる
    for (const key of [SETUP_WINDUP_KEY, SETUP_RELEASE_KEY]) {
      const clip = byName.get(key)
      if (!clip) continue
      const action = registerUpper(key, clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      // 上下を同じ速さで流す。片方だけ速めると腰から上と下が離れる
      if (key === SETUP_RELEASE_KEY) {
        action.setEffectiveTimeScale(SETUP_RELEASE_RATE)
        this.lower.get(key as Locomotion)?.setEffectiveTimeScale(SETUP_RELEASE_RATE)
      }
    }
    // **実際に流れる秒数**を持つ。クリップの尺をそのまま出すと、速めたぶん
    // 手を離れる時刻が後ろにずれて、置き終わってから物が出る
    this.setupReleaseDuration = (byName.get(SETUP_RELEASE_KEY)?.duration ?? 0) / SETUP_RELEASE_RATE

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

    const hardLand = byName.get('hard_land')
    if (hardLand) {
      const action = registerUpper(HARD_LAND_KEY, hardLand)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }

    const proneReload = byName.get('prone_reload')
    if (proneReload) {
      const action = registerUpper(PRONE_RELOAD_KEY, proneReload)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }

    const proneFire = byName.get('prone_fire')
    if (proneFire) {
      // 構えは頭で止めた 1 枚。撃つほうは流す
      registerUpper(PRONE_AIM_KEY, proneFire).setEffectiveTimeScale(0)
      registerUpper(PRONE_FIRE_KEY, proneFire)
    }

    for (const [key, name] of [
      [PRONE_DOWN_KEY, 'prone_down'],
      [PRONE_RISE_KEY, 'prone_rise'],
      [PRONE_ROLL_DOWN_KEY, 'prone_roll_down'],
    ] as const) {
      const clip = byName.get(name)
      if (!clip) continue
      const action = registerUpper(key, clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      // **流す速さで割った尺**を持つ。動けない時間を絵と一致させるため
      if (key === PRONE_DOWN_KEY) this.proneDownDuration = clip.duration
      else if (key === PRONE_ROLL_DOWN_KEY) this.proneRollDownDuration = clip.duration
      else this.proneRiseDuration = clip.duration / PRONE_RISE_RATE
    }

    const bump = byName.get('bump')
    if (bump) {
      const action = registerUpper(BUMP_KEY, bump)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.bumpDuration = bump?.duration ?? 0

    for (const [key, name] of [
      [DEATH_FRONT_KEY, 'death_front'],
      [DEATH_BACK_KEY, 'death_back'],
      // 伏せたまま倒された。**向きは無い** — 既にその向きで寝ている
      [PRONE_DEATH_KEY, 'prone_death'],
      // 眠り。倒れる型と同じで、最後の姿勢のまま留める
      [SLEEP_KEY, 'sleep'],
    ] as const) {
      const clip = byName.get(name)
      if (!clip) continue
      const action = registerUpper(key, clip)
      action.setLoop(THREE.LoopOnce, 1)
      // 倒れた姿勢のまま留める。ここを緩めると死体が立ち上がる
      action.clampWhenFinished = true
    }

    const death = byName.get('death')
    if (death) {
      const action = registerUpper(DEATH_KEY, death)
      action.setLoop(THREE.LoopOnce, 1)
      // 倒れた姿勢のまま留める。ここを緩めると死体が立ち上がる。
      action.clampWhenFinished = true
    }

    const away = byName.get('away')
    if (away) {
      const action = registerUpper(AWAY_KEY, away)
      action.setLoop(THREE.LoopOnce, 1)
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

    /*
     * 再生速度を当てるのは**上半身を揃え終えてから**。
     *
     * 以前は下半身を揃えた直後に呼んでいて、そのとき上半身の action はまだ
     * 1 本も無かった。**止めておくはずの型 (FROZEN_CLIPS) が下半身しか
     * 止まらず**、伏せて止まっている人の腕だけが掻き続けた。
     *
     * 自機では出ない — Soldier が速度の変化で setMoveSpeed を呼び、そこで
     * 呼び直されて止まる。**呼ばない側 (RemoteSoldier) にだけ出る。**
     */
    this.applyLocomotionTimeScales()

    // 全 action を常時再生しておき、見せ方は重みだけで決める。
    // 必要になってから play() すると、その瞬間だけ重みの合計が 1 を割る。
    // (reload はワンショットなので playReload() の中で始める)
    for (const [state, action] of this.lower) {
      // ワンショットは再生を始める側で play する
      if (!ONE_SHOT_LOWER.has(state as Locomotion)) action.play()
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
    this.updateThrow()

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
    this.blend(this.lower, this.lowerWeights, this.resolveLowerKey(), lowerLambda, dt)
    this.previousLocomotion = this.locomotion
    this.blend(this.upper, this.upperWeights, this.resolveUpperKey(), UPPER_BLEND_LAMBDA, dt)
    /*
     * 全身の型が決まっている動作では、照準由来の補正を掛けると崩れる。
     *
     * **しゃがんだ刺突だけは別。** あれは上半身だけの型で、下半身はしゃがみのまま
     * なので、背骨を曲げても壊れない。むしろ曲がらないと**下を向いて刺せない** —
     * 倒れている相手に刃が通るのは見下ろしたときだけ (hitcheck の
     * STAB_DOWN_PITCH) なのに、見た目が真っ直ぐ前を刺したままになる。
     *
     * 腕は Spine2 の子なので、背骨が下を向けば刃も下を向く。
     */
    /*
     * 伏せも同じ扱い。**姿勢が決まっているので、照準由来の補正を掛けない。**
     *
     * とくに squareHips が効く — あれは腰を「構えの基準姿勢」へ寄せるので、
     * 腹這いの腰を立った向きへ引き起こす。構えた瞬間に体が起き上がって見えた
     * のはこれ。出入りの繋ぎ (prone_down / prone_rise) も途中で腰を起こされる
     * と型が崩れるので同じく外す。
     */
    const prone =
      PRONE_LOCOMOTIONS.has(this.locomotion) ||
      this.upperState === 'prone_down' ||
      this.upperState === 'prone_roll_down' ||
      this.upperState === 'prone_rise'
    /*
     * 麻酔で眠っている。**倒れているのと同じ扱い。**
     *
     * ここに入れ忘れていて、眠った下半身の上に**照準の曲げ・背骨の揃え・
     * 上体の傾き**が乗り続けていた。倒れた型を流しているのに体が起き上がる、
     * という形で出る (伏せを入れたときと同じ罠)。
     */
    const asleep = this.locomotion === 'sleep' || this.upperState === 'sleep'
    const committed =
      (this.upperState === 'stab' && this.locomotion !== 'crouch_stab') ||
      this.upperState === 'salute' ||
      this.upperState === 'roll' ||
      this.upperState === 'hard_land' ||
      this.upperState === 'death' ||
      this.upperState === 'hit' ||
      asleep ||
      prone
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
    // **実際に流している下半身**と見比べる。脱力中は別のクリップを流している
    if (this.upperClipNames.get(key) === this.lowerClipNames.get(this.resolveLowerKey())) return
    /*
     * 伏せている間も掛けない。
     *
     * この補正が戻す先は**立った腰**を基準にした向き (uprightHips)。腹這いでは
     * その基準そのものが当てはまらないので、寄せるほど体が起きる。伏せの型は
     * 上下ともほぼ同じ腰の向きで作られているので、補正しなくても食い違わない。
     */
    if (PRONE_LOCOMOTIONS.has(this.locomotion)) return

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
    //
    // ただし取り除くのは**縦軸まわりの捻れだけ**。差には前後の傾きも混ざって
    // いて、そちらは「作られた向き」ではなく本来のポーズなので、一緒に消すと
    // 上体がのけぞる (実測: 立ちの脱力で首が -6.8° → -15.5°。素材は -5.0°)。
    const neutral = this.upperHipsNeutrals.get(key)
    if (neutral && this.uprightHipsKnown && this.upperTwistFix > 0) {
      this.rebaseScratch
        .copy(this.uprightHips)
        .multiply(this.neutralScratch.copy(neutral).invert())
      keepTwist(this.rebaseScratch, this.hipsUp ?? this.resolveHipsUp())
      this.neutralScratch.copy(this.rebaseScratch).multiply(this.referenceHips)
      this.referenceHips.slerp(this.neutralScratch, this.upperTwistFix)
    }

    // 現在の腰の逆 × 本来の腰 = 打ち消すべき差分
    this.scratchRotation.copy(hips.quaternion).invert().multiply(this.referenceHips)
    spine.quaternion.premultiply(this.scratchRotation)
  }

  /**
   * 腰のクォータニオンが乗っている空間での「上」。
   *
   * 腰の親 (Armature) は +90° 傾いていて、その中では上が -Z になる。素直に
   * (0,1,0) を使うと縦軸を取り違えて、捻れの補正が丸ごと効かなくなる。
   */
  private resolveHipsUp(): THREE.Vector3 {
    const axis = new THREE.Vector3(0, 1, 0)
    const parent = this.hipsBone?.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      axis.applyQuaternion(parent.getWorldQuaternion(this.scratchQuat).invert()).normalize()
    }
    this.hipsUp = axis
    return axis
  }

  private applyAimPitch(): void {
    const axes = this.aimAxes ?? this.resolveAimAxes()
    if (!axes.length) return

    // 構えていないときは前傾を上乗せする。
    //
    // 符号は照準の曲げと同じ向きに足す。**引くと前ではなく後ろへ反る** —
    // 実測で立ちの脱力が首 -8.0° (素材どおり) から -12.2° まで倒れていた。
    const total =
      THREE.MathUtils.clamp(this.aimPitch * this.aimPitchGain, -MAX_AIM_BEND, MAX_AIM_BEND) +
      this.lean
    if (total === 0) return

    for (const entry of axes) {
      this.scratchRotation.setFromAxisAngle(entry.axis, total * entry.weight)
      entry.bone.quaternion.multiply(this.scratchRotation)
    }
  }

  private resolveAimAxes(): AimAxis[] {
    // キャラの右方向 = 親 (Player のルート) のローカル +X をワールドへレプリカたもの
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

  /**
   * 這う型の再生位置 (0..1)。**蹴る瞬間を体の進みに合わせるのに使う。**
   *
   * 進む速さのほうを型に合わせる (motion.ts の crawlSurge)。逆に型を速さへ
   * 合わせると、速い時ほど足が速く回るだけで、蹴った瞬間に出るという形にならない。
   */
  get crawlPhase(): number {
    const action = this.lower.get('crawl_f')
    if (!action) return 0
    const duration = action.getClip().duration
    if (duration <= 0) return 0
    return (action.time % duration) / duration
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
      /*
       * 箱と匍匐は意図して遅くしてある。走りは底上げする (RUN_CADENCE)。
       *
       * しゃがみ移動は上げない。**あれは音を立てずに寄る動き**で、足が速く
       * 回ると忍んで見えない。
       */
      const rate =
        state === 'sneak'
          ? SNEAK_RATE
          : state === 'crawl_f' || state === 'crawl_b'
            ? CRAWL_RATE
            : RUN_STATES.has(state as Locomotion)
              ? this.runCadence
              : 1
      const scale = (this.moveSpeed / clipSpeed) * rate
      const locomotion = state as Locomotion
      this.lower.get(locomotion)?.setEffectiveTimeScale(scale)
      /*
       * 脱力中の下半身にも同じ速さを掛ける。**掛け忘れると足だけ滑る** —
       * クリップ本来の速さで割って歩幅と移動速度を合わせているので、
       * 別のクリップを流す枝にも同じ計算が要る。
       */
      for (const table of [RELAXED_CLIPS, PISTOL_RELAXED]) {
        const name = table[locomotion]
        if (name) this.lower.get(relaxedLowerKey(locomotion, name))?.setEffectiveTimeScale(scale)
      }
      /*
       * **上下が同じクリップなら、速さも同じにする。**
       *
       * 上半身は別の action として持っているので、下だけ速さを当てると
       * 腰から上と下が別々の速度で同じ型を流すことになる。伏せで出た —
       * 止まっているのに腕だけ掻き続け、這っている間も腕が半分の速さで動いた。
       * (這う動きは腕で進むので、そこがずれると進んで見えない)
       */
      if (RELAXED_CLIPS[locomotion] === LOWER_CLIPS[locomotion]) {
        this.upper.get(relaxedKey(locomotion))?.setEffectiveTimeScale(scale)
      }
    }

    // 止めておく型。**上下そろえて止める** — 下だけ止めると腕が動き続ける
    for (const state of FROZEN_CLIPS) {
      this.lower.get(state)?.setEffectiveTimeScale(0)
      this.upper.get(relaxedKey(state))?.setEffectiveTimeScale(0)
    }
  }

  /**
   * いま流す下半身。**構えていない走りだけ、上半身と同じクリップを使う。**
   *
   * 8 方向の走りは腰を振って作られていて、その振れを自分の上半身が戻している
   * (登録の所に測った値がある)。脱力の型は正面向きで作られているので、混ぜると
   * 戻しだけが消えて上半身が捻れる。
   *
   * **構えている間は 8 方向のまま。** 体が照準を向いたまま横へ動くので、方向
   * ごとの型が要る。脱力中は体が進行方向を向くので前走りしか使わない。
   */
  private resolveLowerKey(): string {
    if (this.aiming || !RELAXED_LOWER_STATES.has(this.locomotion)) return this.locomotion
    const name = this.pistol ? PISTOL_RELAXED[this.locomotion] : RELAXED_CLIPS[this.locomotion]
    if (!name) return this.locomotion
    const key = relaxedLowerKey(this.locomotion, name)
    return this.lower.has(key) ? key : this.locomotion
  }

  /**
   * いま流している型。**画面に出して確かめるため** (?stats=on の POSE)。
   *
   * 試写と本番で見え方が違うときに、**どこが違うのかを目で読めない。**
   * 上下それぞれ何を流しているかが出れば、その場で突き合わせられる。
   */
  get playingKeys(): string {
    const top = (map: Map<string, THREE.AnimationAction>) => {
      let best = ''
      let weight = 0
      for (const [key, action] of map) {
        const w = action.getEffectiveWeight()
        if (w > weight) {
          weight = w
          best = key
        }
      }
      return best
    }
    /*
     * **鍵ではなくクリップの名前で出す。**
     *
     * 鍵は状態の名前 (relaxed:crouch_idle) で、流れているクリップ
     * (knee_relaxed) とは別物。鍵を出していたら「crouch のままでは？」と
     * 読み違えさせた。**見たいのはどのクリップが流れているか。**
     */
    const lowerKey = top(this.lower)
    const upperKey = top(this.upper)
    const lower = this.lowerClipNames.get(lowerKey) ?? lowerKey
    const upper = this.upperClipNames.get(upperKey) ?? upperKey
    return `${lower} / ${upper}`
  }

  setLocomotion(next: Locomotion): void {
    // 倒れたら他の状態を一切受け付けない。死体が走り出さないため。
    if (this.dead) return
    /*
     * 実際の切り替えは重みの補間に任せる。ここは目標を記録するだけ。
     *
     * **表に在る姿勢だけを受ける。** 下半身には脱力用の枝も入っている
     * (run_f@relaxed_run など) が、あれは姿勢ではなく「その姿勢のときに流す
     * 別のクリップ」なので、姿勢として渡されては困る。
     */
    if (LOWER_CLIPS[next] !== undefined) this.locomotion = next
  }

  /**
   * 拳銃を持っているか。構えと発砲の型を引き分けるのに使う。
   *
   * 銃の種類そのものではなく「片手で構える銃か」を持たせている。
   * 麻酔銃を足すときも同じ型を使うはずなので、そこで分けたくない。
   */
  /** 走りの足の回転の底上げ。**URL から触れる** (RUN_CADENCE の注) */
  runCadence = RUN_CADENCE

  private pistol = false

  /**
   * 片手で持っているか。**走り方と構えの型が変わる。**
   *
   * 名前は拳銃から来ているが、決めているのは「片手か両手か」。手榴弾や
   * ナイフを持っているときも片手で、身軽に走る (domain の twoHanded)。
   */
  setPistol(oneHanded: boolean): void {
    this.pistol = oneHanded
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

  /** リロード中か。銃を抜いたままにするのに使う */
  get reloading(): boolean {
    return this.upperState === 'reload'
  }
  /** 遊底を操作している最中か。**その間は銃を納めない** (見えない銃を操作して見える) */
  get bolting(): boolean {
    return this.upperState === 'bolt'
  }


  /** 怯み中か。被弾リアクションの再生中 */
  get flinching(): boolean {
    return this.upperState === 'hit'
  }

  /**
   * 倒れる。全身動作なので上下を同時に流し、最終ポーズで固める。
   * clampWhenFinished を外すと死体が立ち上がる。
   */
  /**
   * 倒れる。**撃たれた向きで型を変える。**
   *
   * 背後から撃たれたら前へ、正面からなら後ろへ倒れる。倒れた人を見た側が
   * 「どこから撃たれたか」を読めるので、**倒れ方そのものが情報**になる。
   *
   * 向きが分からない場合 (落下や爆風、古い型しか無い皮) は元の 1 本を流す。
   *
   * @param fromBehind 背後から撃たれたか。分からなければ省く
   */
  playDeath(fromBehind?: boolean): void {
    /*
     * **伏せたまま倒されたら、伏せたまま崩れる。**
     *
     * 立ちの型で倒れると、伏せていた体が一度立ち上がってから崩れる。撃たれた
     * 瞬間に姿勢が飛ぶので、見ている側は何が起きたか読めない。
     *
     * 向きは見ない。**うつ伏せから前も後ろも無い** — 既にその向きで寝ている。
     */
    if (PRONE_LOCOMOTIONS.has(this.locomotion) && this.upper.has(PRONE_DEATH_KEY)) {
      const upper = this.upper.get(PRONE_DEATH_KEY)
      const lower = this.lower.get('prone_death')
      if (upper && lower) {
        upper.reset().play()
        lower.reset().play()
        this.upperState = 'death'
        this.locomotion = 'prone_death'
        return
      }
    }

    const state: Locomotion =
      fromBehind === undefined ? 'death' : fromBehind ? 'death_front' : 'death_back'
    const key =
      state === 'death_front' ? DEATH_FRONT_KEY : state === 'death_back' ? DEATH_BACK_KEY : DEATH_KEY
    // 型が無い皮でも倒れる。**倒れないほうが困る**
    const fallback = this.upper.has(key) && this.lower.has(state)
    const upper = this.upper.get(fallback ? key : DEATH_KEY)
    const lower = this.lower.get(fallback ? state : 'death')
    if (!upper || !lower) return
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'death'
    this.locomotion = fallback ? state : 'death'
  }

  /**
   * 麻酔で眠らされた。**倒れるのと同じ道で流す。**
   *
   * --- 姿勢を切り替えるだけでは床に着かない ---
   * setLocomotion('sleep') で下半身を差し替えても、**立ったまま寝ている**絵に
   * なる。上半身が構えのままで、しかも重みの補間で入るので型が頭から流れない。
   * 実測すると腰 1.01m / 頭 1.51m — 立ち姿とほとんど同じだった。
   *
   * 倒れる型 (playDeath) はここを通していて、腰 0.17m / 頭 0.20m まで下りる。
   * **全身で床へ行く型は、両面を頭から流さないと着かない。**
   *
   * 眠りは倒れるのと違って**醒める**ので、起きるときに元へ戻す (wake)。
   */
  playSleep(): void {
    const upper = this.upper.get(SLEEP_KEY)
    const lower = this.lower.get('sleep')
    if (!upper || !lower) return
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'sleep'
    this.locomotion = 'sleep'
  }

  /** 眠りが明けた。**構えへ戻す** — 倒れる型と違って、ここから先がある */
  wakeFromSleep(): void {
    if (this.upperState !== 'sleep') return
    this.upperState = 'stance'
  }

  /**
   * 接続が切れた人の姿。
   *
   * 体はその場に残って撃たれるので、**倒れる型とは別**にしてある。
   * 死んでいるわけではないことが見て分かる必要がある。
   */
  playAway(): void {
    const upper = this.upper.get(AWAY_KEY)
    const lower = this.lower.get('away')
    if (!upper || !lower) return
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'away'
    this.locomotion = 'away'
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
    // 発砲の型。**拳銃では使わない。**
    //
    // 拳銃は単発なので、速く叩くと 1.20 秒のクリップが頭から流れ直し、
    // 構えとの間を何度も行き来する。上半身がくねって見えた。
    // 突撃銃は押しっぱなしで状態が続くので、この問題が出ない。
    //
    // 撃ったことは銃口炎・音・カメラの反動・照準の散らばりで既に伝わっている。
    // 型が無くても分からなくはならない。
    if (this.upperState === 'fire' && !this.pistol) {
      // 伏せ撃ちは専用の型。立ちの発砲を腹這いに載せると上体だけ起き上がる
      if (PRONE_LOCOMOTIONS.has(this.locomotion) && this.upper.has(PRONE_FIRE_KEY)) {
        return PRONE_FIRE_KEY
      }
      if (this.upper.has(FIRE_KEY)) return FIRE_KEY
    }
    if (this.upperState === 'reload') {
      // 銃ごとに型を引き分ける。片手の拳銃を両手の型でリロードすると形が崩れる
      const key = this.reloadKey()
      if (this.upper.has(key)) return key
    }
    /*
     * 眠っている間。**倒れているのと同じ強さで留める。**
     *
     * 下半身が眠りの型に移っても上半身は構えたままなので、ここで揃えないと
     * 「寝た脚の上に銃を構えた上半身」になる。撃つ・リロードより後に置いて
     * あるのは、眠っている間はそもそもその状態に入らないから。
     */
    if (this.locomotion === 'sleep' && this.upper.has(SLEEP_KEY)) return SLEEP_KEY
    // 倒れている間は他の何よりも優先する
    if (this.upperState === 'death') {
      // 倒れる向きの型があればそちら。無ければ元の 1 本
      if (this.locomotion === 'death_front' && this.upper.has(DEATH_FRONT_KEY)) {
        return DEATH_FRONT_KEY
      }
      if (this.locomotion === 'death_back' && this.upper.has(DEATH_BACK_KEY)) {
        return DEATH_BACK_KEY
      }
      if (this.upper.has(DEATH_KEY)) return DEATH_KEY
    }
    if (this.upperState === 'hit' && this.upper.has(HIT_KEY)) return HIT_KEY
    if (this.upperState === 'salute' && this.upper.has(SALUTE_KEY)) return SALUTE_KEY
    if (this.upperState === 'stab' && this.upper.has(STAB_KEY)) return STAB_KEY
    /*
     * ボルト操作は構えを解いても最後まで流す。1 発ごとに必ず起きる動作なので、
     * 途中で切れると「撃ったのに動作していない」が頻繁に見える。
     *
     * ただし**伏せている間は出さない**。ボルトの型は立ち姿で、腹這いの腰に
     * 載せると銃口が下を向いて地面に埋まる (伏せ撃ちの直後に必ず起きる)。
     * 伏せ用のボルトの型はまだ無いので、操作の間は伏せ撃ちの構えのまま
     * 通す。撃てない時間は変わらない (fireCooldown は絵と別で数えている)。
     */
    if (this.upperState === 'bolt' && this.upper.has(BOLT_KEY)) {
      if (!PRONE_LOCOMOTIONS.has(this.locomotion)) return BOLT_KEY
    }
    if (this.upperState === 'sweep' && this.upper.has(SWEEP_KEY)) return SWEEP_KEY
    if (this.upperState === 'throw' && this.pair) {
      // **振りかぶりが残っている間は前半のまま。** 放した瞬間に後半へ渡すと、
      // 後半はまだ流れていない (updateThrow が振りかぶりの終わりを待つ) ので
      // 重みの行き先が止まったアクションになり、合計が 1 を下回って
      // バインドポーズ = T ポーズが埋まる (blend のコメント)。
      //
      // 軽く叩いたときだけ出る。押し続けて投げるぶんには振りかぶりが
      // 終わっているので、放した時点で後半がすぐ流れる。
      const waiting = this.pair.held || this.throwWindupLeft > 0
      const key = waiting ? this.pair.windup : this.pair.release
      if (this.upper.has(key)) return key
    }
    // 起き上がりは中断できない。撃つ操作より優先する
    if (this.upperState === 'stand' && this.upper.has(STAND_KEY)) return STAND_KEY
    if (this.upperState === 'roll' && this.upper.has(ROLL_KEY)) return ROLL_KEY
    // 落下の受け身も中断させない。**上半身だけ構えに戻ると、脚だけ転がる**
    if (this.upperState === 'hard_land' && this.upper.has(HARD_LAND_KEY)) return HARD_LAND_KEY
    // 箱が落ちた反応も中断させない。**上だけ構えに戻ると、銃を構えたまま驚く**
    if (this.upperState === 'bump' && this.upper.has(BUMP_KEY)) return BUMP_KEY
    // 伏せへの出入りも同じ。上だけ構えに戻ると、寝ながら銃を構える形になる
    if (this.upperState === 'prone_down' && this.upper.has(PRONE_DOWN_KEY)) return PRONE_DOWN_KEY
    if (this.upperState === 'prone_rise' && this.upper.has(PRONE_RISE_KEY)) return PRONE_RISE_KEY
    if (this.upperState === 'prone_roll_down' && this.upper.has(PRONE_ROLL_DOWN_KEY)) {
      return PRONE_ROLL_DOWN_KEY
    }

    // 伏せている間、構えていなければ倒れた姿勢のまま。
    //
    // 非構えのクリップがこの姿勢に無いので、既定の代用に任せると
    // **構えの上半身**が出る。倒れた直後に何もしていないのに銃を構え直して見えた。
    // 吹き飛ばされる型は最終姿勢で留まっているので、それをそのまま使う。
    if (!this.aiming && this.locomotion === 'sweep' && this.upper.has(SWEEP_KEY)) {
      return SWEEP_KEY
    }

    /*
     * 匍匐は**構えていても這う型のまま**。
     *
     * 立ち姿の照準クリップを腹這いの腰に載せると、背骨の補正
     * (alignSpineToUpperClip) が「立っている腰」との差を毎フレーム埋めようとして
     * 上半身が暴れる。腰が水平なので差が大きく、しかも再生位置で揺れる。
     *
     * 伏せ撃ち用のクリップが手に入るまでは、上下とも這う型で通す。撃てなくは
     * ならない (撃てるかどうかは持ち物が決めていて、絵とは別)。
     */
    if (PRONE_LOCOMOTIONS.has(this.locomotion)) {
      /*
       * 伏せ撃ちの型は**止まっているときだけ**。
       *
       * 這いながらは撃てない (domain/item/inventory.ts の canShoot)。撃てない
       * のに構えた型を出すと、狙えているように見えて弾が出ない。
       */
      if (this.aiming && this.locomotion === 'prone_idle' && this.upper.has(PRONE_AIM_KEY)) {
        return PRONE_AIM_KEY
      }
      const key = relaxedKey(this.locomotion)
      if (this.upper.has(key)) return key
    }

    /*
     * 転がりの尻尾。**絵が流れている間は転がりの型のまま。**
     *
     * ロック (upperState) は終盤 0.78 で先に解ける — 立ち上がりに入った時点で
     * 操作を返さないと一拍止まって見えるため。そこで上半身まで戻すと、
     * 下半身は立ち上がりの途中なのに**上半身だけ銃を提げた型**になる。
     *
     * **他の型に譲る位置に置く。** 転がりの直後に着地や吹き飛びが始まることが
     * あり、上に置くと**尻尾がそれを潰す** (着地の型が出なくなった)。
     *
     * 返すのは playRoll が下半身と揃えて流し直した action。姿勢の表から引くと
     * 噛み合わない — あちらは常時繰り返し再生で、下半身が終わりで止まっている
     * 間に頭へ戻り、立ち上がりながら腕だけ転がり始めの形 (手を挙げた姿) になる。
     */
    if (this.rollShowing && this.upper.has(ROLL_KEY)) return ROLL_KEY

    if (this.aiming) {
      const crouching = CROUCH_LOCOMOTIONS.has(this.locomotion)
      if (this.pistol) {
        const key = crouching ? PISTOL_CROUCH_AIM_KEY : PISTOL_AIM_KEY
        if (this.upper.has(key)) return key
      }
      if (crouching && this.upper.has(CROUCH_AIM_KEY)) return CROUCH_AIM_KEY
      return AIM_KEY
    }
    // 拳銃は納めているので手ぶら。移動状態ごとに専用の型がある
    if (this.pistol) {
      const key = pistolKey(this.locomotion)
      if (this.upper.has(key)) return key
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

  /**
   * 落下の受け身。**削られる高さから落ちたときだけ。**
   *
   * ただの着地 (playLanding) と分ける。体力が減ったことが体の動きにも出る
   * ようにしたいので、転がる型を最後まで流す。
   */
  playHardLand(): void {
    if (this.dead) return
    const upper = this.upper.get(HARD_LAND_KEY)
    const lower = this.lower.get('hard_land')
    if (!upper || !lower) return
    // **上下そろえて流す。** 下だけだと銃を構えたまま脚が転がる
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'hard_land'
    this.locomotion = 'hard_land'
    this.rootSampleValid = false
  }

  /**
   * ダンボールで敵にぶつかった。**箱が落ちて棒立ちになる。**
   *
   * 受け身と同じで上下そろえて流す。下だけだと銃を構えたまま脚が跳ねる。
   * 焼き込まれた移動は無い (実測 0.00m) ので、その場で反応して終わる。
   */
  playBump(): void {
    if (this.dead) return
    const upper = this.upper.get(BUMP_KEY)
    const lower = this.lower.get('bump')
    if (!upper || !lower) return
    upper.reset().play()
    lower.reset().play()
    this.upperState = 'bump'
    this.locomotion = 'bump'
  }

  /**
   * 伏せに入る / 伏せから起き上がる。**上下そろえて流す。**
   *
   * 姿勢が繋がっていないと、立った姿から 1 フレームで腹這いになる。
   * 起き上がりの型はしゃがみで終わるので、終わった先もしゃがみ。
   */
  playProneDown(): void {
    this.playWholeBody(PRONE_DOWN_KEY, 'prone_down')
  }

  playProneRise(): void {
    this.playWholeBody(PRONE_RISE_KEY, 'prone_rise', PRONE_RISE_RATE)
  }

  /**
   * 仰向けからうつ伏せへ、横へ半回転する。
   *
   * 吹き飛ばされた所から這い出す繋ぎ。転ぶ型 (sweep) は仰向けで終わるので、
   * そのまま這う型へ渡すと 1 フレームで裏返る。
   */
  playProneRollDown(): void {
    this.playWholeBody(PRONE_ROLL_DOWN_KEY, 'prone_roll_down')
  }

  private playWholeBody(key: string, state: Locomotion, rate = 1): void {
    if (this.dead) return
    const upper = this.upper.get(key)
    const lower = this.lower.get(state)
    if (!upper || !lower) return
    upper.reset().setEffectiveTimeScale(rate).play()
    lower.reset().setEffectiveTimeScale(rate).play()
    this.upperState = state as UpperState
    this.locomotion = state
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
  /**
   * 2 段の型を始める。振りかぶりを流し、**その終わりで勝手に止まる**
   * (clampWhenFinished)。以前のように再生速度を 0 にして押さえ込む必要がない。
   *
   * @param whole 全身の型か。**かがむ動作は上半身だけ切り出せない** —
   *   腰の向きが下半身と食い違って、腕だけがバインドポーズ (T ポーズ) に
   *   見えることがある。クレイモアの設置がそれだった。刺突と同じ扱いにする
   */
  private playPair(windup: string, release: string, whole = false): void {
    if (this.dead) return
    const first = this.upper.get(windup)
    if (!first) return
    // 前の型の下半身を畳む。全身の型 (クレイモア) は clampWhenFinished で
    // 最後の姿勢に留まるので、止めずに次へ移ると足だけかがんだまま残る
    if (this.pair?.whole) {
      this.lower.get(this.pair.windup as Locomotion)?.stop()
      this.lower.get(this.pair.release as Locomotion)?.stop()
    }
    first.reset().play()
    this.upper.get(release)?.stop()
    if (whole) {
      // 上下を同時に頭から流す。同じクリップなので腰の向きが食い違わない
      this.lower.get(windup as Locomotion)?.reset().play()
      this.lower.get(release as Locomotion)?.stop()
    }
    this.upperState = 'throw'
    this.pair = { windup, release, held: true, whole }
  }

  /**
   * 投げ始める。**伏せていれば伏せの型。**
   *
   * 立ちの型を腹這いに載せると腕だけが起き上がって振りかぶる (伏せ撃ちや
   * ボルトと同じ)。型を持っていなければ立ちへ落ちるので、伏せ用が入って
   * いないモデルでも投げられなくはならない。
   */
  playThrow(): void {
    if (PRONE_LOCOMOTIONS.has(this.locomotion) && this.upper.has(PRONE_THROW_WINDUP_KEY)) {
      this.playPair(PRONE_THROW_WINDUP_KEY, PRONE_THROW_RELEASE_KEY)
      return
    }
    this.playPair(THROW_WINDUP_KEY, THROW_RELEASE_KEY)
  }

  /**
   * いま流しているのが伏せの投擲か。
   *
   * **手を離れる割合が型ごとに違う** ので、呼ぶ側 (Game) がどちらの尺で
   * 測るかを選ぶのに要る。立ちは振り切る所が 30%、伏せは 36%。
   */
  get proneThrowing(): boolean {
    return this.pair?.windup === PRONE_THROW_WINDUP_KEY
  }

  /** クレイモアを構え始める。**かがむので全身** */
  playSetup(): void {
    this.playPair(SETUP_WINDUP_KEY, SETUP_RELEASE_KEY, true)
  }

  /**
   * 振り切る / 置き切る。
   *
   * **振りかぶりが終わるのを待ってから**後半へ移る (updatePair)。軽く叩いた
   * だけのときに途中で切り替えると、腕を引いている最中から次の型へ飛んで
   * 見た目が繋がらない。
   */
  releaseThrow(): void {
    if (this.pair) this.pair.held = false
  }

  /**
   * 置くのを解く。
   *
   * **構えていないのに置く型が来ることがある。** 途中から見えるようになった人が
   * それで、こちらには振りかぶりが流れていない。振りかぶりから流し直すと、
   * 実際にはもう置いている相手が構え直して見える。振りかぶりを終わった所から
   * 始める。
   */
  releaseSetup(): void {
    if (!this.pair) {
      this.playPair(SETUP_WINDUP_KEY, SETUP_RELEASE_KEY, true)
      // 振りかぶりを終わらせておく。updateThrow は残っている間は後半へ移らない
      const windup = this.upper.get(SETUP_WINDUP_KEY)
      if (windup) windup.time = windup.getClip().duration
      const lower = this.lower.get(SETUP_WINDUP_KEY as Locomotion)
      if (lower) lower.time = lower.getClip().duration
    }
    this.releaseThrow()
  }

  /** やめる。腕を下ろして構えに戻す (倒された・箱に入った) */
  cancelThrow(): void {
    if (this.upperState !== 'throw' || !this.pair) return
    /*
     * **止めない。重みを構えへ移すだけ。**
     *
     * stop() すると、その型はもう再生されていないのに重みの行き先としては
     * 残る。合計が 1 に届かず、足りない分に**バインドポーズ (T ポーズ)** が
     * 混ざる — 構えを解いた瞬間に一瞬だけ棒立ちになっていたのはこれ。
     *
     * 一度きりの型なので、放っておいても終わりで止まる。重みは blend が
     * 0 まで落とすので、それまでの数フレームは腕を下ろす動きとして見える。
     */
    this.pair = null
    this.upperState = 'stance'
  }

  /**
   * 装填を途中でやめる。**止めずに重みを構えへ移すだけ** (cancelThrow と同じ)。
   *
   * stop() すると、再生されていない型が重みの行き先として残り、足りない分に
   * バインドポーズ (T ポーズ) が混ざる。
   */
  cancelReload(): void {
    if (this.upperState !== 'reload') return
    this.upperState = 'stance'
  }

  /** 振りかぶりが終わるまであと何秒か。軽く叩いただけなら残っている */
  get throwWindupLeft(): number {
    if (!this.pair || this.upperState !== 'throw') return 0
    const windup = this.upper.get(this.pair.windup)
    if (!windup) return 0
    /*
     * **実時間で返す。** 呼ぶ側は待ち時間として足すので (Game の setupRelease)、
     * クリップの秒のままだと**速めたぶんだけ長く待つ**ことになる。
     * クレイモアの振りかぶりは 1.8 倍で流している。
     */
    const rate = windup.getEffectiveTimeScale() || 1
    return Math.max(0, (windup.getClip().duration - windup.time) / rate)
  }

  /** いま振りかぶった所で止まっているか */
  get throwWoundUp(): boolean {
    return !!this.pair?.held && this.throwWindupLeft <= 0
  }

  /**
   * 振りかぶりが終わっていたら後半へ移す。
   *
   * 保持そのものは clampWhenFinished がやる。ここがやるのは繋ぎだけ。
   */
  private updateThrow(): void {
    if (this.upperState !== 'throw' || !this.pair || this.pair.held) return
    const release = this.upper.get(this.pair.release)
    if (!release || release.isRunning() || release.time > 0) return
    if (this.throwWindupLeft > 0) return
    release.reset().play()
    if (this.pair.whole) {
      /*
       * 振りかぶりは**止めずに、重みで抜けさせる。**
       *
       * `stop()` は重みも再生位置も即座に 0 にする。置く型のほうは 0 から
       * 上げていくので、その間**どの型にも重みが乗らない**。実測で合計 0.18 まで
       * 落ちて素の姿勢が透け、**腰が 0.41m から 0.90m へ跳ねて立ち上がり、
       * また座り直す**ように見えていた。
       *
       * 2 つのクリップは繋がっている (振りかぶりの終わりと置く型の頭は腰も頭も
       * 差 0.00m) ので、重ねたまま入れ替えれば継ぎ目が出ない。振りかぶりは
       * 最後の姿勢で留まる (clampWhenFinished) ので、抜けるまで同じ形を保つ。
       */
      this.lower.get(this.pair.release as Locomotion)?.reset().play()
    }
  }

  /**
   * ボルト / ポンプを操作する。
   *
   * @param rate 再生速度。**撃てない時間と必ず一致させる** — 呼ぶ側は
   *   同じ倍率で尺を割って待つ (Game の fireCooldown)
   */
  playBolt(rate = 1): void {
    if (this.dead) return
    const upper = this.upper.get(BOLT_KEY)
    if (!upper) return
    upper.reset().setEffectiveTimeScale(rate).play()
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
    // **いま流れている全身の型から引く。** roll だけを見ていたので、
    // 受け身は焼かれた移動を持っているのに誰も読まなかった
    const name = this.locomotion
    if (!ROOT_MOTION_CLIPS.has(name)) return false
    const stored = this.rootMotion.get(name)
    const action = this.lower.get(name)
    if (!stored || !action) return false

    if (this.skeletonScale === 0) {
      const armature = this.hipsBone?.parent
      if (!armature) return false
      this.skeletonScale = armature.getWorldScale(this.scratchVector).x
    }

    sampleVectorTrack(stored.times, stored.values, action.time, this.scratchVector)

    /*
     * **頭へ戻ったら、その差は移動ではない。**
     *
     * クリップが 1 周して time が 0 に戻ると、根元の位置も先頭へ跳ぶ。差を
     * そのまま渡すと**進んだぶんを 1 フレームで引き戻す**。一度きりにして
     * あれば起きないが、一覧から漏れた型がまた出たときにここで止まる。
     */
    if (this.rootSampleValid && action.time < this.lastRootTime) {
      this.lastRootSample.copy(this.scratchVector)
      this.lastRootTime = action.time
      return false
    }
    this.lastRootTime = action.time

    if (!this.rootSampleValid) {
      this.lastRootSample.copy(this.scratchVector)
      this.rootSampleValid = true
      return false
    }

    // トラック空間は X/Y が水平、Z が上下 (Armature の +90°X 回転のため)。
    // モデル空間では armature ローカルの +Y が前方 (+Z) に対応する。
    const scale = this.skeletonScale * (ROOT_DISTANCE_SCALE[name] ?? 1)
    out.set(
      (this.scratchVector.x - this.lastRootSample.x) * scale,
      0,
      (this.scratchVector.y - this.lastRootSample.y) * scale,
    )
    this.lastRootSample.copy(this.scratchVector)
    return true
  }

  /**
   * 転がりの**ロック**が続いているか。この間は撃てず、向きも変えられない。
   *
   * 終盤で先に解ける (releaseRollIfSettling)。立ち上がりに入った時点で操作を
   * 返さないと、最終ポーズに固まった所からブレンドが始まって一拍止まって見える。
   */
  get rolling(): boolean {
    return this.upperState === 'roll'
  }

  /**
   * 転がりの**絵**がまだ流れているか。
   *
   * --- rolling と何が違うか ---
   * あちらは「もう動かしてよいか」。こちらは「もう転がって見えていないか」。
   * ロックは ROLL_EXIT_PHASE (0.78) で先に解けるので、**クリップはまだ 2 割
   * 残っている**。同じ getter で兼ねていたせいで、二段の型 (手榴弾の振りかぶり
   * など) が転がりの尻尾の中で始まって終わり、**一度も画面に映らなかった**。
   *
   * 一度だけ流す型 (ONE_SHOT_LOWER) なので、終われば time が尺で止まる。
   */
  get rollShowing(): boolean {
    if (this.upperState === 'roll') return true
    const action = this.lower.get('roll')
    if (!action || !action.isRunning()) return false
    const duration = action.getClip().duration
    return duration > 0 && action.time < duration
  }

  /** 終盤に入ったらロックを解く。クリップ自体は流れ続け、重みで抜けていく */
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

  /**
   * クレイモアを置いている最中の姿勢。置いていなければ null。
   *
   * **全身の型なので、位置に載せる姿勢もこれになる。** 他人の画面でも
   * かがんで見えないと、置いていることが誰にも分からない
   */
  get setupLocomotion(): 'claymore_windup' | 'claymore_place' | null {
    if (this.upperState !== 'throw' || !this.pair?.whole) return null
    return this.pair.held ? 'claymore_windup' : 'claymore_place'
  }

  /** リロードモーションを頭から再生する。終わると自動で構えに戻る */
  /**
   * 弾倉を替える。
   *
   * @param seconds 掛ける時間。**銃ごとに違う** (domain/item/weapons.ts) ので、
   *   クリップの尺をそこへ合わせて伸び縮みさせる。
   *
   * --- なぜ尺を合わせるか ---
   * 型は 1 本しかない (拳銃だけ別)。**時間をクリップ任せにすると、どの銃も
   * 同じ 3.33 秒になる。** 表には P90 3.0 / AK47 2.5 / XM2010 3.2 と書いてあるのに
   * 全部同じ手応えで、「P90 を選んでいるのに AK が入っている」ように感じていた。
   */
  playReload(seconds = 0): void {
    if (this.dead) return
    const action = this.upper.get(this.reloadKey())
    if (!action) return
    const clip = action.getClip().duration
    action.setEffectiveTimeScale(seconds > 0 && clip > 0 ? clip / seconds : 1)
    action.reset().play()
    this.upperState = 'reload'
  }

  /**
   * どの装填の型を流すか。**姿勢が先、銃が後。**
   *
   * 腹這いに立ちの型を載せると上体だけ起き上がる (伏せ撃ちと同じ理由)。
   * 拳銃で伏せている場合も伏せの型を採る — 片手か両手かの違いより、
   * 立っているか寝ているかの違いのほうが大きく崩れる。
   */
  private reloadKey(): string {
    if (PRONE_LOCOMOTIONS.has(this.locomotion) && this.upper.has(PRONE_RELOAD_KEY)) {
      return PRONE_RELOAD_KEY
    }
    if (this.pistol && this.upper.has(PISTOL_RELOAD_KEY)) return PISTOL_RELOAD_KEY
    return RELOAD_KEY
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
 * 与えた軸のまわりの成分だけ残す (swing-twist 分解の twist 側)。
 *
 * 「素材が作られた向き」を打ち消すのに使う。向きの違いは縦軸まわりの回転なので、
 * 前後の傾きまで一緒に消してしまわないように切り分ける。
 */
function keepTwist(q: THREE.Quaternion, axis: THREE.Vector3): void {
  const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z
  const x = axis.x * dot
  const y = axis.y * dot
  const z = axis.z * dot
  const length = Math.sqrt(x * x + y * y + z * z + q.w * q.w)
  if (length < 1e-6) {
    q.identity()
    return
  }
  q.set(x / length, y / length, z / length, q.w / length)
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
 * 別経路で読み込んだモデルでもズレないよう、同じドメインルールで正規化してから比べる。
 */
function sameNode(trackName: string, boneName: string): boolean {
  // three.js の sanitizeNodeName と同じやり方: 空白は _、[ ] . : / は除去
  const normalize = (value: string) => value.replace(/\s/g, '_').replace(/[[\].:/]/g, '')
  return normalize(nodeNameOf(trackName)) === normalize(boneName)
}
