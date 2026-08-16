import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  dot,
  float,
  normalize,
  oneMinus,
  positionViewDirection,
  pow,
  saturate,
  transformedNormalView,
} from "three/tsl";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CharacterAnimator, findBoneBySuffix } from "./animation";
import type { Locomotion } from "../sim/locomotion";
import { loadSoldier } from "./assets";
import { WHOLE_BODY } from "../sim/stance";
import { weaponOf, type WeaponId } from "../sim/weapons";
import {
  advanceBoxLift,
  boxLift,
  createCardboardBox,
  disposeBox,
  placeBox,
} from "./box";
import { isMesh } from "./guards";
import {
  BACKSTAB_DOT,
  MAX_HEALTH,
  MELEE_CONE_COS,
  MELEE_RANGE,
  ROLL_HIT_RANGE,
  ROLL_KNOCKBACK,
  type HitZone,
} from "../sim/damage";
import { Footsteps, type Step } from "../sim/footsteps";
import { onBattlefield, type Life } from "../sim/lifecycle";
import { Hitbox } from "./hitbox";
import { dampAngle } from "./math";
import { Weapon } from "./weapon";
import {
  INTERPOLATION_DELAY,

  type PlayerSnapshot,
  type Team,
} from "../net/types";

/**
 * 所属を表す色。テクスチャに掛ける。
 *
 * 迷彩の上から色を乗せるので、遠くからでも所属が読める。ステルスの game で
 * 目立つ色を着せるのは矛盾しているようだが、**見つけた後に撃つかどうかを
 * 即断できる**ほうが大事。見つけること自体は音と視線が受け持っている。
 */
/**
 * 位置が途切れてから相手を隠すまでの下限 (秒)。
 *
 * 送る間隔 (1/64 秒) と補間の遅れ (0.1 秒) を足しても届かない長さにする。
 * 短すぎると、普通に見えている相手が通信のゆらぎで明滅する。
 */
const HIDE_AFTER = 0.35

/**
 * 隠すまでを、その相手から実際に届いている間隔の何倍まで伸ばすか。
 *
 * 固定の 0.35 秒だけで決めていたときに何が起きたか: 送るのが遅れがちな機械
 * (64Hz で送っているつもりでも数通/秒しか出ていない。裏に回ったタブは
 * ブラウザに 1 通/秒まで間引かれる) が相手だと、届く間隔が 0.35 秒に迫って
 * **見えたり消えたりを繰り返す**。こちらの回線が細いときも同じ。
 *
 * 「途切れた」は、その相手が普段どれだけの間隔で届いているかに対しての話で、
 * 絶対の秒数ではない。健全な相手 (50ms 間隔) なら 3 倍しても 150ms なので
 * 下限の 0.35 秒が効いたまま — 遮蔽に入った敵が消えるまでの速さは変わらない。
 */
const HIDE_SLACK = 3

/**
 * どれだけ間隔が開いていても、ここで隠す (秒)。
 *
 * 伸ばしすぎると、遮蔽に入った相手が居ない場所に立って見え続ける。
 * 撃てる (raycast は見えている相手だけを拾う) ので、そのぶん嘘の的が増える。
 */
const HIDE_LIMIT = 1.5

/**
 * 何秒過去を描くかを、届く間隔の何倍にするか。
 *
 * `INTERPOLATION_DELAY` は「相手が 64Hz で送ってくる」前提の値 (0.05 秒 = 3 通ぶん)。
 * 遅れている相手にはまったく足りない。**3 通/秒 の相手は間隔が 333ms あるので、
 * 50ms しか遡らないと狙った時刻が常に最新の位置より後ろになり、補間が一切効かない**
 * — 届いた位置にカクッと飛んで次が来るまで止まる。実際にそう見えた。
 *
 * 前後に 1 つずつ材料がある状態を保つには、間隔より長く遡る必要がある。
 */
const DELAY_SLACK = 1.5

/**
 * どれだけ遅れている相手でも、これ以上は過去を描かない (秒)。
 *
 * **サーバーが遡れる長さ (LAG_WINDOW = 0.4 秒) の内側に収める。** 描いている場所が
 * それより古いと、当てたと申告しても照合の窓から外れて却下される —
 * 「当てたのに何も起きない」になる。滑らかさより、当たることを採る。
 */
const DELAY_LIMIT = 0.25

/**
 * 届く間隔の目安を下げる速さ (1 通あたりの割合)。
 *
 * 上へは即座に、下へはゆっくり。回線が詰まって固まって届くと、束の中だけ見れば
 * 間隔は 1ms になる。そこに合わせて猶予を縮めると、束と束の間で消える。
 * 直近の**最悪の間隔**を覚えておいて、良くなったらゆっくり忘れる。
 */
const GAP_DECAY = 0.05

/**
 * 送り主の時計との差を、上へ戻す速さ (1 通あたりの割合)。
 *
 * 差は最小値で採るので、下へは即座に、上へはこの速さでしか動かない。
 * 一度でも短く届けばそれが真値に近い、という前提。時計は 1 日で数秒ずれる
 * 程度なので、上へ戻すのは極端に遅くてよい。
 */
const CLOCK_DRIFT = 0.002

const TEAM_TINT: Record<Team, number> = {
  blue: 0x88a8ff,
  red: 0xff9a86,
};

/**
 * 味方を壁越しに光らせる。
 *
 * 味方の位置はサーバーが無条件で配っている。隠すべきなのは敵に対してだけで、
 * 味方が見えないと連携のしようがない。ただ配られていても、壁の向こうに
 * 居れば深度で消える。だから描画のほうで前に出す。
 *
 * はっきり出すと「壁の中に人が立っている」に見えてしまう。出したいのは
 * 姿ではなく**気配**なので、輪郭だけを強く、中は薄く抜く。
 * 面がこちらを向くほど薄くなるので、輪郭に近いほど光が溜まる。
 */
