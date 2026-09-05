import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { FollowCamera, type CameraWorld } from "./sense/camera";
import { isMesh } from "./util/guards";
import { Input } from "../../infra/input";
import { Soldier, PLAYER_HEIGHT, PLAYER_RADIUS, type PlayerWorld } from "./actor/soldier";
import { Shots } from "./fx/shots";
import { Spread } from "../../domain/item/spread";
import { STAGES, surfaceOf, waterOf, type StageName } from "../../domain/stage";
import {
  canChooseSkills,
  masteryReloadScale,
  masteryRecoveryScale,
  type SkillId,
  type Skills,
} from "../../domain/player/skill";
import { throwSpeedOf } from "../../domain/item/grenade";
import { pelletsOf } from "../../domain/item/weapons";
import type { Stance } from "../../domain/player/stance";
import { offsetInCone } from "../../sim/space/aim";
import {
  ARENA_HALF_SIZE,
  buildLights,
  buildBases,
  buildStage,
  STAGE_CODE,
  loadStageBoxes,
  type Stage,
} from "./world/stage";
import { solidBlockers, type StageBox } from "../../sim/space/vision";
import {
  ceilingHeight,
  clampToArena,
  groundHeight,
  resolveCircle,
  surfaceAt,
} from "../../sim/space/collision";
import { GameAudio, type SoundToken } from "./sense/audio";
import type { Step } from "../../domain/rule/footsteps";
import { SoundRing, type PingKind } from "./sense/soundRing";
import { ThrownItems } from "./arms/thrown";
import { Grenades } from "./arms/grenades";
import { Claymores } from "./arms/claymores";
import { BlastFx } from "./fx/blastfx";
import { Casings } from "./fx/casings";
import { Drops } from "./arms/drops";
import { BOX_BUMP_RANGE, fallDamage, MAX_HEALTH } from "../../domain/rule/damage";
import { IDLE_EXIT_SPEED } from "./actor/motion";
import {
  canAct,
  canChoose,
  CHOOSE_FLOOR,
  CHOOSE_TIMEOUT,
  isDowned,
  isSpawning,
  type Life,
} from "../../domain/player/lifecycle";
import { CHOICES, SUPPORTS, roundsPerDecoy, type SupportId, type WeaponId } from "../../domain/item/weapons";
import { Inventory } from "../../domain/item/inventory";
import type { Intent } from "../../domain/player/intent";
import { isGun, type HeldId } from "../../domain/item/held";
import {
  MODES,
  ROOMS,
  isHostile,
  isRoomName,
  primariesOf,
  secondaryOf,
} from "../../domain/match/room";
import { RemoteSoldiers, type RemoteSoldier } from "./actor/remoteSoldier";
import type { HitZone } from "../../domain/rule/damage";
import type { NoiseEvent } from "../../application/protocol/types";
import { weaponOf } from "../../domain/item/weapons";
import { STEP_UP } from "../../domain/player/moving";
import {
  bulletOffset,
  flightTime,
  TRAJECTORY_STEPS,
} from "../../sim/judge/bullet";
import { createTransport } from "../../infra/link";
import {
  applyMatch,
  newMatchReplica,
  type MatchEffect,
} from "../../application/replica/match";
import {
  applyRoster,
  newRoster,
  type RosterEffect,
} from "../../application/replica/roster";
import { applySelf, driftOf, newSelfReplica } from "../../application/replica/self";
import {
  createCalibration,
  defaultKnobs,
  type Calibration,
  type Knobs,
} from "./calibration";
import type { NetTransport } from "../../application/protocol/types";
import type { Identity } from "../../infra/auth/session";
import { selfSkin } from "./actor/skin";
import {
  SNAPSHOT_INTERVAL,
  type HealthMessage,
  type MatchPhase,
  type SelfMessage,
  type KillEvent,
  type MatchMessage,
  type ServerMessage,
  type Team,
} from "../../application/protocol/types";
import { MAX_STAMINA, staminaBlur, staminaSwayScale } from "../../domain/player/stamina";

/** HUD へ渡す状態。Three.js 側からこれだけを Solid の signal に流す */
export interface GameStats {
  stage: string;
  /**
   * いま描いている裏側。'WebGPU' か 'WebGL2'。
   *
   * WebGPU が無い環境では three が黙って WebGL2 に落ちる。黙って落ちるのは
   * 動かし続けるには正しいが、どちらで走っているのか分からないままだと、
   * 速い / 遅いの原因を取り違える。
   */
  backend: string;
  fps: number;
  x: number;
  z: number;
  speed: number;
  /** ポインタロック中か。false ならクロスヘアを隠して操作説明を出す */
  locked: boolean;
  shots: number;
  ammo: number;
  magazine: number;
  /** 弾倉の外に残っている弾 */
  reserve: number;
  reloading: boolean;
  /** 転んでいて、まだ起き上がれるか */
  downed: boolean;
  /** 構えているか。クロスヘアはこのときだけ出す */
  aiming: boolean;
  /** 現在の散布界 (度)。クロスヘアの開き具合に使う */
  spread: number;
  /** その部屋で選べる主武器。**部屋が絞ることがある** */
  primaries: readonly WeaponId[];
  /**
   * 次に湧いたときの主武器。**選ばれている物。**
   *
   * 画面側で信号に持たせていた頃、初期値が 'rifle' で固定されていた。狙撃銃
   * だけの部屋では**どれも選ばれていない**状態で開く (一覧に rifle が無いので
   * どの札にも印が付かない)。選んでいる物を知っているのはこちら。
   */
  primary: WeaponId | null;
  /** 副武器。**部屋が外していれば null** */
  secondary: WeaponId | null;
  /**
   * 粒が散る角度 (度)。散弾でなければ 0。
   *
   * **0 でなければクロスヘアが輪になる。** 十字は「その一点へ 1 発飛ぶ」の形で、
   * 8 粒に分かれる銃に出すと狙った点へ集まるように読めてしまう。
   *
   * 輪の大きさは**狙いの散布に粒の散りを足した幅**。粒がどこまで飛び散るかを
   * そのまま出すので、間合いの外では輪が画面を覆うほど大きくなる。
   */
  pelletSpread: number;
  /** しゃがんでいるか */
  crouching: boolean;
  /**
   * いまの構え。**旗ではなく構えそのもの。**
   *
   * 伏せは屈みの旗も立てている (低い姿勢としての扱いが要る) ので、旗を
   * 読むと CROUCH に見える。頭の高さも当たり判定も構えのほうで決まって
   * いるので、見せる値もそちらから引く。
   */
  stance: Stance;
  /** 直近に当てた部位。空文字なら表示しない */
  hitZone: string;
  /** その命中が麻酔だったか。**青で出す** */
  hitTranq: boolean;
  /** 敬礼で繋がったばかりの味方 */
  links: string[];
  /** 成績表を開いているか */
  menuOpen: boolean;
  /** 装備の画面を開いているか */
  loadoutOpen: boolean;
  /** 装備の画面が自動で閉じるまで (秒) */
  loadoutLeft: number;
  /** OK が効くようになるまで (秒)。0 なら押せる */
  loadoutWait: number;
  /**
   * いま効いているスキル。**サーバーが決める。**
   *
   * 選んだ物をそのまま出さないのは、途中参加した人が自分で選んでいないため —
   * 前回の選択を DB から持ってくるので、返ってきた物だけが正しい。
   */
  skills: Skills;
  /** スキルを選び直せるか。**試合が始まったら閉じる** */
  skillsOpen: boolean;
  /** スコープを覗いているか。覗いている間は専用の表示にする */
  scoped: boolean;
  /** いま持っている銃。調整パネルが追従する */
  equipped: WeaponId;
  /** 覗いている倍率。空なら覗いていない */
  zoom: string;
  /** ホイールで覗ける状態か。案内を出すのに使う */
  canZoom: boolean;
  /** 部屋に居る全員の戦績。サーバーが 1 秒ごとに配る */
  scores: MatchMessage["players"];
  /**
   * 直近の点の増減。**自分の分だけ。**
   *
   * 倒した / 倒された瞬間に右下へ出す。誰が誰を倒したかの一覧 (kills) とは別で、
   * こちらは自分に何が起きたかだけを短く見せる。
   */
  points: { label: string; delta: number; at: number }[]
  /** 近くに落ちている武器がある。**押せば拾える**という案内を出す */
  canPickUp: boolean
  /** 自分が光っている (個人戦の 1 位)。位置が全員に漏れている */
  leaking: boolean
  /** 直近のキル表示。新しいものが先頭 */
  kills: KillEvent[]
  /** 残っている投げ物 */
  throwables: number
  /** 手榴弾の残り */
  grenades: number
  /** 投擲の枠に何を入れているか */
  support: SupportId
  /** 開いている持ち替えの一覧。閉じていれば null */
  browsing: {
    /** n = 持っている総数 (銃は装填 + 予備)。loaded/mag は銃だけ */
    items: { id: HeldId; n: number | null; loaded: number | null; mag: number | null }[]
    at: number
  } | null
  /** いま手にある物 */
  held: HeldId
  /** 武器系で選んでいる物。道具を手にしていても変わらない */
  weaponHeld: HeldId
  /** 道具系で選んでいる物。使っていなければ 'none' */
  tool: HeldId
  /** その道具をいま手にしているか */
  toolInHand: boolean
  /** どちらの系統の一覧を開いているか。閉じていれば null */
  browsingFamily: 'weapon' | 'tool' | null
  /** 持ち替えの最中か。HUD を薄くするのに使う */
  switching: boolean
  /** 自分の所属 */
  team: Team
  /** 試合の状態。まだ届いていなければ null */
  match: MatchMessage | null
  /** 自分の体力 */
  health: number;
  /**
   * 視界の曇り (0..1)。**スタミナが減るほど濃い。**
   *
   * 残りの数字ではなく効き目を渡す。画面は棒を出さずに曇るだけなので、
   * 数字を持たせても使い道が無い (domain/player/stamina.ts の staminaBlur)。
   */
  stamina: number;
  /**
   * 直近の爆風。**近くで爆ぜるたび、別物に差し替わる。**
   *
   * 続いている効き目 (stamina) と違って、これは起きた一瞬を知らせる合図。
   * 0.1 秒ごとの stats に乗せるので、いつ届くかは揃わない — **濃さと長さは
   * 受けた側 (Hud.css) が時間で決める。** ここが持つのは近さだけ。
   *
   * seq は毎回増える番号。**同じ場所で続けて爆ぜても新しい 1 発と分かる。**
   */
  shock: { seq: number; power: number } | null;
  /** 眠っているか。眠っている間は操作を受け付けない */
  asleep: boolean;
  /** 眠りの深さ。**1 が眠った瞬間、0 が起きた瞬間。** 画面の暗さがこれに従う */
  sleepDepth: number;
  maxHealth: number;
  /** 倒れているか */
  dead: boolean;
  /** 接続している他プレイヤーの数 */
  players: number;
  /**
   * 自分が実際に位置を送れている回数 (通/秒)。
   *
   * 名目は 64。**下回っていたら、描画が重くて setInterval が発火できていない。**
   * 相手の画面ではその分だけ自分がカクつく
   */
  sendRate: number;
  /** 相手ごとに、位置が届いている回数 (通/秒) */
  peerRates: { name: string; rate: number }[];
}

const LINK_RANGE = 5;

/** 繋がったことを何秒出すか */
const LINK_FEED_LIFE = 4;
const LINK_FEED_MAX = 3;

/** HUD 更新間隔 (秒)。毎フレーム Solid を起こさない */
const STATS_INTERVAL = 0.1;
/** 1 フレームの最大 dt (秒)。タブ復帰時の巨大な dt でワープするのを防ぐ */
const MAX_DT = 1 / 20;
/** 弾が届く距離 (m)。何にも当たらなければここまで飛んで消える */
const MAX_RANGE = 200;


/**
 * 刺突の判定を出すタイミング (クリップ尺に対する割合)。
 *
 * モーションの頭で判定すると、刃が届く前に相手が倒れて不自然に見える。
 * 腕を突き出す辺りで出す。1.93 秒の 35% = 約 0.68 秒。
 */
const STAB_HIT_PHASE = 0.35;
/** 刺突モーションの尺のフォールバック (秒)。クリップが無いとき用 */
const FALLBACK_STAB_DURATION = 1.9;

/**
 * 弾痕の色。**地形に当たった分だけ。**
 *
 * 人に当たった痕は出さない — 痕はワールドに置くので、相手が動いた後もその場に
 * 浮いてしまう。削られたことは足元の血で残す (Shots.blood)。
 */
const IMPACT_WORLD = 0xffd9a0;
/** 命中表示を HUD に出しておく時間 (秒) */
const HIT_FEEDBACK_DURATION = 0.6;

/** トーンマッピングの露出。全体の明るさはまずここで調整する */
const DEFAULT_EXPOSURE = 3.0;

/**
 * 水面を叩く強さ。**弾を 1 とした比。**
 *
 * 落ちる物の重さがそのまま水しぶきの大きさになる。薬莢が手榴弾と同じ音・同じ
 * 大きさで跳ねると、**水の音で何が落ちたか読めなくなる**。
 */
const GRENADE_SPLASH = 2.2;
const THROWN_SPLASH = 1.6;
const CASING_SPLASH = 0.45;
/**
 * 着弾点から地形を探す幅 (m)。
 *
 * 弾の穴は面のすぐ手前で止まっているので、広く探す必要は無い。広げると
 * **隣の面を拾って音を間違える** (金属の柵の脇の木の床、など)。
 */
const IMPACT_PROBE = 0.3;
/**
 * 水音を鳴らす下限の大きさ。
 *
 * 薬莢 (0.45) は鳴らさず、投げ物 (1.6) から上を鳴らす。撃つたびに水音が
 * 挟まると、音で相手を探す遊びが成立しない。
 */
const SPLASH_SOUND_MIN = 1.2;
/**
 * 人が落ちたときのしぶき。**手榴弾より大きい。**
 *
 * 体は手榴弾より桁違いに大きいので、同じ大きさだと水に入ったことが
 * 伝わらない。落ちた速さで 0.6〜1.6 倍する (BODY_SPLASH の呼び出し)。
 */
const BODY_SPLASH = 3.4;
/** この速さで落ちたらしぶきが最大になる (m/s)。板の縁から落ちて 2 秒ぶん */
const FALL_SPLASH_SPEED = 14;
/** 水中で爆ぜたときの水柱。**投げ込んだときより大きい** */
const BLAST_SPLASH = 3;
/**
 * 水面ちょうどと見なす幅 (m)。
 *
 * 沈む物は水面ちょうどへ置かれるので、数え落ちを防ぐぶんだけ。**板の厚み
 * (8cm) より小さく**しておかないと、板の上の物まで水として数える。
 */
const SURFACE_TOLERANCE = 0.03;




/**
 * 手を離れる高さ (m)。server の RELEASE_HEIGHT と揃える。
 *
 * 投擲モーションで手が振り切る所の実測が 1.74m (1.65 秒の時点)。
 * そこに合わせてある。低くすると、腕は上にあるのに物が腰から出る。
 */
const GRENADE_RELEASE_HEIGHT = 1.7;

/**
 * 手を離れる位置を、投げる向きへどれだけ前に出すか (m)。
 * server の RELEASE_FORWARD と揃える。
 *
 * 体の中心から出すと、真下へ投げたときに自分の足元をすり抜ける。
 * 腕を伸ばした先から出るようにする。
 */
const GRENADE_RELEASE_FORWARD = 0.45;

/**
 * クレイモアが地面に着く位置。置く型に対する割合。
 *
 * 型は 3.6 秒あるが、手を離れるのはかがんで置いた辺り。残りは立ち上がる動き。
 *
 * **0.38 は測った値。** 右手が一番低くなるのがそこ (0.37m)。50% では既に
 * 0.58m まで戻り、67% では 1.10m — 目分量で置いていた 0.55 は**手が上がり
 * かけた後**で、置いたのに 0.28 秒遅れて現れていた。
 */
const CLAYMORE_PLACE_RATIO = 0.38;


/**
 * 空撃ちの音を鳴らす間隔 (秒)。
 *
 * 押しっぱなしでも連射の速さでは鳴らさない。カチカチ鳴り続けると
 * 音そのものが情報にならなくなるし、単にうるさい。
 */
const EMPTY_INTERVAL = 0.45;


/** 集中してから音の輪が出そろうまで (秒) */
const RING_SETTLE = 1

/** これ以下の強さなら聞こえていないものとして扱う */
const PING_THRESHOLD = 0.04

/**
 * 拾える距離 (m)。**サーバーと同じ値** (server/index.ts の PICKUP_RANGE)。
 *
 * こちらは案内を出すためだけに使う。実際に拾えるかを決めるのはあちら。
 */
const PICKUP_RANGE = 1.0;

/** キル表示を残す時間 (秒) と、同時に出す行数 */
const KILL_FEED_DURATION = 6;

/**
 * 点の増減を残す時間 (秒) と行数。
 *
 * キル表示より**短く**する。あれは「誰が誰を」の記録で読むもの、こちらは
 * 「いま入った」という手応えなので、残り続けると邪魔になる。
 */
const POINT_FEED_DURATION = 2.5;

/**
 * スポーン地点をどれだけ散らすか (m)。
 *
 * **基地の枠 (stage.ts の BASE_HALF = 2m) の内側に収める。** 外に出ると、
 * 地面に描いた枠が「自分の湧く場所」に見えなくなる。
 */
const SPAWN_SPREAD = 1.5;

/**
 * 名簿を頼み直す間隔 (ms)。
 *
 * 往復は普通 30〜60ms なので、1 秒あれば来ているはず。それでも来ないなら
 * **頼みか答えのどちらかが落ちている**ので、もう一度言う。
 *
 * 短くしすぎると、往復を待っている間に何十通も投げることになる。
 */
const ROSTER_RETRY = 1000;

/** ID から湧く方向を決める。同じタブなら再読み込みしても同じ場所 */
function spawnAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  return ((hash >>> 0) / 0x100000000) * Math.PI * 2;
}

/**
 * ゲーム本体。シーン・カメラ・キャラ・ループを命令的に管理する。
 * Solid 側はこのクラスの外に一切踏み込まず、onStats 経由で状態を購読するだけ。
 */
export class Game {
  /** 地形 (glb) が届いたか。**届くまで人を動かさない** (落ちてしまう) */
  private stageReady = false;

  /**
   * スタミナ。**麻酔だけが削る。** 0 で眠る (domain/player/stamina.ts)。
   *
   * サーバーが決めた値をそのまま控える。体力と違って撃たれた瞬間に自分で
   * 減らさないのは、**麻酔は当てた本人にも効いたかどうかが見えない**から —
   * 見えるのは自分の目盛りだけ。
   */
  private stamina = MAX_STAMINA;
  /**
   * 直近の爆風。**同じ物を送り続ける** — 新しく爆ぜたときだけ差し替える。
   *
   * 毎 tick 作り直すと、受けた Solid 側から見て「毎回新しい爆風」になって、
   * 曇りが 0.1 秒ごとに掛け直される。
   */
  private shock: { seq: number; power: number } | null = null;

  private readonly renderer: WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly follow: FollowCamera;
  private readonly player = new Soldier();
  private readonly input = new Input();
  private readonly stage: Stage;
  private readonly sun: THREE.DirectionalLight;
  private readonly remotes: RemoteSoldiers;
  /** 足元に出る音の輪。聞こえた方向に山が立つ */
  private readonly soundRing: SoundRing;
  /** 投げた物。落ちた場所で音を出すためだけのもの */
  private readonly thrown: ThrownItems;
  private readonly grenades: Grenades;
  private readonly claymores: Claymores;
  private readonly blast: BlastFx;
  private readonly casings: Casings;
  /** 地面に落ちている武器。浮かせて回している */
  private readonly drops: Drops;
  /** 地形の箱。サーバーと同じ stage.json を読む。読めるまでは空 */
  private stageBoxes: StageBox[] = [];
  /**
   * 一覧を開いている最中。
   *
   * **開いている間は持ち替えていない。** 選ぶことと抜くことを分けてあるので、
   * ここを動かしても代償は発生しない (docs/design.md の 5)。
   */
  /**
   * 一覧が食い残したホイール。倍率 (updateZoom) が続けて読む。
   *
   * ホイールは読んだ時点で 0 になるので、**取り合いになる 2 か所で 2 回読めない**。
   * 先に読む側 (一覧) が残りをここへ置く。
   */
  private wheelLeft = 0;

