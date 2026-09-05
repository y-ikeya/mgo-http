import * as THREE from 'three'
import { damp } from '../util/math'
import type { Soldier } from '../actor/soldier'
import { PLAYER_HEIGHT } from '../actor/soldier'

/**
 * 構えていないとき / 構えているときのカメラ。
 * 構えると寄って画角も狭くなるぶん狙いやすくなるが、周辺視野を失う。
 * 「構えれば狙えるが索敵しづらくなる」という交換条件をカメラで表現している。
 */
const HIP_VIEW = { distance: 4.2, shoulder: 0.75, fov: 60 }
const AIM_VIEW = { distance: 1.35, shoulder: 0.42, fov: 38 }
/** 構えの切り替わりの速さ */
const AIM_LAMBDA = 11
/** 構えている間のマウス感度の倍率。寄っている分だけ手元を落ち着かせる */
const AIM_SENSITIVITY_SCALE = 0.65

/**
 * 姿勢の変化で注視点が寄る速さ。
 *
 * 速すぎると歩行の上下動をそのまま拾って画面が揺れる。遅すぎると
 * しゃがみ・立ちの切り替えに追従できない。歩行の周期 (約 0.5 秒) を
 * ならしつつ、姿勢変更には 0.3 秒程度で追いつく妥協点。
 */
const STANCE_LAMBDA = 8

/** カメラ位置が目標位置に追従する速さ。向きは補間しない (エイムが鈍るため) */
const POSITION_LAMBDA = 16

/**
 * 段差で上がった足元に視点が追いつく速さ。
 *
 * 0.25m の段を 0.2 秒ほどで吸収する。速すぎると跳ねが残り、遅すぎると
 * 階段を上っている間ずっと視点が沈んで見える。
 */
const STEP_LAMBDA = 14
/**
 * これ以上動いたら均さずに合わせる (m)。
 *
 * 落下・跳躍・湧き直しまで均すと、落ちている間ずっと視点が遅れて付いてくる。
 * 段差 (最大 0.25m) より大きく、跳躍 (0.6m) より小さい所に置く。
 */
const STEP_SNAP = 0.45
/** カメラが地面に潜らないための下限 (m) */
const MIN_CAMERA_Y = 0.4

/**
 * 壁からどれだけ手前に置くか (m)。
 *
 * カメラは点ではなく錐台なので、遮蔽点にぴったり置くと near 平面の四隅が
 * まだ壁の中にあり、画面の端から壁の裏側が見える。near は 0.1 だが、
 * 画角と縦横比のぶん四隅はもっと外側にあるので余裕を多めに取る。
 */
const OCCLUSION_PADDING = 0.28

/**
 * 遮られたときに寄れる最短距離 (m)。
 *
 * これ以上詰めるとキャラの頭の中に入る。壁に張り付いたときは
 * 画面がキャラの背中で埋まるが、壁抜けよりは読める絵になる。
 */
const MIN_OCCLUDED_DISTANCE = 0.45

/**
 * 倒した相手を映すときの構え。
 *
 * 近い。誰に倒されたのかが読めないと映す意味が無いので、顔と装備が
 * 分かる距離まで寄せる。
 */
const WATCH_DISTANCE = 3.4
/** どれだけ壁に押されても、これより寄らない (m)。中に入ると何も映らない */
const WATCH_MIN_DISTANCE = 1.2
/** 相手の足元からのカメラの高さ (m)。少し見下ろす */
const WATCH_HEIGHT = 1.5
/** 注視点の高さ (m)。胸のあたり */
const WATCH_LOOK_HEIGHT = 1.2
/** 回り込む速さ (rad/s)。止まった絵にすると固まったように見える */
const WATCH_SPIN = 0.3
/**
 * 映す位置へ寄る速さ。
 *
 * 追従より遅い。倒れた場所から相手のところまで一瞬で飛ぶと、
 * どこを映しているのか分からなくなる。
 */
const WATCH_LAMBDA = 3.5

/**
 * 遮蔽が解けてカメラが戻る速さ。
 *
 * 寄るときは補間しない。壁に入る側を遅らせると、遅れている間そのまま
 * 壁を突き抜けて見える。逆に戻る側を即座にすると、柱の陰を通り過ぎるたびに
 * カメラが跳ねて画面が暴れる。
 */
const OCCLUSION_RELEASE_LAMBDA = 6