/** 中の濃さ。形が分かる手前で止める */
const ALLY_GLOW_CORE = 0.06;
/** 輪郭の濃さ。ここが気配の本体 */
const ALLY_GLOW_RIM = 0.7;
/** 輪郭へ寄る速さ。大きいほど縁だけになる */
const ALLY_GLOW_FALLOFF = 2.4;

/** 味方の輪郭を出す色。所属の色より明るく振って、実物の陰と区別できるようにする */
const ALLY_GLOW_TINT: Record<Team, number> = {
  blue: 0x5c8cff,
  red: 0xff6a4a,
};
/** 向きが追いつく速さ。角度は補間より追従のほうが素直に見える */
const YAW_LAMBDA = 16;
/** 補間に使う状態を何個まで溜めるか。64Hz なので 0.3 秒分 */
const BUFFER_SIZE = 20;
/** モデルの正面 (+Z) を Player の基準 (-Z) に合わせる回転 */
const MODEL_YAW_OFFSET = Math.PI;

/** 頭から流し直す必要がある全身モーション。状態の遷移で検出する */

/**
 * 他のプレイヤー。受信した状態だけで動く。
 *
 * Player と違って入力も物理も持たない。移動アニメを速度から推定することもせず、
 * 送られてきた locomotion をそのまま再生する。推定は外れるうえ、送るほうが安い。
 *
 * 位置は「少し過去の状態」を 2 点間で補間して描く。届いた位置をそのまま入れると、
 * 受信した瞬間だけ飛んで、次が来るまで止まる。
 */
export class RemotePlayer {
  readonly id: string;
  readonly object = new THREE.Group();
  /** ボーンに追従する当たり判定。メッシュではなくこれを撃つ */
  readonly hitbox = new Hitbox();

  health = MAX_HEALTH;
  /** 画面に出す名前。スナップショットで届く */
  name = "";
  /** 最後に状態が届いた時刻。**こちらの** Date.now。隠すかどうかの判定に使う */
  lastSeen = 0;
  /**
   * 送り主の時計とこちらの時計の差 (ms)。届いた時刻から引いて求める。
   *
   * 最初の 1 通が来るまでは分からないので null。
   */
  private clockOffset: number | null = null;
  /** 直近で位置が届いていた間隔 (ms)。最悪の値を覚えて、良くなったら忘れる */
  private packetGap = 0;
  /** サーバーが「もう見えない」と言ってきたか。位置が来たら解ける */
  private hiddenByServer = false;
  /** サーバーが決めた状態。倒れているか / 戦場に居るかはこれで決まる */
  private life: Life = "joining";
  /** 所属。サーバーが決める。届くまでは赤として描く */
  private team: Team = "red";
  /** 色を掛ける対象。所属が変わっても掛け直せるよう控えておく */
  private readonly tinted: THREE.MeshStandardMaterial[] = [];
  /** 壁越しに見せる身体。敬礼を交わした味方にだけ出す */
  private readonly glow: THREE.SkinnedMesh[] = [];
  private ally = false;
  /** 敬礼を交わしたか。位置は届いていても、繋がるまでは映さない */
  private linked = false;
  /** 読み込んだ体。銃を差し替えるときに手ボーンを引き直すのに要る */
  private model: THREE.Object3D | null = null;
  /** いま持っている銃 */
  private weaponKind: WeaponId = 'rifle';
  /** 差し替えの最中。二重に走らせない */
  private swapping = false;
  /** 取り付けの基準。最初の 1 回で決めて、持ち替えでも使い回す */
  private attachRef: {
    matrix: THREE.Matrix4;
    right: THREE.Vector3;
    left: THREE.Vector3;
  } | null = null;
  /** いま敬礼で手を挙げているか。リンクの成立を見るのに使う */
  saluting = false;

  private animator: CharacterAnimator | null = null;
  private weapon: Weapon | null = null;
  private readonly box: THREE.Object3D;
  private boxed = false;
  /**
   * サーバーが「倒れている」と言っているか。
   *
   * 相手が送ってくる locomotion を待たない。倒された側のタブが裏に回っていると
   * 描画ループが止まり、死亡の姿勢を送り返してこない。権威が体力を持っているなら、
   * 倒れる見た目もそれに従わせるのが筋。
   */
  private serverDead = false;
  /** このフレームに吹き飛ばされたか。叫びを 1 回だけ鳴らすのに使う */
  sweptThisFrame = false;
  /** 箱の浮き上がり量 (m)。自機と同じ計算を同じアニメーションに対して行う */
  private lift = 0;
  private readonly buffer: PlayerSnapshot[] = [];
  private locomotion: Locomotion = "idle";
  /** 足音の勘定。自機と同じ式を、補間された位置に対して回す */
  private readonly footsteps = new Footsteps();
  /** 直前のリロード状態。始まった瞬間だけ型を流すのに使う */
  private reloading = false;
  /** このフレームにリロードを始めたか。音を鳴らすのは呼び出し側の仕事 */
  reloadStarted = false;
  /** 無敵の間は半透明にする。撃っても効かない相手だと見て分かるように */
  private ghost = false;
  private setGhost(on: boolean): void {
    if (this.ghost === on) return;
    this.ghost = on;
    for (const material of this.tinted) {
      material.transparent = on || material.userData.wasTransparent === true;
      material.opacity = on ? 0.35 : 1;
      material.needsUpdate = true;
    }
  }

  /**
   * 位置が届いている回数 (通/秒)。診断の表示に使う。
   *
   * **packetGap から割り出してはいけない。** あちらは「隠すまでの猶予」を
   * 決めるための推定器で、直近の**最悪の間隔**を覚えるようにしてある
   * (平均で切ると、たまの遅れで相手が消える)。悲観側に張り付くので、
   * 57 通/秒 届いていても 37 と出た。数えるなら素直に数える。
   */
  get packetRate(): number {
    const span = this.rateWindowFrom > 0 ? this.lastSeen - this.rateWindowFrom : 0;
    return span > 0 ? (this.rateCount * 1000) / span : 0;
  }

