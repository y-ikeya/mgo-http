import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { FollowCamera, type CameraWorld } from "./camera";
import { isMesh } from "./guards";
import { Input, type InputDevice } from "./input";
import { Player, PLAYER_HEIGHT, PLAYER_RADIUS, type PlayerWorld } from "./player";
import { Shots } from "./shots";
import type { WeaponTarget } from "./weapon";
import {
  ARENA_HALF_SIZE,
  buildLights,
  buildBases,
  buildStage,
  setAmbientIntensity,
  setCloudCoverage,
  TEAM_SPAWNS,
  STAGE_CODE,
  loadStageBoxes,
  type Stage,
} from "./stage";
import { solidBlockers, type StageBox } from "../sim/vision";
import {
  ceilingHeight,
  clampToArena,
  groundHeight,
  resolveCircle,
  surfaceAt,
} from "../sim/collision";
import { GameAudio } from "./audio";
import type { Step } from "../domain/rule/footsteps";
import { SoundRing, type PingKind } from "./soundRing";
import { ThrownItems } from "./thrown";
import { Grenades } from "./grenades";
import { Claymores } from "./claymores";
import { BlastFx } from "./blastfx";
import { Casings } from "./casings";
import { Drops } from "./drops";
import { damp } from "./math";
import { randomSigned, randomUnit, RandomStream } from "./random";
import { fallDamage, MAX_HEALTH } from "../domain/rule/damage";
import {
  canAct,
  canChoose,
  CHOOSE_FLOOR,
  CHOOSE_TIMEOUT,
  type Life,
} from "../domain/lifecycle";
import { CHOICES, SUPPORTS, roundsPerDecoy, type SupportId, type WeaponId } from "../domain/item/weapons";
import { setBoxTuning, type BoxTuning } from "./box";
import { Inventory } from "../domain/item/inventory";
import { canDrop, isGun, type Family, type HeldId } from "../domain/item/held";
import { RemotePlayers, type RemotePlayer } from "./remotePlayer";
import type { HitZone } from "../domain/rule/damage";
import type { NoiseEvent } from "../net/types";
import { weaponOf } from "../domain/item/weapons";
import {
  BULLET_GRAVITY,
  flightTime,
  trajectoryOffset,
  TRAJECTORY_STEPS,
} from "./ballistics";
import { createTransport } from "../net";
import type { NetTransport } from "../net/types";
import type { Identity } from "../auth/session";
import { selfSkin } from "./skin";
import { DEATH_POINTS, KILL_POINTS, SUICIDE_POINTS } from "../domain/rule/scoring";
import {
  SNAPSHOT_INTERVAL,
  type HealthMessage,
  type KillEvent,
  type MatchMessage,
  type ServerMessage,
  type Team,
} from "../net/types";

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
  /** しゃがんでいるか */
  crouching: boolean;
  /** 直近に当てた部位。空文字なら表示しない */
  hitZone: string;
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

/**
 * 敬礼が届く距離 (m)。
 *
 * 短い。向かい合って初めて繋がる距離にしてある。
 *
 * 遠くから繋がれると、敬礼が「安全な所から押すボタン」になる。この動作は
 * 銃を下ろして無防備になることに意味があるので、**相手の前に立つ**ところまで
 * 込みで手続きにする。合流するには実際に合流しないといけない。
 */
/**
 * リロードの音を鳴らし始める位置 (動作全体に対する割合)。
 *
 * 頭で鳴らすと早すぎる。音の中身は 0.10〜1.35 秒に 3 つの塊 (弾倉を外す /
 * 差す / 叩き込む) があり、動作は 3.33 秒。頭から鳴らすと残り 2 秒が無音になる。
 *
 * 割合で持つのは、武器やクリップが変わっても位置がずれないようにするため。
 * 0.28 なら 3.33 秒の動作で 0.93 秒後 — 弾倉に手が掛かるあたり。
 */
const RELOAD_SOUND_AT = 0.28;

/**
 * 撃ってからボルトに手を掛けるまで (秒)。
 *
 * 撃った瞬間から動かすと、反動を受ける間もなく手が動いて忙しなく見える。
 * この分だけ次の 1 発までも延びる。
 */
const BOLT_DELAY = 0.54;

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
 * リロード時間 (秒) のフォールバック。
 * 通常はリロードモーションの尺をそのまま使い、モーションと操作不能時間を一致させる。
 * これが使われるのはモデル未読み込みか、クリップが無いときだけ。
 */

/**
 * 反動のパターン (度)。[上方向, 右方向] を 1 発ごとに並べたもの。
 *
 * 乱数を使わないのは意図的で、理由が 2 つある。
 *  - 覚えれば押さえ戻せるので、技量が結果に反映される
 *  - 決定的なのでサーバー権威に移しても計算が一致する。乱数だと
 *    「クライアントが思っている弾道」と「サーバーの判定」がずれる
 *
 * 最初の 1 発が最も強く、以降は落ち着く。左右は交互に振れて一直線に登らせない。
 * 弾数がこの表を超えたら最後の値を使い続ける。
 */
const RECOIL_PATTERN: readonly (readonly [number, number])[] = [
  [0.95, 0.0],
  [0.85, -0.12],
  [0.75, 0.2],
  [0.68, -0.26],
  [0.6, 0.32],
  [0.55, 0.24],
  [0.5, -0.3],
  [0.48, -0.38],
  [0.45, 0.28],
  [0.44, 0.34],
  [0.42, -0.32],
  [0.4, -0.24],
];
/** これだけ撃たない時間が続いたらパターンを頭に戻す (秒) */
const BURST_RESET_TIME = 0.35;

/**
 * 反動に乗せる乱れ。完全に固定だとマウスマクロで打ち消せてしまうため、
 * 大枠は覚えられるが完全な再現はできない程度に散らす。
 */
const RECOIL_PITCH_JITTER = 0.15;
/** 左右の乱れ (度)。パターン値が 0 の弾もあるので倍率ではなく加算 */
const RECOIL_YAW_JITTER = 0.08;


/**
 * 姿勢由来の散布が落ち着く速さ。
 * 即座に 0 に戻ると「止まった瞬間に撃つ」だけで精度が得られてしまう。
 * 一拍置く必要があることで、遮蔽に入って落ち着ける動作に意味が出る。
 */
const SPREAD_SETTLE_LAMBDA = 5;

/**
 * 刺突の判定を出すタイミング (クリップ尺に対する割合)。
 *
 * モーションの頭で判定すると、刃が届く前に相手が倒れて不自然に見える。
 * 腕を突き出す辺りで出す。1.93 秒の 35% = 約 0.68 秒。
 */
const STAB_HIT_PHASE = 0.35;
/** 刺突モーションの尺のフォールバック (秒)。クリップが無いとき用 */
const FALLBACK_STAB_DURATION = 1.9;

/** 着弾痕の色。地形 / 命中 / 倒した */
const IMPACT_WORLD = 0xffd9a0;
const IMPACT_HIT = 0xff5c47;
/** 命中表示を HUD に出しておく時間 (秒) */
const HIT_FEEDBACK_DURATION = 0.6;