/**
 * カメラから見た世界。地形の形は Game 側が握り、カメラは問い合わせるだけ。
 * PlayerWorld と同じ考え方で、カメラは障害物の表現を知らない。
 */
export interface CameraWorld {
  /**
   * origin から dir 方向へ maxDistance まで見て、最初に遮るものまでの距離を返す。
   * 何も無ければ maxDistance をそのまま返す。
   */
  distanceToObstruction(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): number
}

/**
 * 衝撃で画面が揺れる長さ (秒) と、一番強いときの振れ幅 (rad)。
 *
 * **短く、浅く。** 長いと酔うし、深いと狙いが動いたように錯覚する
 * (実際には動いていない)。0.05 rad = 約 2.9°。
 */
const SHAKE_TIME = 0.35
const SHAKE_MAX = 0.05
/** 揺れを引き直す速さ (回/秒)。速いほど細かく震える */
const SHAKE_RATE = 26
/**
 * 一番強いときに位置がずれる量 (m)。**画角そのものを動かす分。**
 *
 * 揺れの強さ (rad) に掛けるので、実際のずれは SHAKE_MAX × これ = 12cm ほど。
 * 大きくすると壁を突き抜けて中が見える。
 */
const SHAKE_SHIFT = 2.4

/**
 * 不規則な揺れ。**刻みごとに引き直した値を滑らかに繋ぐ。**
 *
 * 正弦波だと周期が見えて「漂う」ように見える。かといって毎フレーム乱数だと
 * 1 コマごとに飛んで画面が壊れる。**整数の刻みで値を決めて、その間を滑らかに
 * 繋ぐ**と、不規則なのに繋がった揺れになる。
 *
 * 種で系列を分ける。同じ種なら同じ揺れ方になるので、向き 3 軸と位置 2 軸に
 * 別々の種を渡して、全部が同じ方向へ動くのを避ける。
 */
function wobble(t: number, seed: number): number {
  const i = Math.floor(t)
  const f = t - i
  // なめらかに繋ぐ (smoothstep)。線形だと折れ目が見える
  const w = f * f * (3 - 2 * f)
  return hashUnit(i, seed) * (1 - w) + hashUnit(i + 1, seed) * w
}