  /** 数えている窓の始まり (Date.now) と、その間に届いた数 */
  private rateWindowFrom = 0;
  private rateCount = 0;

  /** サーバーから「もう見えない」と届いた。次の位置が来るまで隠す */
  hide(): void {
    this.hiddenByServer = true;
  }

  /**
   * この相手を何秒過去で描くか (ms)。
   *
   * 64Hz で届いている相手は既定の 50ms のまま。遅れている相手ほど深く遡って、
   * 補間の材料が前後に揃うようにする。
   */
  get renderDelay(): number {
    return Math.min(
      DELAY_LIMIT * 1000,
      Math.max(INTERPOLATION_DELAY * 1000, this.packetGap * DELAY_SLACK),
    );
  }

  /**
   * 途切れたと見なすまでの猶予 (ms)。
   *
   * 相手ごとに変わる。64Hz で届いている相手なら下限の 0.35 秒のまま。
   * 3 通/秒しか出せていない相手には 1 秒近くまで伸びる — その人にとっては
   * 0.3 秒空くのが普通なので、そこで切ると見えたり消えたりになる。
   */
  get hideAfter(): number {
    return Math.min(
      HIDE_LIMIT * 1000,
      Math.max(HIDE_AFTER * 1000, this.packetGap * HIDE_SLACK),
    );
  }

  /**
   * 画面に出すかどうかを決める。
   *
   * 判断は 2 つある。**サーバーの知らせ**が本筋で、遮蔽に入った瞬間に消える。
   * **沈黙の長さ**はその保険で、相手が丸ごと落ちた (タブを閉じた、回線が切れた)
   * ときに立ち尽くしたまま残るのを防ぐ。
   *
   * 沈黙だけで決めていた頃は、この 2 つが混ざっていた。遅れて届いているだけの
   * 相手と、隠れた相手の区別が付かず、送るのが遅い機械が相手だと明滅した。
   */
  private refreshVisibility(now: number): void {
    const silence = this.lastSeen > 0 ? now - this.lastSeen : 0;
    this.setVisible(
      onBattlefield(this.life) && !this.hiddenByServer && silence < this.hideAfter,
    );
  }

  /** 湧き直しで跳んだことを足音に伝える。積算を捨てないと着いた先で連打になる */
  warp(x: number, z: number): void {
    this.footsteps.warp(x, z);
  }
  /** このフレームで踏んだ足音。Game が拾って鳴らす */
  step: Step | null = null;
  /** このフレームで転がり始めたか。同じく Game が拾う */
  rollStarted = false;
  private yaw = 0;
  private yawInitialized = false;
  private disposed = false;

  constructor(id: string, scene: THREE.Scene) {
    this.id = id;
    this.box = createCardboardBox();
    this.object.add(this.box);
    scene.add(this.object);
    void this.load();
  }

  /**
   * 受信した状態を溜める。順序が入れ替わって届いても時刻順に保つ。
   *
   * --- 時刻はこちらの時計に直してから入れる ---
   * snapshot.time は**送り主の Date.now()**、つまり別の機械の時計であって、
   * こちらの Date.now() と直に引き算してよいものではない。
   *
   * 直に引いていたときに何が起きたか: 相手の時計が 0.35 秒以上遅れていると、
   * 届いた瞬間から「途切れて久しい」判定になり、その人だけ**一度も画面に
   * 出てこない**。銃声は届く (音は別の道を通る) ので、姿の無い敵になる。
   * 逆に相手の時計が進んでいると、遮蔽に入って位置が止まっても消えない。
   * 同じ機械で 2 つ開いて試している限り時計は同一なので、絶対に出ない。
   *
   * 差は「いちばん速く届いた 1 通」がいちばん真値に近いので、観測した
   * 最小値を採る。時計は少しずつずれていくので、上へはゆっくり戻す。
   *
   * @param arrivedAt 届いた時刻 (こちらの Date.now)
   */
  push(snapshot: PlayerSnapshot, arrivedAt: number): void {
    const observed = arrivedAt - snapshot.time;
    if (this.clockOffset === null || observed < this.clockOffset) {
      this.clockOffset = observed;
    } else {
      this.clockOffset += (observed - this.clockOffset) * CLOCK_DRIFT;
    }

    // 届く間隔を覚える。途切れたと見なすまでの猶予をここから決める。
    //
    // 隠れていた間の空白は混ぜない。それは遮蔽に入っていた時間であって、
    // その相手が送る速さではない。HIDE_LIMIT で頭も打っておく —
    // サーバーが古くて hidden を送ってこない場合の保険
    if (this.lastSeen > 0 && !this.hiddenByServer) {
      const gap = arrivedAt - this.lastSeen;
      if (gap <= HIDE_LIMIT * 1000) {
        if (gap > this.packetGap) this.packetGap = gap;
        else this.packetGap += (gap - this.packetGap) * GAP_DECAY;
      }
    }

    // 届いた数を数える。1 秒ごとに窓を切り直す
    if (this.rateWindowFrom === 0 || arrivedAt - this.rateWindowFrom >= 1000) {
      this.rateWindowFrom = this.lastSeen > 0 ? this.lastSeen : arrivedAt;
      this.rateCount = 0;
    }
    this.rateCount++;

    // 位置が来たということは、また見えている
    this.hiddenByServer = false;
    this.lastSeen = arrivedAt;
    const stamped = { ...snapshot, time: snapshot.time + this.clockOffset };

    let index = this.buffer.length;
    while (index > 0 && this.buffer[index - 1].time > stamped.time) index--;
    this.buffer.splice(index, 0, stamped);
    while (this.buffer.length > BUFFER_SIZE) this.buffer.shift();
  }