/** 散布の基準軸。照準がほぼ真上を向いたときだけ前方を基準に切り替える */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, -1);

/** トーンマッピングの露出。全体の明るさはまずここで調整する */
const DEFAULT_EXPOSURE = 3.0;

/**
 * ローリングに切り替わるまでの押し込み時間 (秒)。
 *
 * 短すぎると、しゃがもうとして転がる。長すぎると、避けようとして間に合わない。
 * 人がキーを叩く時間はおよそ 0.1 秒なので、その少し上に置く。
 */
const ROLL_HOLD_TIME = 0.17;



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
 * 手榴弾が手を離れる時刻 (投擲クリップ内の秒)。
 *
 * 投げる型は腕を後ろへ引いてから前へ振る。その振り切る所で放さないと、
 * 構えたまま物だけ飛んでいくように見える。
 *
 * 向きはこの瞬間に取り直す。キーを離した時点の向きを使うと、振っている間に
 * 視点を動かしても軌道が変わらず、手だけが別の方を向く。
 *
 * **秒ではなく投げクリップに対する割合で持つ。** 秒で持つと、尺の違うモデルに
 * 差し替えたときに別の場所を指す (実測 0.83 秒のクリップの 0.16 秒あたり)。
 */
const GRENADE_RELEASE_RATIO = 0.19;

/**
 * クレイモアが地面に着く位置。置く型に対する割合。
 *
 * 型は 3.6 秒あるが、手を離れるのはかがんで置いた辺り。残りは立ち上がる動き。
 */
const CLAYMORE_PLACE_RATIO = 0.55;

/**
 * 一覧が開くまでの長押し (秒)。
 *
 * **短く押したときは一覧を出さない。** 往復するたびに画面が騒がしくなるし、
 * 一覧が出ること自体が「いま選んでいる」という状態なので、意図せず入るのは困る。
 *
 * 1 秒にしていたら遅かった。押してから出るまで待たされると、一覧を使うこと自体が
 * 億劫になる。叩く (0.1 秒前後) と押さえる (0.3 秒以上) の間を取る。
 */
const BROWSE_HOLD = 0.35;

/** 長押しで一覧が出るキー。系統ごとに 1 つ */
const SWITCH_KEYS: readonly (readonly [Family, "swap" | "box", string])[] = [
  ["weapon", "swap", "KeyQ"],
  ["tool", "box", "KeyC"],
];


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
const KILL_FEED_MAX = 5;

/**
 * 点の増減を残す時間 (秒) と行数。
 *
 * キル表示より**短く**する。あれは「誰が誰を」の記録で読むもの、こちらは
 * 「いま入った」という手応えなので、残り続けると邪魔になる。
 */
const POINT_FEED_DURATION = 2.5;
const POINT_FEED_MAX = 4;

/**
 * スポーン地点をどれだけ散らすか (m)。
 *
 * **基地の枠 (stage.ts の BASE_HALF = 2m) の内側に収める。** 外に出ると、
 * 地面に描いた枠が「自分の湧く場所」に見えなくなる。
 */