/** 整数 2 つから -1..1 を作る。**乱数を持たない** — 同じ入力なら同じ値 */
function hashUnit(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

/** マウス感度 (rad / px) */
const SENSITIVITY = 0.0022

/**
 * 覗いている間、見る速さを画角に合わせて落とす倍率。
 *
 * --- なぜ要るか ---
 * 感度は長らく「構えているか」だけで決まる一定値だった。狙撃銃の 16 倍は
 * 画角 4 度で、肩越し (38 度) の 1/15 しか画面に映らない。**同じマウスの
 * 動きで狙いが 15 倍飛ぶ**ので、倍率を上げるほど狙いが置けなくなる。
 * 遠くを見るために覗いているのに、覗くほど当てられない、が起きていた。
 *
 * 画面上で動く距離が同じになる比は、角度そのものではなく **tan の比**。
 * 画角の端は tan(画角/2) の位置に映るので、そこを揃える。
 *
 * 肩越しを 1 とする。肩越しの画角は武器ごとに 38〜44 度と幅があるが、
 * **1 を超えないよう頭を打たせて**あるので、覗いていない間の手触りは
 * 今までと変わらない。変わるのは段を上げた後だけ。
 */
const LOOK_REFERENCE_FOV = AIM_VIEW.fov

export function zoomLookScale(fov: number): number {
  const half = (deg: number) => Math.tan((deg * Math.PI) / 360)
  return Math.min(1, half(fov) / half(LOOK_REFERENCE_FOV))
}
/** 見下ろし / 見上げの限界 (rad)。見上げ側はカメラが地面に潜るので浅め */
const MIN_PITCH = -1.1
const MAX_PITCH = 0.55

/**
 * 反動が戻り始めるまでの猶予 (秒)。
 *
 * これが無いと連射中も戻り続けてしまい、跳ね上がりが一定値で頭打ちになる。
 * 撃っている間は溜まり、止めてから戻る、という形にすることで
 * 「短く撃って戻す」というバースト射撃の判断が生まれる。
 */
const RECOIL_RECOVERY_DELAY = 0.1
/** 反動が戻る速さ */
const RECOIL_RECOVERY_LAMBDA = 9

/**
 * キャラの右肩越しに構える三人称カメラ。
 *
 * 向きはマウス入力が唯一の駆動源で、キャラの向きには追従しない。
 * (逆にキャラ側がこのカメラの yaw へ向き直る = エイム基準の TPS)
 *
 * 位置だけは damp で遅れて追いかけるが、回転は毎フレーム厳密に yaw/pitch を反映する。
 * 照準は「位置」ではなく「向き」で決まるので、位置が遅れても弾道はズレない。
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera

  /**
   * カメラが下がれる下限 (m)。
   *
   * **水面のあるステージでは水面に上げる。** 水は上からしか描いていないので、
   * 潜ると裏側から見ることになって、水面が消えて海底が丸見えになる。
   * 溺れた体は沈んで見えなくなるが、見ている側は水の上に残る。
   *
   * 既定は地面に潜らないための値。庭園のように**板ごと 10m 持ち上げた**
   * ステージでは、固定値のままだと海底 (y=0) まで付いていってしまう。
   */
  minY = MIN_CAMERA_Y

  /** Y 軸回りの向き (rad)。移動入力をワールド空間へ変換する基準にもなる */
  yaw = 0
  /** 上下の向き (rad)。+ が見上げ */
  pitch = -0.08

  /**
   * 反動による照準のずれ (rad)。マウス由来の yaw/pitch とは別に持つ。
   *
   * 分けているのは、プレイヤーが手で押さえ戻した分をこちらが打ち消さないため。
   * 押さえ戻しても this.pitch が下がるだけで、反動分は独立に 0 へ戻る。
   */
  private recoilPitch = 0
  private recoilYaw = 0

  /**
   * 手ブレによる照準のずれ (rad)。反動と同じく、マウス由来とは別に持つ。
   *
   * --- 画面が揺れる。カーソルは動かない ---
   * 最初はクロスヘアだけを動かしていた。**銃口はずれているのに視界は微動だに
   * しない**という、どこにも無い見え方になる。実際は銃を保持している腕が
   * 揺れるので、構えている**画面ごと揺れて**、照準は中央のまま。
   *
   * ここへ足すと弾道も一緒に動く (aimDirection がこの向きから出る) ので、
   * **見えている中心と当たる場所が必ず一致する**。別々に持つ必要が無くなる。
   */
  private swayPitch = 0
  private swayYaw = 0
  /** 最後に反動が加わってからの経過 (秒) */
  private recoilAge = 0
  /**
   * 反動が戻る速さの倍率。**その銃の MASTERY で決まる** (domain/player/skill.ts)。
   *
   * 猶予 (RECOIL_RECOVERY_DELAY) のほうは動かさない。あちらを縮めると
   * 連射中にも戻り始めて、跳ね上がりが頭打ちになる — 押しっぱなしが強くなる
   * 方向で、このスキルで出したい効き目と逆を向く。
   */
  private recoilRecovery = 1

  private aiming = false
  private distance = HIP_VIEW.distance
  private shoulder = HIP_VIEW.shoulder
  private fov = HIP_VIEW.fov
  /** 構え時の目標値。実機で詰められるよう定数ではなくインスタンスに持つ */
  private readonly aimView = { ...AIM_VIEW }
  /** 注視点の高さ (m)。Soldier が実測した頭の位置から決める */
  private viewHeight = PLAYER_HEIGHT * 0.85
  /** 均した足元の高さ。段差で視点が跳ねないようにするためのもの */
  private footY = 0
  private currentViewHeight = PLAYER_HEIGHT * 0.85

  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  /** 注視点 = 弾道の始点。カメラの視線軸上にあるのでクロスヘアと一致する */
  private readonly pivot = new THREE.Vector3()
  private readonly viewDir = new THREE.Vector3()
  /** 揺れを乗せた向き。euler は狙いのままにしておく */
  private readonly shaken = new THREE.Euler()
  private shakeLeft = 0
  private shakeAmount = 0
  private shakeAge = 0
  /** いま乗せている位置のずれ。次の均しの前に戻す */
  private readonly shakeShift = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  /** 視線の逆方向 (カメラが引く向き)。遮蔽の判定に使う */
  private readonly back = new THREE.Vector3()
  /** 肩オフセットを乗せない注視点。壁に肩を付けたときの判定に使う */
  private readonly centerPivot = new THREE.Vector3()
  /** 遮蔽を考慮した実際の距離。目標の distance 以下になる */
  private occludedDistance = HIP_VIEW.distance
  /** 倒した相手を映すときの回り込み角 (rad) */
  private watchAngle = 0

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(HIP_VIEW.fov, aspect, 0.1, 500)
  }

  /** マウス移動量 (px) を向きに反映する */
  addLook(dx: number, dy: number): void {
    const sensitivity =
      SENSITIVITY * (this.aiming ? AIM_SENSITIVITY_SCALE * zoomLookScale(this.fov) : 1)
    this.yaw -= dx * sensitivity
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch - dy * sensitivity))
  }

  setAiming(aiming: boolean): void {
    this.aiming = aiming
  }

  /** 注視点の高さ (m)。姿勢とアニメーションの上下動を含んだ実測値を受ける */
  setViewHeight(height: number): void {
    this.viewHeight = height
  }

  /**
   * 反動が戻る速さの倍率を差し込む。持ち替えとスキルの変更で変わる。
   *
   * 速さの決め方は**その銃を極めているか**なので domain。ここはその答えを
   * 受け取って掛けるだけ。
   */
  setRecoilRecovery(scale: number): void {
    this.recoilRecovery = scale
  }

  /** 1 発分の反動を加える (rad)。弾道はこの向きで決まるので見た目だけではない */
  addRecoil(pitch: number, yaw: number): void {
    this.recoilPitch += pitch
    this.recoilYaw += yaw
    this.recoilAge = 0
  }

  /**
   * 手ブレを差し込む (rad)。毎フレーム上書きする。
   *
   * 反動と違って**積まない**。あちらは撃つたびに加わって減衰していく量だが、
   * こちらは「いまどれだけ泳いでいるか」そのもの。
   */
  setSway(pitch: number, yaw: number): void {
    this.swayPitch = pitch
    this.swayYaw = yaw
  }

  /** 反動と手ブレを含んだ最終的な照準の向き。弾道もキャラの向きもこれに従う */
  get aimYaw(): number {
    return this.yaw + this.recoilYaw + this.swayYaw
  }

  get aimPitch(): number {
    return Math.min(
      MAX_PITCH,
      Math.max(MIN_PITCH, this.pitch + this.recoilPitch + this.swayPitch),
    )
  }

  /** 構え時のカメラの寄り具合 (調整用。確定したら AIM_VIEW へ焼き込む) */
  setAimView(view: { distance: number; shoulder: number; fov: number }): void {
    Object.assign(this.aimView, view)
  }

  /** カメラ基準の前方向 (XZ 平面、正規化済み) */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw))
  }

  /** カメラ基準の右方向 (XZ 平面、正規化済み) */
  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.aimYaw), 0, -Math.sin(this.aimYaw))
  }

  /**
   * 弾道の始点。カメラ本体ではなくキャラ頭部付近から撃つことで、
   * 「カメラとキャラの間に壁がある」ときに手前の壁へ当たる問題を避ける。
   */
  aimOrigin(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pivot)
  }

  /** 弾道の方向 = 画面中央のクロスヘアが指す方向 */
  aimDirection(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.viewDir)
  }

  /** 初期配置。追従の補間を挟まず目標位置へ即座に置く */
  /**
   * 誰かを映す。倒された側の画面が、倒した相手を映すのに使う。
   *
   * 追従とは別の口にしてある。追従は「自分の後ろ」を保つ仕掛けで、
   * 向きも距離も自分の入力から出る。ここは自分がどこを向いていようと
   * 関係なく相手を中心に置くので、同じ計算では出せない。
   *
   * ゆっくり回り込む。止まった絵にすると、映しているのか固まったのかが
   * 分からない。
   *
   * @param target 映す相手の足元
   */
  watch(dt: number, target: THREE.Vector3, world?: CameraWorld): void {
    this.watchAngle += dt * WATCH_SPIN

    // 見るのは胸のあたり。足元を見ると地面ばかりが映る
    this.pivot.set(target.x, target.y + WATCH_LOOK_HEIGHT, target.z)

    this.back
      .set(Math.sin(this.watchAngle), 0, Math.cos(this.watchAngle))
      .normalize()

    // 壁の向こうから見ない。回り込んだ先が壁の中だと、相手が消える
    let distance = WATCH_DISTANCE
    if (world) {
      const blocked = world.distanceToObstruction(this.pivot, this.back, WATCH_DISTANCE)
      distance = Math.max(WATCH_MIN_DISTANCE, blocked - OCCLUSION_PADDING)
    }

    this.desired
      .copy(this.pivot)
      .addScaledVector(this.back, distance)
    this.desired.y = Math.max(MIN_CAMERA_Y, this.pivot.y + WATCH_HEIGHT)

    const p = this.camera.position
    p.set(
      damp(p.x, this.desired.x, WATCH_LAMBDA, dt),
      damp(p.y, this.desired.y, WATCH_LAMBDA, dt),
      damp(p.z, this.desired.z, WATCH_LAMBDA, dt),
    )
    this.camera.lookAt(this.pivot)
  }

  snapTo(player: Soldier, world?: CameraWorld): void {
    // 映すのをやめたら回り込みも最初から。次に倒されたときに続きから
    // 回り始めると、角度が毎回変わって落ち着かない
    this.watchAngle = 0
    this.occludedDistance = this.distance
    this.computeDesired(player, world, 0)
    this.camera.position.copy(this.desired)
    this.camera.rotation.copy(this.euler)
  }

  /**
   * 衝撃で画面を揺らす。**狙いは動かない。**
   *
   * @param strength 0..1。爆発なら「実際に聞こえた強さ」をそのまま渡せる
   *   (audio.play の返り値)。遠いほど小さく揺れる、が音と同じ式で揃う。
   */
  punch(strength: number): void {
    const amount = Math.min(1, Math.max(0, strength)) * SHAKE_MAX
    // 弱い揺れで強い揺れを上書きしない。近い爆発の途中で遠いのが鳴っても消えない
    if (amount <= this.shakeAmount * (this.shakeLeft / SHAKE_TIME)) return
    this.shakeAmount = amount
    this.shakeLeft = SHAKE_TIME
  }

  update(dt: number, player: Soldier, world?: CameraWorld): void {
    // 撃っている間は溜まり、止めてから戻る
    this.recoilAge += dt
    if (this.recoilAge >= RECOIL_RECOVERY_DELAY) {
      const lambda = RECOIL_RECOVERY_LAMBDA * this.recoilRecovery
      this.recoilPitch = damp(this.recoilPitch, 0, lambda, dt)
      this.recoilYaw = damp(this.recoilYaw, 0, lambda, dt)
    }

    this.currentViewHeight = damp(this.currentViewHeight, this.viewHeight, STANCE_LAMBDA, dt)

    const target = this.aiming ? this.aimView : HIP_VIEW
    this.distance = damp(this.distance, target.distance, AIM_LAMBDA, dt)
    this.shoulder = damp(this.shoulder, target.shoulder, AIM_LAMBDA, dt)

    const fov = damp(this.fov, target.fov, AIM_LAMBDA, dt)
    if (Math.abs(fov - this.fov) > 1e-4) {
      this.fov = fov
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    this.computeDesired(player, world, dt)

    const p = this.camera.position
    /*
     * **前フレームの揺れを戻してから均す。**
     *
     * 揺らした位置をそのまま次の均しの起点にすると、ずれが毎フレーム積み上がる
     * (実測で 3.5m まで流れた)。均すのは揺れていない位置で、揺れは最後に乗せる。
     */
    p.sub(this.shakeShift)
    p.set(
      damp(p.x, this.desired.x, POSITION_LAMBDA, dt),
      damp(p.y, this.desired.y, POSITION_LAMBDA, dt),
      damp(p.z, this.desired.z, POSITION_LAMBDA, dt),
    )
    this.shakeShift.set(0, 0, 0)
    /*
     * 揺れは**カメラだけ**に乗せる。
     *
     * viewDir はこの手前で euler から出ているので (computeDesired)、ここへ
     * 足しても弾道は動かない。**衝撃で狙いまで狂わせない** — 反動 (recoilPitch)
     * は狙いごと動かす別の仕掛けで、あちらは撃った本人の代償として意図している。
     *
     * **正弦波では駄目だった。** 滑らかで周期的なので、叩かれたというより
     * 気味悪く漂って見える。刻みごとに引き直した値を繋いで不規則に震わせる。
     */
    this.shakeLeft = Math.max(0, this.shakeLeft - dt)
    if (this.shakeLeft > 0) {
      // 残り時間の 2 乗で減らす。**終わり際にすっと消える** — 線形だと
      // 止まる瞬間が見えて、揺れが「切れた」ように見える
      const fade = (this.shakeLeft / SHAKE_TIME) ** 2
      const amount = this.shakeAmount * fade
      this.shakeAge += dt
      const t = this.shakeAge * SHAKE_RATE
      this.shaken.set(
        this.euler.x + wobble(t, 1) * amount,
        this.euler.y + wobble(t, 2) * amount,
        this.euler.z + wobble(t, 3) * amount * 0.6,
      )
      this.camera.rotation.copy(this.shaken)

      /*
       * **位置も動かす。** 回すだけだと画角そのものは動かないので、
       * 覗いている先が揺れているように見えない。
       *
       * 視線に対して横と上へずらす。前後は動かさない — 寄ったり引いたりに
       * 見えて、揺れではなく画角が変わったように読める。
       */
      const yaw = this.euler.y
      const shift = amount * SHAKE_SHIFT
      const side = wobble(t, 4) * shift
      this.shakeShift.set(Math.cos(yaw) * side, wobble(t, 5) * shift, -Math.sin(yaw) * side)
      p.add(this.shakeShift)
      return
    }
    this.camera.rotation.copy(this.euler)
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** euler / viewDir / pivot / desired を現在の yaw・pitch とキャラ位置から更新する */
  private computeDesired(player: Soldier, world: CameraWorld | undefined, dt: number): void {
    const yaw = this.aimYaw
    this.euler.set(this.aimPitch, yaw, 0)
    this.viewDir.set(0, 0, -1).applyEuler(this.euler)

    // 肩オフセットは水平方向のみ (pitch で肩越しの左右がブレないように)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)
    const base = player.position
    /*
     * 足元の高さは**均してから使う**。
     *
     * 階段を上がると足元が 1 段ぶん (0.25m) 一気に飛ぶ。そのまま視点にすると、
     * 段のたびに画面が跳ねて狙えない。**大きく動いたときは追いつかせる** —
     * 落下や湧き直しまで均すと、落ちている間ずっと視点が遅れる。
     */
    if (Math.abs(base.y - this.footY) > STEP_SNAP) this.footY = base.y
    else this.footY = damp(this.footY, base.y, STEP_LAMBDA, dt)
    const footY = this.footY
    this.centerPivot.set(base.x, footY + this.currentViewHeight, base.z)
    this.pivot.set(
      base.x + rightX * this.shoulder,
      footY + this.currentViewHeight,
      base.z + rightZ * this.shoulder,
    )

    // 視線の逆方向へ distance だけ引いた位置がカメラの定位置。
    // 途中に壁があればそこまでしか引かない。
    this.back.copy(this.viewDir).negate()
    this.occludedDistance = this.resolveDistance(world, dt)
    this.desired.copy(this.pivot).addScaledVector(this.back, this.occludedDistance)
    if (this.desired.y < this.minY) this.desired.y = this.minY
  }

  /**
   * 遮蔽を考慮したカメラまでの距離。
   *
   * 2 本引く。1 本目は pivot (肩越しの注視点) から。ここは弾道の始点でもあるので、
   * 「カメラから見えているのに撃つと手前の壁に当たる」が起きない。
   *
   * 2 本目は肩オフセットを乗せない体の中心から。壁に右肩を付けると pivot 自体が
   * 壁の内側へ入り、面の裏からは当たらないので 1 本目がすり抜ける。
   * 中心から引けばその状況でも壁を捉えられる。
   */
  private resolveDistance(world: CameraWorld | undefined, dt: number): number {
    if (!world) return this.distance

    const blocked = Math.min(
      world.distanceToObstruction(this.pivot, this.back, this.distance),
      world.distanceToObstruction(this.centerPivot, this.back, this.distance),
    )
    const target =
      blocked >= this.distance
        ? this.distance
        : Math.max(MIN_OCCLUDED_DISTANCE, blocked - OCCLUSION_PADDING)

    // 寄るときは即座。遅らせると、遅れている間そのまま壁を突き抜けて見える。
    if (target <= this.occludedDistance) return target
    return dt > 0 ? damp(this.occludedDistance, target, OCCLUSION_RELEASE_LAMBDA, dt) : target
  }
}