  /**
   * @param now 現在時刻 (Date.now)。描くのはここから INTERPOLATION_DELAY だけ前
   */
  update(dt: number, now: number): void {
    this.refreshVisibility(now);

    const state = this.sampleAt(now - this.renderDelay);
    if (!state) return;

    this.setBoxed(state.boxed);
    this.object.position.set(state.x, state.y, state.z);
    if (!this.yawInitialized) {
      this.yaw = state.yaw;
      this.yawInitialized = true;
    }
    this.yaw = dampAngle(this.yaw, state.yaw, YAW_LAMBDA, dt);
    this.object.rotation.y = this.yaw;

    const animator = this.animator;
    if (!animator) return;

    // 倒れているかはサーバーが決める。送られてきた姿勢より優先する。
    const locomotion = this.serverDead ? "death" : state.locomotion;

    // 全身モーションは重みの補間では出せない。状態が切り替わった瞬間に頭から流す。
    this.rollStarted = false;
    this.sweptThisFrame = false;
    this.reloadStarted = false;
    if (locomotion !== this.locomotion && WHOLE_BODY.has(locomotion)) {
      if (locomotion === "roll") {
        animator.playRoll();
        this.rollStarted = true;
      } else if (locomotion === "stab") animator.playStab();
      else if (locomotion === "death") animator.playDeath();
      else if (locomotion === "salute") animator.playSalute();
      // 爆風で倒れる / 起き上がる。ここを書き忘れると着地モーションに落ちて、
      // 上半身がどこにも割り当たらず素の姿勢 (T ポーズ) が出る
      else if (locomotion === "sweep") {
        animator.playSweep();
        // 叫んだことを呼ぶ側へ伝える。音を鳴らすのは Game の仕事
        this.sweptThisFrame = true;
      }
      else if (locomotion === "stand") animator.playStand();
      // 接続が切れた人。ここを書き忘れると playLanding へ落ちる
      else if (locomotion === "away") animator.playAway();
      else animator.playLanding();
    }
    // 敬礼から抜けたら畳む。playSalute で入った状態は自分では戻らない
    if (this.locomotion === "salute" && locomotion !== "salute") {
      animator.cancelSalute();
    }
    this.locomotion = locomotion;

    // 足音は送られてこない。補間された位置と姿勢から、撃つ側と同じ式で出す。
    this.step = this.serverDead
      ? null
      : this.footsteps.update(state.x, state.z, locomotion, true);

    animator.setLocomotion(locomotion);
    // 敬礼を保っているかは送られてくる。再生位置は送らず、同じ規則で止める
    animator.setSaluteHeld(state.saluteHeld)
    this.saluting = locomotion === 'salute' && state.saluteHeld
    animator.setAiming(state.aiming && !this.serverDead);
    animator.setAimPitch(state.aiming && !this.serverDead ? state.pitch : 0);
    animator.update(dt);

    // 持ち替えに追従する。何を持っているかは位置と一緒に届いている
    void this.equip(state.weapon)

    // リロードは始まった瞬間だけ型を流す。状態として届くので、
    // 途中から見え始めた相手にも「いま撃てない」が伝わる
    if (state.reloading && !this.reloading) {
      animator.playReload();
      this.reloadStarted = true;
    }
    this.reloading = state.reloading;

    // 無敵の間は半透明。撃てない相手だと見て分かる必要がある
    this.setGhost(state.protectedNow)

    // 銃を隠す場面は自機と同じ規則で当てる。片方だけだと、自分では納めているのに
    // 相手の画面には出たままになる。
    //   敬礼中 / ダンボール … 手が塞がっている
    //   拳銃を構えていない  … ホルスターに納まっている
    const holstered =
      this.boxed ||
      locomotion === 'salute' ||
      (state.weapon === 'pistol' && !state.aiming && !state.reloading)
    if (this.weapon) this.weapon.visible = !holstered

    this.object.updateMatrixWorld(true);

    // 箱の浮きは受信せず、同じアニメーションから同じ式で出す。
    // 姿勢は locomotion で共有しているので結果は一致し、送る量も増えない。
    const head = animator.headHeight();
    if (head !== null) {
      this.lift = advanceBoxLift(this.lift, this.boxed ? boxLift(head) : 0, dt);
      placeBox(this.box, this.lift);
    }
  }

  /**
   * 箱の出し入れ。見た目だけを切り替える。
   *
   * 箱は当たり判定を持たない。中のキャラはしゃがんだまま存在していて、
   * その頭も胴も普段どおり撃てる。段ボールは身を隠す道具であって、
   * 弾を止める盾ではない。
   *
   * キャラのモデルも消さない。箱が上から被さって見えなくなるだけなので
   * 消す必要がなく、消さないほうが姿勢と判定の食い違いも起きない。
   */
  private setBoxed(boxed: boolean): void {
    if (boxed === this.boxed) return;
    this.boxed = boxed;
    this.box.visible = boxed;
    this.animator?.setBoxed(boxed);
    // 箱の中では武器を出さない
    if (this.weapon) this.weapon.visible = !boxed;
  }

  /**
   * 姿を出す / 隠す。
   *
   * サーバーが見えている相手にしか位置を配らないので、遮蔽に入った相手は
   * 位置が止まる。止まった場所に立たせたままにすると、そこに居ない相手が
   * 見えていることになる。
   */
  setVisible(visible: boolean): void {
    this.object.visible = visible
  }

  /** 同じ陣営か。撃つ前ではなく、当ててしまった後の表示に使う */
  isAlly(team: Team): boolean {
    return this.team === team;
  }

  /**
   * 味方として扱うか。壁越しの発光を出し入れする。
   *
   * 誰が味方かは自分の所属が分かって初めて決まるので、外から知らせてもらう。
   */
  setAlly(ally: boolean): void {
    this.ally = ally;
    this.applyGlow();
    this.applyGlowTint();
  }

