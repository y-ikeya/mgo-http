import { carrySpeedScale, weaponOf, type WeaponId } from '../sim/weapons'
import type { HeldId } from '../sim/held'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { CharacterAnimator, findBoneBySuffix } from './animation'
import type { Locomotion } from '../sim/locomotion'
import { loadSoldier } from './assets'
import { isMesh } from './guards'
import { damp, dampAngle } from './math'
import { stepMovement, type Mover } from '../sim/movement'
import { resolveLocomotion } from '../sim/stance'
import { advanceBoxLift, boxLift, createCardboardBox, disposeBox, placeBox } from './box'
import { Footsteps, type Step } from '../sim/footsteps'
import { MAX_HEALTH } from '../sim/damage'
import { Weapon } from './weapon'
import type { PlayerSnapshot } from '../net/types'
import type { WeaponTarget } from './weapon'

/** カプセルの円柱部分の長さ (m)。全高 = LENGTH + RADIUS * 2 */
const CAPSULE_LENGTH = 1.1
const CAPSULE_RADIUS = 0.35

/** 立ち姿勢の全高 (m)。カメラの注視点高さの基準でもある */
export const PLAYER_HEIGHT = CAPSULE_LENGTH + CAPSULE_RADIUS * 2
/** 移動判定に使う半径 (m)。XZ 平面では円として扱う */
export const PLAYER_RADIUS = CAPSULE_RADIUS

/**
 * 移動速度 (m/s)。
 *
 * クリップ実測値 (run 3.11 / run_back 2.55 / strafe 2.78〜3.26) に対して
 * 再生速度を補正するので足は滑らないが、離れるほどモーションが速回しになる。
 * 補正が 1.4 倍を超えるあたりから動きが漫画的に見え始める。
 *
 * ここを変えれば全部に効く。しゃがみ・構え・ダンボール・銃の重さは
 * すべてこの値への倍率として掛かるので、姿勢や武器ごとに直して回る必要が無い。
 * 3.8 → 3.04 に落としてある (0.8 倍)。クリップの実測に近づいたぶん、
 * 速回しも収まる方向。
 */
const MOVE_SPEED = 3.04

/** 無敵の間の濃さ。消さずに薄くする — 居ることは見えていてよい */
const GHOST_OPACITY = 0.35

/**
 * 構えている間の移動速度の倍率。
 *
 * 狙える代わりに機動力を失う、という交換条件をカメラの画角と両輪で作る。
 * 下げすぎると走りクリップの再生が遅くなりすぎてスローモーションに見える
 * (実測 3.11 m/s の run_fwd を 0.5 倍速で回すことになる)。
 */
const AIM_SPEED_SCALE = 0.55
/** 構えの入り抜けで速度が寄る速さ。急に止まると引っかかったように見える */
const SPEED_LAMBDA = 10
/**
 * しゃがみ移動の速度。走りに対する倍率。
 *
 * 絶対値ではなく倍率で持つのは、走る速さを変えても姿勢どうしの関係が崩れないため。
 * 「しゃがみは走りの 7 割」という設計判断のほうが、2.66 m/s という数値より寿命が長い。
 *
 * クリップの実測は 2.02 m/s なので、3.8 × 0.7 = 2.66 は 1.32 倍速で回ることになる。
 * 足は滑らない (再生速度を合わせている) が、動きはやや速回しに見える。
 * 1.4 倍を超えると漫画的になり始めるので、その手前。
 *
 * 構えの倍率とは掛け合わせない。掛けるとクリップが 0.7 倍速まで落ちて
 * スローモーションに見える。しゃがみは常に一定、で交換条件としては足りる。
 */
const CROUCH_SPEED_SCALE = 0.7
/**
 * 注視点を頭からどれだけ上に置くか (m)。
 *
 * 立ち姿勢で頭 1.465m / 注視点 1.530m と、6.5cm 上にあるのがちょうど良かった。
 * 頭より下に来るとキャラの体が肩越しの視界を塞ぐ。
 */
const VIEW_CLEARANCE = 0.1
/** モデル未読み込み時の注視点の高さ (m) */
const FALLBACK_VIEW_HEIGHT = PLAYER_HEIGHT * 0.85
/** しゃがみ時の散布の倍率。止まって狙う価値をここで作る */
export const CROUCH_SPREAD_SCALE = 0.45

/**
 * 刺突中の移動速度の倍率。0 = その場に釘付け。
 *
 * 踏み込んで突く全身動作で、クリップにはルートモーションが無い。
 * 動けるようにすると脚が踏み込みの型のまま滑るので、止めたほうが破綻しない。
 *
 * ゲームとしても、1.67 秒その場から動けないという危険を負う形になり、
 * 間合いに踏み込む判断そのものが賭けになる。向きは変えられるので狙いは付けられる。
 */
const STAB_SPEED_SCALE = 0

/**
 * ダンボールを被っている間の移動速度。走りに対する倍率。
 *
 * 止まっていれば風景に紛れるが、動けば「箱が動いた」こと自体が情報になる。
 * 落としてあるのは、その一瞬の動きを見た側が判断する余地を残すため。
 * 速いと単なる目立つ的になる。
 *
 * 中のキャラは見えないので、しゃがみと違って再生速度との一致は要らない。
 */
const BOX_SPEED_SCALE = 0.5

/**
 * 集中しているとみなす速度の上限 (m/s)。
 *
 * 完全な 0 にすると、壁に押し付けたときの微小な揺れや押しのけで途切れる。
 * 歩き出したかどうかが分かれば足りる。
 */
const CONCENTRATE_MAX_SPEED = 0.15

/**
 * 銃の持ち方が姿勢へ寄る速さ。
 * しゃがみの入り抜けと同じくらいにして、体と銃が別々に動いて見えないようにする。
 */
const WEAPON_STANCE_LAMBDA = 10

/**
 * 自分の身体を描く順番。
 *
 * 味方の壁越しの発光 (renderOrder 999) より後。深度を見ない発光が
 * 自分の身体を貫いて見えるのを防ぐ。
 */
const SELF_RENDER_ORDER = 1000

/**
 * 倒れてから起き上がれるようになるまで (秒)。
 *
 * 転んだら**自分で起きるまで転んだまま**。時間で勝手に立たない。
 *
 * 伏せたまま撃つか、起きて動くかを選ばせたい。自動で立つと、その選択が
 * 時計に奪われる — 撃とうとした瞬間に立ち上がり始めて、無防備な時間だけが残る。
 *
 * ここで置いているのは吹き飛ばされる型が終わるまでの分だけ。倒れ切る前に
 * 移動キーで起き上がれてしまうと、爆風を受けた事実がほぼ無かったことになる。
 */
const DOWN_LOCK = 0.35

/** 照準方向へ向き直る速さ */
const TURN_LAMBDA = 14

/** 銃口のオフセット (m)。構えた右手あたりを想定した固定値 */
const MUZZLE_HEIGHT = 1.35
const MUZZLE_FORWARD = 0.35
const MUZZLE_RIGHT = 0.22

/**
 * 停止と判定する速度 (m/s)。入る側と出る側で閾値を変えてある。
 * 同じ値だと壁際で速度が閾値付近を上下したときに idle と移動が毎フレーム入れ替わる。
 */

/** 重力加速度 (m/s²)。現実と同じ値 */
const GRAVITY = 9.8
/**
 * ローリングは移動速度を持たない。クリップのルートモーションをそのまま位置に使う。
 *
 * 平均速度で動かすと、クリップが減速して着地しているのに同じ速さで進み続けるので
 * 足が接いた後も前へ滑る。加減速まで含めてクリップに従わせれば、その食い違いが
 * 原理的に起きない。再生速度を上げれば移動も自動的に速くなる。
 */