const SPAWN_SPREAD = 1.5;

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
  private readonly renderer: WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly follow: FollowCamera;
  private readonly player = new Player();
  private readonly input = new Input();
  private readonly stage: Stage;
  private readonly sun: THREE.DirectionalLight;
  private readonly remotes: RemotePlayers;
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
  private browsing: { family: Family; at: number } | null = null;
  /** 系統ごとの押し始めた時刻。0 なら押していない */
  private readonly pressedAt: Record<Family, number> = { weapon: 0, tool: 0 };

  private grenadeAiming = false;
  /** 構え始めと同じフレームに引かれた引き金。次のフレームで放す */
  private pendingThrow = false;
  /**
   * 投げる引き金を**このフレームで引いたか**。押しっぱなしで連投しない。
   *
   * --- なぜ 1 か所で数えるか ---
   * 以前は「引いていたか」を控える札を 3 つの投げ物 (弾倉・手榴弾・クレイモア)
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
  private triggerReleased = true;
  private grenadeReleaseRatio = GRENADE_RELEASE_RATIO;
  private readonly grenadeOrigin = new THREE.Vector3();
  /** 手持ちの投げ物。復帰で戻る */
  /** 投げる構えを取っているか。離した瞬間に投げる */
  private throwAiming = false;
  /** しゃがみ / 回避のキーを押している時間 (秒) */
  private stanceHeld = 0;
  /** その押しで既に転がったか。離したときにしゃがませないため */
  private stanceRolled = false;
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
  private readonly spreadRight = new THREE.Vector3();
  private readonly spreadUp = new THREE.Vector3();
  /** カメラの遮蔽判定用。弾道とは別に持つ (far が毎回変わるため) */
  private readonly cameraRay = new THREE.Raycaster();
  /** 弾道を折れ線で辿るための作業ベクトル */
  private readonly segmentFrom = new THREE.Vector3();
  private readonly segmentTo = new THREE.Vector3();
  private readonly segmentDir = new THREE.Vector3();
  /** 弾に掛かる重力。調整パネルから変えられる */
  private bulletGravity = BULLET_GRAVITY;

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
  private loadout: { primary: WeaponId; secondary: WeaponId; support: SupportId } = {
    primary: "rifle",
    secondary: "pistol",
    support: "grenade",
  };
  /** 次に湧いたときの装備。試合中に変えても、いま持っている物は変わらない */
  private pendingLoadout = {
    primary: "rifle" as WeaponId,
    secondary: "pistol" as WeaponId,
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
    secondary: "pistol",
    support: "grenade",
  });

  private get ammo(): number {
    return this.inv.ammo;
  }
  /** 0 より大きい間はリロード中で、発砲できない */
  private reloadTimer = 0;
  /** リロードの音を鳴らすまでの残り時間 (秒)。0 なら鳴らし終えている */
  private reloadSoundIn = 0;
  /** ボルト操作を始めるまでの残り時間 (秒) */
  private boltIn = 0;
  /** 撃ってからボルトに手を掛けるまで (秒、調整用) */
  private boltDelay = BOLT_DELAY;
  /** リロードの音を鳴らし始める位置 (割合、調整用) */
  private reloadSoundAt = RELOAD_SOUND_AT;
  /** 連射中の何発目か。反動パターンを引く添字 */
  private burstIndex = 0;
  /** 姿勢由来の散布 (度)。移動と滞空で増え、落ち着くと戻る */
  private postureSpread = 0;
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
  private hitFeedbackTimer = 0;
  private timeSinceShot = BURST_RESET_TIME;
  /** 状態を送るタイマーの ID。描画ループとは独立して回る */
  private snapshotHandle = 0;
  /** 直近のキル表示。新しいものが先頭 */
  private readonly killFeed: (KillEvent & { at: number })[] = []
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
    const steps = this.input.consumeWheel();
    // Z は 1 段ずつ上げて、一番上まで行ったら肩越しへ戻る。
    // トラックパッドではホイールが扱いにくいので、キーでも回せるようにしてある
    const cycled = this.input.consumeAction("zoom", "KeyZ");
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
  private team: Team = "blue";
  /** 試合の状態。サーバーが持っているものをそのまま控える */
  private match: MatchMessage | null = null;
  /** 遠隔の弾道を描くための作業ベクトル */
  private readonly remoteFrom = new THREE.Vector3();
  private readonly remoteTo = new THREE.Vector3();
  private fps = 0;
  private onStats: ((stats: GameStats) => void) | null = null;

  constructor(container: HTMLElement, identity: Identity, room: string) {
    this.container = container;
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

    this.stage = buildStage(this.scene);
    // 陣営の基地。地面を見れば自分の湧く場所が分かる
    this.scene.add(buildBases());
    this.sun = buildLights(this.scene);
    this.placeAtSpawn();
    this.scene.add(this.player.object);
    this.remotes = new RemotePlayers(this.scene);
    this.soundRing = new SoundRing(this.scene);
    this.thrown = new ThrownItems(this.scene);
    this.grenades = new Grenades(this.scene);
    this.claymores = new Claymores(this.scene);
    this.blast = new BlastFx(this.scene);
    this.casings = new Casings(this.scene);
    this.drops = new Drops(this.scene);
    void loadStageBoxes().then((boxes) => {
      // 跳ねる面と遮蔽は別の集合。手榴弾は当たり判定のほうを見る
      this.stageBoxes = solidBlockers(boxes);
    });
    this.shots = new Shots(this.scene);
    this.net.onMessage((message) => this.receive(message));

    this.raycaster.far = MAX_RANGE;

    this.follow = new FollowCamera(1);
    this.follow.snapTo(this.player, this.cameraWorld);
    this.audio = new GameAudio(this.follow.camera, this.scene);

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
    this.snapshotHandle = window.setInterval(
      () => this.broadcast(),
      SNAPSHOT_INTERVAL * 1000,
    );
  }

  /** 武器の取り付け位置の調整用。開発時の Calibrator からのみ呼ばれる */
  calibrateWeapon(
    target: WeaponTarget,
    grip: THREE.Vector3,
    rotation: THREE.Euler,
  ): void {
    this.player.calibrateWeapon(target, grip, rotation);
  }

  /** 撃ってからボルトに手を掛けるまでの調整用 (秒) */
  /** 吹き飛ばされる / 起き上がる型の再生速度。調整用 */
  setKnockdownRates(sweep: number, stand: number): void {
    this.player.setKnockdownRates(sweep, stand);
  }

  /** 手を離れる位置。投げクリップに対する割合 (0..1)。調整用 */
  setGrenadeRelease(ratio: number): void {
    this.grenadeReleaseRatio = ratio;
  }

  setBoltDelay(seconds: number): void {
    this.boltDelay = seconds;
  }

  /** リロードの音を鳴らし始める位置の調整用 (0..1) */
  setReloadSoundAt(ratio: number): void {
    this.reloadSoundAt = ratio;
  }

  /** 弾の落下の調整用。0 でまっすぐ飛ぶ */
  setBulletGravity(gravity: number): void {
    this.bulletGravity = gravity;
  }

  /** ダンボールの寸法と位置の調整用 */
  setBoxTuning(tuning: Partial<BoxTuning>): void {
    setBoxTuning(tuning);
  }

  /** ナイフを出しっぱなしにする (調整用) */
  setKnifePreview(visible: boolean): void {
    this.player.setKnifePreview(visible);
  }

  /** 照準の上下が上半身に効く強度の調整用 */
  setAimPitchGain(gain: number): void {
    this.player.setAimPitchGain(gain);
  }

  /** しゃがみ時に上半身を右へ旋回させる角度の調整用 (度で受ける) */
  setCrouchTorsoYaw(degrees: number): void {
    this.player.setCrouchTorsoYaw(degrees);
  }

  /** 非構え時の上半身の向き補正の調整用 */
  setUpperTwistFix(amount: number): void {
    this.player.setUpperTwistFix(amount);
  }

  /** 構えていないときの前傾の調整用 (度で受ける) */
  setRelaxedLean(degrees: number): void {
    this.player.setRelaxedLean(THREE.MathUtils.degToRad(degrees));
  }

  /** 雲の量の調整用。小さいほど広く覆う */
  setCloudCoverage(coverage: number): void {
    setCloudCoverage(coverage);
  }

  /** 日陰の明るさ (天空光) の調整用 */
  setAmbientIntensity(intensity: number): void {
    setAmbientIntensity(intensity);
  }

  /** 影の濃さの調整用 (0..1) */
  setShadowIntensity(intensity: number): void {
    this.sun.shadow.intensity = intensity;
  }

  /** 画面全体の明るさ (トーンマッピングの露出) の調整用 */
  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  /** 構え時のカメラの寄り具合の調整用 */
  setAimView(view: { distance: number; shoulder: number; fov: number }): void {
    this.follow.setAimView(view);
  }

  /** 跳躍の調整用 */
  setJumpTuning(gravity: number, height: number, fallScale: number): void {
    this.player.setJumpTuning(gravity, height, fallScale);
  }

  /** 移動速度の調整用 */
  setMoveSpeed(speed: number, aimScale: number): void {
    this.player.setMoveSpeed(speed, aimScale);
  }

  /** 操作方法の切り替え */
  setInputDevice(device: InputDevice): void {
    this.input.setDevice(device);
  }

  /** 自分の ID。HUD がキル表示で自他を分けるのに使う */
  get selfId(): string {
    return this.net.id;
  }

  /** 今どちらが効いているか。パネルの表示用 */
  inputStatus(): { active: "keyboard" | "gamepad"; connected: boolean } {
    return {
      active: this.input.activeDevice,
      connected: this.input.gamepadConnected,
    };
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
    window.clearInterval(this.snapshotHandle);
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
    if (this.match?.phase === "countdown") this.moveDir.set(0, 0, 0);

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

    // 押した事実を渡して、受け付けるかは Player が決める。
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
     * (sim/hitcheck.ts の STAB_DOWN_PITCH)。
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

    this.updateSwitchKeys();
    this.updateStanceInput(dt);
    this.updateLoadoutKeys();
    this.syncLoadoutPointer();
    this.syncHeld();
    this.inv.update(dt);
    this.updateTrigger();
    this.updateZoom();
    this.applyWeaponView();

    // 成績表。開いている間はポインタを離して、押せる状態にする
    if (this.input.consumeAction("menu", "Tab")) this.setMenu(!this.menuOpen);

    if (this.input.consumeAction("salute", "KeyV")) this.player.salute();
    this.updateLinks();
    // 押している間は手を挙げたまま。離すと下ろす
    this.player.setSaluteHeld(this.input.isActionDown("salute", "KeyV"));
    // **引き金の立ち上がりはフレームの頭で 1 回だけ。** 投げ物ごとに数えると、
    // 先に見た物が倒した札を後の物が読むことになる
    this.triggerEdge = this.input.firing && !this.wasFiring;
    this.wasFiring = this.input.firing;
    this.updateThrowAim();
    // 反動込みの照準を渡す。銃口が跳ね上がる動きが体にも出る。
    this.player.update(
      dt,
      this.moveDir,
      this.follow.aimYaw,
      this.follow.aimPitch,
      this.world,
    );
    this.reportFall();
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
    this.player.setGhost(this.life === "spawning" || this.loadoutBlocking);
    this.updateRollContact();
    this.updateStab(dt);
    this.updatePostureSpread(dt);
    this.updateWeapon(dt);
    this.remotes.update(dt, Date.now());
    this.drops.update(dt);
    this.updateFootsteps();
    this.grenades.update(dt, this.stageBoxes, (bounce) => {
      // 跳ねた音は全員の輪に出す。自分が投げたものも例外にしない。
      // 手榴弾は隠すものではなく、転がってきたことに気付かせるためのもの
      const gain = this.audio.play("bounce", bounce.position, bounce.strength);
      this.addPing("shot", bounce.position, gain);
    });
    this.updateGrenadeAim();
    this.updateClaymoreRelease(dt);
    this.updateGrenadeRelease(dt);
    this.thrown.update(dt, this.stage.collidables, (impact) => {
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
    this.casings.update(dt, this.stageBoxes, (at) => {
      // 落ちた音。輪には出さない — 撃った位置は銃声が既に伝えているので、
      // ここで二重に印を付ける意味が無い
      this.audio.play("casingDrop", at);
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

  /** Player から見た世界。地形の表現を Player 側に漏らさないための薄い層 */
  private readonly world: PlayerWorld = {
    resolveHorizontal: (position, radius, feetY) => {
      resolveCircle(position, radius, this.stage.obstacles, feetY, PLAYER_HEIGHT);
      clampToArena(position, radius, ARENA_HALF_SIZE);
    },
    groundHeight: (position, radius, feetY) =>
      groundHeight(position, radius, this.stage.obstacles, feetY),
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
  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "state":
        this.remotes.receive(message.snapshot);
        break;

      case "shot":
        // 弾道と発砲音は必ず出す。撃たれたことが見えないと遮蔽へ動く判断ができない。
        // 当たったかどうかはここには載っていない (health で別に届く)。
        this.remoteFrom.fromArray(message.from);
        this.remoteTo.fromArray(message.to);
        this.shots.fire(this.remoteFrom, this.remoteTo, null, IMPACT_WORLD);
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

      case "kill":
        this.killFeed.unshift({ ...message, at: Date.now() });
        this.killFeed.length = Math.min(this.killFeed.length, KILL_FEED_MAX);
        this.recordPoints(message);
        // 倒された。この後の 5 秒はこの人を映す。
        // 自爆なら映すものが無いので空のままにする
        if (message.victim === this.net.id) {
          this.killedBy = message.killer === this.net.id ? "" : message.killer;
        }
        break;

      // 繋ぎ直したときに届く、離脱前の続き。
      //
      // 湧き地点へは戻さない。**その命の続き**なので、居た場所に居た体力で戻る。
      // 弾数もサーバーが写しを持っているので、そちらを正とする
      case "resume":
        this.player.resumeAt(message.x, message.y, message.z, message.health);
        // **持っている銃にだけ当てる。** サーバーはまだ銃ごとの表で返してくるが、
        // こちらは持っている物しか持たない。持っていない銃の弾は捨てる
        this.inv.restore(message.magazine, message.reserve, message.grenades);
        // **選んである装備を戻す。** ここを抜かすと、こちらだけ既定値の手榴弾に
        // 戻って、投げの型を出しているのにサーバーはクレイモアのまま、になる
        this.loadout.support = message.support;
        this.loadout.primary = message.primary;
        this.pendingLoadout.support = message.support;
        this.pendingLoadout.primary = message.primary;
        this.onLoadout?.(this.pendingLoadout);
        void this.player.equip(message.primary);
        this.follow.snapTo(this.player, this.cameraWorld);
        break;

      // 自分が湧いたことは life で分かる。ここで受けるのは他人の跳躍だけ
      case "respawn":
        if (message.id !== this.net.id) this.remotes.warp(message.id);
        break;

      case "roster":
        for (const player of message.players) {
          // 自分の所属もここで分かる。湧き位置がこれで決まる
          if (player.id === this.net.id) {
            this.team = player.team;
            // 誰が味方かは自分の所属が分かって初めて決まる
            this.remotes.setSelfTeam(this.team);
            this.placeAtSpawn();
            continue;
          }
          this.remotes.setName(player.id, player.name);
          this.remotes.setTeam(player.id, player.team);
          this.remotes.setHealth(player.id, player.health);
          // 状態を先に入れる。無いと既定の joining のまま = 戦場に居ない扱いで、
          // 位置が届いていても一度も描かれない
          if (player.life) this.remotes.setLife(player.id, player.life);
        }
        break;

      case "match": {
        const changed = this.match?.phase !== message.phase;
        // 試合が切り替わったら飛んでいる手榴弾を捨てる。
        // サーバー側も同じ所で捨てるので、爆発が届かないまま残り続ける
        if (changed && message.phase !== "playing") {
          this.grenades.clear();
          this.claymores.clear();
        }
        this.match = message;

        // 決着したら成績表を開く。
        //
        // 誰が何点取ったかは、終わった直後にしか意味を持たない。Tab を
        // 押した人だけが見られる形だと、押さない人には勝ち負けの結果しか残らない。
        //
        // 次の試合が始まったら畳む。開いたままだとポインタが離れていて、
        // 始まった瞬間に動けない
        if (changed) {
          if (message.phase === "over") this.setMenu(true);
          else if (message.phase === "playing" && this.menuOpen) this.setMenu(false);
        }
        break;
      }

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

      case "claymorePlaced":
        this.claymores.place(message.id, message.at, message.yaw);
        break;

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
        // 転べば手が緩む。**握っていた手榴弾は足元へ** (落としたのはサーバー)
        this.loseHeldGrenade();
        this.audio.play("blastScream", this.player.position);
        break;

      case "join":
        this.remotes.setName(message.id, message.name);
        if (message.team) this.remotes.setTeam(message.id, message.team);
        // 参加を知ったら即座に返す。相手の画面に現れるまでを次の周期まで待たせない。
        this.broadcast();
        break;

      case "noise":
        this.hearNoise(message);
        break;

      // サーバーが状態を移した。装備画面も、倒れる姿勢も、無敵の見た目も
      // ここから出る。推し量る側の判断はどこにも残さない
      case "life":
        if (message.id === this.net.id) this.setLife(message.state);
        else {
          const at = this.remotes.setLife(message.id, message.state);
          // 倒れた相手の位置で叫ぶ。撃った側には当てた手応えになり、
          // 離れた場所の誰かには「そこで撃ち合いが終わった」と伝わる
          if (at) this.addPing("shot", at, this.audio.play("scream", at));
        }
        break;

      // 遮蔽の裏へ入った。位置が止まるのを待たずに消す。
      // 待つと、遅れて届いているだけの相手と区別が付かない
      case "hidden":
        this.remotes.hide(message.id);
        break;

      case "leave":
        this.remotes.remove(message.id);
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
  private applyHealth(message: HealthMessage): void {
    if (message.id !== this.net.id) {
      this.remotes.setHealth(message.id, message.health);
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
    const died = this.player.setHealth(message.health, message.flinch);
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
    const base = TEAM_SPAWNS[this.team];
    // 同じ点に重なると互いが見えないので、ID から決まる向きへ散らす
    const spread = spawnAngle(this.net.id + this.shotCount);
    this.player.position.set(
      base.x + Math.cos(spread) * SPAWN_SPREAD,
      0,
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
    // 決めたら湧く。閉じるのではなく**戦場へ出る**ので、サーバーに頼む。
    // 湧かせるかどうかを決めるのはあちら (支度に入って 3 秒経つまでは通らない)
    if (this.input.consumeKeyPress("Enter") || this.input.consumeKeyPress("KeyL")) {
      this.requestSpawn();
    }
    // **番号は並び順から出す。** 主武器が 1 から、投擲はその続き。
    // 直に書くと、銃が 1 挺増えたときに番号が重なる (P90 を足して実際に重なった)
    const choices = CHOICES.primary;
    choices.forEach((id, i) => {
      if (this.input.consumeKeyPress(`Digit${i + 1}`)) this.setLoadout(id);
    });
    SUPPORTS.forEach((id, i) => {
      if (this.input.consumeKeyPress(`Digit${choices.length + 1 + i}`)) this.setSupport(id);
    });
  }

  /**
   * 自分がどういう状態に居るか。**サーバーが決めたものの写し。**
   *
   * 以前はここが無く、「体力が 0 か」「試合の段階は何か」から必要な場所で
   * 都度組み立てていた。組み立て方が場所ごとにずれて不具合になっていたので、
   * 権威が言ってきた 1 つの値だけを見る (src/domain/lifecycle.ts)。
   */
  private life: Life = "joining";
  /** その状態に入った時刻 (Date.now)。残り秒数の表示に使う */
  private lifeAt = Date.now();

  /**
   * サーバーが状態を移した。
   *
   * 装備画面の出し入れも、無敵の見た目も、入力を受けるかも全部ここから出る。
   * 「開いているか」という別の札は持たない — 持つと、状態と札の 2 つが
   * 食い違い得る場所が生まれる (実際、札が閉じたまま開き直らない不具合があった)。
   */
  private setLife(state: Life): void {
    if (this.life === state) return;
    this.life = state;
    this.lifeAt = Date.now();

    // 支度へ移った。倒した相手を映すのをやめて、自分の湧き地点へ戻る。
    // ここで初めて装備画面が出るので、その背景が自分の湧き地点になる
    if (state === "choosing") {
      this.killedBy = "";
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
  private killedBy = "";
  private readonly killCamAt = new THREE.Vector3();

  /**
   * 倒した相手を映すか。映すなら killCamAt にその足元が入る。
   *
   * 相手が見つからない (自爆した、退出した) ときは映さない。
   * その場合は倒れた自分の体をそのまま映し続ける
   */
  private get killCamTarget(): THREE.Vector3 | null {
    if (this.life !== "downed" || !this.killedBy) return null;
    const at = this.remotes.positionOf(this.killedBy);
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
   * サーバーも同じ規則で手榴弾を配っているので、ここを揃えないと
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
  setLoadout(primary: WeaponId): void {
    this.pendingLoadout.primary = primary;
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

  /** 選んだことを画面へ知らせる。Game は signal を持たないので、外から差し込む */
  onLoadout: ((next: { primary: WeaponId; support: SupportId }) => void) | null = null;

  /**
   * 戦場へ出た。
   *
   * 湧き地点へ置くのは支度に移った時点で済んでいる (装備画面の背景が
   * 自分の湧き地点になる)。ここでやるのは持ち物の確定だけ。
   */
  private respawnSelf(): void {
    // 湧くときに装備が確定する。試合中に組み替えても、ここまで反映されない
    this.loadout = { ...this.pendingLoadout };

    void this.player.equip(this.loadout.primary);
    this.player.respawn();
    this.refillFromLoadout();
    this.reloadTimer = 0;
    this.reloadSoundIn = 0;
    this.boltIn = 0;
    this.stabTimer = 0;
    this.burstIndex = 0;
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
      this.team,
      // 見下ろしていれば倒れている相手にも届く。構えていなければ水平とみなす
      this.player.isAiming ? this.follow.aimPitch : 0,
    );
    if (!result) return;

    // 味方に当てた。申告は送らない (サーバーが捨てるが、送る意味も無い)。
    // 表示だけは出す。当たったこと自体が分からないと、撃ち続けてしまう。
    if (result.friendly) {
      this.lastHitZone = "FF";
      this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
      return;
    }

    this.lastHitZone = result.fromBehind ? "BACKSTAB" : "KNIFE";
    this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
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
    // ナイフは押した瞬間に振る。押しっぱなしで連打しない
    if (this.input.firing && this.triggerReleased) {
      this.triggerReleased = false;
      this.startStab();
    }
    if (!this.input.firing) this.triggerReleased = true;
  }

  private updateWeapon(dt: number): void {
    // 撃つ手を止めたらパターンを頭に戻す。バースト射撃が意味を持つのはこのため。
    this.timeSinceShot += dt;
    if (this.timeSinceShot >= BURST_RESET_TIME) this.burstIndex = 0;

    // ボルト操作の開始待ち
    if (this.boltIn > 0) {
      this.boltIn -= dt;
      if (this.boltIn <= 0) {
        this.boltIn = 0;
        this.player.playBolt();
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
        }
      }
    }

    if (this.input.consumeAction("reload", "KeyR")) this.startReload();

    this.fireCooldown -= dt;

    // 弾が無いのに引き金を引いた。撃てないことを音で返す。
    //
    // 何も起きないと、撃てているのか当たっていないのかが分からない。
    // 自動でリロードはしない — 弾を切らしたこと自体が代償なので、
    // そこを黙って埋めると弾数を数える意味が消える。
    if (this.emptyCooldown > 0) this.emptyCooldown -= dt;
    if (
      this.input.firing &&
      this.player.isAiming &&
      canAct(this.life) &&
      this.reloadTimer <= 0 &&
      this.ammo <= 0 &&
      this.emptyCooldown <= 0
    ) {
      this.audio.play("empty", this.player.position);
      this.emptyCooldown = EMPTY_INTERVAL;
    }

    // 単発の銃は、押しっぱなしでは 1 発しか出ない。
    //
    // 表に auto があるのに誰も見ていなかった。狙撃銃が連射できないのは
    // ボルト操作の時間で塞がれていたからで、単発だからではなかった。
    // 拳銃はその時間が無いので、そのままだと押しっぱなしで撃ち続けられる。
    //
    // 引き金を離すまで次を撃たせない。離した瞬間に撃てるようにするのではなく、
    // **離してから押し直す**まで待たせる。
    if (!this.input.firing) this.triggerReleased = true;
    const pulled = this.weapon.auto || this.triggerReleased;

    // 構えていないと撃てない。空になっても自動でリロードはしない。
    const firing =
      pulled &&
      this.input.firing &&
      this.player.isAiming &&
      canAct(this.life) &&
      this.reloadTimer <= 0 &&
      this.stabTimer <= 0 &&
      !this.player.rolling &&
      // **撃てる物を手にしていて、持ち替えが終わっていること。**
      // 手榴弾やナイフに持ち替えている間は引き金が効かない。これが
      // 投げること・刺すことの代償になる (docs/design.md の 5)
      this.inv.canShoot &&
      this.ammo > 0;
    this.player.setFiring(firing);

    if (!firing || this.fireCooldown > 0) return;
    // ボルト操作がある銃は、動作が終わるまで次を撃てない。
    // クリップの尺を優先するので、動きと撃てない時間が必ず一致する。
    //
    // 動作は撃った瞬間ではなく少し置いてから始める。撃った反動を受けてから
    // 手を掛ける、という順になる。
    if (this.weapon.bolt && this.player.boltDuration > 0) {
      this.boltIn = this.boltDelay;
      this.fireCooldown = this.boltDelay + this.player.boltDuration;
    } else {
      this.fireCooldown = this.weapon.fireInterval;
    }
    // 単発の銃はここで引き金を「使い切る」。次は離して押し直すまで出ない
    if (!this.weapon.auto) this.triggerReleased = false;
    this.fire();
  }

  private startReload(): void {
    if (this.reloadTimer > 0 || this.stabTimer > 0 || this.player.rolling)
      return;
    // ボルトを送り終えるまでは弾倉に触れない。
    //
    // 持ち替え・ダンボール・ローリングで飛ばせないようにしてあるのと同じ規則。
    // ここが抜けていて、撃った直後に R を押すとコッキングを省略できた。
    if (this.cocking) return;
    if (this.ammo >= this.weapon.magazine) return;
    // 予備が尽きていたら替えるものが無い
    if (this.inv.reserve <= 0) return;
    // モーションの尺をそのまま操作不能時間にして、見た目と挙動を一致させる
    this.reloadTimer = this.player.reloadDuration || this.weapon.reload;
    this.player.playReload();
    // 音は動作に合わせて遅らせる (下の updateWeapon で鳴らす)
    this.reloadSoundIn = this.reloadTimer * this.reloadSoundAt;
    // 覗いたままだと入れ替えの間ずっと視界が狭い。肩越しへ戻す
    this.zoomStep = 0;
  }

  private fire(): void {
    this.follow.aimOrigin(this.aimOrigin);
    this.follow.aimDirection(this.aimDir);
    this.applySpread(this.aimDir);

    const shot = this.traceBullet();
    const player = shot.player;
    const terrain = shot.terrain;
    // 距離は銃口からではなく照準の起点から測る。弾道の判定と同じ基準にする。
    const distance = shot.distance;
    const hit = player || terrain;
    if (player) {
      const friendly = player.player.isAlly(this.team);
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
      this.hitFeedbackTimer = HIT_FEEDBACK_DURATION;
    }

    // トレーサーだけは銃口から描く。判定は照準線、見た目は銃口という TPS 共通の割り切り。
    this.player.muzzle(this.muzzlePos);
    // 排莢。当たり判定も音も無く、撃っている手応えのためだけに出す
    this.player.ejectPort(this.ejectPos);
    this.casings.eject(this.ejectPos, this.player.yaw);
    this.audio.play(this.weapon.shotSound, this.muzzlePos);
    // 撃っている間は何も聞こえない
    this.soundRing.suppress(1);
    this.shots.fire(
      this.muzzlePos,
      this.hitPoint,
      hit ? this.hitNormal : null,
      player ? IMPACT_HIT : IMPACT_WORLD,
    );
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

    // 反動は撃った「後」に加える。この一発はまだ狙った向きへ飛ぶ。
    const [pitch, yaw] =
      RECOIL_PATTERN[Math.min(this.burstIndex, RECOIL_PATTERN.length - 1)];
    const kickPitch =
      pitch *
      (1 +
        RECOIL_PITCH_JITTER *
          randomSigned(this.shotCount, RandomStream.recoilPitch));
    const kickYaw =
      yaw +
      RECOIL_YAW_JITTER * randomSigned(this.shotCount, RandomStream.recoilYaw);
    this.follow.addRecoil(
      THREE.MathUtils.degToRad(kickPitch),
      THREE.MathUtils.degToRad(kickYaw),
    );

    this.burstIndex++;
    this.timeSinceShot = 0;
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
   */
  private updateStanceInput(dt: number): void {
    if (this.input.consumeAction("roll", "Space")) {
      this.stanceHeld = 0;
      this.stanceRolled = false;
    }

    if (this.input.isActionDown("roll", "Space")) {
      this.stanceHeld += dt;
      if (!this.stanceRolled && this.stanceHeld >= ROLL_HOLD_TIME) {
        this.stanceRolled = true;
        // ボルトを送り終えるまでは転がれない。撃って即座に回避、を塞ぐ
        if (!this.cocking) this.player.roll();
      }
      return;
    }

    if (this.stanceHeld > 0) {
      if (!this.stanceRolled) this.player.toggleCrouch();
      this.stanceHeld = 0;
    }
  }

  /**
   * 投げる構えと、離したときの投擲。
   *
   * 押している間は落下点を見せ、離した瞬間に投げる。囮として使う道具なので、
   * どこへ落ちるかを見てから決められないと「そこへ落とす」判断にならない。
   * 押した瞬間に飛ぶ形だと、狙った場所へ落とすのが運になる。
   *
   * 数を限ってあるのは、無制限だと「とりあえず投げ続ける」が最適になって
   * 読み合いにならないため。1 回の命につき数発で、外せば手札が減る。
   */
  private updateThrowAim(): void {
    // ボルトを送り終えるまでは投げられない。持ち替え・ダンボール・ローリング・
    // リロードと同じ規則。ここが抜けていて、撃った直後に投げるとコッキングを
    // 省略できた
    const canThrow =
      this.inv.held === "magazine" && canAct(this.life) && !this.cocking;
    const held = canThrow && this.input.aiming;
    const release = held && this.throwAiming && this.triggerEdge;

    if (held && !release) {
      this.follow.aimOrigin(this.aimOrigin);
      this.follow.aimDirection(this.aimDir);
      this.thrown.showPreview(this.aimOrigin, this.aimDir, this.stage.collidables);
      this.throwAiming = true;
      return;
    }

    if (!this.throwAiming) return;
    this.throwAiming = false;
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
    if (this.inv.held !== "claymore" && this.setupAiming) {
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
      this.grenades.showPreview(this.grenadeOrigin, this.aimDir, this.stageBoxes);
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
      this.player.throwWindupLeft + this.grenadeReleaseRatio * this.player.throwReleaseDuration,
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
      !this.cocking;
    const held = canPlace && this.input.aiming;
    const release = held && this.setupAiming && this.triggerEdge;

    if (held && !release) {
      if (!this.setupAiming) this.player.playSetup();
      this.setupAiming = true;
      // 体をカメラの方へ向ける。置く向き = 自分の向きなので、これが照準になる
      this.player.setThrowing(true);
      return;
    }

    if (!this.setupAiming) return;
    this.setupAiming = false;
    // 構えをやめただけなら置かない。覗いて場所を確かめる、が使える
    if (!release || !canPlace) {
      this.player.cancelThrow();
      this.player.setThrowing(false);
      return;
    }

    this.inv.spend();
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
  private updateSwitchKeys(): void {
    if (!canAct(this.life) || this.loadoutBlocking) {
      this.browsing = null;
      this.pressedAt.weapon = 0;
      this.pressedAt.tool = 0;
      return;
    }
    // ボルトを送り終えるまでは持ち替えない。撃って即座に隠れる、を塞ぐ
    if (this.cocking) return;
    // 構えたままは持ち替えられない。銃を下ろす一手間があって初めて、
    // どちらで待つかの選択になる
    if (this.player.isAiming) {
      this.browsing = null;
      return;
    }

    /*
     * G。**一覧を開いていれば置く、開いていなければ拾う。**
     *
     * 同じ 1 つのキーにしてあるのは、どちらも「地面と手の間で物を動かす」
     * 操作だから。押し分ける必要が出るのは、置きたい物の上に立っているときだけで、
     * そのときは一覧を開いているかどうかで意図がはっきりしている。
     */
    if (this.input.consumeAction("drop", "KeyG")) {
      if (this.browsing) this.dropSelected();
      else this.net.send({ type: "pickup" });
    }

    // --- 長押しで一覧、離すと持ち替え ---
    //
    // **一覧の中を動くのはタダ。** 時間がかかるのは決めた後の持ち替えだけ。
    // 押すだけのトグルは即持ち替えなので、連打すると全部が実際の持ち替えになる。
    // 選ぶことと抜くことを分けると、迷っている時間に代償が要らなくなる。
    for (const [family, action, code] of SWITCH_KEYS) {
      const down = this.input.isActionDown(action, code);
      if (down) {
        // 押し始めを控える。**一覧はすぐには出さない** — 単押しのつもりで
        // 出ると、往復するたびに画面が騒がしくなる
        if (this.pressedAt[family] === 0) this.pressedAt[family] = Date.now();
        const holding = Date.now() - this.pressedAt[family] >= BROWSE_HOLD * 1000;
        if (holding && !this.browsing) {
          this.browsing = { family, at: this.browseStart(family) };
        }
        if (this.browsing?.family === family) {
          const steps = this.input.consumeWheel();
          if (steps !== 0) this.browsing.at = this.browseMove(this.browsing, -steps);
        }
      } else if (this.pressedAt[family] !== 0) {
        const opened = this.browsing?.family === family;
        const pick = opened ? this.inv.list(family)[this.browsing!.at]?.id : undefined;
        this.pressedAt[family] = 0;
        if (opened) this.browsing = null;
        // 一覧を開いていたなら選んだ物へ。開いていなければトグル
        if (pick) this.inv.switchTo(pick);
        else if (family === "weapon") this.inv.toggle("weapon");
        else this.inv.toggle("tool");
      }
    }

    // 名指しの持ち替え。一覧を開かずに行き先が決まっているとき
    if (this.input.consumeAction("grenade", "KeyE")) {
      const support = this.inv.supportId;
      if (support) this.inv.switchTo(support);
    }
    if (this.input.consumeAction("knife", "KeyF")) this.inv.switchTo("knife");
  }

  /** 一覧を開いた時点の位置。いま手にある物に合わせる */
  private browseStart(family: Family): number {
    const list = this.inv.list(family);
    const at = list.findIndex((item) => item.id === this.inv.held);
    return at < 0 ? 0 : at;
  }

  /** 一覧の中を送る。端で止めず回す — 短い並びなので行き止まりが煩わしい */
  private browseMove(state: { family: Family; at: number }, step: number): number {
    const list = this.inv.list(state.family);
    if (list.length === 0) return 0;
    return (state.at + step + list.length) % list.length;
  }

  /**
   * 手にある物を Player と Inventory で揃える。
   *
   * 銃はモデルの読み込みが要る (equip) ので、変わった瞬間だけ呼ぶ。
   */
  /**
   * 一覧で選んでいる物を地面へ置く。
   *
   * **持ち物から外すのはこちら、地面に置くのはあちら。** 位置を持っているのが
   * サーバーなので、置き場所はあちらが決める (足元)。残弾は本人しか知らないので
   * 一緒に送る。
   */
  private dropSelected(): void {
    if (!this.browsing) return;
    const id = this.inv.list(this.browsing.family)[this.browsing.at]?.id;
    if (!id || !canDrop(id)) return;
    const gone = this.inv.drop(id);
    if (!gone) return;
    this.net.send({
      type: "drop",
      weapon: gone.id,
      ammo: "ammo" in gone ? gone.ammo : undefined,
      reserve: "reserve" in gone ? gone.reserve : undefined,
      count: "count" in gone ? gone.count : undefined,
    });
    // 一覧は閉じる。置いた物を指したまま残ると、次に離した瞬間に
    // 「持っていない物へ持ち替える」になる
    this.browsing = null;
    this.pressedAt.weapon = 0;
    this.pressedAt.tool = 0;
    // 音は dropped が返ってきたときに鳴らす。**置いた場所で鳴らしたい**し、
    // ここでも鳴らすと自分だけ 2 回聞こえる
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
    const gain = this.audio.play("explosion", position, 1);
    this.addPing("shot", position, gain);
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
    const surface = surfaceAt(position, PLAYER_RADIUS, this.stage.obstacles, position.y);
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
      this.team,
    );
    for (const name of formed) {
      this.links.unshift({ name, at: Date.now() });
      this.links.length = Math.min(this.links.length, LINK_FEED_MAX);
      // 繋がったことは音でも返す。手を挙げている間は画面を見ていない
      this.audio.play("clink", this.player.position);
    }
  }

  /**
   * 自分の点が動いたことを控える。
   *
   * **数字はルールから引く** (domain/rule/scoring.ts)。ここで 3 や -2 を直に
   * 書くと、点の付け方を変えたときに画面だけ古い数を出し続ける。
   *
   * 練習部屋のように点が記録されない部屋でも出る。**手応えとしての表示**なので、
   * 記録に残るかどうかとは別で構わない。
   */
  private recordPoints(message: KillEvent): void {
    const me = this.net.id;
    const mine = message.killer === me;
    const died = message.victim === me;
    if (!mine && !died) return;

    const suicide = mine && died;
    const label = suicide ? "SUICIDE" : mine ? "KILL" : "DEATH";
    const delta = suicide ? SUICIDE_POINTS : mine ? KILL_POINTS : DEATH_POINTS;
    this.pointFeed.unshift({ label, delta, at: Date.now() });
    this.pointFeed.length = Math.min(this.pointFeed.length, POINT_FEED_MAX);
  }

  /** 直近の点の増減。画面の右下に流す */
  private readonly pointFeed: { label: string; delta: number; at: number }[] = [];

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
    player: { player: RemotePlayer; zone: HitZone; distance: number } | null;
    terrain: THREE.Intersection | null;
    distance: number;
  } {
    const total = flightTime(MAX_RANGE);
    const step = total / TRAJECTORY_STEPS;

    // 区間の始点。最初は銃口 (= 照準の起点)
    this.segmentFrom.copy(this.aimOrigin);
    let travelled = 0;

    for (let i = 1; i <= TRAJECTORY_STEPS; i++) {
      trajectoryOffset(
        this.aimDir,
        step * i,
        this.bulletGravity,
        this.segmentTo,
      );
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
   * 姿勢由来の散布を更新する。
   *
   * **上がるのは即座、戻るのは遅い。** 狙いが乱れるのは動いた瞬間であって、
   * 一拍置いてからではない。両方を均すと、立ち座りのような一瞬の乱れが
   * 平らに均されて何も起きなくなる (実測で 0.83 度が 0.23 度まで潰れていた)。
   *
   * 遅いのは戻りのほうだけ。止まってから精度が返るまでに間がある。
   */
  private updatePostureSpread(dt: number): void {
    const moving = this.player.speed * this.weapon.spreadPerSpeed;
    // 姿勢を変えている間も散る。頭の高さが変わることは、このゲームでは
    // 移動と同じ重みを持つ (遮蔽を越えるかがそれで決まる)。ここが只だと、
    // 止まったまましゃがみ連打で頭だけ上下させるのが一番安い覗き方になる。
    const changing = this.player.stanceRate * this.weapon.spreadPerStance;
    const target = this.player.grounded
      ? moving * (this.player.isCrouching ? this.weapon.spreadCrouchScale : 1) + changing
      : this.weapon.spreadAirborne;
    this.postureSpread = Math.max(
      target,
      damp(this.postureSpread, target, SPREAD_SETTLE_LAMBDA, dt),
    );
  }

  /** 現在の散布界 (度)。連射で広がる分と、姿勢で広がる分の合計 */
  private get spreadDegrees(): number {
    return Math.min(
      this.burstIndex * this.weapon.spreadPerShot + this.postureSpread,
      this.weapon.spreadMax,
    );
  }

  /** 照準方向を散布界の円錐内へずらす。dir は正規化済みで、破壊的に書き換える */
  private applySpread(dir: THREE.Vector3): void {
    const spread = this.spreadDegrees;
    if (spread <= 0) return;

    // 円内に一様分布させる。半径に sqrt を掛けないと中心に偏る
    const angle =
      randomUnit(this.shotCount, RandomStream.spreadAngle) * Math.PI * 2;
    const radius =
      Math.sqrt(randomUnit(this.shotCount, RandomStream.spreadRadius)) *
      Math.tan(THREE.MathUtils.degToRad(spread));

    // 照準方向に直交する 2 軸を作る。真上を向いているときは基準を切り替える
    const up = Math.abs(dir.y) > 0.99 ? WORLD_FORWARD : WORLD_UP;
    this.spreadRight.crossVectors(dir, up).normalize();
    this.spreadUp.crossVectors(this.spreadRight, dir);

    dir
      .addScaledVector(this.spreadRight, Math.cos(angle) * radius)
      .addScaledVector(this.spreadUp, Math.sin(angle) * radius)
      .normalize();
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
    const shownWeapon: HeldId = choosing ? this.pendingLoadout.primary : this.inv.weapon;
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
      spread: this.spreadDegrees,
      crouching: this.player.isCrouching,
      hitZone: this.hitFeedbackTimer > 0 ? this.lastHitZone : "",
      links: this.links.filter((l) => now - l.at < LINK_FEED_LIFE * 1000).map((l) => l.name),
      menuOpen: this.menuOpen,
      loadoutOpen: this.loadoutBlocking,
      loadoutLeft: Math.max(0, Math.ceil(CHOOSE_TIMEOUT - this.chooseElapsed)),
      // OK が効くようになるまで。押せないボタンを押させないための表示
      loadoutWait: Math.max(0, Math.ceil(CHOOSE_FLOOR - this.chooseElapsed)),
      scoped: this.scoped,
      equipped: this.player.equipped,
      zoom: this.zoomStep > 0 ? this.weapon.scope[this.zoomStep - 1].label : "",
      canZoom: this.weapon.scope.length > 0 && this.player.isAiming,
      scores: this.match?.players ?? [],
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
      points: this.pointFeed.filter(
        (entry) => now - entry.at < POINT_FEED_DURATION * 1000,
      ),
      kills: this.killFeed.filter(
        (entry) => now - entry.at < KILL_FEED_DURATION * 1000,
      ),
      throwables: this.inv.countOf('magazine'),
      grenades: this.inv.supportCount,
      /**
       * 開いている一覧。閉じていれば null。
       *
       * 並びと、いま指している位置を渡す。**L 字に折って描く**のは画面側の仕事
       * (真ん中を塞がないため)。
       */
      browsing: this.browsing
        ? {
            // **数も載せる。** 選ぶときに「あと何発か」が要る — 弾切れの銃と
            // 満タンの銃が同じ見た目だと、一覧が選ぶ材料にならない。
            // 銃は装填分も足した**総数**。カードの数字と揃える
            items: this.inv.list(this.browsing.family).map((c) => ({
              id: c.id,
              n: 'ammo' in c ? c.ammo + c.reserve : 'count' in c ? c.count : null,
              // **装填の内訳も銃ごとに。** 送っている間、角のカードは指している銃を
              // 映すので、目盛りだけ手元の銃のままだと弾倉の長さが名前と合わない
              loaded: 'ammo' in c ? c.ammo : null,
              mag: 'ammo' in c ? weaponOf(c.id).magazine : null,
            })),
            at: this.browsing.at,
          }
        : null,
      held: this.inv.held,
      // **武器のカードに出す物。** 道具を手にしていても変わらない
      weaponHeld: shownWeapon,
      tool: this.inv.tool,
      toolInHand: this.inv.usingTool,
      browsingFamily: this.browsing?.family ?? null,
      switching: this.inv.switching,
      // **持ち物を見る。** 選択ではなく実際に持っている物
      support: (this.inv.supportId as SupportId | null) ?? this.loadout.support,
      team: this.team,
      match: this.match,
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