  /** 敬礼を交わした。以後この相手は壁越しに見える */
  setLinked(linked: boolean): void {
    this.linked = linked;
    this.applyGlow();
  }

  get isLinked(): boolean {
    return this.linked;
  }

  private applyGlow(): void {
    const on = this.ally && this.linked;
    for (const mesh of this.glow) mesh.visible = on;
  }

  private applyGlowTint(): void {
    const color = new THREE.Color(ALLY_GLOW_TINT[this.team]);
    for (const mesh of this.glow) {
      (mesh.material as MeshBasicNodeMaterial).color.copy(color);
    }
  }

  /**
   * 壁越しに見える身体を重ねる。
   *
   * 元のメッシュと骨格を共有するので、動きは勝手に付いてくる。深度を見ない
   * 材質にして最後に描くことで、間に何があっても前に出る。
   */
  private buildGlow(model: THREE.Object3D): void {
    const sources: THREE.SkinnedMesh[] = [];
    model.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) sources.push(obj as THREE.SkinnedMesh);
    });

    for (const source of sources) {
      const material = new MeshBasicNodeMaterial({
        color: ALLY_GLOW_TINT[this.team],
        transparent: true,
        // 深度を見ない = 壁の向こうでも前に出る
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        // 足し算で重ねる。奥の面と手前の面が重なった所ほど濃くなり、
        // 体の厚みがそのまま滲みになる
        blending: THREE.AdditiveBlending,
      });

      // 面がこちらを正面に向けているほど薄い。輪郭へ向かって濃くなる
      const facing = abs(dot(normalize(transformedNormalView), positionViewDirection));
      material.opacityNode = float(ALLY_GLOW_CORE).add(
        pow(oneMinus(saturate(facing)), ALLY_GLOW_FALLOFF).mul(ALLY_GLOW_RIM),
      );
      const glow = new THREE.SkinnedMesh(source.geometry, material);
      glow.bind(source.skeleton, source.bindMatrix);
      glow.frustumCulled = false;
      glow.castShadow = false;
      glow.receiveShadow = false;
      // 何より後に描く。手前に出すのが目的なので順番が要る
      glow.renderOrder = 999;
      glow.visible = this.ally && this.linked;
      source.parent?.add(glow);
      this.glow.push(glow);
    }
  }

  /** 所属を反映する。色を掛け直す */
  setTeam(team: Team): void {
    this.team = team
    this.applyTint()
    this.applyGlowTint()
  }

  /**
   * 所属の色を掛ける。
   *
   * 元の色を控えておいて毎回そこから掛け直す。掛かった色にさらに掛けると、
   * 所属が変わるたびに濁っていく。
   */
  private applyTint(): void {
    const tint = new THREE.Color(TEAM_TINT[this.team])
    for (const material of this.tinted) {
      const base = material.userData.baseColor as THREE.Color | undefined
      if (base) material.color.copy(base).multiply(tint)
    }
  }

  /** 撃った。ボルト操作のある銃なら動作を流す */
  playShot(): void {
    if (weaponOf(this.weaponKind).bolt) this.animator?.playBolt();
  }

  /** 排莢口のワールド座標。銃がまだ付いていなければ null */
  ejectPort(out: THREE.Vector3): THREE.Vector3 | null {
    return this.weapon ? this.weapon.ejectWorld(out) : null;
  }

  /** 持っている銃 */
  get equipped(): WeaponId {
    return this.weaponKind;
  }

  /** 怯ませる。上半身だけ跳ねるので走っている脚は止まらない */
  flinch(): void {
    this.animator?.playHit();
  }

  /**
   * サーバーが確定させた体力を反映する。
   *
   * 倒れる / 起き上がるは体力ではなく**状態**が決める (setLife)。ここは
   * 数字を控えるだけ。体力から生死を導いていた頃は、状態と導出結果が
   * 食い違い得る場所が 2 つあった。
   */
  applyHealth(health: number): void {
    this.health = health;
  }

  /**
   * サーバーが状態を移した。
   *
   * 倒れる姿勢も、戦場に居るかどうかも全部ここから出す。
   * @returns 倒れた瞬間なら true (叫びを鳴らすのは呼び出し側の仕事)
   */
  setLife(state: Life): boolean {
    if (this.life === state) return false;
    this.life = state;

    const dead = state === "downed";
    if (dead !== this.serverDead) {
      this.serverDead = dead;
      if (dead) this.animator?.playDeath();
      else this.animator?.revive();
    }
    // 戦場に居ないなら消す。支度中の相手が倒れた場所に立っていることになる
    if (!onBattlefield(state)) this.hiddenByServer = true;
    return dead;
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.animator = null;
    this.weapon?.dispose();
    this.weapon = null;
    disposeBox(this.box);
    this.object.removeFromParent();
  }

  /**
   * 指定時刻の状態を作る。前後 2 つの状態を線形補間する。
   * 溜まっていなければ最も近いものをそのまま返す。
   */
  private sampleAt(time: number): PlayerSnapshot | null {
    const buffer = this.buffer;
    if (buffer.length === 0) return null;
    if (buffer.length === 1) return buffer[0];

    for (let i = buffer.length - 1; i > 0; i--) {
      const after = buffer[i];
      const before = buffer[i - 1];
      if (before.time <= time && time <= after.time) {
        const span = after.time - before.time;
        const alpha = span > 0 ? (time - before.time) / span : 0;
        return {
          ...after,
          x: before.x + (after.x - before.x) * alpha,
          y: before.y + (after.y - before.y) * alpha,
          z: before.z + (after.z - before.z) * alpha,
          pitch: before.pitch + (after.pitch - before.pitch) * alpha,
          // yaw は補間しない。dampAngle 側で追従させる (境界をまたぐ角度の補間は回りすぎる)
          yaw: after.yaw,
          // 状態は補間できない。手前のものを使う (先の状態を先取りしない)
          locomotion: before.locomotion,
          aiming: before.aiming,
          crouching: before.crouching,
          boxed: before.boxed,
          saluteHeld: before.saluteHeld,
        };
      }
    }

    // 目標時刻が範囲外。まだ届いていないなら最新、古すぎるなら最古。
    return time > buffer[buffer.length - 1].time
      ? buffer[buffer.length - 1]
      : buffer[0];
  }

  private async load(): Promise<void> {
    let gltf;
    try {
      gltf = await loadSoldier();
    } catch (error) {
      console.error("[RemotePlayer] 兵士モデルの読み込みに失敗", error);
      return;
    }
    if (this.disposed) return;

    const model = cloneSkinned(gltf.scene);
    model.rotation.y = MODEL_YAW_OFFSET;

    // 元のマテリアルは自機と共有しているので、複製してから色を掛ける
    const tinted = new Map<THREE.Material, THREE.Material>();
    model.traverse((obj) => {
      if (!isMesh(obj)) return;
      obj.castShadow = true;
      // スキニング後の姿勢はバウンディングボックスに出ないので視錐台カリングを切る
      obj.frustumCulled = false;
      obj.material = tintMaterial(obj.material, tinted, this.tinted);
    });
    this.applyTint();
    this.buildGlow(model);

    this.object.add(model);
    this.hitbox.bind(model);
    // 移動速度は再生速度の補正に使うだけ。送る側と同じ値にしておく。
    this.animator = new CharacterAnimator(
      model,
      gltf.animations,
      REMOTE_MOVE_SPEED,
    );
    // モデルが届く前に状態が変わっていた場合を拾う
    this.animator.setBoxed(this.boxed);
    if (this.serverDead) this.animator.playDeath();

    this.model = model;
    await this.attachWeapon(model);
  }

  /**
   * 相手が持ち替えたら、こちらのモデルも差し替える。
   *
   * 何を持っているかは位置と一緒に届いている。見た目が古いままだと、
   * 狙撃銃を構えている相手が突撃銃に見えて、間合いの判断を誤る。
   *
   * 読み込みは共有のキャッシュに乗るので、2 回目以降は待ち時間が出ない。
   */
  private async equip(kind: WeaponId): Promise<void> {
    if (kind === this.weaponKind || this.swapping) return;
    this.weaponKind = kind
    this.animator?.setPistol(kind === 'pistol');
    const model = this.model;
    if (!model) return;

    this.swapping = true;
    try {
      const old = this.weapon;
      this.weapon = null;
      old?.dispose();
      await this.attachWeapon(model, kind);
    } finally {
      this.swapping = false;
    }
  }

  private async attachWeapon(
    model: THREE.Object3D,
    kind: WeaponId = this.weaponKind,
  ): Promise<void> {
    let weapon: Weapon;
    try {
      weapon = await Weapon.load(kind);
    } catch (error) {
      console.error("[RemotePlayer] 武器の読み込みに失敗", error);
      return;
    }
    if (this.disposed) {
      weapon.dispose();
      return;
    }

    // バインドポーズのままだと基準がずれるので、構えを 1 フレーム分適用する
    this.animator?.update(0);
    this.object.updateMatrixWorld(true);

    const rightHand = findBoneBySuffix(model, "RightHand");
    const leftHand = findBoneBySuffix(model, "LeftHand");
    if (!rightHand || !leftHand) {
      weapon.dispose();
      return;
    }

    // 基準は最初の 1 回だけ決める。持ち替えのたびに取り直すと、
    // そのときの姿勢 (しゃがみ・構え) が基準になって銃の向きがずれる
    if (!this.attachRef) {
      this.attachRef = {
        matrix: rightHand.matrixWorld.clone(),
        right: new THREE.Vector3().setFromMatrixPosition(rightHand.matrixWorld),
        left: new THREE.Vector3().setFromMatrixPosition(leftHand.matrixWorld),
      };
    }
    const ref = this.attachRef;
    weapon.attachTo(rightHand, ref.right, ref.left, ref.matrix);
    this.weapon = weapon;
  }
}