/**
 * 下降中に重力へ掛ける倍率。
 *
 * 上昇と下降で重力を変えるのは現実には無いが、跳躍の体感はこれで大きく変わる。
 * 重力そのものを上げると跳び出しまで鋭くなって「弾かれた」感じになるのに対し、
 * 落下だけ重くすると、踏み切りの感触と到達する高さを保ったまま
 * 浮いている時間だけを削れる。
 */
const FALL_GRAVITY_SCALE = 1.8
/**
 * 落下ループの再生速度を出すときの基準の高さ (m)。
 * ジャンプが無くなったので、段差から降りるときの想定として置いてある。
 */
const FALL_REFERENCE_HEIGHT = 0.6
/**
 * 着地モーションを出しておく時間 (秒)。
 *
 * クリップは 0.67 秒あるが、全部流すと着地のたびに膝を曲げた時間が長く残る。
 * 落下 0.35 秒に対して着地 0.3 秒が乗ると、屈んでいる時間のほうが長く見えてしまう。
 * 衝撃を受け止める瞬間だけ見せてすぐ移動へ返す。
 */
const LANDING_TIME = 0.16
/**
 * 着地モーションを出す落下速度の下限 (m/s)。
 *
 * 階段を駆け上がると一段ごとに接地と離地を繰り返すので、
 * 小さな段差まで拾うと着地モーションが出ずっぱりになる。
 * 0.6m のジャンプの着地は 3.4 m/s なので、それは拾って段差は捨てる高さに置く。
 */
const LANDING_MIN_SPEED = 3.0
/**
 * 空中で進行方向を変えられる度合い (0 = 変えられない)。
 *
 * 空中で加速できるのは物理的におかしいうえ、跳ぶ判断が軽くなる。
 * 踏み切った時点の勢いだけで飛ぶことで、跳ぶ前に助走を付ける必要が生まれ、
 * 階段を登るにも「どこから踏み切るか」という判断が要るようになる。
 *
 * 向きは空中でも変えられる (カメラに追従する) ので、狙いは付けられる。
 * 変わるのは進む方向だけ。
 */
const AIR_CONTROL = 0

/**
 * Player から見た世界。地形の形は Game 側が握り、Player は問い合わせるだけ。
 * これにより Player は障害物の表現 (今は AABB、将来は TriMesh) に依存しない。
 */
export interface PlayerWorld {
  /** 位置を障害物の外へ押し戻す */
  resolveHorizontal(position: THREE.Vector3, radius: number, feetY: number): void
  /** その位置で足が着く高さ */
  groundHeight(position: THREE.Vector3, radius: number, feetY: number): number
  /** その位置で頭がぶつかる高さ。何も無ければ Infinity */
  ceilingHeight(position: THREE.Vector3, radius: number, feetY: number): number
}

/**
 * モデルの正面は +Z (Mixamo/Blender 由来)。
 * Player は「ローカル -Z が前方」で組んであるので、読み込んだモデルを 180° 回して合わせる。
 */
const MODEL_YAW_OFFSET = Math.PI

/** 倒れている間に渡す移動入力。毎フレーム作らないよう使い回す */
const ZERO_MOVE = new THREE.Vector3()

/**
 * プレイヤーキャラクター。
 *
 * モデルが読み込まれるまではカプセルのプレースホルダーを出し、届いた時点で差し替える。
 * 外向きの API はプレースホルダーでもモデルでも同じで、Game 側はどちらの状態かを
 * 知らなくてよい (アニメーション関連の呼び出しはモデル未着なら黙って何もしない)。
 */
export class Player {
  /** シーンに add するルート */
  readonly object = new THREE.Group()

  /** Y 軸回りの向き (rad)。0 = -Z 方向を向く */
  yaw = 0

  /** 体力。対戦では相手の弾で減る */
  health = MAX_HEALTH

  private placeholder: THREE.Group | null = null
  private animator: CharacterAnimator | null = null
  private weapon: Weapon | null = null
  /** ナイフ。刺突中だけ表示し、それ以外はライフルを出す */
  private knife: Weapon | null = null
  /** 調整用にナイフを出しっぱなしにするか */
  private knifePreview = false

  /** 現在の移動アニメの状態。切り替えのヒステリシス判定に使う */
  private locomotion: Locomotion = 'idle'
  /** 銃の持ち方が姿勢へ寄っている度合い (0 = 立ち, 1 = しゃがみ) */
  private weaponStance = 0
  /** 姿勢が変わっている速さ。散布に効かせる */
  private stanceRateValue = 0
  /** 読み込んだ体。銃を差し替えるときに手ボーンを引き直すのに要る */
  private model: THREE.Object3D | null = null
  /** いま持っている銃 */
  private weaponKind: WeaponId = 'rifle'

  /**
   * いま手にある物。
   *
   * **見た目の唯一の在り処。** どのモデルを出すか、銃を納めるかが全部ここから
   * 決まる。以前は boxed / stabbing / weaponKind から場合分けしていて、
   * 手に持てる物を増やすたびに条件が増えた (docs/design.md の 5)。
   */
  private held: HeldId = 'rifle'
  /**
   * 爆風で倒れているか。起き上がる操作をするまで続く。
   *
   * 倒れている間も撃てる (下半身だけ伏せた姿勢で留まり、上半身は構えに戻る)。
   * 立ち上がりに入ったら中断できない — そこが爆風を受けた代償になる。
   */
  private downed_ = false
  /** 倒れてからの時間 (秒)。DOWN_LOCK を過ぎるまで起き上がれない */
  private downElapsed = 0
  /**
   * 倒される前から構えていたか。
   *
   * 立っているとき構えていた人がそのまま伏せ撃ちに移れてしまうのを止める。
   * 一度指を離すまで下ろしたままにする。
   */
  private aimLatched = false
  /** 立ち上がりの最中か。ここに入ると入力を受け付けない */
  private standing = false
  private standTimer = 0

  /** 取り付けの基準。最初の 1 回で決めて、持ち替えでも使い回す */
  private attachRef: {
    matrix: THREE.Matrix4
    right: THREE.Vector3
    left: THREE.Vector3
  } | null = null
  /** 足音の勘定。実際に動いた距離で数える */
  private readonly footsteps = new Footsteps()
  /** 構えているか。向きの決め方と上半身の挙動が変わる */
  private aiming = false
  /** しゃがんでいるか。速度・視点の高さ・散布・モーションが変わる */
  private crouching = false
  /** 直近に受け取った照準の上下 (rad)。他プレイヤーへ送るのに控えておく */
  private aimPitch = 0
  /** 集中している時間 (秒)。姿勢を崩すか動いた瞬間に 0 へ戻る */
  private concentrateTime = 0
  /** 倒れているか。操作を一切受け付けなくなる */
  private down = false
  /** ダンボールを被っているか */
  private boxed = false
  private box: THREE.Object3D | null = null
  /** 箱の浮き上がり量 (m)。姿勢に遅れて追う */
  private boxLift = 0
  /** 鉛直方向の速度 (m/s)。接地中は 0 */
  /**
   * 移動の規則へ渡す体。位置は object のものをそのまま指す。
   *
   * 速度と接地はここが持ち主になる。Player 側の同名のフィールドは
   * このオブジェクトを覗くだけにして、真実の置き場を 1 つにする。
   */
  private readonly mover: Mover = {
    position: this.object.position,
    velocityY: 0,
    onGround: true,
    airX: 0,
    airZ: 0,
  }