  private grenadeAiming = false;
  /** 構え始めと同じフレームに引かれた引き金。次のフレームで放す */
  private pendingThrow = false;
  /** クレイモア側の同じもの */
  private pendingSetup = false;
  /** 弾倉 (囮) 側の同じもの */
  private pendingDecoy = false;
  /**
   * 投げる引き金を**このフレームで引いたか**。押しっぱなしで連投しない。
   *
   * --- なぜ 1 か所で数えるか ---
   * 以前は「引いていたか」を控えるフラグを 3 つの投げ物 (弾倉・手榴弾・クレイモア)
   * が**共有して、それぞれが自分の番で倒していた**。順番が先の弾倉が先に倒すので、
   * 後から見る手榴弾には「もう引かれている」としか見えず、**手榴弾が投げられ
   * なかった**。
   *
   * 立ち上がりはフレームに 1 つしかないので、フレームの頭で 1 回だけ数える。
   */
  private triggerEdge = false;
  private wasFiring = false;
  /** 手を離れるまでの残り (秒)。0 なら投げていない */
  private grenadeRelease = 0;
  /** 直前のフレームの経過時間 (秒)。tick の外で時計を進めるのに使う */
  /** 空撃ちの音を次に鳴らせるまで (秒) */
  private emptyCooldown = 0;
  /**
   * 引き金を離したか。単発の銃で、押しっぱなしの連射を止めるのに使う。
   *
   * 「押した瞬間」を数えるのではなく「離したか」を持つのは、撃てない条件
   * (弾切れ・リロード中・構えていない) で押し始めたときに、条件が解けた瞬間へ
   * 1 発ぶん持ち越さないため。
   */
  private readonly grenadeOrigin = new THREE.Vector3();
  /** 手持ちの投げ物。復帰で戻る */
  /** 投げる構えを取っているか。離した瞬間に投げる */
  private throwAiming = false;
  /**
   * 通信路。既定はタブ間 (BroadcastChannel)、URL に ?server= を付けると WebSocket。
   * ゲーム側はどちらで繋がっているかを知らない。
   */
  private readonly net: NetTransport;
  private readonly shots: Shots;
  private readonly audio: GameAudio;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;

  private readonly moveDir = new THREE.Vector3();
  private readonly forwardVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly look = { x: 0, y: 0 };

  private readonly raycaster = new THREE.Raycaster();
  private readonly aimOrigin = new THREE.Vector3();
  /** 姿の見えない音源を置く先。方向と距離から組み立てる */
  private readonly noisePos = new THREE.Vector3();
  private readonly aimDir = new THREE.Vector3();
  private readonly muzzlePos = new THREE.Vector3();
  private readonly ejectPos = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();
  private readonly hitNormal = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();
  /** カメラの遮蔽判定用。弾道とは別に持つ (far が毎回変わるため) */
  private readonly cameraRay = new THREE.Raycaster();
  /** 弾道を折れ線で辿るための作業ベクトル */
  private readonly segmentFrom = new THREE.Vector3();
  private readonly segmentTo = new THREE.Vector3();
  private readonly segmentDir = new THREE.Vector3();

  /**
   * 手触りの仮置き。**調整パネルだけが動かす** (calibration.ts)。
   *
   * 既定は knobs.ts。パネルは開発時にしか出ないので通常は動かないが、
   * Game が読むのはここ 1 つで、重複は持たない。
   */
  private readonly knobs: Knobs = defaultKnobs();
  /**
   * 調整パネルの受け口。**本体の顔から外してある。**
   *
   * 以前は Game に setBoltDelay / setCrouchTorsoYaw … と 20 本以上生えていて、
   * 外から見ると「この値はいつでも変わりうる」ように読めた。実際に触るのは
   * 手元で ?panel=open を付けたときだけ。
   */
  readonly calibration: Calibration;

  /**
   * 散布と反動。撃つたびに広がり、撃たなければ戻る。
   *
   * **数字も状態機械も domain** (item/spread.ts)。ここが持つのは、返ってきた
   * 角度をカメラへ足すことと、円錐の中へ実際に向きを傾けること (sim/space/aim.ts)
   * だけ。サーバーが同じ弾を再現できるように、three を挟まない形にしてある。
   */
  /**
   * いま効いているスキル。**サーバーが返した物だけを持つ。**
   *
   * 送った物を控えて表示に使うと、弾かれたときに画面だけ先へ行く。選び直せる
   * 窓は試合が始まる前だけなので、そこを外して送るのは普通に起きる。
   */
  private skills: Skills = {};

  private readonly spread = new Spread();
  /**
   * サーバーが持っている自分の値。**予測を直すためだけに持つ。**
   *
   * 描くのに使うのはこちらではなく、予測した側 (player / inv)。
   */
  private readonly self = newSelfReplica();
  /**
   * 名簿を待っているか。**試合が始まったら立ち、届いたら降りる。**
   *
   * 立っている間は 1 秒ごとに頼み直す (askRoster)。
   */
  private rosterWanted = false;
  /** 最後に頼んだ時刻 (Date.now)。**頼みすぎない**ための間隔 */
  private rosterAskedAt = 0;
  /** 直前に見た段階。**変わった瞬間**を捕まえるのに要る */
  private phaseSeen: MatchPhase | null = null;

  /** 破棄済みか。非同期の初期化が終わったときに、まだ生きているかを確かめる */
  private disposed = false;
  /** 初期化のあとに決まる。それまでは分からない */
  private backend = "…";
  private lastTime = 0;
  private statsTimer = 0;
  private fireCooldown = 0;
  private shotCount = 0;
  /**
   * 残弾。**武器ごとに別で持つ。**
   *
   * 持ち替えで満タンになると、持ち替えがリロードの代わりになってしまう。
   * 撃ち切ったら持ち替えて、また撃ち切ったら戻して、で永久に撃てる。
   * 銃を置いてくるわけではないので、残りはそのまま残る。
   */
  /**
   * 湧き地点で組んだ装備。
   *
   * 銃を並べて順に持ち替えるのではなく、**枠に何を入れるかを選ぶ**。
   * 狙撃銃を主に選んだなら、詰められたときに突撃銃は無い — その代わり副武器がある。
   * 選んだこと自体が手になる。
   *
   * 替えられるのは湧くときだけ。試合中に持ち物を組み替えられると、
   * 状況ごとに最適な物へ乗り換えるだけになって、選ぶ意味が消える。
   */
  /**
   * 湧き地点で組んだ装備。
   *
   * 副武器は**部屋が外すことがある** (ROOMS の secondary)。null を持てないと、
   * サーバーは外しているのに手元にだけ拳銃が残る。
   */
  private loadout: {
    /** 主武器。**銃を外した部屋では null** (domain/match/room.ts の primaries) */
    primary: WeaponId | null
    secondary: WeaponId | null
    support: SupportId
  } = {
    primary: "rifle",
    secondary: "m9",
    support: "grenade",
  };
  /** 次に湧いたときの装備。試合中に変えても、いま持っている物は変わらない */
  private pendingLoadout = {
    primary: "rifle" as WeaponId | null,
    secondary: "m9" as WeaponId | null,
    support: "grenade" as SupportId,
  };
  /** いまどちらの枠を持っているか */

  /**
   * 持ち物と、いま手にある物。
   *
   * **弾はここにある。** 以前は銃ごとの装填と予備、手榴弾の残り、投げられる弾倉が
   * 別々のフィールドに散っていて、読み書きが各所にあった。持ち物の考え方を変える
   * たびに全部を追いかけることになる (docs/design.md の 5)。
   */
  private inv = new Inventory({
    primary: "rifle",
    secondary: "m9",
    support: "grenade",
  });

  private get ammo(): number {
    return this.inv.ammo;
  }
  /** ポンプ / ボルトを流す速さ。撃った時に決めて、動作を始める時に使う */
  private boltRate = 1;
  /** 0 より大きい間はリロード中で、発砲できない */
  private reloadTimer = 0;
  /** その装填を始めたときに伏せていたか。**姿勢をまたいだら中断する** */
  private reloadProne = false;
  /** どの銃を替えていたか。**持ち替えたら中断する** */
  private reloadWeapon: WeaponId | null = null;
  /** 鳴らした弾倉の音の札。中断したら途中でも止める */
  private reloadSoundToken: SoundToken | null = null;
  /** リロードの音を鳴らすまでの残り時間 (秒)。0 なら鳴らし終えている */
  private reloadSoundIn = 0;
  /** ボルト操作を始めるまでの残り時間 (秒) */
  private boltIn = 0;
  /** 撃ってからボルトに手を掛けるまで (秒、調整用) */
  /** リロードの音を鳴らし始める位置 (割合、調整用) */
  /** 連射中の何発目か。反動パターンを引く添字 */
  /** 姿勢由来の散布 (度)。移動と滞空で増え、落ち着くと戻る */
  /** 刺突の残り時間。0 より大きい間は発砲できない */
  private stabTimer = 0;
  /** 判定を出したか。1 回の振りで 1 回だけ */
  private stabResolved = true;
  private readonly meleeForward = new THREE.Vector3();
  /** 今のローリングで既に弾いた相手。1 回の転がりで同じ相手を何度も弾かない */
  private readonly rolledInto = new Set<string>();
  private wasRolling = false;
  /** 直近に当てた部位と、その表示を消すまでの残り時間 */
  private lastHitZone = "";
  /**
   * その命中が麻酔だったか。**色を変えるためだけに持つ。**
   *
   * 赤は「削った」の色。麻酔は削らないので、同じ赤で出すと**倒しに行けている
   * のか眠らせに行けているのか**が読めない。
   */
  private lastHitTranq = false;
  private hitFeedbackTimer = 0;
  /**
    * 状態を送るタイマーの握り。描画ループとは独立して回る。
    *
    * 型を `ReturnType<typeof setInterval>` で持つのは、**走る場所を型に
    * 持ち込まない**ため。ブラウザは番号を返し bun は Timer を返すので、
    * どちらかに決め打つと、もう片方の宣言が勝った瞬間に食い違う。
    */
  private snapshotHandle: ReturnType<typeof setInterval> | null = null;
  /** 直近のキル表示。新しいものが先頭 */
  /**
   * 試合のレプリカ。**サーバーが持っている状態を追従するだけ** (src/application/replica)。
   *
   * 段階・残機・得点・自分の所属・キルログは全部あちらが持つ。ここは受けた
   * 報せを渡して、返ってきた「やること」を絵と音にする。
   */
  private readonly replica = newMatchReplica();
  /**
   * 名簿のレプリカ。**誰が居て、いまどうなっているか** (src/application/replica/roster.ts)。
   *
   * 体 (RemoteSoldiers) はこれを見て姿を合わせるだけ。名前も所属も体力も状態も、
   * 決めているのはサーバー。
   */
  private readonly roster = newRoster();
  /** 敬礼で繋がった相手。数秒で消える */
  private readonly links: { name: string; at: number }[] = []
  /** 成績表を開いているか */
  private menuOpen = false
  
  /**
   * いま持っている武器の性能。
   *
   * 発射間隔も散布も威力も画角も、全部ここから引く。持ち替えたら
   * 参照先が変わるだけで、呼ぶ側は書き換えなくてよい。
   */
  private get weapon() {
    return weaponOf(this.player.equipped);
  }

  /**
   * ボルトを操作している最中か。
   *
   * 撃つこととボルトを送ることが 1 組の動作なので、途中で抜けられないようにする。
   * 抜けられると「撃って即座に隠れる」「撃って即座に持ち替えて連射」が通り、
   * 1 発ごとに 1.8 秒という代償を払わずに済んでしまう。
   *
   * 通すのは移動としゃがみだけ。姿勢を低くするのは逃げではなく次の 1 発の準備で、
   * 走って逃げるにしても体を晒したまま逃げることになるので代償が残る。
   * 転がりは無敵の移動に近いので塞ぐ。
   */
  private get cocking(): boolean {
    return this.weapon.bolt && (this.boltIn > 0 || this.fireCooldown > 0);
  }

  /** スコープを覗いているか。構えている + 覗く武器 */
  /**
   * 覗いているか。
   *
   * 構えているだけでは覗かない。ホイールで段を上げて初めて 1 人称になる。
   * 判定に入力ではなく **実際に構えられているか** を使うのは、
   * 箱を被ったまま覗けてしまったため (押した事実だけで見ていた)。
   */
  private get scoped(): boolean {
    return this.player.isAiming && this.zoomStep > 0;
  }

  /** いま覗いている段。0 なら肩越し */
  private zoomStep = 0;

  /**
   * 倍率を上げ下げする。
   *
   * 構えていないときは受け付けない。構えを解いたら 0 へ戻す —
   * 覗いたまま構えを解いて、次に構えたら突然 16 倍、では扱えない。
   */
  private updateZoom(): void {
    // 一覧が食い残したぶんだけ。同じホイールを一覧が先に見ている
    const steps = this.wheelLeft;
    this.wheelLeft = 0;
    // Z は 1 段ずつ上げて、一番上まで行ったら肩越しへ戻る。
    // トラックパッドではホイールが扱いにくいので、キーでも回せるようにしてある
    const cycled = this.input.tapped("zoom");
    const levels = this.weapon.scope.length;

    if (!this.player.isAiming || levels === 0) {
      this.zoomStep = 0;
      return;
    }
    if (cycled) this.zoomStep = (this.zoomStep + 1) % (levels + 1);
    else if (steps !== 0) {
      this.zoomStep = Math.max(0, Math.min(levels, this.zoomStep + steps));
    }
  }

  /**
   * 構えたときのカメラを武器に合わせる。
   *
   * 覗く武器は視点を銃の位置まで寄せて (引きも肩のずれも 0)、自分の姿を消す。
   * 3 人称のまま画角だけ狭めると、寄るほど自分の背中が的を隠す。
   */
  private applyWeaponView(): void {
    const spec = this.weapon;
    const level = this.zoomStep > 0 ? spec.scope[this.zoomStep - 1] : null;
    this.follow.setAimView(
      level
        ? { distance: 0, shoulder: 0, fov: level.fov }
        : { distance: spec.aimDistance, shoulder: spec.aimShoulder, fov: spec.aimFov },
    );
    this.player.setSelfVisible(!this.scoped);
  }
  /** 自分の所属。名簿で届くまでは青として振る舞う */

  /** 試合の状態。サーバーが持っているものをそのまま控える */

  /** 遠隔の弾道を描くための作業ベクトル */
  private readonly remoteFrom = new THREE.Vector3();
  private readonly remoteTo = new THREE.Vector3();
  /** 他人の弾痕を向ける先。**弾の向きの逆** — 面の法線の代わりに使う */
  private readonly impactFacing = new THREE.Vector3();
  private fps = 0;
  private onStats: ((stats: GameStats) => void) | null = null;

  /** 乗っているステージ。**部屋が決める** (ROOMS) */
  private readonly stageName: StageName;
  /**
   * 持ち込める主武器。**部屋が決める** (ROOMS の primaries)。
   *
   * 一覧から消すだけでは足りない — 送ってくる側は止まらないので、
   * サーバーも同じ表で弾く (domain/player/equip.ts)。ここは見せ方の話。
   */
  private readonly primaries: readonly WeaponId[];
  /** 副武器。**部屋が外していれば null** (ROOMS の secondary) */
  private readonly secondary: WeaponId | null;