/** アニメの再生速度補正に使う基準速度 (m/s)。Player の MOVE_SPEED と揃えてある */
const REMOTE_MOVE_SPEED = 3.8;

/**
 * 他プレイヤーの集合。参加・退出とタイムアウトを面倒みる。
 *
 * 射線の判定・近接・体当たりをまとめて受け持つ。相手の位置と骨格を持っているのが
 * ここだけなので、判定もここに置く。
 */
/** 名簿で先に届いたが、まだ実体の無い相手の情報 */
interface Pending {
  name?: string;
  team?: Team;
  health?: number;
  life?: Life;
}

export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly players = new Map<string, RemotePlayer>();
  /**
   * 位置が届く前に知らされたこと。
   *
   * 名簿は入室した瞬間に届くが、相手の実体は最初の位置が届いて初めて作られる。
   * その間に来た所属や名前を捨てると、既定値のまま残る。
   */
  private readonly pending = new Map<string, Pending>();
  /**
   * 自分の所属。誰が味方かはこれが分かって初めて決まる。
   *
   * 名簿が届くまでは分からないので、それまでは誰も味方として光らせない。
   * 敵を味方として光らせるほうが、味方が光らないより害が大きい。
   */
  private selfTeam: Team | null = null;
  private readonly scratch = new THREE.Vector3();
  private readonly victimForward = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.players.size;
  }

  /** 走査用。足音のように毎フレーム全員を見るものが使う */
  get all(): Iterable<RemotePlayer> {
    return this.players.values();
  }

  /**
   * 状態を受け取る。知らない ID なら参加とみなして作る。
   *
   * @param arrivedAt 届いた時刻 (こちらの Date.now)。既定は今
   */
  receive(snapshot: PlayerSnapshot, arrivedAt = Date.now()): void {
    let player = this.players.get(snapshot.id);
    if (!player) {
      player = new RemotePlayer(snapshot.id, this.scene);
      this.players.set(snapshot.id, player);

      // 名簿で先に届いていた情報を反映する。
      // 入室直後に届く名簿の時点では、まだ相手の実体が無い (位置が届いて
      // 初めて作られる) ので、そのまま捨てると所属も名前も既定のままになる。
      // 所属が既定のままだと、敵を撃っても味方判定になる。
      const known = this.pending.get(snapshot.id);
      if (known) {
        if (known.name !== undefined) player.name = known.name;
        if (known.team !== undefined) player.setTeam(known.team);
        if (known.health !== undefined) player.applyHealth(known.health);
        if (known.life !== undefined) player.setLife(known.life);
        this.pending.delete(snapshot.id);
      }
      this.refreshAlly(player);
    }
    player.push(snapshot, arrivedAt);
  }

  /** まだ実体の無い相手の情報を控える。位置が届いて作られたときに反映する */
  private remember(id: string, info: Partial<Pending>): void {
    this.pending.set(id, { ...this.pending.get(id), ...info });
  }

  remove(id: string): void {
    this.pending.delete(id);
    const player = this.players.get(id);
    if (!player) return;
    player.dispose();
    this.players.delete(id);
  }

  /**
   * 隠れた相手も**消さずに残す**。
   *
   * 消すと所属も名前も失われ、出てきた瞬間に陣営の色が分からない別人として
   * 現れる。かといって止まった場所に立たせたままにもしない。そこに居ない相手が
   * 見えていることになる。最後に見えた位置は、こちらの頭の中にだけ残ればよい。
   *
   * 出す / 出さないの判断は RemotePlayer が持つ (refreshVisibility)。
   */
  update(dt: number, now: number): void {
    for (const player of this.players.values()) player.update(dt, now);
  }

  /**
   * 相手ごとに、位置が届いている回数 (通/秒)。診断の表示に使う。
   *
   * ここが 64 を大きく下回っている相手は、**その人の機械が送れていない**。
   * こちらの画面ではその人がカクつくが、直せるのは相手側だけ。
   */
  rates(): { name: string; rate: number }[] {
    const out: { name: string; rate: number }[] = [];
    for (const player of this.players.values()) {
      if (player.packetRate <= 0) continue;
      out.push({ name: player.name, rate: player.packetRate });
    }
    return out.sort((a, b) => a.rate - b.rate);
  }

  /** サーバーが「もう見えない」と言ってきた。位置が止まるのを待たずに消す */
  hide(id: string): void {
    this.players.get(id)?.hide();
  }

  /** 退出。サーバーが配る leave で消える */
  leave(id: string): void {
    this.remove(id);
  }

  /**
   * 湧き直した。跳んだ距離を足音に積ませない。
   *
   * 積むと、湧いた相手の足音が着いた先で連打される。update 側でも
   * 距離で弾いているが、知らせを受けられる場面では受けたほうが確実。
   */
  warp(id: string): void {
    const player = this.players.get(id);
    if (player) player.warp(player.object.position.x, player.object.position.z);
  }

  /**
   * 射線に当たる相手を探す。最も手前の 1 人だけを返す。
   *
   * @param maxDistance 地形に遮られるまでの距離。壁の向こうの相手に当てないため
   */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDistance: number,
  ): { player: RemotePlayer; zone: HitZone; distance: number } | null {
    let best: { player: RemotePlayer; zone: HitZone; distance: number } | null =
      null;
    for (const player of this.players.values()) {
      if (player.health <= 0) continue;
      // 見えていない相手は撃てない。位置が古いので、当てても居ない場所を撃っている
      if (!player.object.visible) continue;
      const hit = player.hitbox.raycast(
        origin,
        dir,
        best ? best.distance : maxDistance,
      );
      if (hit && (!best || hit.distance < best.distance)) {
        best = { player, zone: hit.zone, distance: hit.distance };
      }
    }
    return best;
  }

  /**
   * ナイフの判定。射線ではなく「前方の扇形に入っているか」で決める。
   *
   * 弾のような raycast にしないのは、近接は当たり判定の精度より
   * 「間合いを取れているか」がゲームとして重要な部分だから。
   *
   * @param origin 攻撃者の位置
   * @param forward 攻撃者の向き (正規化済み)
   */
  hitMelee(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    team: Team,
  ): { id: string; fromBehind: boolean; distance: number; friendly: boolean } | null {
    let closest: { player: RemotePlayer; distance: number } | null = null;

    for (const player of this.players.values()) {
      if (player.health <= 0) continue;
      this.scratch.subVectors(player.object.position, origin);
      this.scratch.y = 0;
      const distance = this.scratch.length();
      if (distance > MELEE_RANGE || distance < 1e-4) continue;
      this.scratch.divideScalar(distance);
      if (this.scratch.dot(forward) < MELEE_CONE_COS) continue;
      if (!closest || distance < closest.distance)
        closest = { player, distance };
    }
    if (!closest) return null;

    // 被害者の正面。object は Player と同じ規約で「ローカル -Z が前」。
    // モデルの正面が +Z である分の 180° は子のモデル側で吸っているので、
    // ここで +Z を使うと背中の向きが取れて背後判定が丸ごと裏返る。
    this.victimForward
      .set(0, 0, -1)
      .applyQuaternion(closest.player.object.quaternion);
    this.victimForward.y = 0;
    this.victimForward.normalize();

    // ダメージは入れない。体力を持っているのはサーバーなので、
    // ここは「誰にどう当たったか」を返すだけ。
    return {
      id: closest.player.id,
      fromBehind: this.victimForward.dot(forward) > BACKSTAB_DOT,
      distance: closest.distance,
      friendly: closest.player.isAlly(team),
    };
  }

  /**
   * ローリングの体当たり。ダメージは入れず、押しのける向きと量を返す。
   *
   * ここで相手を動かさないのは、位置の権利が相手側にあるから。
   * 呼んだ側が結果を送り、押される側が自分で適用する。
   *
   * @param origin 転がっている側の位置
   * @param exclude 既に当てた相手。1 回のローリングで同じ相手を何度も弾かない
   */
  rollInto(
    origin: THREE.Vector3,
    exclude: Set<string>,
  ): { id: string; x: number; z: number }[] {
    const knocks: { id: string; x: number; z: number }[] = [];

    for (const player of this.players.values()) {
      if (player.health <= 0 || exclude.has(player.id)) continue;

      this.scratch.subVectors(player.object.position, origin);
      this.scratch.y = 0;
      const distance = this.scratch.length();
      if (distance > ROLL_HIT_RANGE || distance < 1e-4) continue;

      exclude.add(player.id);
      // ぶつかった方向へ押しのける
      this.scratch.divideScalar(distance);
      knocks.push({
        id: player.id,
        x: this.scratch.x * ROLL_KNOCKBACK,
        z: this.scratch.z * ROLL_KNOCKBACK,
      });
    }

    return knocks;
  }

  /** 指定の相手を怯ませる。誰の画面でも同じように見えるよう、撃った本人以外も呼ぶ */
  flinch(id: string): void {
    this.players.get(id)?.flinch();
  }

  /** サーバーが確定させた体力を控える。倒れる表示は setLife が持つ */
  setHealth(id: string, health: number): void {
    const player = this.players.get(id);
    if (!player) this.remember(id, { health });
    else player.applyHealth(health);
  }

  /** 撃った相手にボルト操作を流す。撃った音もその銃のものにする */
  shot(id: string): WeaponId {
    const player = this.players.get(id);
    player?.playShot();
    return player?.equipped ?? 'rifle';
  }

  /**
   * 排莢口の位置と体の向き。撃った合図を受けて薬莢を出すのに使う。
   *
   * まだ銃が付いていない (読み込み中) なら null。
   */
  ejectFrom(id: string, out: THREE.Vector3): number | null {
    const player = this.players.get(id);
    if (!player || !player.ejectPort(out)) return null;
    return player.object.rotation.y;
  }

  /** 今いる場所。倒れていなくても音を鳴らす先が要るとき用 */
  positionOf(id: string): THREE.Vector3 | null {
    return this.players.get(id)?.object.position ?? null;
  }

  /** 所属を控える。参加時と名簿で届く */
  setTeam(id: string, team: Team): void {
    const player = this.players.get(id);
    if (player) {
      player.setTeam(team);
      this.refreshAlly(player);
    } else this.remember(id, { team });
  }

  /**
   * 自分の所属を知らせる。味方を壁越しに光らせるのに要る。
   *
   * 味方の位置はサーバーが無条件で配っているが、配られているだけでは
   * 壁の向こうで深度に消える。前に出すのは描画側の仕事。
   */
  setSelfTeam(team: Team): void {
    this.selfTeam = team;
    for (const player of this.players.values()) this.refreshAlly(player);
  }

  private refreshAlly(player: RemotePlayer): void {
    player.setAlly(this.selfTeam !== null && player.isAlly(this.selfTeam));
  }

  /**
   * 敬礼を交わした味方を探す。
   *
   * 味方の位置はサーバーが配っているが、既定では映さない。**互いに敬礼して
   * 初めて繋がる。** 味方が全員最初から見えていると、探すことも合流することも
   * 手続きでなくなる。手を挙げて返してもらう、という一手間が入るだけで、
   * 「誰と組んでいるか」が自分で選んだものになる。
   *
   * @param saluting 自分が手を挙げているか
   * @returns 新しく繋がった相手の名前
   */
  linkSaluting(
    saluting: boolean,
    origin: THREE.Vector3,
    range: number,
    team: Team | null,
  ): string[] {
    if (!saluting || team === null) return [];

    const formed: string[] = [];
    for (const player of this.players.values()) {
      if (player.isLinked || !player.isAlly(team) || !player.saluting) continue;
      if (player.object.position.distanceTo(origin) > range) continue;
      player.setLinked(true);
      formed.push(player.name);
    }
    return formed;
  }

  /** 繋がりを断つ。倒れたら結び直し */
  clearLinks(): void {
    for (const player of this.players.values()) player.setLinked(false);
  }

  /** 名前を控える。参加時と名簿でまとめて届く */
  setName(id: string, name: string): void {
    const player = this.players.get(id);
    if (player) player.name = name;
    else this.remember(id, { name });
  }

  /**
   * サーバーが決めた状態を渡す。
   *
   * @returns 倒れた瞬間なら、その位置 (叫ぶのに使う)
   */
  setLife(id: string, state: Life): THREE.Vector3 | null {
    const player = this.players.get(id);
    if (!player) {
      this.remember(id, { life: state });
      return null;
    }
    return player.setLife(state) ? player.object.position : null;
  }

  dispose(): void {
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
  }
}

/**
 * 元のマテリアルを壊さないよう複製する。色そのものは applyTint が掛ける。
 * 掛ける前の色を userData に控えて、所属が変わっても掛け直せるようにしておく。
 */
function tintMaterial(
  material: THREE.Material | THREE.Material[],
  cache: Map<THREE.Material, THREE.Material>,
  out: THREE.MeshStandardMaterial[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((m) => tintMaterial(m, cache, out) as THREE.Material);
  }

  const existing = cache.get(material);
  if (existing) return existing;

  const copy = material.clone() as THREE.MeshStandardMaterial;
  if (copy.color instanceof THREE.Color) {
    copy.userData.baseColor = copy.color.clone();
    out.push(copy);
  }
  cache.set(material, copy);
  return copy;
}