  /** 接地。真実は mover が持つ */
  private get onGround(): boolean {
    return this.mover.onGround
  }
  private get velocityY(): number {
    return this.mover.velocityY
  }
  private set velocityY(value: number) {
    this.mover.velocityY = value
  }
  /** 着地モーションの残り時間 */
  private landingTimer = 0
  /**
   * 跳躍の設定。高さを固定したまま重力を変えられるよう、初速は毎回 sqrt(2gh) で出す。
   * 重力だけ上げれば「同じ高さまで跳ぶが滞空が短い」になる。
   */
  private gravity = GRAVITY
  private fallGravityScale = FALL_GRAVITY_SCALE
  /**
   * このフレームで着地したときの落下速度 (m/s)。着地していなければ 0。
   *
   * 呼ぶ側 (Game) が拾ってサーバーへ送る。Player は体力を持たないので、
   * ここで削らない。
   */
  landedSpeed = 0

  /** 落下ループの再生速度を出すための想定落下高さ */
  private fallReferenceHeight = FALL_REFERENCE_HEIGHT
  /** ローリング中に進む向き。踏み切った時点で固定する */
  private rollYaw = 0
  /** 転がり始めたか。音を鳴らす側が 1 回だけ拾う */
  private rollStarted = false
  private moveSpeed = MOVE_SPEED
  private aimSpeedScale = AIM_SPEED_SCALE
  /** 実際に使う速度。構えの入り抜けで目標へ寄せる */
  private currentSpeed = MOVE_SPEED
  /** アニメ側に反映済みの速度。変化したときだけ再生速度を引き直す */
  private appliedAnimationSpeed = MOVE_SPEED

  /** 実測の頭の高さ + 余裕。モデルが届くまではフォールバック */
  private currentViewHeight = FALLBACK_VIEW_HEIGHT

  private readonly scratchVelocity = new THREE.Vector3()
  /** コリジョン解決後の実移動量から求めた速度 (m/s) */
  private actualSpeed = 0

  private disposed = false

  constructor() {
    this.placeholder = buildPlaceholder()
    this.object.add(this.placeholder)
    this.box = createCardboardBox()
    this.object.add(this.box)
  }

  /**
   * モデルを読み始める。**構築とは分けてある。**
   *
   * どのモデルを着るかは名前で決まるが (skin.ts)、名前を知っているのは
   * Game のほう。構築時に読み始めると、まだ名前が入っていない
   */
  start(skin: string): void {
    void this.load(skin)
  }

  get position(): THREE.Vector3 {
    return this.object.position
  }

  /** 現在の水平速度 (m/s)。壁に押し付けている間は 0 に落ちる */
  get speed(): number {
    return this.actualSpeed
  }

  /**
   * 姿勢が変わっている速さ (1/秒)。立ち上がり / しゃがみ込みの最中に大きくなる。
   *
   * 頭の高さが変わることは、このゲームでは移動と同じ重みを持つ。遮蔽を越えるか
   * 越えないかがそれで決まるので、**止まったまましゃがみ連打で頭だけ上下させる**のが
   * 一番安い覗き方になってしまう。動くのと同じだけ狙いが散るようにする。
   */
  get stanceRate(): number {
    return this.stanceRateValue
  }

  /**
   * このフレームで足を踏んだなら音量を返す。
   * 音を鳴らすのは Game の仕事なので、ここでは判定だけする。
   */
  /** 転がり始めたなら true。1 回の転がりにつき 1 回だけ */
  consumeRollStart(): boolean {
    const started = this.rollStarted
    this.rollStarted = false
    return started
  }

  consumeFootstep(): Step | null {
    if (this.down) return null
    const p = this.object.position
    return this.footsteps.update(p.x, p.z, this.locomotion, this.onGround)
  }

  /**
   * 他のプレイヤーへ送る状態を切り出す。
   *
   * 速度を送らないのは意図的。受け取った側は位置を補間するだけで、
   * 自前で動きを進めない。移動アニメも推定せず state をそのまま再生する。
   * 予測を持ち込むのはサーバー権威にしてからで、今はまず「ずれない」ほうを取る。
   */
  snapshot(id: string, time: number): PlayerSnapshot {
    return {
      id,
      time,
      x: this.object.position.x,
      y: this.object.position.y,
      z: this.object.position.z,
      yaw: this.yaw,
      pitch: this.aimPitch,
      // 視点の向きとリロードは呼ぶ側が持っている。あちらで上書きする
      cameraYaw: this.yaw,
      reloading: false,
      // 無敵かどうかはサーバーが書き込む。名乗る値ではない
      protectedNow: false,
      locomotion: this.locomotion,
      aiming: this.aiming,
      weapon: this.weaponKind,
      crouching: this.crouching,
      boxed: this.boxed,
      // いま手にある物。**ここが唯一の在り処になる。** いまは既存の状態から
      // 組み立てているが、持ち物 (Carried[]) を Player が持つようになったら
      // そちらを直接返す
      held: this.held,
      concentrating: this.isConcentrating,
      saluteHeld: this.saluteHeld,
      // 振りかぶって持っている間だけ。倒されたら足元に落ちる
      holdingGrenade: this.throwing,
    }
  }

  /** 倒れているか。この間は操作を受け付けない */
  get isDead(): boolean {
    return this.down
  }

  /** ダンボールを被っているか。この間は撃てない */
  get isBoxed(): boolean {
    return this.boxed
  }

  /**
   * ダンボールの出し入れ。
   *
   * 空中では切り替えない。落下中に被ると、着地までの間だけ箱が宙に浮く。
   */
  toggleBox(): void {
    this.setBoxed(!this.boxed)
  }

  /**
   * 箱を被る / 下ろす。
   *
   * **持ち替えから呼ばれる。** 箱は道具系の 1 つなので、手にした瞬間に被る。
   * 立てない場面 (転がり中・倒れている・敬礼中) では被れない。
   */
  setBoxed(on: boolean): void {
    if (on === this.boxed) return
    if (on) {
      if (this.down || !this.onGround || this.rolling || this.stabbing) return
      if (this.downed || this.standing) return
      if (this.saluting) return
    }
    this.boxed = on
    this.animator?.setBoxed(this.boxed)
    // 被る = 屈む。箱の高さはしゃがみ姿勢に合わせてある。
    if (this.boxed) {
      this.crouching = true
      this.aiming = false
    }
  }

  /** 箱を脱ぐ。構える・撃つ・転がるなど、隠れるのをやめる操作から呼ぶ */
  private dropBox(): void {
    if (!this.boxed) return
    this.boxed = false
    this.animator?.setBoxed(false)
  }



  /** 倒れるモーションの尺 (秒)。復帰までの待ち時間の下限に使える */
  get deathDuration(): number {
    return this.animator?.deathDuration ?? 0
  }

  /**
   * サーバーが確定させた体力を反映する。
   *
   * 自分で減らさないのが要点。撃たれた瞬間に手元で減らすと、サーバーの計算と
   * ずれて「死んだはずが生きている」が起きる。表示が一拍遅れる代わりに、
   * 全員が同じ数字を見る。
   *
   * @param flinch 怯ませるか。連射のたびに出すと棒立ちになるので、
   *   サーバーが「頭に当たったが倒れなかった」場面に絞って立てる
   * @returns このフレームで倒れたら true
   */
  setHealth(health: number, flinch = false): boolean {
    const wasAlive = !this.down
    this.health = health

    if (health > 0) {
      if (flinch) this.animator?.playHit()
      return false
    }
    if (!wasAlive) return false

    this.down = true
    // 移動状態もここで倒す。update() は描画ループから呼ばれるので、
    // 裏に回ったタブでは走らない。ここで倒さないと、相手へは生きた姿勢を
    // 送り続けることになる (相手側はサーバーの体力で倒すので破綻はしないが、
    // 送っている中身が嘘になる)。
    this.locomotion = 'death'
    // 構えも発砲も解いてから倒す。解かないと倒れた姿勢に構えの補正が乗る。
    this.dropBox()
    this.aiming = false
    this.crouching = false
    this.animator?.setAiming(false)
    this.animator?.setFiring(false)
    this.animator?.playDeath()
    return true
  }