  constructor(container: HTMLElement, identity: Identity, room: string) {
    this.container = container;
    /*
     * どのステージに乗るか。**部屋から引く** (domain/match/room.ts)。
     *
     * サーバーに訊かないのは、画面を組み始める時点でまだ 1 通も届いていない
     * ため。同じ表をこちらも読むので食い違わない。
     *
     * **試合ごとに切り替えるようになったら、ここがサーバーからの通に変わる**
     * (回す表は既に domain/stage に在る)。そのときは地形を
     * 読み直す道が要る。
     */
    this.stageName = STAGES[
      isRoomName(room) ? ROOMS[room].stages.stages[0] : 'mall'
    ].name;
    this.primaries = isRoomName(room) ? primariesOf(room) : CHOICES.primary;
    this.secondary = isRoomName(room) ? secondaryOf(room) : "m9";
    // 手元の装備も部屋に合わせる。**サーバーは外しているのにこちらだけ持つ**を防ぐ
    this.pendingLoadout.secondary = this.secondary;
    this.loadout.secondary = this.secondary;
    /*
     * 持ち込めない銃を選んだ状態で開かない。**サーバーも同じ表で丸める**
     * (domain/player/equip.ts の fitLoadout)。
     *
     * **一覧が空なら銃を持たない部屋。** ナイフだけになる。
     */
    const carryable =
      this.pendingLoadout.primary !== null &&
      this.primaries.includes(this.pendingLoadout.primary);
    if (!carryable) {
      this.pendingLoadout.primary = this.primaries[0] ?? null;
    }
    // 誰として繋ぐか。token を渡し、サーバーが署名から ID を導く
    this.net = createTransport(identity, room);
    // 自機のモデルはここで読み始める。**構築時ではない** —
    // どのモデルを着るかは名前で決まり、名前を知っているのはこちら (skin.ts)
    this.player.start(selfSkin(identity.displayName));

    // WebGPU が無い環境では three が自動で WebGL2 に落ちる。
    // 「対応ブラウザだけ」にはならないので、片道の選択ではない。
    //
    // three と three/webgpu は同じ three.core.js を読んでいるので、
    // Vector3 や Object3D は同じクラスのまま。混ざっても壊れない。
    this.renderer = new WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // three r185 で PCFSoftShadowMap は deprecated (内部で PCFShadowMap にフォールバックする)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 露出という 1 つのつまみで明るさを動かせるようにする。
    // Neutral (Khronos PBR Neutral) は ACES より色が転びにくく、暗い迷彩色が濁らない。
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE;
    container.appendChild(this.renderer.domElement);

    this.stage = buildStage(this.scene, this.stageName);
    /*
     * 水面をこの 2 つへ配る。**溺れた体は沈み、見ている側は水の上に残る。**
     *
     * 水は上からしか描いていないので、潜ると裏側から見ることになって水面が
     * 消える。カメラの下限を水面に上げておけば、沈んでいく体だけが見えなくなる。
     */
    const water = waterOf(this.stageName);
    this.player.setWater(water);
    /*
     * **地形が届くまで人を落とさない。**
     *
     * buildStage はブロックアウトの箱だけ持ってすぐ返り、本物の地形は後から
     * 差し替わる。庭園は足場が水面の 10m 上にあるので、届く前に湧くと**立つ
     * 床が無いまま重力が効いて、そのまま落ちて溺れる** — 「たまに試合開始で
     * 下に落ちる」の正体がこれ。
     *
     * 届いたら湧き直す。読み込みの間に流れた分の落下を無かったことにする。
     */
    void this.stage.ready.then(() => {
      this.stageReady = true;
      this.placeAtSpawn();
    });
    // 陣営の基地。地面を見れば自分の湧く場所が分かる
    /*
     * 陣営の基地。**個人戦では出さない。**
     *
     * ルールは 1 秒ごとに届く match で分かるので、置いてから隠す。地面に色の
     * 付いた枠があると「そこが自分の陣地」に読めるが、個人戦にはそんな場所は
     * 無い (湧く所も毎回変わる)。
     */
    this.bases = buildBases(this.stageName);
    this.scene.add(this.bases);
    this.sun = buildLights(this.scene);
    this.placeAtSpawn();
    this.scene.add(this.player.object);
    this.remotes = new RemoteSoldiers(this.scene);
    this.remotes.setWaterY(water?.y ?? null);
    this.soundRing = new SoundRing(this.scene);
    this.thrown = new ThrownItems(this.scene);
    this.grenades = new Grenades(this.scene);
    this.claymores = new Claymores(this.scene);
    this.blast = new BlastFx(this.scene);
    this.casings = new Casings(this.scene);
    this.drops = new Drops(this.scene);
    void loadStageBoxes(this.stageName).then((boxes) => {
      // 跳ねる面と遮蔽は別の集合。手榴弾は当たり判定のほうを見る
      this.stageBoxes = solidBlockers(boxes);
    });
    this.shots = new Shots(this.scene);
    this.net.onMessage((message) => this.receive(message));

    /*
     * **開発中だけ、動いている本体を窓から掴めるようにする。**
     *
     * 見た目の不具合は、コードを読んでも模擬を回しても掴めないことがある。
     * 「高い所から落ちると下半身だけ回る」を追ったとき、手元の模擬では
     * 上下とも受け身が乗っていて**再現しなかった**。実機の骨の向きを
     * 1/60 秒ごとに読めれば、模擬と実機のどこが違うかを直接測れる。
     *
     * 本番のバンドルには入らない (import.meta.env.DEV は build 時に false へ
     * 畳まれ、この塊ごと落ちる)。**遊ぶ人に本体を触らせない。**
     */
    if (import.meta.env.DEV) {
      (window as unknown as { __game?: Game }).__game = this;
    }

    this.raycaster.far = MAX_RANGE;

    this.follow = new FollowCamera(1);
    if (water) this.follow.minY = water.y + Game.WATER_CLEARANCE;
    this.follow.snapTo(this.player, this.cameraWorld);
    // 環境音はステージが決める。庭園は波、屋内は街の音 (domain/stage の ambience)
    this.audio = new GameAudio(this.follow.camera, this.scene, STAGES[this.stageName].ambience);

    this.calibration = createCalibration({
      knobs: this.knobs,
      player: this.player,
      follow: this.follow,
      input: this.input,
      sun: this.sun,
      renderer: this.renderer,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  async start(onStats?: (stats: GameStats) => void): Promise<void> {
    this.onStats = onStats ?? null;
    this.input.attach(this.renderer.domElement);

    // WebGPU の初期化は非同期 (アダプタとデバイスの取得)。
    // 待たずに回し始めると最初の数フレームが黙って落ちる。
    await this.renderer.init();
    if (this.disposed) return;
    // isWebGLBackend は型定義に無いが実体にはある (WebGLBackend だけが持つ目印)
    const backend = this.renderer.backend as { isWebGLBackend?: boolean };
    this.backend = backend.isWebGLBackend ? "WebGL2" : "WebGPU";
    if (backend.isWebGLBackend) void this.reportWebGPUFallback();

    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((time) => this.tick(time));
    this.broadcast();
    this.snapshotHandle = setInterval(
      () => this.broadcast(),
      SNAPSHOT_INTERVAL * 1000,
    );
  }

  /** 武器の取り付け位置の調整用。開発時の Calibrator からのみ呼ばれる */
  /** 自分の ID。HUD がキル表示で自他を分けるのに使う */
  get selfId(): string {
    return this.net.id;
  }


  /**
   * WebGPU に乗れなかった理由を出す。
   *
   * three は黙って WebGL2 に落ちる。動かし続けるには正しいが、理由が出ないと
   * 「対応していないブラウザなのか」「開き方が悪いのか」の区別が付かない。
   * 一番多いのは後者で、navigator.gpu は HTTPS か localhost でしか露出しない。
   */
  private async reportWebGPUFallback(): Promise<void> {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;

    if (!window.isSecureContext) {
      console.warn(
        "[描画] WebGL2 で動いている。このページは安全な文脈ではないので " +
          "navigator.gpu が出てこない。localhost か https で開くと WebGPU になる " +
          `(いま ${location.origin})`,
      );
      return;
    }
    if (!gpu) {
      console.warn("[描画] WebGL2 で動いている。このブラウザに WebGPU が無い");
      return;
    }
    const adapter = await gpu.requestAdapter().catch(() => null);
    console.warn(
      adapter
        ? "[描画] WebGL2 で動いている。アダプタは取れているので、初期化のどこかで落ちている"
        : "[描画] WebGL2 で動いている。使える GPU アダプタが返ってこない",
    );
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    if (this.snapshotHandle !== null) clearInterval(this.snapshotHandle);
    this.snapshotHandle = null;
    this.input.detach();
    this.resizeObserver.disconnect();
    this.net.dispose();
    this.audio.dispose();
    this.shots.dispose();
    this.remotes.dispose();
    this.soundRing.dispose();
    this.thrown.dispose();
    this.grenades.dispose();
    this.blast.dispose();
    this.casings.dispose();
    this.drops.clear();
    this.player.dispose();
    this.scene.traverse((obj) => {
      if (isMesh(obj)) {
        obj.geometry.dispose();
        const material = obj.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private tick(time: number): void {
    const dt = Math.min((time - this.lastTime) / 1000, MAX_DT);
    this.lastTime = time;

    // パッドはイベントを出さないので毎フレーム読みに行く。
    // 視点も移動もこの後の処理が読むので、フレームの先頭で更新しておく。
    this.input.pollGamepad(dt);
    // 押している時間を進める。**単押しと長押しの別はここで決まる** (infra/input)
    this.input.advance(dt);

    // 視点はマウスが唯一の駆動源。カメラを回してから移動方向を解決する。
    const look = this.input.consumeLook(this.look);
    // 動かせるときだけ視点を回す。
    //
    // 支度中 (装備画面) と倒れている間 (倒した相手を映している間) は、
    // 動かしても意味が無いどころか害になる — 裏で回った向きのまま湧く。
    // 読み捨てているのは、溜めておくと解けた瞬間に一気に飛ぶため。
    if (canAct(this.life)) this.follow.addLook(look.x, look.y);

    // 移動入力はカメラ基準。W で必ず「画面奥」へ進む。
    const axis = this.input.moveAxis();
    this.follow.forward(this.forwardVec);
    this.follow.right(this.rightVec);
    this.moveDir
      .set(0, 0, 0)
      .addScaledVector(this.forwardVec, -axis.z)
      .addScaledVector(this.rightVec, axis.x);

    // 装備を組んでいる間は動けない。
    //
    // 決めるまで動けない形にしてある。裏で動けると、選ぶのを後回しにして
    // 走り出せてしまい、「湧くときに決める」という手続きが有名無実になる。
    if (this.loadoutBlocking) this.moveDir.set(0, 0, 0);

    // 開始前も動けない。
    //
    // 湧き地点は決まっているので、始まる前に動けると、始まった瞬間には
    // もう散らばっている。位置取りは試合が始まってから始まってほしい。
    //
    // 視点は動かせるままにする。周りを見て、どこへ向かうか決める時間になる。
    if (this.replica.match?.phase === "countdown") this.moveDir.set(0, 0, 0);

    // クレイモアを構えている / 置いている間は動けない。
    //
    // かがんで置く動作なので、そのまま走られると型と足が食い違う。**向きだけは
    // 変えられる** — 置く向きは自分の向きで決まるので、狙えないと通り道を塞げない
    // (体をカメラへ向ける処理は updateClaymoreSetup が setThrowing で入れている)。
    //
    // **手を離したあとも塞ぐ。** 押している間だけ止めていたら、離した瞬間から
    // 動けるのに足はかがんだままで、置く型が流れきるまで滑って見えた。
    if (this.setupAiming || this.player.placing) this.moveDir.set(0, 0, 0);

    // ブラウザはユーザー操作があるまで音を出せない。ロック取得やボタン押下がそれにあたる。
    if (this.input.engaged) this.audio.resume();

    // 押した事実を渡して、受け付けるかは Soldier が決める。
    // カメラはその結果に従う (箱の中では寄らない)
    // 装備を組んでいる間は操作を受け付けない。
    //
    // 決めるまで動けない形にしてある。裏で動けると、選ぶのを後回しにして
    // 走り出せてしまい、「湧くときに決める」という手続きが有名無実になる。
    /*
     * 構える。
     *
     * **投げ物のときだけ別。** あれは Shift が振りかぶりなので、銃を構える型に
     * すると腕が二重に動く。
     *
     * **ナイフは構える。** 下を狙えることに意味がある — 倒れている相手には
     * 立ったまま前を刺しても届かず、しゃがんで見下ろして初めて刃が通る
     * (domain/rule/damage.ts の STAB_DOWN_PITCH)。
     */
    const throwing =
      this.inv.held === "grenade" ||
      this.inv.held === "claymore" ||
      this.inv.held === "magazine";
    this.player.setAiming(
      this.input.aiming && this.input.engaged && !this.loadoutBlocking && !throwing,
    );
    this.follow.setAiming(this.player.isAiming);
    this.follow.setViewHeight(this.player.viewHeight);

    this.updateSwitchKeys(dt);
    this.updateStanceInput();
    this.updateLoadoutKeys();
    this.syncLoadoutPointer();
    this.syncHeld();
    this.inv.update(dt, this.input.firing);
    this.updateTrigger();
    this.updateZoom();
    this.applyWeaponView();

    // 成績表。開いている間はポインタを離して、押せる状態にする
    if (this.input.tapped("menu")) this.setMenu(!this.menuOpen);

    if (this.input.tapped("salute")) this.player.salute();
    this.updateLinks();
    // 押している間は手を挙げたまま。離すと下ろす
    this.player.setSaluteHeld(this.input.down("salute"));
    // **引き金の立ち上がりはフレームの頭で 1 回だけ。** 投げ物ごとに数えると、
    // 先に見た物が倒したフラグを後の物が読むことになる
    this.triggerEdge = this.input.firing && !this.wasFiring;
    this.wasFiring = this.input.firing;
    this.updateThrowAim();
    /*
     * **地形が届くまで人を進めない。**
     *
     * buildStage はブロックアウトの箱だけ持ってすぐ返り、本物の地形は後から
     * 差し替わる。庭園は足場が水面の 10m 上にあるので、届く前に進めると
     * **立つ床が無いまま重力だけが効いて、落ちて溺れる**。
     *
     * 止めるのは人の歩みだけで、描画も HUD も回し続ける — ここで tick ごと
     * 抜けると読み込みの間だけ画面が固まる。
     */
    if (this.stageReady) {
      // 反動込みの照準を渡す。銃口が跳ね上がる動きが体にも出る。
      this.player.update(
        dt,
        this.moveDir,
        this.follow.aimYaw,
        this.follow.aimPitch,
        this.world,
      );
      this.reportFall();
    }
    this.updateFallScream();
    // 倒されている間は倒した相手を映す。それ以外は自分を追う
    const watching = this.killCamTarget;
    if (watching) this.follow.watch(dt, watching, this.cameraWorld);
    else this.follow.update(dt, this.player, this.cameraWorld);

    if (this.hitFeedbackTimer > 0) this.hitFeedbackTimer -= dt;
    // 無敵の間は半透明。撃てば切れる (サーバーがそう決めている) ので、
    // 撃った時点でこちらも消す
    // 無敵かどうかも支度中かどうかも状態が答える。こちらで時計を回さない —
    // 回すと、サーバーが解いたのにこちらは半透明のまま、が起きる
    this.player.setGhost(isSpawning(this.life) || this.loadoutBlocking);
    this.updateRollContact();
    this.updateBoxContact();
    this.updateStab(dt);
    this.askRosterIfWanted();
    const posture = {
      speed: this.player.speed,
      stanceRate: this.player.stanceRate,
      crouching: this.player.isCrouching,
      stance: this.player.stance,
      grounded: this.player.grounded,
    };
    this.spread.update(dt, this.weapon, posture);
    /*
     * 手ブレ。**画面ごと揺らす。**
     *
     * カメラの向きへ差し込むので、弾道も一緒に動く (aimDirection がこの向きから
     * 出る)。画面中央のクロスヘアは中央のままで、狙っている景色のほうが泳ぐ。
     *
     * 最初はクロスヘアだけを動かしていた。**銃口はずれているのに視界は微動だに
     * しない**という、どこにも無い見え方になっていた。
     */
    const [swayRight, swayUp] = this.spread.sway(this.weapon, this.skills, posture);
    /*
     * **麻酔を受けているほど手が泳ぐ。**
     *
     * スタミナの残りを画面の棒で出していたが、撃ち合いの最中に読む人は
     * 居なかった。狙いが定まらないことで分かるほうが早いし、そのまま
     * 不利にもなっている (domain/player/stamina.ts)。
     */
    const drowsy = staminaSwayScale(this.stamina);
    this.follow.setSway(
      (swayUp * drowsy * Math.PI) / 180,
      (-swayRight * drowsy * Math.PI) / 180,
    );
    // 反動の戻りも極めた銃ほど速い。**押しっぱなしの間は効かない** —
    // 戻り始めるまでの猶予より発射間隔のほうが短いので (skill.ts)
    this.follow.setRecoilRecovery(masteryRecoveryScale(this.skills, this.weapon.id));
    this.updateWeapon(dt);
    this.remotes.update(dt, Date.now());
    this.drops.update(dt);
    this.updateFootsteps();
    this.grenades.update(dt, this.stageBoxes, this.stage.water, (bounce) => {
      /*
       * 水に落ちたら輪を出す。**跳ねる音は鳴らさない** — 水面で金属が跳ねる
       * 音がすると、そこに硬い床があるように聞こえる。
       *
       * 手榴弾そのものは沈んで消えない。爆ぜるのはサーバーが決めていて、
       * 水中でも同じ場所で爆ぜる。
       */
      // 手榴弾は重い。弾より大きく叩く
      if (this.splashAt(bounce.position, GRENADE_SPLASH)) return;
      // 跳ねた音は全員の輪に出す。自分が投げたものも例外にしない。
      // 手榴弾は隠すものではなく、転がってきたことに気付かせるためのもの
      const gain = this.audio.play("bounce", bounce.position, bounce.strength);
      this.addPing("shot", bounce.position, gain);
    });
    this.updateGrenadeAim();
    this.updateClaymoreRelease(dt);
    this.updateGrenadeRelease(dt);
    this.thrown.update(dt, this.stage.collidables, this.stage.water, (impact) => {
      // 水に落ちたら輪だけ。囮の音が水面から鳴ると、そこが床に聞こえる
      if (this.splashAt(impact.position, THROWN_SPLASH)) return;
      // 跳ねるたびに鳴る。自分が投げたものは輪に出さない
      // (どこへ落ちるかは分かっているので、映しても情報にならない)。
      const gain = this.audio.play("clink", impact.position, impact.strength);
      if (impact.remote) this.addPing("shot", impact.position, gain);
    });
    this.soundRing.update(
      dt,
      this.player.position,
      this.player.waistHeight,
      this.listeningLevel(),
    );
    this.shots.update(dt);
    this.blast.update(dt);
    this.casings.update(dt, this.stageBoxes, this.stage.water, (at) => {
      // 水に落ちたら輪だけ出して沈める。**金属の音は鳴らさない**
      // 薬莢は軽い。小さく叩く
      if (this.splashAt(at, CASING_SPLASH)) return true;
      // 落ちた音。輪には出さない — 撃った位置は銃声が既に伝えているので、
      // ここで二重に印を付ける意味が無い
      this.audio.play("casingDrop", at);
      return false;
    });

    this.renderer.render(this.scene, this.follow.camera);
    this.publishStats(dt);
    this.input.endFrame();
  }

  /**
   * カメラから見た世界。視線を遮る最初の地形までの距離を返す。
   *
   * 見るのはステージだけで、プレイヤーは対象にしない。人が横を通るたびに
   * カメラが寄ると画面が暴れるし、遮蔽としても一瞬で消えるので意味が無い。
   */
  /**
   * カメラを水面からどれだけ上に留めるか (m)。
   *
   * 0 だと水面と同じ高さで、面の裏表がちらつく。人の目線 1 つぶん上げておく。
   */
  private static readonly WATER_CLEARANCE = 0.6;

  private readonly cameraWorld: CameraWorld = {
    distanceToObstruction: (origin, dir, maxDistance) => {
      this.cameraRay.set(origin, dir);
      this.cameraRay.far = maxDistance;
      // カメラを止める面だけ。弾を止める面とは別 (金網はカメラを寄せない、など)
      const hits = this.cameraRay.intersectObjects(
        this.stage.cameraBlockers,
        false,
      );
      return hits.length > 0 ? hits[0].distance : maxDistance;
    },
  };

  /** Soldier から見た世界。地形の表現を Soldier 側に漏らさないための薄い層 */
  private readonly world: PlayerWorld = {
    resolveHorizontal: (position, radius, feetY) => {
      resolveCircle(position, radius, this.stage.obstacles, feetY, PLAYER_HEIGHT, STEP_UP);
      clampToArena(position, radius, ARENA_HALF_SIZE);
    },
    groundHeight: (position, radius, feetY) =>
      groundHeight(position, radius, this.stage.obstacles, feetY, STEP_UP),
    ceilingHeight: (position, radius, feetY) =>
      ceilingHeight(position, radius, this.stage.obstacles, feetY),
  };

  /**
   * 自分の状態を一定間隔で送る。
   *
   * 描画ループから切り離して setInterval で回している。requestAnimationFrame は
   * タブが裏に回ると止まるので、ループの中で送ると裏のタブが黙り込み、
   * 表のタブからは遮蔽に入ったのと区別が付かず、相手の画面から姿が消える。
   * ブラウザは裏のタブのタイマーも 1 秒まで間引くが、無音にはならないので
   * 「そこに立っている」ことは伝わり続ける。
   *
   * 毎フレーム送らないのは帯域のためだけではない。受け取る側は届いた 2 点の間を
   * 補間するので、**間隔が一定でない**と補間の速度が揺れる。描画の速さは
   * 機械ごとに違うが、送る速さは揃えられる。
   */
  /** 直前に位置を送った時刻と、その間隔の均し (ms)。名目は 1/64 秒 */
  private sentAt = 0;
  private sendGap = 0;

  private broadcast(): void {
    // 実際に送れている間隔を測る。名目 (SNAPSHOT_INTERVAL) ではなく実測。
    // 描画が重いとタイマーが発火できず、ここが伸びる
    const at = Date.now();
    if (this.sentAt > 0) {
      const gap = at - this.sentAt;
      this.sendGap = this.sendGap > 0 ? this.sendGap + (gap - this.sendGap) * 0.1 : gap;
    }
    this.sentAt = at;

    const snapshot = this.player.snapshot(this.net.id, Date.now());
    // 視点の向きはカメラが持っている。体の向きとは別 (構えていないと体は進行方向を向く)。
    // サーバーはこれで「どこから見ているか」を出し、可視の判定に使う
    snapshot.cameraYaw = this.follow.aimYaw;
    // 撃ち返せない時間は相手にも見せる。反撃の機会になる
    snapshot.reloading = this.reloadTimer > 0;
    this.net.send({ type: "state", snapshot });
  }

  /** 他プレイヤーからのメッセージ。自分宛ての被弾はここで受ける */
  /**
   * レプリカが返してきた「やること」を絵と音にする。
   *
   * **レプリカは three を知らない。** 段階が変わったことは向こうが決め、飛んでいる
   * 手榴弾を捨てるのはこちら、という分け方。
   */
  private perform(effect: MatchEffect): void {
    switch (effect.kind) {
      case "phase":
        // 陣営が無い部屋には基地も無い
        if (this.bases) this.bases.visible = effect.teams;
        // 試合が切り替わったら飛んでいる物を捨てる。サーバー側も同じ所で
        // 捨てるので、爆発が届かないまま残り続ける
        if (effect.to !== "playing") {
          this.grenades.clear();
          this.claymores.clear();
        }
        /*
         * 決着したら成績表を開く。
         *
         * 誰が何点取ったかは、終わった直後にしか意味を持たない。Tab を押した人
         * だけが見られる形だと、押さない人には勝ち負けの結果しか残らない。
         *
         * 次の試合が始まったら畳む。開いたままだとポインタが離れていて、
         * 始まった瞬間に動けない
         */
        if (effect.to === "over") this.setMenu(true);
        else if (effect.to === "playing" && this.menuOpen) this.setMenu(false);
        break;

      case "team":
        // 誰が味方かは自分の所属が分かって初めて決まる
        this.remotes.setSelfTeam(effect.team);
        this.placeAtSpawn();
        break;
    }
  }

  /**
   * 名簿のレプリカが返してきたことを、体に反映する。
   *
   * **レプリカは three を知らない。** 誰の姿を直すか・誰を消すか・どこで叫ぶかだけ
   * 受け取って、実際に触るのはこちら。
   */
  private performRoster(effect: RosterEffect): void {
    switch (effect.kind) {
      // 姿をレプリカに合わせる。倒れたかを決めるのはレプリカの側なので、
      // ここでは返り値を見ない
      case "sync":
        this.remotes.sync(effect.id, effect.entry);
        break;
      case "died": {
        // 倒れた相手の位置で叫ぶ。撃った側には当てた手応えになり、
        // 離れた場所の誰かには「そこで撃ち合いが終わった」と伝わる
        const at = this.remotes.positionOf(effect.id);
        if (at) this.addPing("shot", at, this.audio.play("scream", at));
        break;
      }
      case "left":
        this.remotes.remove(effect.id);
        break;
    }
  }

  private receive(message: ServerMessage): void {
    /*
     * 名簿の取りこぼしに気づく。**試合が始まったら、届くまで頼み続ける。**
     *
     * 試合の頭で陣営が切り直される。名簿を落とすと前の試合の色のまま描き、
     * **敵味方が逆になる** — 撃てる相手かはクライアントが陣営で判断している
     * ので、味方を撃ちに行って削れない、が起きる。
     *
     * サーバーからの自発的な送信は残っている (普段は 1 往復ぶん速い)。ここは
     * それが落ちたときのための道で、**来なければもう一度頼む**。頼みのほうが
     * 落ちることもあるので、「言えば来る」ではなく「来るまで言う」にする。
     */
    if (message.type === "match" && message.phase === "countdown") {
      if (this.phaseSeen !== "countdown") this.rosterWanted = true;
    }
    if (message.type === "match") this.phaseSeen = message.phase;
    if (message.type === "roster") this.rosterWanted = false;

    // **レプリカを先に進める。** 段階も所属もキルログも、持っているのはあちら
    for (const effect of applyMatch(this.replica, message, this.net.id, Date.now())) {
      this.perform(effect);
    }
    for (const effect of applyRoster(this.roster, message, this.net.id)) {
      this.performRoster(effect);
    }
    switch (message.type) {
      case "state":
        this.remotes.receive(message.snapshot);
        break;

      case "shot":
        // 弾道と発砲音は必ず出す。撃たれたことが見えないと遮蔽へ動く判断ができない。
        // 当たったかどうかはここには載っていない (health で別に届く)。
        this.remoteFrom.fromArray(message.from);
        this.remoteTo.fromArray(message.to);
        /*
         * **他人の弾も痕を残す。**
         *
         * 長らく痕を出していなかった (法線を渡していなかった)。自分が外した
         * 痕だけが残る形で、**索敵の材料になるのは他人の痕のほう**なので、
         * 残す意味の半分が消えていた。
         *
         * 面の向きは弾の向きで代用する。`to` は撃った本人が出した着弾点なので
         * 位置は分かるが、どの面に当たったかは届いていない。正面から当たれば
         * 正しく、**浅い角度だと壁へ食い込む** — そこが気になったら地形の箱と
         * 突き合わせて本当の法線を出す (この時点では割に合わない)。
         */
        this.impactFacing.subVectors(this.remoteFrom, this.remoteTo).normalize();
        this.shots.fire(
          this.remoteFrom,
          this.remoteTo,
          this.impactFacing,
          IMPACT_WORLD,
        );
        /*
         * 他人の弾の着弾音。**当たった面はこちらで引き直す。**
         *
         * 届くのは着弾点だけで、何に当たったかは載っていない (載せると送る量が
         * 増える)。位置から地形を引けば同じ答えが出る — 地形は全員が同じ物を
         * 持っているので、撃った側と食い違わない。
         */
        this.playImpactAt(this.remoteTo);
        {
          // 撃った本人にボルト操作を流し、音もその銃のものにする。
          // 全部ライフルの音だと、撃たれた側は相手の武器を読み違える
          const kind = this.remotes.shot(message.id);
          // 遠くの人の排莢も出す。通信はせず、撃ったことだけを合図に各自で出す
          const yaw = this.remotes.ejectFrom(message.id, this.ejectPos);
          if (yaw !== null) this.casings.eject(this.ejectPos, yaw);
          const sound = weaponOf(kind).shotSound;
          // 銃声も輪に出す。最も遠くまで届くので、撃ち合いが始まった方角が分かる。
          this.addPing("shot", this.remoteFrom, this.audio.play(sound, this.remoteFrom));
        }
        break;

      case "health":
        this.applyHealth(message);
        break;

      /*
       * スタミナ。**麻酔を受けた本人にだけ届く。**
       *
       * 眠るかどうかを決めるのはサーバー。こちらは知らせを受けて倒れるだけで、
       * **自分で起きられない** — 起きられるなら麻酔は効かない。
       */
      case "stamina": {
        this.stamina = message.stamina;
        const left = (message.sleepUntil - Date.now()) / 1000;
        if (left > 0) this.player.sleep(left);
        else this.player.wake();
        break;
      }


      /*
       * 自分の本当の値。**3 秒ごとに届く。**
       *
       * 撃った瞬間に減らすのも、体力 0 で倒れるのもこちらがやっている
       * (押した瞬間に返らないと手触りが壊れる)。ここで受けるのは
       * 「本当はこう」という値だけで、**ずれていたら合わせる**ために使う。
       * 普段は一致しているので何も起きない。
       */
      case "self":
        this.applySelf(message);
        break;


      // 繋ぎ直したときに届く、離脱前の続き。
      //
      // 湧き地点へは戻さない。**その命の続き**なので、居た場所に居た体力で戻る。
      // 弾数もサーバーがレプリカを持っているので、そちらを正とする
      case "resume":
        this.player.resumeAt(message.x, message.y, message.z, message.health);
        // **選んである装備を戻す。** ここを抜かすと、こちらだけ既定値の手榴弾に
        // 戻って、投げの型を出しているのにサーバーはクレイモアのまま、になる
        this.loadout.support = message.support;
        this.loadout.primary = message.primary;
        /*
         * **持ち物を組み直す。**
         *
         * 画面を読み直すと Inventory は既定 (AK47) で作られる。装備を戻すだけ
         * では手の中は既定のままで、**P90 を選んでいたのに AK を持って戻る**。
         * 戻した装備から組み直してから、残弾を当てる (順番が要る)。
         */
        this.inv.refill(this.loadout);
        // **持っている銃にだけ当てる。** サーバーはまだ銃ごとの表で返してくるが、
        // こちらは持っている物しか持たない。持っていない銃の弾は捨てる
        this.inv.restore(message.magazine, message.reserve, message.grenades);
        this.pendingLoadout.support = message.support;
        this.pendingLoadout.primary = message.primary;
        this.pendingLoadout.secondary = message.secondary;
        this.onLoadout?.(this.pendingLoadout);
        // 銃を持たない部屋では持ち替えない。手にあるのはナイフ
        if (message.primary) void this.player.equip(message.primary);
        this.follow.snapTo(this.player, this.cameraWorld);
        break;

      /*
       * スキルが決まった。**送った物ではなく返ってきた物を持つ。**
       *
       * 弾かれたときも今の値が返るので、こちらの画面だけ選び直したつもりで
       * 残らない。途中参加した人はそもそも送っていない (窓が閉じている) ので、
       * これが唯一の入り口になる。
       */
      case "skills":
        this.skills = message.skills as Skills;
        // 速さは体が持っている。**同じ値を 2 か所に置かない** — 渡し忘れると
        // 「散布だけ締まって走りは素のまま」という半端な効き方になる
        this.player.setSkills(this.skills);
        break;

      // 自分が湧いたことは life で分かる。ここで受けるのは他人の跳躍だけ
      case "respawn":
        if (message.id !== this.net.id) this.remotes.warp(message.id);
        break;

      // 光っている人 (個人戦の 1 位) を体に出す。レプリカは持っているが、
      // 光らせるのは絵の仕事
      case "match":
        this.remotes.setLeaking(message.leader ?? null);
        break;

      /*
       * 抜いた相手が光り始めた (ENEMY EXPOSURE)。
       *
       * **届くのは抜いた側だけ。** サーバーが宛先を決めているので、
       * ここで陣営を見る必要は無い。同じ通で遮蔽も外れるので、
       * 壁の裏に居た相手の位置がこの後から流れてくる。
       */
      case "exposed":
        this.remotes.expose(message.id, message.seconds);
        break;

      case "throw":
        // 初速だけが届く。同じ物理を同じ地形に対して解くので、
        // 跳ねる場所も落ちる場所もこちらで求まる。
        // 飛んでいる間は見えず、止まったところで現物が現れる。
        this.remoteFrom.fromArray(message.from);
        this.remoteTo.fromArray(message.dir);
        this.thrown.throwFrom(this.remoteFrom, this.remoteTo, true);
        break;

      case "knock":
        if (message.hit !== this.net.id) break;
        this.player.knockBack(message.x, message.z);
        break;

      case "grenade":
        // 番号 0 は捨てる。番号を振るのはサーバーなので、0 のまま届いたものは
        // 中継されただけの申告であって、飛ばしてもらえていない。
        // (手榴弾を知らない古いサーバーに繋ぐと、既定の中継でこれが起きる。
        //  原点に極小の手榴弾が現れ、いつまでも爆発しない)
        if (message.id <= 0) {
          console.warn("[手榴弾] サーバーが飛ばしていない。サーバーが古い可能性");
          break;
        }
        // 位置も速度もサーバーが決めたものをそのまま使う。自分が投げたものも
        // 例外にしない — 手元で先に飛ばして後から合わせると、
        // 見えている場所と爆ぜる場所がずれる
        this.grenades.spawn(message.id, message.from, message.velocity);
        break;

      case "explosion": {
        this.explode(message.id, message.at);
        break;
      }

      // **置いたのが自分でも他人でも鳴らす。** 落ちた場所で鳴るので、
      // 見えていなくても「そこで誰かが捨てた」ことが耳に入る
      case "dropped": {
        this.drops.place(message.id, message.weapon, message.at, message.yaw);
        const at = this.drops.positionOf(message.id);
        if (at) this.audio.play("drop", at);
        break;
      }

      /*
       * 拾われた / 消えた。**音と後片付けはここ 1 か所。**
       *
       * 拾った本人には picked も届くが、あちらでは消さない。消してしまうと
       * この通が来たときに置き場所が分からず、**拾った本人にだけ音が鳴らない**。
       * (実際そうなっていた。他の人には聞こえていたので気づきにくい)
       */
      case "droppedGone": {
        const at = this.drops.positionOf(message.id);
        if (at) this.audio.play("pick", at);
        this.drops.remove(message.id);
        break;
      }

      // 拾えた。**中身はここで初めて分かる** (見ただけでは残弾は読めない)
      case "picked": {
        const found =
          message.count !== undefined && message.count > 0
            ? { id: message.weapon as never, count: message.count }
            : { id: message.weapon as never, ammo: message.ammo ?? 0, reserve: message.reserve ?? 0 };
        this.inv.pick(found);
        // **消すのは droppedGone の側。** ここで消すと、あちらが鳴らす音の
        // 置き場所が無くなる (自分にだけ聞こえない、になる)
        break;
      }

      /*
       * 置かれたクレイモア。**自分の物なら、ここで初めて残り数を減らす。**
       *
       * 置けるかを決めているのはサーバー (壁の中や縁の外へは置けない)。送った
       * 時点で減らしていたので、断られると**置けていないのに減る**ことがあった。
       *
       * 同じ物が二度来る (見え隠れするたびに配られる) ので、初めて見た物だけ数える。
       */
      case "claymorePlaced": {
        const mine = message.owner === this.net.id && !this.claymores.has(message.id);
        this.claymores.place(message.id, message.at, message.yaw);
        if (mine) this.inv.spendOf("claymore");
        break;
      }

      case "claymoreGone": {
        // 位置を先に取る。消してから爆発を出すと出す場所が分からない
        const mesh = this.claymores.at(message.id);
        this.claymores.remove(message.id);
        if (message.blast && mesh) {
          const gain = this.audio.play("claymore", mesh, 1);
          this.addPing("shot", mesh, gain);
          this.blast.explode(mesh);
        }
        break;
      }

      case "knockdown":
        this.player.knockDown();
        // 爆心と逆へ飛ばす。**向きだけ届く** — 動かすのはこちら
        this.player.knockPush(message.dirX, message.dirZ);
        // 転べば手が緩む。**握っていた手榴弾は足元へ** (落としたのはサーバー)
        this.loseHeldGrenade();
        this.audio.play("blastScream", this.player.position);
        break;

      // 名前と所属はレプリカが受け取っている。ここでやるのは折り返しだけ —
      // 参加を知ったら即座に返す。相手の画面に現れるまでを次の周期まで待たせない
      case "join":
        this.broadcast();
        break;

      case "noise":
        this.hearNoise(message);
        break;

      // サーバーが状態を移した。装備画面も、倒れる姿勢も、無敵の見た目も
      // ここから出る。推し量る側の判断はどこにも残さない
      // 他人のぶんはレプリカが受け取っている (sync / died)
      case "life":
        if (message.id === this.net.id) this.setLife(message.state);
        break;

      // 遮蔽の裏へ入った。位置が止まるのを待たずに消す。
      // 待つと、遅れて届いているだけの相手と区別が付かない
      case "hidden":
        this.remotes.hide(message.id);
        break;


    }
  }

  /**
   * サーバーが確定させた体力を反映する。
   *
   * 自分の体力もここでしか変わらない。撃たれた瞬間に自分で減らすと、
   * サーバーの計算とずれて「死んだはずが生きている」が起きる。
   * 表示が一拍遅れる代わりに、全員が同じ数字を見る。
   */
  /**
   * サーバーが持っている自分の値と突き合わせる。
   *
   * --- 直し方は物によって違う ---
   * 弾数は**黙って合わせる**。ずれる原因は「撃った申告が届かなかった」なので、
   * 音も画面の反応も要らない — 数字が正しくなればよい。
   *
   * 体力は**合わせない。** 減ったことは health の報せが音と画面の反応ごと
   * 運んでいて、こちらで上書きすると**同じダメージを 2 回受けたように見える**。
   * ここでは食い違いを控えるだけにして、直すのは health の道に任せる。
   */
  /**
   * 名簿を待っている間、**1 秒ごとに頼み直す**。
   *
   * 間隔を空けるのは、届くまでの往復のあいだに何十通も投げないため。
   * 1 秒あれば往復は済んでいるので、それでも来ないなら落ちている。
   */
  private askRosterIfWanted(): void {
    if (!this.rosterWanted) return;
    const now = Date.now();
    if (now - this.rosterAskedAt < ROSTER_RETRY) return;
    this.rosterAskedAt = now;
    this.net.send({ type: "refetchRoster" });
  }

  private applySelf(message: SelfMessage): void {
    applySelf(this.self, message);

    const gun = this.weapon.id;
    const drift = driftOf(
      this.self,
      {
        health: this.player.health,
        magazine: this.inv.ammoOf(gun),
        reserve: this.inv.reserveOf(gun),
        grenades: this.inv.supportCount,
      },
      gun,
    );

    // 弾数と投擲物だけ合わせる。**持っている物にだけ当たる** (restore)
    if (drift.magazine !== 0 || drift.reserve !== 0 || drift.grenades !== 0) {
      this.inv.restore(message.magazine, message.reserve, message.grenades);
    }
  }

  private applyHealth(message: HealthMessage): void {
    /*
     * 削られた人の足元に血を落とす。**弾も爆風もここを通る。**
     *
     * 撃った所ではなく health で見るのは、道が 1 本だからで — 手榴弾も
     * クレイモアも落下も、削れたことは全部この報せで届く。撃つ側に書くと
     * **爆風のぶんを書き忘れる**。
     *
     * 体ではなく地面に残す。体に貼るには骨で動く頂点に沿わせる必要があって
     * 費用が跳ね上がるが、地面なら弾痕と同じ仕掛けでよい。
     */
    if (message.damage > 0) {
      const at =
        message.id === this.net.id
          ? this.player.position
          : this.remotes.positionOf(message.id);
      if (at) this.shots.blood(at);
    }

    if (message.id !== this.net.id) {
      // 体力そのものはレプリカが持っている (sync)。ここは見た目の反応だけ
      if (message.flinch) this.remotes.flinch(message.id);
      // 倒れた相手の叫びは life で鳴らす (倒れたと決めるのは体力ではなく状態)。
      // 倒れなかった頭への一発はうめきになる。近くの相手にだけ届く。
      if (message.zone === "HEAD" && message.damage > 0) {
        const at = this.remotes.positionOf(message.id);
        if (at) this.addPing("shot", at, this.audio.play("pain", at));
      }
      return;
    }

    // **仰け反れば手が緩む。** 振りかぶったまま頭を撃たれたら足元に落ちる
    if (message.flinch) this.loseHeldGrenade();
    // 倒れる向きはサーバーが決める (位置と向きの両方を持っているので)。
    // **他人の画面にはこちらの姿勢として届く** — 見た側が撃たれた向きを読める
    const died = this.player.setHealth(message.health, message.flinch, message.fromBehind);
    if (message.damage > 0) {
      this.lastHitZone = "HIT";
      this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
      // サーバーが計算した方向をそのまま使う。誰に撃たれたかは知らされない。
      if (message.fromBearing !== undefined) {
        this.soundRing.hitFrom(message.fromBearing);
      }
    }
    // 倒れたことは表示だけの問題。復帰の時計はサーバーが持っている。
    if (died) {
      this.player.setFiring(false);
      // 倒れたら繋がりは切れる。生き返ったら結び直し
      this.remotes.clearLinks();
      this.audio.play("scream", this.player.position);
    } else if (message.zone === "HEAD" && message.damage > 0) {
      // 頭に当たったのに立っている。仕留められなかったことが音で分かる
      this.audio.play("pain", this.player.position);
    }
  }

  /**
   * 陣営の湧き地点へ置く。
   *
   * 位置を決めるのはクライアント。地形を知っているのがこちらだけなので。
   * サーバーは「復帰してよい」とだけ言う。
   */
  private placeAtSpawn(): void {
    /*
     * 湧く場所。**陣営で分かれない部屋は散らす。**
     *
     * 個人戦で角の 2 つに全員が湧くと、出た所で撃ち合いになって「湧き待ち」が
     * 成立する。8 点から選んで、死ぬたびに変える (同じ所へ戻ると待たれる)。
     */
    const spawns = STAGES[this.stageName];
    const solo = spawns.solo;
    const base = MODES[this.replica.mode].teams
      ? spawns.bases[this.replica.team]
      : solo[Math.floor(Math.random() * solo.length)];
    // 同じ点に重なると互いが見えないので、ID から決まる向きへ散らす
    const spread = spawnAngle(this.net.id + this.shotCount);
    // 高さは点が持っている。**地形からは決まらない** — 同じ柱に床が
    // 何枚もあるので (domain/stage の Spot)
    this.player.position.set(
      base.x + Math.cos(spread) * SPAWN_SPREAD,
      base.y ?? 0,
      base.z + Math.sin(spread) * SPAWN_SPREAD,
    );
    // 跳んだ距離を足音に積ませない。積むと着いた先で連打になる
    this.player.warpTo(this.player.position.x, this.player.position.z);

    this.faceCentre();
  }

  /**
   * ステージの中央を向く。
   *
   * 向きを触らないと、倒された時のカメラ (倒した相手を映していた) の向きが
   * そのまま残る。湧いた瞬間にステージの外を眺めていることが多かった。
   *
   * yaw = θ のとき前方は (-sinθ, -cosθ)。中央 (0,0) へ向けるなら
   * (-sinθ, -cosθ) ∝ (-x, -z) なので sinθ = x/d, cosθ = z/d。
   * **符号を 1 つ間違えると外を向く** — 直そうとしていた不具合そのものになる。
   *
   * **カメラがまだ無いことがある。** 最初の 1 回は構築の途中から呼ばれていて、
   * this.follow はもっと後で作られる。構築順に依存する書き方をしたせいで
   * 「undefined の yaw に代入した」で落ちた。
   *
   * 無ければ何もしなくてよい。構築時の湧きは**所属が分かる前の仮置き**で、
   * 名簿で所属を受け取った時 (roster) と湧くたび (spawning) に置き直される。
   * 向きが要るのはそちらで、そこでは既にカメラがある。
   */
  private faceCentre(): void {
    if (!this.follow) return;
    this.follow.yaw = Math.atan2(this.player.position.x, this.player.position.z);
  }

  /**
   * 数字キーで主武器を選ぶ。
   *
   * ポインタを掴んだままなので画面のボタンは押せない。押せるようにするには
   * ポインタを離す必要があり、そうすると死んでいる間に視点が動かせなくなる。
   * 選ぶのはキーで済ませる。
   */
  private updateLoadoutKeys(): void {
    if (!this.canChooseLoadout) return;
    /*
     * Enter。**支度の段階では READY の切り替え、それ以外は湧く。**
     *
     * 同じキーに 2 つの意味を持たせているのは、押す場所が同じだから — 画面の
     * 一番下のボタンが「READY」から「OK」に変わるだけで、位置も操作も同じ。
     * 別のキーにすると、始まる前と後で押す指が変わる。
     */
    if (this.input.tapped("spawn")) {
      if (this.replica.match?.phase === "ready") this.setReady(!this.selfReady);
      else this.requestSpawn();
    }
    // **番号は並び順から出す。** 主武器が 1 から、投擲はその続き。
    // 直に書くと、銃が 1 挺増えたときに番号が重なる (P90 を足して実際に重なった)
    const choices = this.primaries;
    choices.forEach((id, i) => {
      if (this.input.slotPressed(i)) this.setLoadout(id);
    });
    // 副武器。**主武器の続き番号。** 持たせない部屋では番号ごと詰める
    const seconds = this.secondary === null ? [] : CHOICES.secondary;
    seconds.forEach((id, i) => {
      if (this.input.slotPressed(choices.length + i)) this.setSecondary(id);
    });
    SUPPORTS.forEach((id, i) => {
      if (this.input.slotPressed(choices.length + seconds.length + i)) this.setSupport(id);
    });
  }

  /**
   * 自分がどういう状態に居るか。**サーバーが決めたもののレプリカ。**
   *
   * 以前はここが無く、「体力が 0 か」「試合の段階は何か」から必要な場所で
   * 都度組み立てていた。組み立て方が場所ごとにずれて不具合になっていたので、
   * 権威が言ってきた 1 つの値だけを見る (src/domain/player/lifecycle.ts)。
   */
  private life: Life = "joining";
  /** その状態に入った時刻 (Date.now)。残り秒数の表示に使う */
  private lifeAt = Date.now();

  /**
   * サーバーが状態を移した。
   *
   * 装備画面の出し入れも、無敵の見た目も、入力を受けるかも全部ここから出る。
   * 「開いているか」という別のフラグは持たない — 持つと、状態とフラグの 2 つが
   * 食い違い得る場所が生まれる (実際、フラグが閉じたまま開き直らない不具合があった)。
   */
  private setLife(state: Life): void {
    if (this.life === state) return;
    this.life = state;
    this.lifeAt = Date.now();

    // 支度へ移った。倒した相手を映すのをやめて、自分の湧き地点へ戻る。
    // ここで初めて装備画面が出るので、その背景が自分の湧き地点になる
    if (state === "choosing") {
      this.replica.killedBy = "";
      this.placeAtSpawn();
      this.player.respawn();
      this.follow.snapTo(this.player, this.cameraWorld);
    }

    // 戦場へ出た。装備が確定して、持ち物が配り直される
    if (state === "spawning") this.respawnSelf();
  }

  /**
   * 倒した相手の id。倒れている間だけ入っている。
   *
   * その 5 秒はこの人を映す。遮蔽の裏に居てもサーバーが位置を配ってくれる
   * (倒れている間だけ)。
   */

  private readonly killCamAt = new THREE.Vector3();

  /**
   * 倒した相手を映すか。映すなら killCamAt にその足元が入る。
   *
   * 相手が見つからない (自爆した、退出した) ときは映さない。
   * その場合は倒れた自分の体をそのまま映し続ける
   */
  private get killCamTarget(): THREE.Vector3 | null {
    if (!isDowned(this.life) || !this.replica.killedBy) return null;
    const at = this.remotes.positionOf(this.replica.killedBy);
    if (!at) return null;
    return this.killCamAt.copy(at);
  }

  /** ポインタを離しているか。出ている画面が変わったときだけ触る */
  private loadoutHadPointer = false;

  /**
   * 装備の画面に合わせてポインタを離す / 掴み直す。
   *
   * **毎フレーム、実際に出ているかを見て決める。** 開いたり閉じたりした瞬間だけ
   * 触っていると、死んで画面が出た瞬間には走らない (開いているかどうかは
   * 変わっておらず、組める場面になっただけなので)。
   * 掴んだままだとキーを押すたびに視点が飛び、毎回 Esc を押す羽目になる。
   */
  private syncLoadoutPointer(): void {
    const showing = this.loadoutBlocking;
    if (showing === this.loadoutHadPointer) return;
    this.loadoutHadPointer = showing;
    this.input.wantsLock = !showing && !this.menuOpen;
    if (showing) document.exitPointerLock();
    else if (!this.menuOpen) this.input.grab();
  }

  /**
   * 自分から部屋を出る。
   *
   * 黙って切ると、サーバーは「うっかり切れた人」として席を 30 秒空けて待つ。
   * 残った側はその間、居ない相手を相手に立たされる (試合は続いているのに
   * 誰も来ない)。出ると決めたことは伝えてから切る。
   */
  leaveRoom(): void {
    this.net.send({ type: "leave", id: this.net.id });
  }

  /**
   * 画面の OK。**閉じるのではなく戦場へ出る。**
   *
   * 湧かせてよいかを決めるのはサーバー (支度に入って CHOOSE_FLOOR 秒
   * 経つまでは通らない)。こちらで閉じてしまうと、通らなかったときに
   * 誰も居ない画面の前で動けなくなる。
   */
  closeLoadout(): void {
    this.requestSpawn();
  }

  private requestSpawn(): void {
    if (!this.canChooseLoadout) return;
    if (this.chooseElapsed < CHOOSE_FLOOR) return;
    this.net.send({ type: "spawn" });
  }

  /** いま装備の画面が出ているか。状態がそのまま答えになる */
  private get loadoutBlocking(): boolean {
    return this.canChooseLoadout;
  }

  /**
   * 装備を組めるか。
   *
   * **サーバーの状態をそのまま問う。** 以前はここで
   * 「倒れている or 試合前」と組み立てていて、試合の段階から人の都合を
   * 代弁していた。そのせいで、先に部屋へ入って 30 秒待った人は始まる時に
   * 画面が閉じたままになり、試合中に入ってきた人には最初から出なかった。
   */
  private get canChooseLoadout(): boolean {
    return canChoose(this.life);
  }

  /** 支度に入ってから経った時間 (秒) */
  private get chooseElapsed(): number {
    return (Date.now() - this.lifeAt) / 1000;
  }

  /**
   * 装備に従って持ち物を配り直す。
   *
   * 生き返ったら両方満タン。持ち替えの都合で片方だけ空、を持ち越さない。
   */
  private refillFromLoadout(): void {
    this.inv.refill(this.loadout);
    this.roundsFired = 0;
  }

  /**
   * この命で撃った発数。投げられる弾倉の出どころ。
   *
   * **リロードの回数では数えない。** 回数だと半分残ったまま替えても増えるので、
   * 篭って替え続けるのが最適になる。撃った弾で数えれば実弾を使わないと増えない。
   */
  private roundsFired = 0;

  /** 1 発撃った。1 弾倉ぶん溜まったら投げられる弾倉が 1 個増える */
  private countRoundForDecoy(): void {
    this.roundsFired++;
    const per = roundsPerDecoy(this.player.equipped);
    if (this.roundsFired >= per) {
      this.roundsFired -= per;
      this.inv.gainMagazine();
    }
  }

  /**
   * 選び直した装備を、待たずに反映してよい場面なら反映する。
   *
   * 組めるのは湧くときだけなので、その場面では**すぐ**効かせる。
   * 次の湧きを待つと、支度の間に選び直した分が 1 試合ぶん遅れて効く。
   * サーバーも同じドメインルールで手榴弾を配っているので、ここを揃えないと
   * 画面には 3 個あるのに投げられない、が起きる。
   */
  private applyLoadoutNow(): void {
    if (!this.canChooseLoadout) return;
    this.loadout = { ...this.pendingLoadout };
    this.refillFromLoadout();
  }

  /**
   * 次に湧いたときの装備を決める。
   *
   * 反映されるのは次に湧いたとき。いま持っている物は変わらない。
   */
  setLoadout(primary: WeaponId | null): void {
    this.pendingLoadout.primary = primary;
    this.sendLoadout();
    this.applyLoadoutNow();
    this.onLoadout?.(this.pendingLoadout);
  }

  /**
   * 副武器を選ぶ。**その部屋が持たせない場合は何もしない。**
   *
   * 拳銃が 1 挺しか無かった頃は選ぶ物が無かった。麻酔銃 (M9) と殺傷 (M1911) に
   * 分かれてからは、**どちらを腰に提げるか**が判断になっている。
   */
  /**
   * 支度が済んだと言う / 取り消す。
   *
   * **決めるのはサーバー。** 押した瞬間にこちらで印を付けない — 名簿が
   * 配り直されて戻ってくるので、そこで全員ぶんまとめて反映される。
   * 先に付けると、弾かれた時 (試合が始まっていた等) にずれる。
   */
  setReady(ready: boolean): void {
    this.net.send({ type: "ready", ready });
  }

  /** 自分が READY を押しているか。**名簿が答え** (押した瞬間には変わらない) */
  private get selfReady(): boolean {
    return this.replica.match?.players.find((p) => p.id === this.net.id)?.ready === true;
  }

  setSecondary(secondary: WeaponId): void {
    if (this.secondary === null) return;
    this.pendingLoadout.secondary = secondary;
    this.sendLoadout();
    this.applyLoadoutNow();
    this.onLoadout?.(this.pendingLoadout);
  }

  /**
   * 選んだ物をサーバーへ知らせる。
   *
   * 数を持っているのがあちらなので、伝えないと選んだ物と配られる物が食い違う。
   * **主武器も送る。** 遊びの上では要らないが、繋ぎ直したときに返してもらうため
   * (読み直すとこちらは既定値へ戻る)。
   */
  private sendLoadout(): void {
    this.net.send({
      type: "loadout",
      support: this.pendingLoadout.support,
      primary: this.pendingLoadout.primary,
      // 持たせない部屋 (null) では送らない。**送ると弾かれる**
      secondary: this.pendingLoadout.secondary ?? undefined,
    });
  }

  /**
   * 投擲の枠を選ぶ。
   *
   * サーバーへ知らせる。手榴弾の数を持っているのがあちらなので、
   * 伝えないと弾倉を選んでも手榴弾が配られる。
   */
  setSupport(support: SupportId): void {
    this.pendingLoadout.support = support;
    this.sendLoadout();
    this.applyLoadoutNow();
    this.onLoadout?.(this.pendingLoadout);
  }

  /**
   * スキルを 1 つ選び直す。段に 0 を渡せば外す。
   *
   * **こちらでは書き換えない。** 通ったかどうかを決めるのはサーバーで、
   * 結果は skills の通で返ってくる (弾かれたときも今の値が返る)。
   * 先に書き換えると、予算を超えた選択が一瞬効いて見える。
   */
  setSkill(id: SkillId, level: number): void {
    const next: Skills = { ...this.skills };
    if (level <= 0) delete next[id];
    else next[id] = level as 1 | 2 | 3;
    this.net.send({ type: "skills", skills: next });
  }

  /** 選んだことを画面へ知らせる。Game は signal を持たないので、外から差し込む */
  onLoadout: ((next: { primary: WeaponId | null; support: SupportId }) => void) | null = null;

  /**
   * 戦場へ出た。
   *
   * 湧き地点へ置くのは支度に移った時点で済んでいる (装備画面の背景が
   * 自分の湧き地点になる)。ここでやるのは持ち物の確定だけ。
   */
  private respawnSelf(): void {
    // 湧くときに装備が確定する。試合中に組み替えても、ここまで反映されない
    this.loadout = { ...this.pendingLoadout };

    if (this.loadout.primary) void this.player.equip(this.loadout.primary);
    this.player.respawn();
    this.refillFromLoadout();
    this.reloadTimer = 0;
    this.reloadSoundIn = 0;
    this.boltIn = 0;
    this.stabTimer = 0;
    this.spread.reset();
    this.follow.snapTo(this.player, this.cameraWorld);
  }

  /**
   * 転がりながら体当たりする。
   *
   * 判定は毎フレーム。転がっている間は位置が動き続けるので、
   * 通り道にいる相手を順に弾いていく形になる。
   */
  private updateRollContact(): void {
    const rolling = this.player.rolling;
    // 転がり始めに履歴を空にする。同じ相手を何度も弾かないため。
    if (rolling && !this.wasRolling) this.rolledInto.clear();
    this.wasRolling = rolling;
    if (!rolling) return;

    const knocks = this.remotes.rollInto(this.player.position, this.rolledInto);
    for (const knock of knocks) {
      this.net.send({
        type: "knock",
        id: this.net.id,
        hit: knock.id,
        x: knock.x,
        z: knock.z,
      });
    }
    if (knocks.length > 0) {
      this.lastHitZone = "KNOCK";
      this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
    }
  }

  /**
   * ダンボールで走っていて敵にぶつかる。**箱が落ちて棒立ちになる。**
   *
   * 見るのは走っている間だけ。止まっている箱に敵が寄ってきても落ちない —
   * 隠れて息を潜めることは成立させたい。落とすのは**こちらから当たりに
   * 行った**ときだけにする。
   *
   * 判定はこちらの機械で行う。ぶつかったのは自分の体なので、自分の位置と
   * 相手の位置を持っているのはこの画面 (体当たり rollInto と同じ形)。
   * **サーバーは検算していない** — 箱を被っているという申告自体が
   * こちら発なので、今の作りではここが素直。
   */
  private updateBoxContact(): void {
    if (!this.player.isBoxed) return;
    // 止まっているなら当たりに行っていない。しきい値は箱の型が
    // 歩きへ移るのと同じ (motion.ts の IDLE_EXIT_SPEED)
    if (this.player.speed < IDLE_EXIT_SPEED) return;

    const touched = this.remotes.touching(this.player.position, BOX_BUMP_RANGE);
    if (!touched.some((other) => this.hostileTo(other.id, other.side))) return;

    this.player.bump();
    // 手も箱から戻す。**選んで降ろしたのではなく取り上げられた**ので、
    // 道具の枠ごと none へ戻す (持ち替えだと枠に C.BOX が残る)
    this.inv.dropTool();
    this.syncHeld();
  }

  /**
   * そこは水面か。**水なら輪を出して true を返す。**
   *
   * 弾も薬莢も手榴弾も囮も、水に落ちたときの見え方は同じ — 輪が広がって
   * 消える。判じ方を 1 か所に置いて、落ちる物ごとに書かない。
   */
  private splashAt(at: THREE.Vector3, strength = 1, sound = true): boolean {
    const water = this.stage.water;
    if (!water) return false;
    /*
     * **水面ちょうどか、その下か。**
     *
     * 長らく「水面より 20cm 上まで」を水として数えていた。地面が水面のすぐ下に
     * あった頃はそれで足りたが、**板が水面の 8cm 上に浮いている**いまは、
     * 板の上に置いた手榴弾まで水として数えてしまう (爆ぜずに水柱が立った)。
     *
     * 沈む物は水面ちょうどに置かれる (ballistic.ts / thrown.ts) ので、
     * 数え落ちを防ぐ幅だけあればいい。
     */
    if (at.y > water.y + SURFACE_TOLERANCE) return false;
    if (Math.abs(at.x) >= water.half || Math.abs(at.z) >= water.half) return false;
    this.shots.splash(at, water.y, strength);
    /*
     * 音も鳴らす。**小さい物は黙る。**
     *
     * 薬莢まで鳴らすと、撃つたびに水音が挟まって足音が埋もれる。落ちたことが
     * 報せになるのは人と投げ物で、そこは大きさで分かれている
     * (薬莢 0.45 / 投げ物 1.6 / 手榴弾 2.2 / 人 2.0〜5.4)。
     *
     * 大きさはそのまま音量に効かせる。歩いて踏み外したのと走って飛び込んだので
     * 違って聞こえる。
     */
    if (sound && strength >= SPLASH_SOUND_MIN) {
      this.audio.play("splash", at, Math.min(1, strength / BODY_SPLASH));
    }
    return true;
  }

  /**
   * 弾道が水面を突いたか。**突いたなら to をそこへ縮める。**
   *
   * 弾は水に当たっても止まる物として扱う。水の下には海底があるので、放って
   * おくと**水面を素通りして 10m 下の底に痕が付く** — 水柱もそこへ出るので、
   * 撃った所とずれた場所に、しかも水面の下で上がる。
   *
   * 当たった地形より水面のほうが手前なら、そこで切る。
   */
  private splashOnPath(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const water = this.stage.water;
    if (!water) return false;
    if (to.y >= water.y || from.y < water.y) return false;
    const t = (water.y - from.y) / (to.y - from.y);
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (Math.abs(x) >= water.half || Math.abs(z) >= water.half) return false;
    to.set(x, water.y, z);
    this.shots.splash(to, water.y);
    return true;
  }

  /** ナイフを振り始める。リロード中と多重の振りは受け付けない */
  private startStab(): void {
    if (this.stabTimer > 0 || this.reloadTimer > 0 || this.player.rolling)
      return;
    this.stabTimer = this.player.stabDuration || FALLBACK_STAB_DURATION;
    this.stabResolved = false;
    this.player.stab();
  }

  /**
   * 刺突の進行。モーションの途中で 1 回だけ判定を出す。
   * 判定はキャラの向きを基準にする (カメラではなく体の正面)。
   */
  private updateStab(dt: number): void {
    if (this.stabTimer <= 0) return;
    const total = this.player.stabDuration || FALLBACK_STAB_DURATION;
    const elapsed = total - this.stabTimer;
    this.stabTimer -= dt;

    if (this.stabResolved || elapsed < total * STAB_HIT_PHASE) return;
    this.stabResolved = true;

    // yaw = θ のときローカル -Z が (-sinθ, 0, -cosθ)
    const yaw = this.player.yaw;
    this.meleeForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const result = this.remotes.hitMelee(
      this.player.position,
      this.meleeForward,
      // 見下ろしていれば倒れている相手にも届く。構えていなければ水平とみなす
      this.player.isAiming ? this.follow.aimPitch : 0,
    );
    if (!result) return;

    // 味方に当てた。申告は送らない (サーバーが捨てるが、送る意味も無い)。
    // 表示だけは出す。当たったこと自体が分からないと、撃ち続けてしまう。
    //
    // **敵かどうかはルールに聞く。** 個人戦では同じ色でも敵で、陣営で見ていると
    // 刺しても何も起きない
    if (!this.hostileTo(result.id, result.side)) {
      this.lastHitZone = "FF";
      this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
      return;
    }

    this.lastHitZone = result.fromBehind ? "BACKSTAB" : "KNIFE";
    this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
    // 刺さった音。**空振りでは鳴らさない** — 当てたかどうかで結果が全部決まる
    this.audio.play("stab", this.player.position);
    this.net.send({
      type: "damage",
      id: this.net.id,
      target: result.id,
      kind: "melee",
      fromBehind: result.fromBehind,
    });
  }

  /** リロードの進行と、押しっぱなしの間 FIRE_INTERVAL ごとの発砲 */
  /**
   * 引き金は 1 本。手にある物が何をするかを決める。
   *
   * **撃つ・投げる・刺すが同じボタンになる。** 持ち替えて使う形にした以上、
   * 物ごとに別のキーを割り当てると「持ち替えたのに別のキーを押す」ことになって、
   * 持ち替えたこと自体が意味を失う。
   */
  private updateTrigger(): void {
    if (!canAct(this.life) || this.loadoutBlocking) return;
    if (this.inv.switching) return;
    if (this.inv.held !== "knife") return;
    // ナイフは押した瞬間に振る。押しっぱなしで連打しない。
    // 引き金の面倒は持ち物が見る (domain/item/trigger.ts)
    if (this.input.firing && this.inv.pressedOnce) {
      this.inv.consumePress();
      this.startStab();
    }
  }

  private updateWeapon(dt: number): void {
    // 撃つ手を止めたらパターンを頭に戻す。バースト射撃が意味を持つのはこのため。

    // ボルト操作の開始待ち
    if (this.boltIn > 0) {
      this.boltIn -= dt;
      if (this.boltIn <= 0) {
        this.boltIn = 0;
        this.player.playBolt(this.boltRate);
        // ポンプの音。狙撃銃は発砲音に入っているので鳴らさない (boltSound 無し)
        if (this.weapon.boltSound) {
          this.audio.play(this.weapon.boltSound, this.player.position);
        }
      }
    }

    if (this.reloadTimer > 0) {
      // 両立しないことを始めたら中断する (reloadBroken に一覧)
      if (this.reloadBroken()) {
        this.reloadTimer = 0;
        this.reloadSoundIn = 0;
        // **鳴り始めていたら途中で切る。** 起きなかったことの音を残さない
        if (this.reloadSoundToken) this.audio.stop(this.reloadSoundToken);
        this.reloadSoundToken = null;
        this.player.cancelReload();
      }
    }

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        // 予備から足りるぶんだけ移す。弾倉に残っていた分は捨てない
        const kind = this.player.equipped;
        // **終わった瞬間**に知らせる。始まりではなく終わりを送ることで、
        // サーバーは銃ごとの装填の尺を持たなくてよくなる
        if (this.inv.reload()) this.net.send({ type: "reload", weapon: kind });
      }
      // 弾倉に手が掛かる頃に鳴らす。近くの相手には「いま撃てない」が伝わる
      if (this.reloadSoundIn > 0) {
        this.reloadSoundIn -= dt;
        if (this.reloadSoundIn <= 0) {
          this.reloadSoundIn = 0;
          this.audio.play(this.weapon.reloadSound, this.player.position);
          // 中断したら途中で止められるように控える
          this.reloadSoundToken = this.audio.lastToken;
        }
      }
    }

    /*
     * 伏せて装填している間は這えない。**替えるか進むかのどちらか。**
     *
     * 這い出したら中断、にはしない — 打ち消された動作の弾倉の音を、押した
     * 本人だけが聞くことになる (他人へ届くのは終わったときの通知だけ)。
     * 動けないほうが、押した意味がそのまま残る。
     *
     * 起き上がるのは通す。あちらは中断になるので、**動きたいなら姿勢を
     * 変える**という一手が代償として残る。
     */
    this.player.setReloadHold(this.reloadTimer > 0);

    if (this.input.tapped("reload")) this.startReload();

    this.fireCooldown -= dt;

    /*
     * 弾が無いのに引き金を引いた。撃てないことを音で返す。
     *
     * 何も起きないと、撃てているのか当たっていないのかが分からない。
     * 自動でリロードはしない — 弾を切らしたこと自体が代償なので、そこを
     * 黙って埋めると弾数を数える意味が消える。
     *
     * **手にあるのが銃のときだけ。** 残弾は「持ち物に ammo があれば その値、
     * 無ければ 0」なので (domain/item/inventory.ts)、ナイフや手榴弾を持って
     * いる間もずっと 0 になる。刺すたびに空撃ちの音が鳴っていた。
     */
    if (this.emptyCooldown > 0) this.emptyCooldown -= dt;
    if (
      this.input.firing &&
      this.player.isAiming &&
      canAct(this.life) &&
      isGun(this.inv.held) &&
      this.reloadTimer <= 0 &&
      this.ammo <= 0 &&
      this.emptyCooldown <= 0
    ) {
      this.audio.play("empty", this.player.position);
      this.emptyCooldown = EMPTY_INTERVAL;
    }

    /*
     * 撃てるか。**問いは 1 つ、答えるのは domain。**
     *
     * 以前はここに 9 個の && が並んでいた。ドメインルール (装填中は撃てない、
     * 転がりながらは撃てない) と、装置の話 (ボタンが押されているか) と、
     * 単発の再現 (離して押し直したか) が同じ行に混ざっていて、**どれを変えると
     * 遊びが変わるのかが読めなかった**。
     *
     * 渡すのは真偽だけ。秒を数えるのはこちらの仕事で、domain が数え始めると
     * three の時間と二重管理になる。
     */
    const firing = this.inv.canShoot(this.weapon, {
      held: this.input.firing,
      aiming: this.player.isAiming,
      life: this.life,
      reloading: this.reloadTimer > 0,
      stabbing: this.stabTimer > 0,
      rolling: this.player.rolling,
      crawling: this.player.crawling,
      landing: this.player.landing,
      ammo: this.ammo,
    });
    this.player.setFiring(firing);

    if (!firing || this.fireCooldown > 0) return;
    // ボルト操作がある銃は、動作が終わるまで次を撃てない。
    // クリップの尺を優先するので、動きと撃てない時間が必ず一致する。
    //
    // 動作は撃った瞬間ではなく少し置いてから始める。撃った反動を受けてから
    // 手を掛ける、という順になる。
    if (this.weapon.bolt && this.player.boltDuration > 0) {
      /*
       * ポンプ / ボルトの速さ。**銃ごとの重さに、極めた度合いを掛ける。**
       *
       * 撃てない時間は型の尺そのもの。同じ倍率で割って待つので、**動きと
       * 待ち時間が必ず一致する** (片方だけ変えると、型が終わったのに撃てない
       * 時間が残る)。
       */
      this.boltRate =
        (this.weapon.boltScale ?? 1) / masteryReloadScale(this.skills, this.weapon.id);
      this.boltIn = this.knobs.boltDelay;
      this.fireCooldown = this.knobs.boltDelay + this.player.boltDuration / this.boltRate;
    } else {
      this.fireCooldown = this.weapon.fireInterval;
    }
    // 単発の銃はここで引き金を使い切る。次は離して押し直すまで出ない
    this.inv.fired(this.weapon);
    this.fire();
  }

  /**
   * 始めた装填が続けられなくなったか。
   *
   * --- なぜ要るか ---
   * 始めるのを塞ぐ条件は前からあった (startReload) が、**逆向きが無かった。**
   * 始めた後に別のことを始めると、両方が通る:
   *
   *     転がる      転がりながら弾倉を替え終わる
   *     箱を被る    被ったまま替え終わる
   *     這き出す    動きながら替え終わる
   *     起き上がる  伏せの型のまま立ちで替え終わる
   *     持ち替える  **今持っている別の銃に弾が入る**
   *
   * どれも「始めるときは弾いているのに、始めた後なら通る」という同じ形。
   * 塞ぐ側と対にして、ここに並べておく。
   *
   * 弾は入らない。押し直しになるが、**別のことを始めたのは本人**。
   */
  private reloadBroken(): boolean {
    if (this.player.rolling || this.player.isBoxed) return true;
    // 伏せて動く / 姿勢をまたぐ。装填の型は姿勢ごとに違う (animation.ts の reloadKey)
    if (this.player.crawling || this.player.isProne !== this.reloadProne) return true;
    // 替えている銃を持っていない。**手にある物に弾が入ってしまう**
    return this.weapon.id !== this.reloadWeapon;
  }

  private startReload(): void {
    if (this.reloadTimer > 0 || this.stabTimer > 0 || this.player.rolling)
      return;
    // 這いながらは弾倉を替えられない。撃つのと同じ (domain/item/inventory.ts)。
    // 伏せへの出入りの最中も同じ — 型が全身で決まっているので手が塞がっている
    if (this.player.crawling || this.player.proneShifting) return;
    // どの姿勢で始めたかを控える。**途中で姿勢が変わったら中断する**
    this.reloadProne = this.player.isProne;
    this.reloadWeapon = this.weapon.id;
    this.reloadSoundToken = null;

    // ボルトを送り終えるまでは弾倉に触れない。
    //
    // 持ち替え・ダンボール・ローリングで飛ばせないようにしてあるのと同じドメインルール。
    // ここが抜けていて、撃った直後に R を押すとコッキングを省略できた。
    if (this.cocking) return;
    if (this.ammo >= this.weapon.magazine) return;
    // 予備が尽きていたら替えるものが無い
    if (this.inv.reserve <= 0) return;
    /*
     * **時間を決めるのは武器の表。** 型はそこへ合わせて伸び縮みする。
     *
     * 以前はクリップの尺 (3.33 秒) をそのまま使っていたので、**どの銃も同じ
     * 時間**だった。表には P90 3.0 / AK47 2.5 / XM2010 3.2 と書いてあるのに
     * 手応えが同じで、選んだ銃が入っていないように感じる。
     */
    // **極めた銃だけ速い。** 拾った銃は素の尺のまま (masteryReloadScale)
    this.reloadTimer = this.weapon.reload * masteryReloadScale(this.skills, this.weapon.id);
    this.player.playReload(this.reloadTimer);
    // 音は動作に合わせて遅らせる (下の updateWeapon で鳴らす)
    this.reloadSoundIn = this.reloadTimer * this.knobs.reloadSoundAt;
    // 覗いたままだと入れ替えの間ずっと視界が狭い。肩越しへ戻す
    this.zoomStep = 0;
  }

  private fire(): void {
    this.follow.aimOrigin(this.aimOrigin);
    this.follow.aimDirection(this.aimDir);
    {
      // 何度・どこへ散るかはドメインルールが決め、傾けるのは幾何がやる
      const cone = this.spread.coneFor(this.weapon, this.shotCount, this.skills);
      offsetInCone(this.aimDir, cone.degrees, cone.angle01, cone.radius01);
    }

    /*
     * 粒ごとに道を引く。**散弾以外は 1 粒なので今まで通り。**
     *
     * 狙いの散布は 1 発につき 1 つ (上で当てた) で、そこからさらに粒ごとに
     * 散らす。当たった数だけ削れるので、**近いほど効く**が距離の減衰では
     * なく当たる粒の数として出る。
     *
     * 音・排莢・反動・弾の消費は 1 発につき 1 回。粒の数だけ鳴らすと
     * 撃つたびに音が重なって割れる。
     */
    const pellets = pelletsOf(this.weapon);
    // 狙いの向き。粒はここから散らすので、粒ごとに取り直さない
    this.pelletBase.copy(this.aimDir);
    let hitPlayer: { player: RemoteSoldier; zone: HitZone; distance: number } | null = null;
    let hitTerrain: THREE.Intersection | null = null;

    for (let i = 0; i < pellets; i++) {
      if (pellets > 1) {
        this.aimDir.copy(this.pelletBase);
        const grain = this.spread.pelletFor(this.weapon, this.shotCount, i);
        offsetInCone(this.aimDir, grain.degrees, grain.angle01, grain.radius01);
      }
      this.firePellet();
      if (!hitPlayer && this.pelletHit.player) hitPlayer = this.pelletHit.player;
      if (!hitTerrain && this.pelletHit.terrain) hitTerrain = this.pelletHit.terrain;
    }

    // トレーサーだけは銃口から描く。判定は照準線、見た目は銃口という TPS 共通の割り切り。
    this.player.muzzle(this.muzzlePos);
    // 排莢。当たり判定も音も無く、撃っている手応えのためだけに出す
    this.player.ejectPort(this.ejectPos);
    this.casings.eject(this.ejectPos, this.player.yaw);
    this.audio.play(this.weapon.shotSound, this.muzzlePos);
    // 撃っている間は何も聞こえない
    this.soundRing.suppress(1);
    /*
     * 水面を叩いたか。**痕ではなく輪を出す** (splashAt が両方やる)。
     *
     * 水に穴は開かないし、痕を残すと撃ち合った跡が水面に溜まる。
     */
    const splashed =
      hitPlayer === null && this.splashOnPath(this.muzzlePos, this.hitPoint);

    this.shots.fire(
      this.muzzlePos,
      this.hitPoint,
      // **人に当たったら痕を出さない。** 痕はワールドに置くので、当たった
      // 相手が動いた後もその場に浮いてしまう。削られたことは血で残す (applyHealth)
      hitPlayer || splashed ? null : hitTerrain ? this.hitNormal : null,
      IMPACT_WORLD,
    );
    // 金属に当たった音。**材質は当たった面の名前から引く** (地形と同じ決めごと)
    if (!hitPlayer && !splashed && hitTerrain) this.playImpact(hitTerrain, this.hitPoint);
    this.shotCount++;
    this.inv.spend();
    this.countRoundForDecoy();

    // 弾道と発砲音のためだけの通知。当たったかどうかは damage で別に送っている。
    this.net.send({
      type: "shot",
      id: this.net.id,
      from: [this.muzzlePos.x, this.muzzlePos.y, this.muzzlePos.z],
      to: [this.hitPoint.x, this.hitPoint.y, this.hitPoint.z],
    });

    // 跳ね上がりはドメインルールの側が持っている (domain/item/spread.ts)
    const [kickPitch, kickYaw] = this.spread.fired(
      this.shotCount,
      this.weapon,
      this.skills,
    );
    this.follow.addRecoil(kickPitch, kickYaw);
  }

  /** 粒 1 つぶんの道と、当たったことの申告。散弾以外は 1 発 = 1 粒 */
  private readonly pelletBase = new THREE.Vector3();
  private readonly pelletHit: {
    player: { player: RemoteSoldier; zone: HitZone; distance: number } | null;
    terrain: THREE.Intersection | null;
  } = { player: null, terrain: null };

  private firePellet(): void {
    const shot = this.traceBullet();
    const player = shot.player;
    const terrain = shot.terrain;
    this.pelletHit.player = player;
    this.pelletHit.terrain = terrain;
    // 距離は銃口からではなく照準の起点から測る。弾道の判定と同じ基準にする。
    const distance = shot.distance;
    if (player) {
      /*
       * 撃てる相手か。**陣営ではなくルールに聞く。**
       *
       * 個人戦では同じ色でも敵なので、陣営で見ていると自分の弾が当たらない
       * (申告を送らないので、当てても削れない)。
       */
      const friendly = !this.hostileTo(player.player.id, player.player.side);
      if (!friendly) {
        // 当てたことをサーバーへ申告する。ダメージの数値は決めない。
        this.net.send({
          type: "damage",
          id: this.net.id,
          target: player.player.id,
          kind: "bullet",
          zone: player.zone,
          distance,
        });
      }
      // 表示だけは往復を待たずに出す。狙いを直すのに使う情報なので、
      // 一拍遅れると次の弾に間に合わない。
      //
      // 味方に当てたときは部位を出さない。どこに当たったかは意味を持たず、
      // 知りたいのは「味方を撃った」という一点だけ。
      this.lastHitZone = friendly ? "FF" : `${player.zone} ${distance.toFixed(0)}m`;
      this.lastHitTranq = this.weapon.tranquilizer === true;
      this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
    }
  }

  /**
   * しゃがみと回避を 1 つのキーに載せる。
   *
   *   短く押す … しゃがみの切り替え
   *   押し続ける … ローリング
   *
   * どちらも「体を低くする」動作なので、同じ指で出せるほうが素直。
   * しゃがむ延長に回避があり、深く押し込むと転がる、という感覚になる。
   *
   * ローリングは押している途中で出す。離してから出すと、判断してから
   * 体が動くまでに押していた時間ぶんの遅れが乗る。避ける動作でそれは致命的。
   * しゃがみのほうは離してから出す (押している間はまだどちらか決まらない)。
   *
   * **どちらかを決めるのは入力の側** (infra/input の BINDINGS)。ここは
   * 「しゃがむのか、転がるのか」だけを受け取る — 秒を数えるのも、キーが
   * Space なのかパッドの × なのかも、こちらは知らない。
   */
  private updateStanceInput(): void {
    // 短く押して離した = しゃがみの切り替え
    if (this.input.tapped("stance")) this.player.toggleCrouch();

    if (this.input.holding("stance")) {
      // 長押しが成立した。**1 回の押下につき 1 度だけ転がる**
      if (!this.rolledThisHold) {
        this.rolledThisHold = true;
        // ボルトを送り終えるまでは転がれない。撃って即座に回避、を塞ぐ
        if (!this.cocking) this.player.roll();
      }
      /*
       * **押したまま転がり切ると、立たずに伏せる。**
       *
       * 伏せるための操作を別に置かず、転がりの出口にしてある。飛び込んで
       * そのまま腹這いになる、という一続きの動作になるし、指を離せば
       * 今まで通り立ち上がるので**選んだ結果**として伏せる形になる。
       *
       * 起き上がるのは Space のタップ (player.toggleCrouch)。
       */
      if (this.rolledThisHold && !this.player.rolling) this.player.setProne(true);
      return;
    }

    // 離した。次の押下でまた転がれる
    this.rolledThisHold = false;
  }

  /** この押下でもう転がったか。**1 回の押下につき 1 度だけ** */
  private rolledThisHold = false;

  /**
   * 投げる構えと、離したときの投擲。
   *
   * 押している間は落下点を見せ、離した瞬間に投げる。囮として使う道具なので、
   * どこへ落ちるかを見てから決められないと「そこへ落とす」判断にならない。
   * 押した瞬間に飛ぶ形だと、狙った場所へ落とすのが運になる。
   *
   * 数を限ってあるのは、無制限だと「とりあえず投げ続ける」が最適になって
   * 読み合いにならないため。1 回の命につき数発で、外せば手フラグが減る。
   */
  private updateThrowAim(): void {
    // ボルトを送り終えるまでは投げられない。持ち替え・ダンボール・ローリング・
    // リロードと同じドメインルール。ここが抜けていて、撃った直後に投げるとコッキングを
    // 省略できた
    const canThrow =
      this.inv.held === "magazine" && canAct(this.life) && !this.cocking;
    const held = canThrow && this.input.aiming;
    // 手榴弾・クレイモアと同じドメインルール。構え始めと同じフレームの分も覚えておく
    const pulled = this.triggerEdge || this.pendingDecoy;
    const release = held && this.throwAiming && pulled;

    if (held && !release) {
      this.follow.aimOrigin(this.aimOrigin);
      this.follow.aimDirection(this.aimDir);
      this.thrown.showPreview(
        this.aimOrigin,
        this.aimDir,
        this.stage.collidables,
        this.stage.water,
      );
      if (!this.throwAiming) this.pendingDecoy = this.triggerEdge;
      this.throwAiming = true;
      return;
    }

    if (!this.throwAiming) return;
    this.throwAiming = false;
    this.pendingDecoy = false;
    this.thrown.hidePreview();
    // 構えをやめただけ / 解かされただけ (死んだ・箱に入った) なら投げない
    if (!release || !canThrow) return;

    this.inv.spend();
    this.follow.aimOrigin(this.aimOrigin);
    this.follow.aimDirection(this.aimDir);
    this.thrown.throwFrom(this.aimOrigin, this.aimDir);
    this.net.send({
      type: "throw",
      id: this.net.id,
      from: [this.aimOrigin.x, this.aimOrigin.y, this.aimOrigin.z],
      dir: [this.aimDir.x, this.aimDir.y, this.aimDir.z],
    });
  }

  /**
   * 手榴弾の構えと投擲。
   *
   * 弾倉の囮と同じで、押している間に落下点を見せ、離した瞬間に投げる。
   * どこへ落ちるかを見てから決められないと「そこへ落とす」判断にならない。
   *
   * 信管は**手を離れてから**動き出す。握ったまま溜める手 (cooking) は入れていない。
   * 溜められると、構えている間ずっと残り時間を見せる必要が出てきて、
   * 「落下点を見る」ためのこの画面と役目がぶつかる。
   */
  /**
   * 手にある物で分ける。
   *
   * **投げるのは引き金。** 持ち替えて手にした物を、引き金で使う。物ごとに別の
   * キーを割り当てると「持ち替えたのに別のキーを押す」ことになって、持ち替えた
   * こと自体が意味を失う。
   *
   * **銃と同じ二段。** 構える (Shift / 右クリック) と振りかぶり、引き金 (左
   * クリック) で放す。銃は構えて撃つので、投げ物だけ別の操作にすると持ち替えた
   * ときに指が迷う。落下点は構えている間ずっと見えるので、狙ってから放せる。
   */
  /**
   * 握っていた手榴弾を手放す。
   *
   * **落としたのはサーバー** (転倒と仰け反りの所で足元に置いている)。こちらは
   * その分を持ち物から引いて、構えを畳むだけ。引かないと、画面の残り数だけが
   * 1 個多いまま残る。
   *
   * 振りかぶっていなければ何もしない — サーバーも同じ条件で見ている
   * (holdingGrenade)。
   */
  private loseHeldGrenade(): void {
    if (!this.grenadeAiming && this.grenadeRelease <= 0) return;
    if (this.inv.held === "grenade") this.inv.spend();
    this.grenadeAiming = false;
    this.grenadeRelease = 0;
    this.grenades.hidePreview();
    this.player.cancelThrow();
    this.player.setThrowing(false);
  }

  private updateGrenadeAim(): void {
    // 手榴弾から離れたなら、構えも**落下点も**畳む。
    //
    // 消すのを忘れていて、構えたままダンボールを被ると放物線が出っぱなしに
    // なっていた。持ち替え・箱・死亡のどれでもここを通る
    //
    // **振り切っている最中は畳まない** (grenadeRelease > 0)。最後の 1 個を投げると
    // 持ち物から消えて次の武器へ移るので、投げの型がそこで中断されていた
    if (this.inv.held !== "grenade" && this.grenadeAiming && this.grenadeRelease <= 0) {
      this.grenadeAiming = false;
      this.grenades.hidePreview();
      this.player.cancelThrow();
      this.player.setThrowing(false);
    }
    // クレイモアから離れたときも同じ。**構えっぱなしで腕が上がったまま**になる
    if (this.inv.held !== "claymore" && this.setupAiming && this.setupRelease <= 0) {
      this.setupAiming = false;
      this.player.cancelThrow();
      this.player.setThrowing(false);
    }
    if (this.inv.held === "claymore") {
      this.updateClaymoreSetup();
      return;
    }
    if (this.inv.held !== "grenade") return;
    // 倒れている間は投げられない。しゃがみと箱は許す (箱の中からは出せない)
    const canThrow =
      this.inv.countOf(this.inv.held) > 0 &&
      canAct(this.life) &&
      !this.player.isBoxed &&
      !this.player.downed &&
      // **転がりの絵が流れている間は振りかぶれない。**
      //
      // ローリングは全身の型なので、振りかぶりの型はそこで上書きされる。
      // ここで畳まないと、構えたまま転がった人は転がり終わりに腕を引いた
      // 状態で立ち上がる — 画面には振りかぶりが一度も映っていないのに、
      // クリックすれば即座に飛ぶ。転がりが振りかぶりの時間を丸ごと踏み倒す。
      //
      // **見るのは rolling ではなく rollShowing。** ロック (rolling) は
      // ROLL_EXIT_PHASE で先に解けるので、そこで再開すると振りかぶりが
      // **転がりの尻尾の中で始まって終わる** — 畳んだのに、やはり一度も映らない。
      // 絵が終わるまで待てば、立ち上がってから振りかぶり直すのが見える。
      !this.player.rollShowing &&
      !this.cocking;
    const held = canThrow && this.input.aiming;
    /*
     * 構えている間に引き金を引いたら放す。押しっぱなしで連投しない。
     *
     * **同じフレームで構えて引いた分も覚えておく** (pendingThrow)。Shift と
     * クリックがほぼ同時だと、その回は「構え始め」で消えて、引いたことが
     * 無かったことになっていた。押した意思は消さずに、振りかぶりが始まった
     * 次のフレームで放す。
     */
    const pulled = this.triggerEdge || this.pendingThrow;
    const release = held && this.grenadeAiming && pulled;

    if (held && !release) {
      /*
       * **前の 1 個が手を離れるまで、次を構え始めない。**
       *
       * 構えたまま (Shift を押したまま) 引き金を引くと、その次のフレームには
       * grenadeAiming が倒れていて「構え始め」に見える。そこで振りかぶりを
       * 頭から流し直していたので、**振り上げている最中に前の 1 個が飛んだ**。
       * 振り上げ切った時には 2 個目が構えられている、という形で出る。
       *
       * 手を離れるのは引き金を引いた 1.5 秒後まで遅れることがある
       * (振りかぶりの残りを待つため)。その間は投げの型が流れているので、
       * 新しい振りかぶりを重ねてはいけない。
       */
      if (this.grenadeRelease > 0) return;

      // 構えた瞬間にピンを抜いて振りかぶり始める。腕を引き切った所で止まる。
      // 落下点はその間ずっと見える — どこへ落とすかを見てから放せるように
      if (!this.grenadeAiming) {
        this.player.playThrow();
        // 構え始めと同じフレームに引かれた分を覚えておく
        this.pendingThrow = this.triggerEdge;
      }
      this.grenadeAiming = true;
      this.follow.aimDirection(this.aimDir);
      // 前へ出す量は水平方向だけで測る。見上げているときに近く、
      // 見下ろしているときに遠く、では手の位置が動いて見える
      const flat = Math.hypot(this.aimDir.x, this.aimDir.z) || 1;
      this.grenadeOrigin.set(
        this.player.position.x + (this.aimDir.x / flat) * GRENADE_RELEASE_FORWARD,
        this.player.position.y + GRENADE_RELEASE_HEIGHT,
        this.player.position.z + (this.aimDir.z / flat) * GRENADE_RELEASE_FORWARD,
      );
      this.grenades.showPreview(
        this.grenadeOrigin,
        this.aimDir,
        this.stageBoxes,
        this.stage.water,
        throwSpeedOf(this.skills),
      );
      // 体を照準の方へ向ける。投げる向きと見た目を一致させる
      this.player.setThrowing(true);
      return;
    }

    if (!this.grenadeAiming) {
      /*
       * 振り切っている最中に構えをやめた。**投げない。**
       *
       * 手榴弾が手を離れるのは引き金を引いた 1.5 秒後まで遅れることがある
       * (振りかぶりが残っているぶん待つ)。その間に構えを解けば、腕は下りて
       * 型も畳まれる。**画面では投げていないのに手榴弾だけ飛んでいく**のは
       * 嘘になるので、離す前なら無かったことにする。
       *
       * ピンを戻したことになるが、そこを咎めるより「見た通りに起きる」ほうを
       * 取る。代わりに、投げ切りたければ手を離れるまで構えていることになる。
       */
      if (this.grenadeRelease > 0 && !held) {
        this.grenadeRelease = 0;
        this.player.cancelThrow();
        this.player.setThrowing(false);
        return;
      }
      // 構えても投げてもいない間だけ解く。放すまでは向きを保つ
      if (this.grenadeRelease <= 0) this.player.setThrowing(false);
      return;
    }
    this.grenadeAiming = false;
    this.pendingThrow = false;
    this.grenades.hidePreview();

    // **構えをやめただけなら投げない。** 引き金を引いていないのに投げると、
    // 覗いて確かめる、が使えなくなる
    if (!release) {
      this.player.cancelThrow();
      this.player.setThrowing(false);
      return;
    }

    // 構えを解かされただけ (倒された・箱に入った・死んだ) なら投げない。
    // 腕を下ろして構えに戻す。抜いたピンは無かったことになるが、
    // ここで爆発させると理不尽な死に方が増えるだけで読み合いにならない
    if (!canThrow) {
      this.player.cancelThrow();
      this.player.setThrowing(false);
      return;
    }

    // **数を減らすのは手を離れたとき** (updateGrenadeRelease)。
    //
    // 引き金を引いた時点で減らしていたので、軽く叩いたとき (振りかぶりが
    // 残っている) に「まだ投げていないのに残り数が減る」が 1.5 秒続いていた。
    // 止めていた続きから振り切る。手を離れるのはその途中
    this.player.releaseThrow();
    // 残りは**いまどこまで再生されたか**から測る。
    //
    // 振りかぶりで止まっている前提で引くと、軽く叩いただけのときに
    // まだ腕を引いている途中なのに手を離れる。長押しなら 1.50 秒まで
    // 進んでいるので差は 0.16 秒、叩いただけならほぼ丸ごと残る。
    // **振りかぶりの残りを待ってから**、投げの型の途中で手を離れる。
    // 軽く叩いただけなら振りかぶりが残っているぶん遅れて出る
    this.grenadeRelease = Math.max(
      0.01,
      this.player.throwWindupLeft + this.knobs.grenadeRelease * this.player.throwReleaseDuration,
    );
  }

  /** クレイモアを構えているか */
  private setupAiming = false;
  /** 置き切るまでの残り (秒)。0 になった瞬間にサーバーへ知らせる */
  private setupRelease = 0;

  /**
   * クレイモアを置く。
   *
   * 手榴弾と同じで、押している間は構えたまま止まり、離すと置く型が流れる。
   * **落下点は見せない** — 投げる物ではないので、置くのは自分の足元の前と決まっている。
   *
   * 置く型は 3.6 秒あって、その間ずっと無防備。置いて離れる道具の代償がここ。
   */
  private updateClaymoreSetup(): void {
    const canPlace =
      this.inv.countOf(this.inv.held) > 0 &&
      canAct(this.life) &&
      !this.player.isBoxed &&
      !this.player.downed &&
      // 手榴弾と同じ。転がりは全身の型なので、構えを跨がせない。
      // **絵が終わるまで**待つ (rolling だと尻尾の中で始まって見えない)
      !this.player.rollShowing &&
      !this.cocking;
    const held = canPlace && this.input.aiming;
    // 手榴弾と同じドメインルール。**構え始めと同じフレームに引かれた分も覚えておく**
    const pulled = this.triggerEdge || this.pendingSetup;
    const release = held && this.setupAiming && pulled;

    if (held && !release) {
      /*
       * **前の 1 個が手を離れるまで、次を構え始めない。**
       *
       * 手榴弾と同じ罠 (updateGrenadeThrow の grenadeRelease)。構えたまま
       * 引き金を引くと、その次のフレームには setupAiming が倒れていて
       * 「構え始め」に見える。そこで振りかぶりを頭から流し直すと、
       * **置く型の途中で立ち姿 (腰 1.00m) から始まる**ので、立ち上がって
       * しゃがみ直すように見えた。
       *
       * 置く型が流れている間 (setupRelease > 0) は何もしない。
       */
      if (this.setupRelease > 0) return;

      if (!this.setupAiming) {
        this.player.playSetup();
        this.pendingSetup = this.triggerEdge;
      }
      this.setupAiming = true;
      // 体をカメラの方へ向ける。置く向き = 自分の向きなので、これが照準になる
      this.player.setThrowing(true);
      return;
    }

    if (!this.setupAiming) {
      /*
       * 置き切る前に構えをやめた。**置かない** (手榴弾と同じドメインルール)。
       *
       * 手を離れるのは引き金を引いたあと。その間に構えを解けば腕は下りるので、
       * 画面では置いていない。**見た通りに起きる**ほうを取る。
       */
      if (this.setupRelease > 0 && !held) {
        this.setupRelease = 0;
        this.player.cancelThrow();
        this.player.setThrowing(false);
      }
      return;
    }
    this.setupAiming = false;
    this.pendingSetup = false;
    // 構えをやめただけなら置かない。覗いて場所を確かめる、が使える
    if (!release || !canPlace) {
      this.player.cancelThrow();
      this.player.setThrowing(false);
      return;
    }

    // **数を減らすのは置いた瞬間** (updateClaymoreRelease)
    this.player.releaseSetup();
    // 置き切るまでは向きを保つ。放した瞬間に向き直ると、置く先がずれる
    this.player.setThrowing(true);
    // 置く型の途中で手を離れる。振りかぶりが残っていればそのぶん待つ
    this.setupRelease = Math.max(
      0.01,
      this.player.throwWindupLeft + CLAYMORE_PLACE_RATIO * this.player.setupReleaseDuration,
    );
  }

  /** 置き切ったらサーバーへ知らせる。位置も向きもあちらが決める */
  private updateClaymoreRelease(dt: number): void {
    if (this.setupRelease <= 0) return;
    this.setupRelease -= dt;
    if (this.setupRelease > 0) return;
    this.setupRelease = 0;
    this.player.setThrowing(false);
    // **数を減らすのはサーバーが置けたと言ってから** (claymorePlaced)。
    // 壁の中や縁の外は断られるので、送った時点で減らすと置けずに減る
    this.net.send({ type: "claymore" });
  }

  /**
   * 落ちたことをサーバーへ知らせる。
   *
   * **速さだけ送る。** 受ける量を決めるのはサーバー — 式は共有 (damage.ts) なので、
   * 同じ速さから同じ量が出る。ここで量を送ると好きな値を申告できてしまう。
   *
   * 無傷の速さなら送らない。1 層 (3.2m) 降りるたびに 1 通飛ぶのは無駄で、
   * 飛び降りて回り込むのは普通の動き方なので回数も多い。
   */
  /**
   * 落ちながら叫ぶ。
   *
   * **落ち切ってからでは間に合わない。** 死ぬのは着地した瞬間で、そこから
   * 叫び始めると絵と音がずれる。落下中の速さから「このまま着くと何点削られるか」
   * を出して、**今の体力で死ぬなら**その場で叫ぶ。
   *
   * 式はサーバーと同じ (domain/rule/damage.ts)。こちらは音を鳴らすだけで、
   * 削るのはあちら。
   */
  private updateFallScream(): void {
    if (this.player.fallingSpeed <= 0) {
      this.fallScreamed = false;
      return;
    }
    if (this.fallScreamed || !canAct(this.life)) return;
    if (fallDamage(this.player.fallingSpeed) < this.player.health) return;
    this.fallScreamed = true;
    // 長いほう (3.3 秒)。落ちている間ずっと聞こえていてほしい
    this.audio.play("blastScream", this.player.position);
  }

  /** この落下でもう叫んだか。着地するか、落ちるのをやめたら戻す */
  private fallScreamed = false;

  private reportFall(): void {
    const speed = this.player.landedSpeed;
    if (speed <= 0 || !canAct(this.life)) return;
    if (fallDamage(speed) <= 0) return;
    this.net.send({ type: "fall", speed });
  }

  /**
   * 持ち替えの操作。
   *
   * **押すだけで 2 つを往復し、行き先を決めたいときは名指しする。** MGO2 は
   * 十字の長押しで一覧を出していたが、キーボードなら名指しのほうが速い。
   * 一覧 (L 字) は後で足す。
   *
   *   Q   武器系のトグル。直前に持っていた物と往復する
   *   E   support (手榴弾 / クレイモア) へ
   *   F   ナイフへ
   *   C   ダンボールへ (道具系のトグル)
   *
   * **持ち替えには時間がかかり、その間は何もできない** (Inventory.canShoot)。
   * それが投げること・刺すことの代償になっている (docs/design.md の 5)。
   */
  /**
   * 手にある物。**押されている物を Intent に訳して、ドメインルールへ渡すだけ。**
   *
   * 判断そのものは domain (item/inventory.ts の hand)。ここに残るのは
   * キーコードと、返ってきた結果を通信・音・右スティックの用途に配ること。
   */
  private updateSwitchKeys(dt: number): void {
    /*
     * ホイールは**一覧とスコープの取り合い**になる。
     *
     * 一覧を開いていれば一覧が食い、開いていなければ倍率へ回す。読んだ時点で
     * 0 になるので、ここで両方に配る (updateZoom はこの残りを見る)。
     * 右スティックのぶん (consumeListStep) は一覧専用なので倍率へは回さない。
     */
    const wheel = this.input.consumeWheel();
    const intent: Intent = {
      browse: {
        weapon: this.input.down("swapWeapon"),
        tool: this.input.down("swapTool"),
      },
      select: wheel + this.input.consumeListStep(),
      drop: this.input.tapped("drop"),
      toSupport: this.input.tapped("toSupport"),
      toKnife: this.input.tapped("toKnife"),
    };

    const events = this.inv.hand(intent, {
      canAct: canAct(this.life),
      choosing: this.loadoutBlocking,
      aiming: this.player.isAiming,
      cocking: this.cocking,
      canWearBox: this.player.canWearBox,
    }, dt);

    // 一覧が受け取らなかったぶんは倍率へ回す
    this.wheelLeft = this.inv.browsing ? 0 : wheel;
    // 一覧を開いている間は、右スティックを視点ではなく一覧に使う
    this.input.setListMode(this.inv.browsing !== null);

    for (const event of events) {
      switch (event.kind) {
        case "pickup":
          this.net.send({ type: "pickup" });
          break;
        case "dropped": {
          // **持ち物から外したのはあちら、地面に置くのはサーバー。**
          // 残弾は本人しか知らないので一緒に送る
          const gone = event.item;
          this.net.send({
            type: "drop",
            weapon: gone.id,
            ammo: "ammo" in gone ? gone.ammo : undefined,
            reserve: "reserve" in gone ? gone.reserve : undefined,
            count: "count" in gone ? gone.count : undefined,
          });
          // 音は dropped が返ってきたときに鳴らす。**置いた場所で鳴らしたい**し、
          // ここでも鳴らすと自分だけ 2 回聞こえる
          break;
        }
        case "selected":
          break;
      }
    }
  }

  /**
   * その相手を撃てるか。**陣営ではなくルールに聞く。**
   *
   * 個人戦では同じ色でも敵。陣営で見ていると、当てても申告を送らないので
   * 削れない (弾も刺突も同じ穴があった)。
   */
  private hostileTo(id: string, side: Team): boolean {
    return isHostile(
      MODES[this.replica.mode],
      { id: this.net.id, team: this.replica.team ?? "blue" } as never,
      { id, team: side } as never,
    );
  }

  private syncHeld(): void {
    const held = this.inv.held;
    if (held === this.player.heldItem) return;
    this.player.setHeld(held);
    // ダンボールは被る状態が別にある。持ち替えに合わせる
    this.player.setBoxed(this.inv.usingTool && held === "box");
    if (isGun(held)) {
      void this.player.equip(held);
    }
  }

  /** 投げる型が振り切る所で手を離す */
  private updateGrenadeRelease(dt: number): void {
    if (this.grenadeRelease <= 0) return;
    this.grenadeRelease -= dt;
    if (this.grenadeRelease > 0) return;
    this.grenadeRelease = 0;
    this.player.setThrowing(false);
    // ここで初めて手を離れる。残り数が減るのもここ
    this.inv.spend();

    // 向きはこの瞬間のもの。放す所まで狙いを追えるようにする
    this.follow.aimDirection(this.aimDir);
    // 向きだけ送る。位置も速さもサーバーが決める (捏造した初速で
    // 地図の反対側まで飛ばせないように)
    this.net.send({
      type: "grenade",
      dir: [this.aimDir.x, this.aimDir.y, this.aimDir.z],
    });
  }

  /**
   * 爆発。
   *
   * 誰が傷ついたかはサーバーが決めて health で届く。ここは見せるだけ。
   * 位置は全員に届く — 音も光も壁を回り込むので、伏せる意味が無い。
   */
  private explode(id: number, at: readonly number[]): void {
    const position =
      this.grenades.remove(id) ?? new THREE.Vector3(at[0], at[1], at[2]);
    /*
     * 水の中で爆ぜたか。**火ではなく水を上げる。**
     *
     * 沈んだ手榴弾はそのまま底で爆ぜる。火の玉を出しても不透明な水面の下で
     * 見えないので、「何も起きなかった」ように見える。水柱なら**水面越しに
     * どこで爆ぜたかが分かる** — 傷は届いているので、見えないほうが困る。
     *
     * 見た目より先に判じるのは、**音も水の中かどうかで変える**から。
     */
    // 水音は鳴らさない。**この後すぐ、こもった爆発音を鳴らす** (二重になる)
    const inWater = this.splashAt(position, BLAST_SPLASH, false);
    // 水の中はこもって小さい。届く距離も半分以下 (audio.ts の explosionWater)
    const gain = this.audio.play(inWater ? "explosionWater" : "explosion", position, 1);
    this.addPing("shot", position, gain);
    /*
     * 頭を殴られた感じを出す。**近さは音の強さをそのまま使う。**
     *
     * 遠いほど薄い、が音と同じ式で揃う。距離の閾値をもう 1 つ持つと、
     * 「聞こえるのに効かない」「効くのに聞こえない」がどこかで出る。
     *
     * **カメラは動かさない。** このゲームは軸がそのまま弾道なので
     * (aimDirection が viewDir を返す)、揺らすと狙いまで動く。それ以前に、
     * 回すと画面が斜めに傾いて見えて、衝撃ではなく「傾いた」に読める。
     */
    this.shock = { seq: this.shock ? this.shock.seq + 1 : 1, power: gain };
    if (inWater) return;
    this.blast.explode(position);
  }

  /**
   * 集中の度合い (0..1)。音の輪はこれに従って濃くなる。
   *
   * 集中 = しゃがむ (ダンボールを含む) + 動かない + そこに RING_SETTLE 秒留まる。
   * 撃たれた方向も含めて、輪に出るものは全部これに従う。
   *
   * 立って動き回っている限り、周りのことは何も分からない。情報が欲しければ
   * 足を止めて屈むしかない、という交換条件にしてある。速く動くほど何も見えず、
   * 止まるほど見える。
   */
  private listeningLevel(): number {
    return Math.min(this.player.concentration / RING_SETTLE, 1)
  }

  /**
   * 足音を鳴らす。
   *
   * 自分の足元と、相手の足元。どちらも位置から出しているので、
   * 通信で足音を送る必要がない (送ると取りこぼしで音だけ消える)。
   */
  private updateFootsteps(): void {
    // 自分の音は輪に出さない。自分がどこに居るかは分かっている。
    // 代わりに輪そのものを塞ぐ。自分の足音で相手の足音が聞こえなくなる。
    if (this.player.consumeRollStart()) {
      this.audio.play("roll", this.player.position);
      this.soundRing.suppress(1);
    }
    /*
     * 水に落ちた。**人ひとりぶんのしぶきを立てる。**
     *
     * 落ちた速さで大きさを変える。歩いて縁から踏み外したのと、走って
     * 飛び込んだのが同じ絵になると、勢いが伝わらない。
     */
    const splash = this.player.consumeSplash();
    if (splash > 0) {
      const at = this.player.position;
      this.splashAt(
        new THREE.Vector3(at.x, at.y, at.z),
        BODY_SPLASH * Math.min(1.6, 0.6 + splash / FALL_SPLASH_SPEED),
      );
    }
    const own = this.player.consumeFootstep();
    if (own) {
      this.playStep(own, this.player.position, false);
      // 姿勢がそのまま「どれだけ耳が塞がるか」になる。
      // しゃがんで動けば相手に聞こえにくく、自分も聞こえる。
      this.soundRing.suppress(own.range);
    }

    for (const remote of this.remotes.all) {
      if (remote.rollStarted) {
        const gain = this.audio.play("roll", remote.object.position);
        this.addPing("roll", remote.object.position, gain);
      }
      // リロードの音。姿が見えている相手にだけ届く (位置がそうなので)
      if (remote.reloadStarted) {
        const spec = weaponOf(remote.equipped);
        this.audio.play(spec.reloadSound, remote.object.position);
      }
      // 吹き飛ばされた叫び。倒れたのではなく、まだ生きて転がっている
      if (remote.sweptThisFrame) {
        const gain = this.audio.play("blastScream", remote.object.position);
        this.addPing("shot", remote.object.position, gain);
      }
      // 相手が水に落ちた。**しぶきで気づける** — 姿は水面の下へ消える
      const splash = remote.consumeSplash();
      if (splash > 0) {
        this.splashAt(
          remote.object.position.clone(),
          BODY_SPLASH * Math.min(1.6, 0.6 + splash / FALL_SPLASH_SPEED),
        );
      }
      if (remote.step) this.playStep(remote.step, remote.object.position, true);
    }
  }

  /**
   * 足の下にあるもので音を変える。
   *
   * 材質は世界へ問い合わせる。以前は「高さが 0 より上なら金属」で済ませていたが、
   * それは「地面は y=0 の平面ひとつ」という前提に寄りかかっていて、
   * 高い位置にコンクリートを置いた瞬間に破綻する。
   */
  private playStep(step: Step, position: THREE.Vector3, ping: boolean): void {
    const surface = surfaceAt(position, PLAYER_RADIUS, this.stage.obstacles, position.y, STEP_UP);
    const sound =
      surface === "metal" ? "metalStep" : surface === "wood" ? "woodStep" : "step";
    const gain = this.audio.play(sound, position, step.volume, step.range);
    if (ping) this.addPing("step", position, gain);
  }


  /**
   * 成績表を開く / 閉じる。
   *
   * 開いている間はポインタを離す。掴んだままだとボタンを押せないし、
   * 視点も動き続けて落ち着いて読めない。
   */
  setMenu(open: boolean): void {
    this.menuOpen = open;
    // 開いている間は掴まない。裏で押したキーで掴み直すと、
    // ボタンを押そうとした瞬間に画面が飛ぶ
    this.input.wantsLock = !open;
    if (open) document.exitPointerLock();
    // ボタンで閉じた場合。押した操作の最中なので、ここで掴み直せる
    else this.input.grab();
  }

  /**
   * 敬礼を交わした味方と繋がる。
   *
   * 味方の位置はサーバーが配っているが、既定では映さない。互いに手を挙げて
   * 初めて壁越しに見えるようになる。誰と組むかを自分で選ぶための手続き。
   */
  private updateLinks(): void {
    const formed = this.remotes.linkSaluting(
      this.player.isSaluting,
      this.player.position,
      LINK_RANGE,
      this.replica.team,
    );
    for (const name of formed) {
      this.links.unshift({ name, at: Date.now() });
      this.links.length = Math.min(this.links.length, LINK_FEED_MAX);
      // 繋がったことは音でも返す。手を挙げている間は画面を見ていない
      this.audio.play("clink", this.player.position);
    }
  }


  /** その部屋のルール。1 秒ごとに届く match で分かる */

  /** 陣営の基地を示す枠。陣営が無い部屋では隠す */
  private bases: THREE.Object3D | null = null;
  /** 自分が光っているか (個人戦の 1 位)。位置が全員に漏れている */

  /** 直近の点の増減。画面の右下に流す */


  /**
   * 姿の見えない相手が立てた音。
   *
   * 位置は届かない。届くのは方向と距離だけ — 耳で分かるのがそこまでだから。
   * 鳴らすために座標が要るので、その方向のその距離に音源を置く。
   * 開発者ツールを開いても、読めるのは「その方向で誰かが足音を立てた」まで。
   *
   * 見えている相手の音はここを通らない。位置が届いているので、
   * 動きから自分で数えて鳴らしている。
   */
  private hearNoise(message: NoiseEvent): void {
    const at = this.noisePos.set(
      this.player.position.x + Math.sin(message.bearing) * message.distance,
      this.player.position.y + 1,
      this.player.position.z - Math.cos(message.bearing) * message.distance,
    );

    if (message.kind === "shot") {
      // 銃の違いは耳で分かる。姿が見えなくても音の種類までは伝わってよい
      const sound = weaponOf(message.weapon).shotSound;
      this.addPing("shot", at, this.audio.play(sound, at));
      return;
    }

    const sound =
      message.surface === "metal"
        ? "metalStep"
        : message.surface === "wood"
          ? "woodStep"
          : "step";
    const gain = this.audio.play(sound, at, message.volume ?? 1, message.range ?? 1);
    this.addPing("step", at, gain);
  }

  /**
   * 聞こえた音をレーダーへ。
   *
   * 聞こえたかどうかは音の側が返した強さで決める。別の計算で判断すると
   * 耳とレーダーが食い違い、「聞こえないのに映る」「聞こえるのに映らない」が起きる。
   *
   * 方位は照準の向きを基準にする。画面の上がそのままレーダーの上になるので、
   * 印を見てから振り向くまでの間に読み替えが要らない。
   */
  private addPing(kind: PingKind, position: THREE.Vector3, gain: number): void {
    if (gain <= PING_THRESHOLD) return;
    const dx = position.x - this.player.position.x;
    const dz = position.z - this.player.position.z;
    // ワールド基準の方位。輪は回転させないので、山の出た向きがそのまま音の向きになる。
    this.soundRing.ping(Math.atan2(dx, -dz), gain, kind);
  }

  /**
   * 弾を飛ばして最初に当たったものを返す。
   *
   * まっすぐ引かず、放物線を折れ線に分けて区間ごとに調べる。距離に応じて落ちるので、
   * 遠いほど狙点より下に当たる。1 本の raycast では表現できない。
   *
   * hitPoint / hitNormal を書き換える。
   */
  private traceBullet(): {
    player: { player: RemoteSoldier; zone: HitZone; distance: number } | null;
    terrain: THREE.Intersection | null;
    distance: number;
  } {
    // 速さも落ち方も**武器の性能** (domain)。ここは道を引くだけ。
    // 銃ごとに違うので、狙撃銃の弾は同じ距離でも落ちない
    const speed = this.weapon.bulletSpeed;
    const gravity = this.knobs.bulletGravity ?? this.weapon.bulletGravity;
    const total = flightTime(MAX_RANGE, speed);
    const step = total / TRAJECTORY_STEPS;

    // 区間の始点。最初は銃口 (= 照準の起点)
    this.segmentFrom.copy(this.aimOrigin);
    let travelled = 0;

    for (let i = 1; i <= TRAJECTORY_STEPS; i++) {
      bulletOffset(this.aimDir, step * i, speed, gravity, this.segmentTo);
      this.segmentTo.add(this.aimOrigin);

      this.segmentDir.subVectors(this.segmentTo, this.segmentFrom);
      const length = this.segmentDir.length();
      if (length < 1e-6) continue;
      this.segmentDir.divideScalar(length);

      // 地形を先に見る。ここまでの距離が、この区間で相手に届く上限になる。
      this.raycaster.set(this.segmentFrom, this.segmentDir);
      this.raycaster.far = length;
      const terrain = this.raycaster.intersectObjects(
        this.stage.collidables,
        false,
      )[0];
      const limit = terrain ? terrain.distance : length;

      // 人はメッシュではなくボーンの当たり判定で見る。
      // 姿勢で頭の高さが変わることがこのゲームの中身なので、判定も姿勢に追従させる。
      const player = this.remotes.raycast(
        this.segmentFrom,
        this.segmentDir,
        limit,
      );

      if (player) {
        this.hitPoint
          .copy(this.segmentFrom)
          .addScaledVector(this.segmentDir, player.distance);
        this.hitNormal.copy(this.segmentDir).negate();
        return { player, terrain: null, distance: travelled + player.distance };
      }

      if (terrain) {
        this.hitPoint.copy(terrain.point);
        if (terrain.face) {
          // 面法線はオブジェクトのローカル空間なのでワールドへ変換する
          this.normalMatrix.getNormalMatrix(terrain.object.matrixWorld);
          this.hitNormal
            .copy(terrain.face.normal)
            .applyMatrix3(this.normalMatrix)
            .normalize();
        } else {
          this.hitNormal.copy(this.segmentDir).negate();
        }
        return {
          player: null,
          terrain,
          distance: travelled + terrain.distance,
        };
      }

      travelled += length;
      this.segmentFrom.copy(this.segmentTo);
    }

    // 何にも当たらなかった。落ちきった先を着弾点として扱う。
    this.hitPoint.copy(this.segmentFrom);
    return { player: null, terrain: null, distance: travelled };
  }




  /**
   * 着弾音。**材質ごとに鳴らし分ける。**
   *
   * いまは金属だけ音を持っている。木やコンクリートの音が入るまでは、
   * 金属以外は黙る — 材質の違う音を流用すると、当たった物を聞き間違える。
   */
  private playImpact(hit: THREE.Intersection, at: THREE.Vector3): void {
    if (surfaceOf(hit.object.name) !== "metal") return;
    this.audio.play("hitMetal", at);
  }

  /** 着弾点から地形を引いて鳴らす。他人の弾のように面が届かないとき */
  private playImpactAt(at: THREE.Vector3): void {
    const surface = surfaceAt(at, IMPACT_PROBE, this.stage.obstacles, at.y, IMPACT_PROBE);
    if (surface !== "metal") return;
    this.audio.play("hitMetal", at);
  }

  private publishStats(dt: number): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
    this.statsTimer += dt;
    if (this.statsTimer < STATS_INTERVAL || !this.onStats) return;
    this.statsTimer = 0;
    const now = Date.now();
    /*
     * 支度の間、カードは**これから湧く銃**を映す。
     *
     * 手には何も無い (戦場に居ない) ので、前の命の銃を出すと「P90 を選んだのに
     * AK47 と出る」になる。装備画面で選んでいる物と食い違うのはここだけで、
     * 直前まで持っていた物に用は無い。
     */
    const choosing = this.canChooseLoadout;
    const shownWeapon: HeldId =
      choosing ? (this.pendingLoadout.primary ?? "knife") : this.inv.weapon;
    const chosen = weaponOf(this.pendingLoadout.primary);
    const shownAmmo = choosing
      ? { magazine: chosen.magazine, reserve: chosen.reserve }
      : { magazine: this.inv.ammoOf(shownWeapon), reserve: this.inv.reserveOf(shownWeapon) };
    this.onStats({
      stage: STAGE_CODE,
      backend: this.backend,
      fps: Math.round(this.fps),
      x: this.player.position.x,
      z: this.player.position.z,
      speed: this.player.speed,
      locked: this.input.engaged,
      shots: this.shotCount,
      // **武器のカードに出す数。** 手にある物ではなく、カードが名指している武器の
      // 弾。ダンボールを被っている間も銃の残弾はそのまま出す
      ammo: shownAmmo.magazine,
      magazine: choosing ? chosen.magazine : this.weapon.magazine,
      reserve: shownAmmo.reserve,
      reloading: this.reloadTimer > 0,
      downed: this.player.canStandUp,
      aiming: this.player.isAiming,
      spread: this.spread.degrees(this.weapon, this.skills),
      // 持ち込める主武器。**部屋が絞る**ことがある (ROOMS の primaries)
      primaries: this.primaries,
      /*
       * 次に湧いたときの装備。**画面が別に控えない。**
       *
       * 画面側で信号に持たせていた頃、初期値が 'rifle' で固定されていた。
       * 狙撃銃だけの部屋では**どれも選ばれていない**状態で開く (一覧に rifle が
       * 無いので、どの札にも印が付かない)。選んでいる物を知っているのはこちら。
       */
      primary: this.pendingLoadout.primary,
      /*
       * 副武器。**選んでいる物を返す** (部屋が外していれば null)。
       *
       * 長らく部屋の規則 (this.secondary) をそのまま返していた。拳銃が 1 挺しか
       * 無かった頃は「許す副武器」と「選んだ副武器」が常に同じだったので気づけ
       * なかったが、M9 と M1911 に分かれた途端に**印が M9 から動かなくなった** —
       * 選べてはいるのに、装備画面はいつも M9 が光っている。
       *
       * pendingLoadout.secondary は部屋の規則から始まるので、外している部屋では
       * null のまま。どちらの意味でも読める。
       */
      secondary: this.pendingLoadout.secondary,
      // 粒が散る角度 (度)。**0 でなければクロスヘアが輪になる**
      pelletSpread: pelletsOf(this.weapon) > 1 ? (this.weapon.pelletSpread ?? 0) : 0,
      crouching: this.player.isCrouching,
      stance: this.player.stance,
      hitZone: this.hitFeedbackTimer > 0 ? this.lastHitZone : "",
      hitTranq: this.lastHitTranq,
      links: this.links.filter((l) => now - l.at < LINK_FEED_LIFE * 1000).map((l) => l.name),
      menuOpen: this.menuOpen,
      loadoutOpen: this.loadoutBlocking,
      /*
       * 残り秒。**支度の段階では試合が始まるまでを出す。**
       *
       * 装備の打ち切り (30 秒) を出していると、まだ始まらないのに「残り 0 秒」
       * になって、何を待っているのか分からなくなる。始まる時刻はサーバーが
       * 持っているので、そちらから引く。
       */
      loadoutLeft:
        this.replica.match?.phase === "ready"
          ? Math.max(0, Math.ceil(((this.replica.match?.endsAt ?? 0) - now) / 1000))
          : Math.max(0, Math.ceil(CHOOSE_TIMEOUT - this.chooseElapsed)),
      // OK が効くようになるまで。押せないボタンを押させないための表示
      loadoutWait: Math.max(0, Math.ceil(CHOOSE_FLOOR - this.chooseElapsed)),
      skills: this.skills,
      // 窓が開いているかは試合の段階で決まる。ドメインルールは domain が持つ
      skillsOpen: canChooseSkills(
        this.replica.match?.phase ?? "waiting",
        MODES[this.replica.mode],
      ),
      scoped: this.scoped,
      equipped: this.player.equipped,
      zoom: this.zoomStep > 0 ? this.weapon.scope[this.zoomStep - 1].label : "",
      canZoom: this.weapon.scope.length > 0 && this.player.isAiming,
      scores: this.replica.match?.players ?? [],
      // 視界の曇り (0..1)。**残りの数字ではなく、効き目を渡す**
      stamina: staminaBlur(this.stamina),
      shock: this.shock,
      asleep: this.player.sleeping,
      sleepDepth: this.player.sleepDepth,
      health: this.player.health,
      maxHealth: MAX_HEALTH,
      dead: this.player.isDead,
      /**
       * 拾える物が近くにあるか。
       *
       * **距離はこちらで測る。** サーバーも拾うときに測っている (そちらが正) が、
       * 「押せば拾える」を出すのに毎フレーム往復させるわけにいかない。
       */
      canPickUp: this.drops.nearest(this.player.position) <= PICKUP_RANGE,
      /** いま自分が光っているか。個人戦の 1 位は位置が漏れる */
      leaking: this.replica.leaking,
      points: this.replica.pointFeed.filter(
        (entry) => now - entry.at < POINT_FEED_DURATION * 1000,
      ),
      kills: this.replica.killFeed
        .filter((entry) => now - entry.at < KILL_FEED_DURATION * 1000)
        .map((entry) => entry.event),
      throwables: this.inv.countOf('magazine'),
      grenades: this.inv.supportCount,
      /**
       * 開いている一覧。閉じていれば null。
       *
       * 並びと、いま指している位置を渡す。**L 字に折って描く**のは画面側の仕事
       * (真ん中を塞がないため)。
       */
      browsing: this.inv.browsing
        ? {
            // **数も載せる。** 選ぶときに「あと何発か」が要る — 弾切れの銃と
            // 満タンの銃が同じ見た目だと、一覧が選ぶ材料にならない。
            // 銃は装填分も足した**総数**。カードの数字と揃える
            items: this.inv.list(this.inv.browsing.family).map((c) => ({
              id: c.id,
              n: 'ammo' in c ? c.ammo + c.reserve : 'count' in c ? c.count : null,
              // **装填の内訳も銃ごとに。** 送っている間、角のカードは指している銃を
              // 映すので、目盛りだけ手元の銃のままだと弾倉の長さが名前と合わない
              loaded: 'ammo' in c ? c.ammo : null,
              mag: 'ammo' in c ? weaponOf(c.id).magazine : null,
            })),
            at: this.inv.browsing.at,
          }
        : null,
      held: this.inv.held,
      // **武器のカードに出す物。** 道具を手にしていても変わらない
      weaponHeld: shownWeapon,
      tool: this.inv.tool,
      toolInHand: this.inv.usingTool,
      browsingFamily: this.inv.browsing?.family ?? null,
      switching: this.inv.switching,
      // **持ち物を見る。** 選択ではなく実際に持っている物
      support: (this.inv.supportId as SupportId | null) ?? this.loadout.support,
      team: this.replica.team,
      match: this.replica.match,
      players: this.remotes.count,
      sendRate: this.sendGap > 0 ? 1000 / this.sendGap : 0,
      peerRates: this.remotes.rates(),
    });
  }

  private resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.follow.setAspect(width / height);
    // 太い線は画面上の px で太さが決まるので、描画先の大きさを知らせる
  }
}