  /**
   * 瞬間移動した。足音の積算を捨てる。
   *
   * 位置を直に書き換える側 (湧き地点への配置) が呼ぶ。呼ばないと、跳んだ距離が
   * 歩いた距離として積まれて、着いた先で何歩ぶんも連続して鳴る。
   */
  warpTo(x: number, z: number): void {
    this.footsteps.warp(x, z)
  }

  /**
   * 無敵の間は半透明にする。
   *
   * 撃てない相手だと見て分かる必要がある。撃ち込んでから「効かない」と
   * 気付くのでは、撃った側の弾と時間が無駄になる。
   *
   * 自分の体は既に transparent で描いている (味方の発光より後に描くため) ので、
   * 濃さを触るだけで済む。
   */
  setGhost(on: boolean): void {
    if (this.ghost === on || !this.model) return
    this.ghost = on
    this.model.traverse((obj) => {
      if (!isMesh(obj)) return
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) material.opacity = on ? GHOST_OPACITY : 1
    })
  }

  private ghost = false

  /**
   * 繋ぎ直しで**その命の続き**へ戻す。
   *
   * respawn と違って体力を満タンにしない。切れる前の続きなので、削られていた
   * ぶんは削られたまま。位置もサーバーが持っていた場所へ置く
   * (湧き地点ではない)。
   */
  resumeAt(x: number, y: number, z: number, health: number): void {
    this.object.position.set(x, y, z)
    this.health = health
    this.down = false
    this.boxed = false
    this.velocityY = 0
    this.downed_ = false
    this.downElapsed = 0
    this.standing = false
    this.standTimer = 0
    // 跳んだ距離を足音に積ませない
    this.warpTo(x, z)
  }

  /** 復帰。位置は呼び出し側が決める */
  respawn(): void {
    this.health = MAX_HEALTH
    this.down = false
    this.boxed = false
    this.velocityY = 0
    // 爆風で転んだまま倒された場合、ここで戻さないと復帰しても転んだまま。
    // 姿勢は毎フレーム downed から引き直しているので、他の人の画面では
    // 湧いた直後にもう一度吹き飛ぶ形になる
    this.downed_ = false
    this.downElapsed = 0
    this.standing = false
    this.standTimer = 0
    this.aimLatched = false
    // 振りかぶったまま倒された場合も解く。手榴弾はサーバーが足元へ落としている
    this.throwing = false
    this.animator?.cancelThrow()
    // 移動状態もここで戻す。update() は描画ループから呼ばれるので、
    // 裏に回ったタブでは走らない。ここで戻さないと復帰したのに
    // 他プレイヤーへは死亡状態を送り続けることになる。
    this.locomotion = 'idle'
    this.animator?.revive()
  }

  /**
   * 押しのけられる。ローリングの体当たりを受けた側が呼ぶ。
   *
   * 位置に直接足す。壁にめり込んでも次の update の resolveHorizontal が押し戻す。
   */
  knockBack(x: number, z: number): void {
    this.object.position.x += x
    this.object.position.z += z
  }

  /** リロードモーションの尺 (秒)。モデル未着なら 0 */
  /**
   * いま持っている銃のリロードの尺 (秒)。
   *
   * 銃ごとに型が違うので長さも違う。突撃銃の尺で拳銃を待たせると、
   * 型が終わったのに撃てない時間が残る。
   */
  get reloadDuration(): number {
    if (!this.animator) return 0
    if (this.weaponKind === 'pistol' && this.animator.pistolReloadDuration > 0) {
      return this.animator.pistolReloadDuration
    }
    return this.animator.reloadDuration
  }

  /** ボルトを操作する。上半身だけなので足は動かせる */
  /**
   * 手榴弾を構えている / 投げている最中か。
   *
   * この間は照準の方を向く。構えていないと体は進行方向を向くので、
   * そのままだと横を向いたまま手榴弾だけ画面奥へ飛んでいく。
   */
  private throwing = false

  setThrowing(throwing: boolean): void {
    this.throwing = throwing
  }

  /** 吹き飛ばされる / 起き上がる型の再生速度 (調整用) */
  setKnockdownRates(sweep: number, stand: number): void {
    if (!this.animator) return
    this.animator.sweepRate = sweep
    this.animator.standRate = stand
    this.animator.refreshKnockdownRates()
  }

  /**
   * 手榴弾を構え始める。振りかぶった所で止まる。
   *
   * 上半身だけなので走りながらでも出る。退きながら足元へ落とすのが
   * 使い方の一つなので、投げるために止まらせない。
   */
  /**
   * 手にある物を差し替える。
   *
   * モデルの読み込みは持たない — 銃は equip()、ナイフと箱は最初から付いている。
   * ここがやるのは**どれを見せるか**の切り替えだけ。
   */
  setHeld(id: HeldId): void {
    this.held = id
  }

  get heldItem(): HeldId {
    return this.held
  }

  playSetup(): void {
    this.animator?.playSetup()
  }

  /**
   * クレイモアを構えている / 置いている最中か。
   *
   * **押している間だけでは足りない。** 手を離しても置く型が流れきるまでは
   * かがんだままで、そこで走らせると足が動かないまま滑る。
   */
  get placing(): boolean {
    return this.animator?.setupLocomotion != null
  }

  get setupReleaseDuration(): number {
    return this.animator?.setupReleaseDuration ?? 0
  }

  playThrow(): void {
    this.animator?.playThrow()
  }

  /** 振り切って投げる */
  releaseSetup(): void {
    this.animator?.releaseSetup()
  }

  releaseThrow(): void {
    this.animator?.releaseThrow()
  }

  /** 投げるのをやめる (倒された・箱に入った・死んだ) */
  cancelThrow(): void {
    this.animator?.cancelThrow()
  }

  /** 振りかぶりが終わるまであと何秒か。軽く叩いただけなら残っている */
  get throwWindupLeft(): number {
    return this.animator?.throwWindupLeft ?? 0
  }

  /** 投げ (後半) の尺 (秒)。手を離れる瞬間をこれに対する割合で測る */
  get throwReleaseDuration(): number {
    return this.animator?.throwReleaseDuration ?? 0
  }

  /** 振りかぶり切ったか。投げられる状態になったかの判定に使う */
  get throwWoundUp(): boolean {
    return this.animator?.throwWoundUp ?? false
  }

  playBolt(): void {
    this.animator?.playBolt()
  }

  /** ボルト操作の尺 (秒)。モデル未着なら 0 */
  get boltDuration(): number {
    return this.animator?.boltDuration ?? 0
  }

  /** 刺突モーションの尺 (秒)。モデル未着なら 0 */
  get stabDuration(): number {
    return this.animator?.stabDuration ?? 0
  }

  /** 刺突中か。この間は発砲できない */
  get stabbing(): boolean {
    return this.animator?.stabbing ?? false
  }

  /**
   * 敬礼する。
   *
   * ダメージも防御も無い。ただ立ち止まって型を取るだけで、その間は無防備になる。
   * 撃てる相手に撃たずに敬礼する、という選択がありうるゲームなので、
   * 妨げるものは何も置かない。動けば途中で解ける。
   */
  salute(): void {
    if (this.down || this.boxed || this.rolling || this.stabbing || this.aiming) return
    this.animator?.playSalute()
  }

  /**
   * 敬礼を保つかどうか。押している間 true を渡す。
   * 短く押せば止まる位置に届く前に離れるので、そのまま一度だけ流れる。
   */
  /**
   * 敬礼の最中か。挙げ始めてから下ろし切るまで。
   *
   * この間は移動も回避も構えもできない。動いた瞬間に解ける作りだと、
   * 手を挙げたことに責任が発生しない。銃を下ろして棒立ちになる時間が
   * あるからこそ、味方と繋がる手続きに意味が出る。
   */
  get saluting(): boolean {
    return this.animator?.saluting ?? false
  }

  /** いま手を挙げているか。味方とのリンクの成立を見るのに使う */
  get isSaluting(): boolean {
    return this.saluteHeld && this.locomotion === 'salute'
  }

  setSaluteHeld(held: boolean): void {
    this.saluteHeld = held
    this.animator?.setSaluteHeld(held)
  }

  /** 敬礼を保っているか。相手へ送る */
  private saluteHeld = false

  /** ナイフで刺す。モーションが終わるまで持ち替えたまま */
  stab(): void {
    if (this.down || this.boxed || this.saluting) return
    if (this.downed || this.standing) return
    this.animator?.playStab()
  }

  /** 刃先のワールド座標。判定の起点に使う */
  knifeTip(out: THREE.Vector3): THREE.Vector3 | null {
    return this.knife ? this.knife.muzzleWorld(out) : null
  }

  /** 発砲モーションの再生・停止。上半身レイヤーにだけ効く */
  setFiring(firing: boolean): void {
    this.animator?.setFiring(this.down ? false : firing)
  }

  /** 構えの切り替え。構えている間だけ照準方向を向き、上半身が照準の上下に追従する */
  setAiming(aiming: boolean): void {
    // 敬礼が終わるまでは構えられない。礼と戦闘は両立しないので、
    // 途中で打ち切るのではなく最後まで下ろさせる
    if (this.saluting) return
    // 箱の中では構えられない。入力そのものを捨てるので、押しても脱げない。
    //
    // 「構えたら自動で脱ぐ」にしていたが、それだと隠れることの代償が無くなる。
    // 脱ぐには B か C を押す必要がある、という一手間があって初めて
    // 「今は隠れる / 今は戦う」を選んだことになる。
    // 倒れている間は構えられる (伏せ撃ち)。立ち上がりの最中だけ塞ぐ。
    //
    // ただし**飛ばされている最中は構えられない**。地面に着く前に銃を構え直す
    // のは形として無理があるし、吹き飛ばされたこと自体が短くなる。
    //
    // 押しっぱなしも受け付けない。倒される前から構えていた場合、
    // 着地した瞬間に何もしていないのに構え直してしまう。一度離してから
    // 押し直させることで、伏せて撃つのが**選んだ結果**になる。
    if (this.downed) {
      if (!aiming) this.aimLatched = false
      const landed = this.downElapsed >= (this.animator?.sweepDuration ?? 1.5)
      this.aiming = landed && aiming && !this.aimLatched
      return
    }
    this.aiming = this.down || this.boxed || this.standing ? false : aiming
  }

  /**
   * 実際に構えているか。
   *
   * 入力ではなく**受け付けた結果**。箱の中や敬礼中は押しても構えないので、
   * 入力をそのまま見ると「構えていないのに構えている」状態が生まれる。
   */
  get isAiming(): boolean {
    return this.aiming
  }

  /** 接地しているか。空中では散布が大きくなる */
  get grounded(): boolean {
    return this.onGround
  }

  /** しゃがんでいるか。散布と視点の高さに効く */
  get isCrouching(): boolean {
    return this.crouching
  }

  /**
   * 注視点の高さ (m)。姿勢ごとの定数ではなく、実際の頭の位置から決める。
   * しゃがみ歩きは静止より頭が 18cm 高いといった差を、自動で吸収できる。
   */
  get viewHeight(): number {
    return this.currentViewHeight
  }

  /**
   * 集中している時間 (秒)。
   *
   * 集中 = しゃがんでいる (ダンボールを含む) かつ動いていない。
   * 立った瞬間も動いた瞬間も 0 に戻るので、そのつど待ち直しになる。
   *
   * 姿勢を変えるだけでは足りず、そこに留まる必要がある、という形にしている。
   * 「屈んで、止まって、待つ」の 3 つが揃って初めて周りが聞こえる。
   */
  get concentration(): number {
    return this.concentrateTime
  }

  /** 今まさに集中の条件を満たしているか */
  get isConcentrating(): boolean {
    return this.crouching && !this.down && this.actualSpeed < CONCENTRATE_MAX_SPEED
  }

  /**
   * 腰のあたりの高さ (m)。音の輪を置く高さに使う。
   *
   * 注視点の高さから割り出している。姿勢ごとの定数を別に持つと、
   * しゃがみやダンボールを足すたびに両方を直すことになる。
   */
  get waistHeight(): number {
    return this.currentViewHeight * 0.62
  }

  /** しゃがみの切り替え。空中では姿勢を変えない */
  toggleCrouch(): void {
    if (!this.onGround || this.down || this.saluting) return
    if (this.downed || this.standing) return
    // 箱を被ったまま立ち上がることはできない。脱いでから立つ。
    if (this.boxed) {
      this.dropBox()
      return
    }
    this.crouching = !this.crouching
  }

  /** ローリングの尺 (秒)。モデル未着なら 0 */
  get rollDuration(): number {
    return this.animator?.rollDuration ?? 0
  }

  /** ローリング中か。この間は撃てず、方向も変えられない */
  get rolling(): boolean {
    return this.animator?.rolling ?? false
  }

  /**
   * 前方へ転がる。接地しているときだけ。
   *
   * しゃがみは解除する。転がった先で立っている姿勢になるため。
   */
  roll(): void {
    if (!this.onGround || this.rolling || this.stabbing || this.down) return
    // 倒れている間は転がれない。爆風の代償をここで踏ませる
    if (this.downed || this.standing) return
    // 箱を被ったままは転がれない。脱ぐ動作を挟ませることで、
    // 隠れている状態から即座に回避へ移れないようにする。
    if (this.boxed || this.saluting) return
    this.crouching = false
    // 向きは踏み切った時点で固定する。転がっている間は舵が効かない。
    this.rollYaw = this.yaw
    this.rollStarted = true
    this.animator?.playRoll()
  }

  /** 跳躍の調整用。高さを保ったまま重力と落下の重さを変えられる */
  setJumpTuning(gravity: number, height: number, fallScale: number): void {
    this.gravity = gravity
    this.fallReferenceHeight = height
    this.fallGravityScale = fallScale
  }

  /** 移動速度の調整用。アニメの再生速度補正は update の中で追従する */
  setMoveSpeed(speed: number, aimScale: number): void {
    this.moveSpeed = speed
    this.aimSpeedScale = aimScale
  }

  /** リロードモーションを頭から再生する */
  playReload(): void {
    if (this.down) return
    this.animator?.playReload()
  }

  /** 武器の握り位置と角度を作り直す (調整用。確定したら weapon.ts の定数へ焼き込む) */
  calibrateWeapon(target: WeaponTarget, grip: THREE.Vector3, rotation: THREE.Euler): void {
    if (target === 'knife') {
      this.knife?.setStanceValues(false, grip, rotation)
      return
    }
    // 持っていない銃への調整は捨てる。パネル側が持ち替えに追従するので、
    // 通常はここで落ちない
    const kind: WeaponId = target.startsWith('sniper')
      ? 'sniper'
      : target.startsWith('pistol')
        ? 'pistol'
        : 'rifle'
    if (kind !== this.weaponKind) return
    this.weapon?.setStanceValues(target.endsWith('Crouch'), grip, rotation)
  }

  /**
   * ナイフを常時表示する (調整用)。
   * 普段は刺突中しか出ないので、そのままでは位置を合わせられない。
   */
  setKnifePreview(visible: boolean): void {
    this.knifePreview = visible
  }

  /** 照準の上下を上半身に反映させる強度 (調整用) */
  setAimPitchGain(gain: number): void {
    if (this.animator) this.animator.aimPitchGain = gain
  }

  /** 爆風で倒れているか。起き上がる操作をするまで続く */
  get downed(): boolean {
    return this.downed_
  }

  /** もう起き上がれるか。表示に使う */
  get canStandUp(): boolean {
    return this.downed_ && this.downElapsed >= DOWN_LOCK
  }

  /** 立ち上がりの最中か。この間は何も受け付けない */
  get standingUp(): boolean {
    return this.standing
  }

  /**
   * 爆風で吹き飛ばす。
   *
   * 倒れる → (伏せたまま撃てる) → 立ち上がる、の 3 段。立ち上がりに入ったら
   * 中断できないので、そこが無防備な時間になる。
   */
  knockDown(): void {
    if (this.down || this.downed) return
    this.crouching = false
    this.boxed = false
    this.animator?.setBoxed(false)
    this.aiming = false
    this.standing = false
    this.downed_ = true
    this.downElapsed = 0
    // 押しっぱなしを引き継がせない。離して押し直すまで構えない
    this.aimLatched = true
    this.animator?.playSweep()
  }

  /**
   * 起き上がる。
   *
   * 移動入力で呼ばれる。**倒れたまま構えている間は呼ばれない** —
   * 撃つか起きるかを選ぶのが倒れている間の中身なので、
   * 撃とうとしただけで勝手に起き上がってはいけない。
   */
  standUp(): void {
    if (!this.downed_ || this.standing || this.downElapsed < DOWN_LOCK) return
    this.downed_ = false
    this.aiming = false
    this.standing = true
    this.animator?.playStand()
    this.standTimer = this.animator?.standDuration ?? 3
  }

  /** いま持っている銃 */
  get equipped(): WeaponId {
    return this.weaponKind
  }

  /**
   * 自分の姿を描くか。
   *
   * スコープを覗いている間は消す。視点が銃の位置に来るので、体があると
   * 内側から自分の頭を見ることになる。他の人の画面からは見えたままなので、
   * 覗いている側だけが自分を見失う (それでよい)。
   */
  setSelfVisible(visible: boolean): void {
    if (this.model) this.model.visible = visible
    if (this.weapon) this.weapon.visible = visible
  }

  /** しゃがみ時に上半身を右へ旋回させる角度 (度、調整用) */
  setCrouchTorsoYaw(degrees: number): void {
    if (this.animator) this.animator.crouchTorsoYaw = (degrees * Math.PI) / 180
  }

  /** 非構え時の上半身の向き補正 (0..1)。調整用 */
  setUpperTwistFix(amount: number): void {
    if (this.animator) this.animator.upperTwistFix = amount
  }

  /** 構えていないときの前傾 (rad、調整用) */
  setRelaxedLean(lean: number): void {
    if (this.animator) this.animator.relaxedLean = lean
  }

  /**
   * 銃口位置 = トレーサーの始点。弾道の判定そのものはカメラ側の照準線で行うので、
   * これは純粋に見た目用。武器モデルを持たせたら右手ボーンのワールド座標に置き換える。
   */
  /** 排莢口のワールド座標。銃が付いていなければ銃口で代用する */
  ejectPort(out: THREE.Vector3): THREE.Vector3 {
    if (this.weapon) return this.weapon.ejectWorld(out)
    return this.muzzle(out)
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    // 武器がある間はその銃口を使う。以下は武器が付く前のフォールバック。
    if (this.weapon) return this.weapon.muzzleWorld(out)

    // yaw = θ のとき、ローカル -Z (前方) は (-sinθ, 0, -cosθ)、+X (右) は (cosθ, 0, -sinθ)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    const base = this.object.position
    return out.set(
      base.x - sin * MUZZLE_FORWARD + cos * MUZZLE_RIGHT,
      base.y + MUZZLE_HEIGHT,
      base.z - cos * MUZZLE_FORWARD - sin * MUZZLE_RIGHT,
    )
  }

  /**
   * @param moveDir XZ 平面のワールド空間移動方向 (長さ 0..1)
   * @param facingYaw 向くべき方向 (rad)。カメラ = 照準の yaw を渡す
   * @param aimPitch 照準の上下 (rad)。上半身を曲げるのに使う
   * @param world 地形への問い合わせ先
   */
  update(
    dt: number,
    moveDir: THREE.Vector3,
    facingYaw: number,
    aimPitch: number,
    world: PlayerWorld,
  ): void {
    this.aimPitch = aimPitch

    // 倒れている間は入力を捨てる。重力と接地だけは回して、体が宙に浮かないようにする。
    if (this.down) moveDir = ZERO_MOVE

    // 倒れている間と立ち上がりの最中は動けない。
    // 撃つことはできる (上半身は構えに戻っている)。
    //
    // 移動しようとしたことが起き上がる合図になる。動きたいと思った時点で
    // 起きるのが素直で、そのためのキーを別に覚えさせる理由が無い
    if (this.downed || this.standing) {
      if (this.downed && moveDir.lengthSq() > 1e-6) this.standUp()
      moveDir = ZERO_MOVE
    }

    // 敬礼が終わるまで動けない。
    //
    // 動いた瞬間に解ける作りだと、手を挙げたことに責任が発生しない。
    // 銃を下ろして棒立ちになる時間があるからこそ、味方と繋がる手続きに
    // 意味が出る。挙げると決めたら、下ろし切るまでは無防備でいる。
    if (this.saluting) moveDir = ZERO_MOVE

    // 銃の重さはどの姿勢でも効く。担いでいる物が軽くなるわけではないので。
    //
    // 構えている間だけは重さを見ない。あちらは狙いを保つために遅くしている
    // (aimSpeedScale) ので、重さと二重に掛けると狙撃銃が止まってしまう。
    const carrying = carrySpeedScale(weaponOf(this.weaponKind))
    let targetSpeed = this.crouching
      ? this.moveSpeed * CROUCH_SPEED_SCALE * carrying
      : this.moveSpeed * (this.aiming ? this.aimSpeedScale : carrying)
    if (this.stabbing) targetSpeed *= STAB_SPEED_SCALE
    // ダンボールを被っている間も担いでいる物は同じ
    if (this.boxed) targetSpeed = this.moveSpeed * BOX_SPEED_SCALE * carrying
    if (this.down) targetSpeed = 0
    this.currentSpeed = damp(this.currentSpeed, targetSpeed, SPEED_LAMBDA, dt)

    // ローリング中はクリップに焼かれた移動をそのまま辿る。入力は受け付けない。
    // 速度に直して渡すのは、移動の規則を 1 本に通すため。位置へ直接足すと
    // 押し戻しも接地も素通りする。
    let overrideX: number | undefined
    let overrideZ: number | undefined
    if (this.rolling) {
      overrideX = 0
      overrideZ = 0
      if (dt > 0 && this.animator?.consumeRootMotion(this.scratchVelocity)) {
        // モデル空間 (正面 +Z) の移動をワールドへ写す。
        // モデルは 180° 回してあるので yaw + π の回転になる。
        const sin = Math.sin(this.rollYaw)
        const cos = Math.cos(this.rollYaw)
        const dx = this.scratchVelocity.x
        const dz = this.scratchVelocity.z
        overrideX = (-dx * cos - dz * sin) / dt
        overrideZ = (dx * sin - dz * cos) / dt
      }
    }

    const moved = stepMovement(
      this.mover,
      {
        dirX: moveDir.x,
        dirZ: moveDir.z,
        speed: this.currentSpeed,
        overrideX,
        overrideZ,
      },
      world,
      {
        radius: PLAYER_RADIUS,
        height: PLAYER_HEIGHT,
        gravity: this.gravity,
        fallGravityScale: this.fallGravityScale,
        airControl: AIR_CONTROL,
      },
      dt,
    )

    // 空中から地面に触れた瞬間、かつ十分な速さで落ちてきたときだけ流す
    if (moved.landed && moved.impactSpeed >= LANDING_MIN_SPEED) {
      this.landingTimer = LANDING_TIME
      this.animator?.playLanding()
    }
    // 落ちた速さを外へ渡す。**量はここで決めない** — 体力を持っているのは
    // サーバーなので、速さを申告して同じ式 (damage.ts) を向こうで通してもらう
    this.landedSpeed = moved.landed ? moved.impactSpeed : 0
    if (this.landingTimer > 0) this.landingTimer -= dt
    this.actualSpeed = moved.actualSpeed

    // 倒れている間の時計。起き上がるのは操作されたときだけ (standUp)
    if (this.downed_) this.downElapsed += dt
    if (this.standing) {
      this.standTimer -= dt
      if (this.standTimer <= 0) this.standing = false
    }

    // 集中の時計。条件を外れた瞬間に 0 へ戻す
    this.concentrateTime = this.isConcentrating ? this.concentrateTime + dt : 0

    // 構えている間は照準方向を向く (撃つ向きと見た目を一致させる)。
    // 構えていなければ進行方向を向く。横歩き・後退のモーションは構え時にだけ出る。
    let targetYaw = facingYaw
    if (this.down) {
      // 倒れた向きのまま。カメラを回しても死体は回らない。
      targetYaw = this.yaw
    } else if (this.rolling) {
      targetYaw = this.rollYaw
    } else if (!this.aiming && !this.throwing) {
      // yaw = θ のときローカル -Z が (-sinθ, 0, -cosθ) を向くので、その逆算
      targetYaw =
        moveDir.lengthSq() > 1e-6 ? Math.atan2(-moveDir.x, -moveDir.z) : this.yaw
    }
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt)
    this.object.rotation.y = this.yaw

    if (this.animator) {
      // 足が滑らないよう、その瞬間の速度に再生速度を合わせ続ける
      if (Math.abs(this.currentSpeed - this.appliedAnimationSpeed) > 0.01) {
        this.animator.setMoveSpeed(this.currentSpeed)
        this.appliedAnimationSpeed = this.currentSpeed
      }
      this.animator.setLocomotion(this.resolveLocomotion(moveDir))
      // 構えていないときに体が照準の上下へ傾くと、ただ歩いているのに前後に折れて見える
      this.animator.setAimPitch(this.aiming ? aimPitch : 0)
      this.animator.setAiming(this.aiming)
      this.animator.update(dt)

      this.object.updateMatrixWorld(true)

      const head = this.animator.headHeight()
      if (head !== null) {
        this.currentViewHeight = head + VIEW_CLEARANCE
        // 中の人が伸びたぶんだけ箱が浮く。歩けば隙間から足が見える。
        this.boxLift = advanceBoxLift(this.boxLift, this.boxed ? boxLift(head) : 0, dt)
        if (this.box) placeBox(this.box, this.boxLift)
      }

      // 銃の持ち方を姿勢に合わせる。切り替わりで跳ねないよう補間して追う
      const before = this.weaponStance
      this.weaponStance = damp(this.weaponStance, this.crouching ? 1 : 0, WEAPON_STANCE_LAMBDA, dt)
      this.weapon?.applyStance(this.weaponStance)
      // 姿勢がどれだけ速く変わっているか。散布に効かせる
      this.stanceRateValue = dt > 0 ? Math.abs(this.weaponStance - before) / dt : 0

      // 箱は被せるだけで、キャラは消さない。しゃがんだ体の上に箱が乗っている、
      // という見たままの状態にしておく。判定もその姿勢のボーンで取られるので、
      // 見えているものと当たるものが食い違わない。
      if (this.box) this.box.visible = this.boxed

      // 手に何を出すかは held が決める。
      //
      // 銃を隠す場面:
      //   銃以外を手にしている … 持ち替えたので背中・腰に納まっている
      //   敬礼中               … 銃を握った手で敬礼はできない。手が空いている型
      //   拳銃を構えていない   … ホルスターに納まっている扱い。副武器なので
      //                          持っていること自体を見せなくてよく、相手からも
      //                          「今どちらを持っているか」が読みにくくなる。
      //                          ただしリロード中は抜いている (納めたまま弾倉は
      //                          替えられないし、見えない銃をリロードして見える)
      const saluting = this.animator.saluting
      const gun = this.held === 'rifle' || this.held === 'sniper' || this.held === 'pistol'
      const holstered =
        !gun ||
        saluting ||
        (this.weaponKind === 'pistol' && !this.aiming && !this.animator.reloading)
      // ナイフは持ち替えて出す。刺突中の一瞬だけではなくなった
      const knifeOut = (this.held === 'knife' || this.knifePreview) && !saluting && !this.boxed
      if (this.knife) this.knife.visible = knifeOut
      if (this.weapon) this.weapon.visible = !holstered
    }
  }

  dispose(): void {
    this.disposed = true
    this.animator?.dispose()
    this.animator = null
    this.weapon?.dispose()
    this.weapon = null
    this.knife?.dispose()
    this.knife = null
    disposeTree(this.placeholder)
    this.placeholder = null
    if (this.box) disposeBox(this.box)
    this.box = null
  }

  private async load(skin: string): Promise<void> {
    let gltf
    try {
      gltf = await loadSoldier(skin)
    } catch (error) {
      // 読み込みに失敗してもプレースホルダーのまま操作は続けられる
      console.error('[Player] 兵士モデルの読み込みに失敗', error)
      return
    }
    if (this.disposed) return

    // 読み込んだ実体は敵側とも共有しているので、直接いじらず複製して使う
    const model = cloneSkinned(gltf.scene)
    model.rotation.y = MODEL_YAW_OFFSET
    model.traverse((obj) => {
      if (isMesh(obj)) {
        obj.castShadow = true
        // スキニング後の実際の姿勢はバウンディングボックスに反映されないため、
        // 画面端でモデルが消えるのを避けて視錐台カリングを切る
        obj.frustumCulled = false
      }
    })
    this.drawLast(model)

    // 読み込み前に速度を変えられている場合があるので、定数ではなく現在値を渡す
    this.animator = new CharacterAnimator(model, gltf.animations, this.moveSpeed)
    // モデルは非同期で読むので、ここより前に受けた設定を流し込み直す。
    // 呼ばれた時点では animator がまだ無く、素通りしている
    this.animator.setPistol(this.weaponKind === 'pistol')

    disposeTree(this.placeholder)
    this.placeholder = null
    this.object.add(model)
    this.model = model

    await this.attachWeapon(model)
  }

  /**
   * 自分の身体を、味方の発光より後に描く。
   *
   * 発光は壁を突き抜けて見えるように深度を見ないので、そのままだと
   * 自分の身体の上にも重なる。壁の向こうの味方が、自分より手前に居るように見える。
   *
   * three は不透明を先に、半透明を後にまとめて描く。順番を跨いで並べ替えられないので、
   * こちらも半透明の列に入れてから、発光より後ろの順番を与える。不透明度は 1 のままなので
   * 見た目は変わらない。
   *
   * マテリアルは複製してから触る。glTF の実体は他プレイヤーの複製元でもあるので、
   * ここで書き換えると相手の見た目まで変わる。
   *
   * --- 深度の書き方は元のまま残す ---
   *
   * 以前はここで全部に `depthWrite = true` を焼いていた。**髪で破綻する。**
   *
   * 髪は重なった板の集まりで、glTF の alphaMode BLEND (three では
   * `depthWrite: false`) で描くことを前提に作られている。深度を書かせると、
   * 板の**透明な所まで深度を書く**。半透明の列の並べ替えは物体の中心までの距離で
   * 決まり、頭も髪も中心がほぼ同じなので順番が回によって入れ替わる。髪が先に出た
   * 回は、その裏の頭とうなじが深度で落ちて**背景の壁が抜けて見える**。
   *
   * 元が半透明だった物には書かせない。そのうえで実体より後ろの順番に回して、
   * 並べ替えの当たり外れに任せない。
   */
  private drawLast(root: THREE.Object3D): void {
    const cloned = new Map<THREE.Material, THREE.Material>()
    root.traverse((obj) => {
      if (!isMesh(obj)) return
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      // 元から半透明だった物 (髪のような重なる板) は実体を全部描いたあとに回す
      const wasTransparent = materials.some((material) => material.transparent)
      obj.renderOrder = SELF_RENDER_ORDER + (wasTransparent ? 1 : 0)
      const replaced = materials.map((material) => {
        let copy = cloned.get(material)
        if (!copy) {
          copy = material.clone()
          copy.depthWrite = material.transparent ? material.depthWrite : true
          copy.transparent = true
          cloned.set(material, copy)
        }
        return copy
      })
      obj.material = Array.isArray(obj.material) ? replaced : replaced[0]
    })
  }

  /** 構えのポーズを反映させてから、その両手の位置を基準に武器を取り付ける */
  /**
   * 銃を持ち替える。
   *
   * 取り付けの基準は「構えのポーズにおける両手の位置」なので、差し替えるたびに
   * 計算し直す必要がある。モデルの読み込みは共有のキャッシュに乗るので、
   * 2 回目以降は待ち時間が出ない。
   */
  async equip(kind: WeaponId): Promise<void> {
    if (kind === this.weaponKind) return
    this.weaponKind = kind
    this.animator?.setPistol(kind === 'pistol')
    const model = this.model
    if (!model) return

    const old = this.weapon
    this.weapon = null
    old?.dispose()
    await this.attachWeapon(model, kind)
  }

  private async attachWeapon(
    model: THREE.Object3D,
    kind: WeaponId = this.weaponKind,
  ): Promise<void> {
    let weapon: Weapon
    try {
      weapon = await Weapon.load(kind)
    } catch (error) {
      // 武器が無くてもキャラは動く。銃口はフォールバックの固定オフセットになる。
      console.error('[Player] 武器の読み込みに失敗', error)
      return
    }
    if (this.disposed) return

    // バインドポーズ (T ポーズ) のままだと基準がずれるので、構えを 1 フレーム分適用する
    this.animator?.update(0)
    this.object.updateMatrixWorld(true)

    const rightHand = findBoneBySuffix(model, 'RightHand')
    const leftHand = findBoneBySuffix(model, 'LeftHand')
    if (!rightHand || !leftHand) {
      console.warn('[Player] 手ボーンが見つからない。武器を取り付けられない')
      weapon.dispose()
      return
    }

    // 取り付けの基準は**最初の 1 回**に決めて、以後それを使い回す。
    //
    // 持ち替えのたびにその場の姿勢から取り直すと、しゃがんで構えている最中に
    // 持ち替えたときの手の向きが基準になって、銃が下を向く。
    // 基準は姿勢によらず 1 つでなければならない。
    if (!this.attachRef) {
      this.attachRef = {
        matrix: rightHand.matrixWorld.clone(),
        right: new THREE.Vector3().setFromMatrixPosition(rightHand.matrixWorld),
        left: new THREE.Vector3().setFromMatrixPosition(leftHand.matrixWorld),
      }
    }
    const ref = this.attachRef
    weapon.attachTo(rightHand, ref.right, ref.left, ref.matrix)
    this.drawLast(weapon.object)
    this.weapon = weapon
    // 持ち替えたときは、いまの姿勢に合わせ直す (立ち / しゃがみで握りが違う)
    weapon.applyStance(this.weaponStance)

    // ナイフを付けるのは最初の 1 回だけ。銃を差し替えても左手はそのまま
    if (this.knife) return

    // ナイフは左手。刺突クリップは左手が 0.40m 突き出す (右手は 0.06m) ので、
    // 刃を持っているのは左手側。向きは肘から手首への線を刃の方向とする。
    const foreArm = findBoneBySuffix(model, 'LeftForeArm')
    if (!foreArm) {
      console.warn('[Player] 左前腕のボーンが無い。ナイフを付けられない')
      return
    }
    try {
      const knife = await Weapon.load('knife')
      if (this.disposed) {
        knife.dispose()
        return
      }
      this.drawLast(knife.object)
      // ナイフは最初の 1 回しか付けないので、その場の姿勢を基準にしてよい
      knife.attachTo(
        leftHand,
        new THREE.Vector3().setFromMatrixPosition(foreArm.matrixWorld),
        new THREE.Vector3().setFromMatrixPosition(leftHand.matrixWorld),
      )
      knife.visible = false
      this.knife = knife
    } catch (error) {
      console.error('[Player] ナイフの読み込みに失敗', error)
    }
  }

  /**
   * 再生すべきクリップを選ぶ。
   *
   * 規則そのものは src/sim/stance.ts にある。ここでやるのは、その規則が要る値を
   * 集めることと、決まった結果に応じて**こちら側の状態を畳む**ことだけ。
   * (敬礼をやめる、落下ループの尺を渡す、といった副作用は共有側に置けない)
   */
  private resolveLocomotion(moveDir: THREE.Vector3): Locomotion {
    const saluting = this.saluting
    const next = resolveLocomotion({
      previous: this.locomotion,
      down: this.down,
      boxed: this.boxed,
      crouching: this.crouching,
      aiming: this.aiming,
      saluting,
      downed: this.downed,
      standingUp: this.standing,
      stabbing: this.stabbing,
      setting: this.animator?.setupLocomotion ?? null,
      rolling: this.rolling,
      onGround: this.onGround,
      landing: this.landingTimer,
      velocityY: this.velocityY,
      dirX: moveDir.x,
      dirZ: moveDir.z,
      actualSpeed: this.actualSpeed,
      yaw: this.yaw,
    })

    // 落下ループは尺を渡さないと再生速度が決まらない。
    // 跳躍の高さから落下時間を見積もる (段差から降りた場合はループが回って埋める)
    if (next === 'jump_loop') {
      this.animator?.enterJumpLoop(
        Math.sqrt((2 * this.fallReferenceHeight) / (this.gravity * this.fallGravityScale)),
      )
    }

    this.locomotion = next
    return next
  }
}

/**
 * モデルが届くまでの仮の体。
 *
 * 寸法だけ合わせておく。読み込みに失敗してもこのまま操作は続けられるので、
 * 「何も出ない」より「四角い何かが動く」ほうが原因を切り分けやすい。
 */
function buildPlaceholder(): THREE.Group {
  const group = new THREE.Group()
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0x6f7a63, roughness: 0.9 }),
  )
  mesh.position.y = PLAYER_HEIGHT / 2
  mesh.castShadow = true
  group.add(mesh)
  return group
}

/** 枝ごと捨てる。形状と材質は自分で解放しないと GPU 側に残る */
function disposeTree(root: THREE.Object3D | null): void {
  if (!root) return
  root.traverse((obj) => {
    if (!isMesh(obj)) return
    obj.geometry.dispose()
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of materials) material.dispose()
  })
  root.removeFromParent()
}
