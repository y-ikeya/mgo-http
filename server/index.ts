import {

  meleeDamage,
  MAX_HEALTH,
  RECOVER_CAP,
  RECOVER_DELAY,
  RECOVER_RATE,
  type HitZone,
} from '../src/sim/damage'
import { verifyToken, type Identity } from './auth'
import {
  decodeSnapshot,
  isSnapshot,
  stampLocomotion,
  stampProtected,
  stampSlot,
  SNAPSHOT_BYTES,
} from '../src/net/snapshot'
import { Footsteps } from '../src/sim/footsteps'
import { surfaceOf } from '../src/sim/surface'
import { blastAt } from '../src/sim/blast'
import { fallDamage } from '../src/sim/damage'
import { HELD, type HeldId } from '../src/sim/held'
import {
  blastFrom,
  canPlaceAt,
  triggeredBy,
  PLACE_FORWARD,
  SHOT_HALF,
  SHOT_TOP,
  type Placed,
} from '../src/sim/claymore'
import { closeMatch, flush, recordPlayer } from './stats'
import { FIXED_STEP, stepProjectile, throwVelocity, type Projectile } from '../src/sim/ballistic'
import {
  bulletDamage,
  reloadInto,
  startingAmmo,
  weaponOf,
  SUPPORT_SPECS,
  type Ammo,
  type SupportId,
  type WeaponId,
} from '../src/sim/weapons'
import { verifyHit, type Pose } from '../src/sim/hitcheck'
import { stanceOf } from '../src/sim/stance'
import {
  groundUnder,
  hasLineOfSight,
  headHeight,
  sightBlockers,
  solidBlockers,
  segmentHitsBox,
  type StageBox,
} from '../src/sim/vision'
import { cameraPoint } from '../src/sim/eyepoint'
import { arenaHalfOf, checkMove } from '../src/sim/motioncheck'
import {
  canAct,
  canBeHurt,
  canChoose,
  canSee,
  canTransition,
  CHOOSE_FLOOR,
  CHOOSE_TIMEOUT,
  DOWN_DURATION,
  isSeated,
  onBattlefield,
  SPAWN_PROTECT,
  type Life,
} from '../src/sim/lifecycle'
import type { Locomotion } from '../src/sim/locomotion'
import {
  SNAPSHOT_INTERVAL,
  type ClientMessage,
  type RoomSummary,
  type ServerMessage,
  type Team,
} from '../src/net/types'

/**
 * 対戦サーバー。
 *
 *   bun run server
 *
 * 体力・生死・復帰・キルを持つ。位置や見た目は持たず、そのまま中継する。
 *
 * ダメージの計算は src/sim/damage.ts を**そのまま読み込んでいる**。Bun は
 * TypeScript を直接動かせるので、クライアントと文字どおり同じコードが走る。
 * 移植しないので値がずれようがなく、片方だけ直して忘れる、が起きない。
 *
 * --- まだ守れていないこと ---
 * 「当たった」と言っているのはクライアント。壁抜けも自動照準もこれでは防げない。
 * 防ぐにはサーバーが位置・当たり判定・地形を持つ必要があり、それは Rust 版の仕事。
 * ここで先に押さえたのは、二重にキルが数えられない・体力が全員で一致する、
 * という「試合として成立させる」ための最低限。
 */

const PORT = Number(process.env.PORT ?? 8787)
/** 1 試合の長さ (ms) */
const MATCH_DURATION = 5 * 60 * 1000

/**
 * 陣営ごとの残機。TDM の勝敗はこれの削り合いで決まる。
 *
 * 死因を問わず 1 ずつ減り、**0 になった側が負け**。時間切れなら多く残っている
 * ほうが勝ち。倒した数ではなく「相手をどれだけ削れたか」で決まるので、
 * 相打ちを重ねても差が付かない。
 *
 * 20 は 4 対 4 で 5 分の試合を想定した数。1 人あたり 5 回死ねる勘定で、
 * 削り切って終わることも時間切れになることも両方ある辺り。**実際に回して詰める**
 * ものなので、環境変数で変えられるようにしてある (箱の上で試すのに再配置が要らない)。
 */
const TICKETS = Math.max(1, Number(process.env.MGO2_TICKETS) || 20)
/** 決着してから次の支度が始まるまで (ms)。結果を読む時間 */
const INTERMISSION = 10 * 1000
/**
 * 試合が始まるまでの数え (ms)。
 *
 * 全員を湧き地点へ戻してから始める。戻す瞬間にいきなり撃ち合いが始まると、
 * 画面が切り替わった側が一方的に不利になる。
 */
const COUNTDOWN = 5 * 1000
/**
 * 試合を始めるのに要る人数。
 *
 * 各陣営に 1 人。片方しか居ない状態で時計を回すと、誰も居ない相手に対して
 * 勝ったことになる。
 */
const MIN_PLAYERS = 2
/** 試合の状態を配る間隔 (ms)。残り時間の表示に要る */
const MATCH_BROADCAST = 1000

/**
 * 遮蔽になる箱。ステージの書き出しが glb と一緒に作る。
 *
 * サーバーが glb を解析する必要は無い。要るのは箱の位置と寸法だけで、
 * それは書き出しのときに分かっている。glb と同時に書かれるので、
 * 片方だけ古い形を見ている、ということが起きない。
 */
/**
 * ステージの箱。用途で 2 つに分ける。
 *
 * 遮蔽 (stageBoxes) と、物がぶつかる面 (solidBoxes) は別の集合になる。
 * 当たり判定専用のブロック (col_) は視線を止めないので遮蔽から外れるが、
 * 手榴弾はそこで跳ねる。逆に見えない壁 (vis_) は視線を止めるだけで物は通る。
 */
const [stageBoxes, solidBoxes]: [StageBox[], StageBox[]] = await (async () => {
  const path = new URL('../public/models/stage.json', import.meta.url)
  try {
    const data = (await Bun.file(path).json()) as { boxes: StageBox[] }
    const blockers = sightBlockers(data.boxes)
    const solids = solidBlockers(data.boxes)
    console.info(
      `ステージ: 箱 ${data.boxes.length} 個 / 視線を止める ${blockers.length} 個 / ` +
        `物が当たる ${solids.length} 個 / 範囲 ±${arenaHalfOf(solids).toFixed(1)}m`,
    )
    return [blockers, solids]
  } catch {
    // 形が無くても対戦は成立する。ただし全員が全員を見られる状態になる
    console.warn('stage.json が読めない。遮蔽の判定なしで動かす (位置は全員へ配られる)')
    return [[], []]
  }
})()

interface Player {
  id: string
  name: string
  team: Team
  health: number
  /**
   * いまどういう状態に居るか。src/sim/lifecycle.ts に定義がある。
   *
   * **ここが唯一の出どころ。** 以前は respawnAt / droppedAt / protectedUntil /
   * positioned の 4 つの数から、必要な場所で必要な条件をその都度組み立てていた。
   * 同じ問いへの答えが場所ごとにずれて、そのまま不具合になっていた。
   */
  life: Life
  /**
   * 倒した相手の id。倒れている間だけ意味がある。
   *
   * 倒された側の画面はこの人を映す。**その間だけ、遮蔽を無視して位置を配る** —
   * 映すものが無いと画面が成立しないので。湧いたら消す。
   */
  killedBy: string
  /**
   * その状態に入った時刻 (Date.now)。
   *
   * 時間で切り替わる遷移 (倒れる尺、無敵、支度の打ち切り、席を畳むまで) は
   * 全部ここから出す。状態ごとに別の時計を持たない。
   */
  lifeAt: number
  /**
   * 直近の位置。state をそのまま流すついでに控えている。
   *
   * サーバーが位置を持つのはこれが初めて。今は「撃たれた方向」を出すためだけだが、
   * 選択的可視化 (見えている相手だけを配る) に要るのも同じ情報なので、
   * ここが将来その足場になる。
   */
  x: number
  y: number
  z: number
  /** 姿勢。頭の高さが変わるので、遮蔽の判定に要る */
  crouching: boolean
  boxed: boolean
  /**
   * 姿勢が低くなった時刻 (Date.now)。0 なら低くない。
   *
   * しゃがむ操作は押した瞬間に届くが、体が実際に沈むのは補間で 0.3 秒ほどかかる。
   * 届いた瞬間から低い頭で線を引くと、**まだ立っている相手を先に消す**ことになり、
   * 物陰でしゃがんだ相手が一瞬で画面から消える。沈み切るまでは高いほうで見る。
   */
  loweredAt: number
  /**
   * 位置が届く間隔 (ms) の均し。64Hz で送っているので 16 前後が正常。
   *
   * ここが伸びている人は、こちらから見て「途切れがちな相手」になる。
   * 相手の画面ではその人が明滅するか、出てこない。
   */
  packetGap: number
  /** 最後に位置が届いた時刻 (Date.now)。間隔を測るのに使う */
  lastPacketAt: number
  /**
   * その人の時計とこちらの時計の差 (ms)。
   *
   * 位置には送り主の Date.now() が乗っている。ここが大きくずれている機械が
   * 混ざると、受け取る側が「送り主の時計 − 自分の時計」で古さを測っていた
   * 頃は、その人だけ姿が出なかった。今は各クライアントで直しているが、
   * ずれ自体は見えるようにしておく。
   */
  clockSkew: number
  /** 体の向き (rad)。ナイフの背後判定に要る */
  yaw: number
  /**
   * 視点の向きと上下 (rad)、構えているか。
   *
   * どこから見ているかを出すのに要る。三人称なので、画面に映るものを
   * 決めているのはカメラの位置であって目の位置ではない (src/sim/eyepoint.ts)。
   */
  cameraYaw: number
  pitch: number
  aiming: boolean
  /**
   * いまこの人へ位置を配っている相手の id。
   *
   * 配るのをやめた瞬間に「もう見えない」と知らせるために持つ。知らせないと、
   * 受け取る側は沈黙から察するしかなく、遅れて届いているだけの相手と
   * 区別が付かない (見えたり消えたりになる)。
   */
  seen: Set<string>
  /**
   * その人に見えていると伝えてあるクレイモアの id。
   *
   * 位置の seen と同じ形。**置いた瞬間に全員へ配ると、壁の裏に置いた物が
   * 透けて見える** — 隠して置くことに意味がある道具なので、そこを漏らすと
   * 使う理由が消える。
   */
  seenClaymores: Set<number>
  /**
   * 集中し始めた時刻 (Date.now)。0 なら集中していない。
   *
   * 回復の条件。姿勢を崩した瞬間も、撃たれた瞬間も 0 に戻すので、
   * 待ち直しになる。
   */
  concentratingSince: number
  /** 残りの手榴弾。倒れて復帰するたびに戻る */
  grenades: number
  /**
   * 投擲の枠に何を入れたか。
   *
   * 弾倉を選んだ人には手榴弾を配らない。数を持っているのがこちらなので、
   * 知らせてもらわないと決められない。
   */
  /**
   * support の枠に何を入れたか。
   *
   * 弾倉はここに入らない — 撃った弾が 1 弾倉ぶん溜まるごとに勝手に増える物で、
   * 枠を使って選ぶ装備ではない。数えているのはクライアント (囮は各自が解く)。
   */
  support: SupportId
  /**
   * 主武器の選択。
   *
   * `weapon` (いま構えている物) とは別。繋ぎ直したときに返すためだけに持つ —
   * 読み直した瞬間は拳銃を持っているかもしれないので、構えている物からは復元できない。
   */
  primary: WeaponId
  /**
   * いま手にある物。位置と一緒に届く。
   *
   * 撃てない物 (手榴弾・ナイフ・箱) を持っている間の射撃を弾くのに使う。
   * **申告を信じるのではなく、届いた状態と突き合わせる。**
   */
  held: HeldId
  /** 手榴弾を振りかぶって持っているか。倒されたら足元に落ちる */
  holdingGrenade: boolean
  /**
   * 切れたとき戦場に居たか。
   *
   * 戻ってきた人を続きへ返すか、支度からやり直させるかの判断。
   * 倒れている最中に切れたなら、どのみち次は湧くので支度でよい。
   */
  wasAlive: boolean
  /**
   * 最後に届いた位置のパケット。**そのまま配り直す**ために取っておく。
   *
   * 接続が切れた人の体をその場に残すのに要る。位置は「届いたときに配る」形なので、
   * 送ってこなくなれば自然に止まり、相手の画面から消える。消えると、撃ち合いで
   * 不利になったらブラウザを閉じる、が逃げ道になる。
   */
  lastPayload: Uint8Array | null
  /**
   * 席番号。位置の 2 進で誰のものかを表すのに使う。
   *
   * id をそのまま載せると長さが可変になる。抜けた番号は空くまで使い回さない
   */
  slot: number
  /** 倒した数 / 倒された数。試合ごとに 0 に戻る */
  kills: number
  deaths: number
  /**
   * 与えたヘッドショットと、**受けた**ヘッドショット。
   *
   * MGO2 はやられた側も記録していた。上手さだけでなく「どうやられたか」を
   * 見せるため。こちらは zone を持っているのでタダで取れる。
   */
  headshots: number
  headDeaths: number
  /** 自爆。倒された数には入るが、誰かの手柄にはならない */
  suicides: number
  /**
   * 武器ごとのキル。**表示名ではなく安定した id で数える**
   * ('rifle' | 'sniper' | 'pistol' | 'knife' | 'grenade')。
   * 銃の表示名を変えたときに過去の記録が壊れないように
   */
  killsByWeapon: Record<string, number>
  /**
   * 直前に配った体力。同じ値を配り直さないための控え。
   *
   * 回復は毎 tick 少しずつ動くので、丸めた値が変わったときだけ配る
   */
  healthShown: number
  /** 却下した申告の数。/health に出す (当たり判定が疑わしい人が分かる) */
  rejected: number
  /** 最後に撃った時刻 (Date.now)。連射の速さの上限を見るのに使う */
  lastShotAt: number
  /**
   * 過去の姿勢。当てたという申告を遡って照合するのに使う。
   *
   * 長さは送る間隔から出す (HISTORY_SIZE)。決め打ちにすると、送る速さを
   * 変えたときに遡れる長さが黙って変わる
   */
  history: Pose[]
  /** 歩いた距離の積算。足音を出す間隔を決める */
  footsteps: Footsteps
  /** いまどの動きの中に居るか。足音の間隔と、他の人に見せる姿勢に効く */
  locomotion: Locomotion
  /** 持っている銃。威力と連射の上限をこれで引く */
  weapon: WeaponId
  /**
   * 銃ごとの弾数。**写しであって、権威ではない。**
   *
   * 空撃ちの判断はクライアントがやる (押した瞬間に音が要るので)。ここが持って
   * いるのは、繋ぎ直した人へ続きを返すため。持たせないと、30 秒の猶予が
   * 「瀕死でリロードすれば全快して弾も満タン」という抜け道になる。
   *
   * 減らすのは shot が届いたとき。増やすのは reload が届いたとき —
   * **クライアントは装填が終わった瞬間に送る**ので、こちらは銃ごとの尺を
   * 知らなくてよい。
   */
  ammo: Ammo
  /**
   * 形の合わない位置を最後に警告した時刻 (Date.now)。
   *
   * 古いクライアントが繋ぐと毎フレーム落ちるので、間引かないとログが埋まる
   */
  badPacketAt: number
  /** 成立しない移動を最後に警告した時刻 (Date.now)。同じく間引くため */
  badMoveAt: number
  socket: Bun.ServerWebSocket<Client>
}

interface Client {
  /** 発行元が保証した ID。名乗った値ではない (認証が有効なとき) */
  id: string
  /** 発行元が持っていた表示名 */
  name?: string
  room: string
}

/** 席番号を配る。抜けた番号は空くまで使い回さない (取り違えを避ける) */
function nextSlot(room: Match): number {
  const used = new Set([...room.players.values()].map((p) => p.slot))
  for (let i = 0; i < 0xffff; i++) if (!used.has(i)) return i
  return 0
}

interface Match {
  players: Map<string, Player>
  blue: number
  red: number
  endsAt: number
  phase: 'waiting' | 'countdown' | 'playing' | 'over'
  winner?: Team | 'draw'
  /** 最後に状態を配った時刻。1 秒ごとに配る */
  lastBroadcast: number
  /** 最後に「切れた人の体」を配り直した時刻 */
  lastLimbo: number
  /**
   * いま走っている試合の身元。記録に要る。
   *
   * 始まった時に発番して、終わるまで変えない。**離脱した人はその場で書く**ので、
   * 試合が終わってから採番したのでは間に合わない。
   */
  matchId: string | null
  startedAt: number
}

const rooms = new Map<string, Match>()

/**
 * 部屋は最初から決まった数だけ置く。
 *
 * 「誰かが立てて人を待つ」形にすると、人が少ないうちは空の部屋が並ぶだけの
 * 一覧になる。数を絞って固定すれば、入った先に必ず誰かが居る確率が上がる。
 * 人が増えて埋まるようになってから、立てられる形へ変える。
 */
const ROOM_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo'] as const

/** 1 部屋の上限。4 対 4 */
const ROOM_CAPACITY = 8

export type RoomName = (typeof ROOM_NAMES)[number]

function isRoomName(name: string): name is RoomName {
  return (ROOM_NAMES as readonly string[]).includes(name)
}

function roomOf(name: string): Match {
  let room = rooms.get(name)
  if (!room) {
    room = {
      players: new Map(),
      blue: 0,
      red: 0,
      endsAt: 0,
      phase: 'waiting',
      lastBroadcast: 0,
      lastLimbo: 0,
      matchId: null,
      startedAt: 0,
    }
    rooms.set(name, room)
  }
  return room
}

/**
 * 少ないほうへ入れる。同数なら青。
 *
 * 本人に選ばせない。人数が偏ったまま始まると、腕前より頭数で決まってしまう。
 */
/**
 * 席を空けて待つ時間 (ms)。
 *
 * リロードや一瞬の電波切れで戻ってこられる長さ。長くすると、抜けた相手を
 * 待って試合が始まらない時間も伸びるので、ほどほどに。
 */
const RECONNECT_GRACE = 30_000

/** 今つながっている人だけ。離脱中の席は配信に入れない */
function connected(room: Match): Player[] {
  return [...room.players.values()].filter((p) => isSeated(p.life))
}

/**
 * 席を持っている人。**一瞬の離脱を数に入れる。**
 *
 * 試合を続けるかどうかはこちらで数える。繋がっている人だけで数えていた頃は、
 * 片方がリロードした瞬間に人数が割れて待ちへ戻り、戻ってきたときに
 * countdown からやり直しになっていた — 得点も試合の時計も最初から。
 *
 * 席は RECONNECT_GRACE の間だけ空けて待つ、と決めてある。人数もその間は
 * 空けて待つのが筋で、そうでないと「席を残す」という仕掛けが試合の側から
 * 台無しにされる。戻ってこなければ席ごと消えて、そこで初めて人数が割れる。
 */
function holdingSeats(room: Match, now: number): Player[] {
  return [...room.players.values()].filter(
    (p) => isSeated(p.life) || now - p.lifeAt < RECONNECT_GRACE,
  )
}

function assignTeam(room: Match): Team {
  let blue = 0
  let red = 0
  for (const player of connected(room)) {
    if (player.team === 'blue') blue++
    else red++
  }
  return blue <= red ? 'blue' : 'red'
}

/**
 * 残機を 1 減らす。**残機が動く道はここ 1 本だけ**にする。
 *
 * 以前は点を 2 箇所 (銃と手榴弾) で別々に動かしていた。片方に足し忘れても
 * 試合はそれらしく進むので気づけない。
 *
 * **死因を問わない。** 撃たれても自爆しても自陣の残機が 1 減り、倒した側には
 * 何も入らない。これで「殺されるくらいなら自死する」が成り立たなくなる —
 * どちらで死んでも自陣の損は同じで、敵の得も同じ (ゼロ)。
 */
function loseTicket(room: Match, team: Team): void {
  if (team === 'blue') room.blue = Math.max(0, room.blue - 1)
  else room.red = Math.max(0, room.red - 1)
}

function matchState(room: Match): ServerMessage {
  return {
    type: 'match',
    blue: room.blue,
    red: room.red,
    endsAt: room.endsAt,
    phase: room.phase,
    present: connected(room).length,
    required: MIN_PLAYERS,
    winner: room.winner,
    // 戦績。1 秒ごとに配られるので、成績表はこれを見れば足りる。
    //
    // 離脱中の人も**消さずに残す**。リロードしている 2 秒のあいだ行が消えて
    // 戻ってくると、点差を見ている側には試合が壊れたように見える
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      suicides: p.suicides,
      away: !isSeated(p.life),
      // 位置が届いている回数 (通/秒)。名目は 64。
      //
      // **全員に見せる。** 「相手がカクつく / 消える」の原因が誰にあるかは、
      // これを見れば一目で分かる。調べるのに /health を叩いたり
      // DevTools を開いてもらったりしていた
      rate: p.packetGap > 0 ? Math.round(1000 / p.packetGap) : 0,
    })),
  }
}

/** 全員を湧き地点へ戻して立たせる。段階が変わるたびに呼ぶ */
function resetPlayers(roomName: string, room: Match): void {
  // 前の試合の手榴弾が残っていると、始まった直後に爆発する
  for (let i = grenades.length - 1; i >= 0; i--) {
    if (grenades[i].room === roomName) grenades.splice(i, 1)
  }
  for (const player of connected(room)) {
    player.kills = 0
    player.deaths = 0
    // 記録に残す分もここで戻す。**足したら必ずここにも足す** —
    // 戻し忘れると前の試合の数が次に混ざる
    player.headshots = 0
    player.headDeaths = 0
    player.suicides = 0
    player.killsByWeapon = {}
    // 仕切り直しは支度から。いきなり湧かせない —
    // 前の試合の装備のまま次が始まるのは、選ぶ場面を 1 回飛ばすのと同じ
    setLife(roomName, player, 'choosing')
    player.health = MAX_HEALTH
    player.concentratingSince = 0
    sendHealth(roomName, player, 0, false)
  }
}

/**
 * 湧かせる。装備を配り直して、無敵を付けて、戦場へ出す。
 *
 * 支度からしか呼ばない。倒れた直後にここへ跳ぶと装備が配り直されない
 * (setLife が通してくれないので、書き間違えても状態が壊れることはない)。
 */
function spawn(roomName: string, player: Player, now = Date.now()): void {
  player.killedBy = ''
  player.health = MAX_HEALTH
  // 装備から詰め直す。式は共有なので、画面に出る数と必ず一致する
  player.ammo = startingAmmo()
  player.grenades = SUPPORT_SPECS[player.support].count
  player.holdingGrenade = false
  player.concentratingSince = 0
  // 湧き地点へ跳ぶ。歩いた距離として積むと、着いた先で足音が連打される
  player.footsteps.warp(player.x, player.z)
  setLife(roomName, player, 'spawning', now)
  broadcast(roomName, { type: 'respawn', id: player.id })
  sendHealth(roomName, player, 0, false)
}

/**
 * 席を畳む。切れるのを待たずに消す。
 *
 * 名乗った id ではなく接続の player を受ける。他人を追い出せてしまうので。
 */
function leaveRoom(roomName: string, player: Player): void {
  const room = rooms.get(roomName)
  if (!room) return
  // 走っている試合を捨てて出た。抜けたことごと残す
  if (room.phase === 'playing') recordSeat(roomName, room, player, true)
  room.players.delete(player.id)
  // 本人はもう聞いていない。残った人に消してもらう
  broadcast(roomName, { type: 'leave', id: player.id })
}

/**
 * その人の一戦分を残す。
 *
 * **試合の終わりにまとめて、ではない。** 抜けた人は終わる頃にはもう部屋に
 * 居ないので、席を畳む側からもここを呼ぶ。関数は冪等なので、同じ人を
 * 二度書いても増えない。
 */
function recordSeat(roomName: string, room: Match, player: Player, leftEarly: boolean): void {
  if (!room.matchId) return
  recordPlayer({
    matchId: room.matchId,
    room: roomName,
    startedAt: room.startedAt,
    // 発行元での識別子。認証を通しているので player.id がそれになっている
    subject: player.id,
    name: player.name,
    team: player.team,
    kills: player.kills,
    deaths: player.deaths,
    headshots: player.headshots,
    headDeaths: player.headDeaths,
    suicides: player.suicides,
    killsByWeapon: player.killsByWeapon,
    leftEarly,
  })
}

/**
 * 決着した。残っている全員を書いて、試合を締める。
 *
 * 途中で抜けた人は既に書かれている (recordSeat) ので、ここには出てこない。
 */
function finishMatch(roomName: string, room: Match): void {
  if (!room.matchId) return
  for (const player of room.players.values()) {
    // 接続が切れているだけの人も含める。席は残っているので、まだ抜けてはいない
    recordSeat(roomName, room, player, false)
  }
  closeMatch(room.matchId, roomName, room.startedAt, room.winner ?? 'draw')
}

/** 部屋の全員へ。except を渡すとその 1 人を除く */
function broadcast(roomName: string, message: ServerMessage, except?: string): void {
  const room = rooms.get(roomName)
  if (!room) return
  const payload = JSON.stringify(message)
  for (const player of connected(room)) {
    if (player.id !== except) player.socket.send(payload)
  }
}

/**
 * 位置が届いたとき。
 *
 * 中身は詰め直さず、送り主の席番号だけを書き込んで、そのまま配る。
 * 送り主に名乗らせないので、他人になりすませない。
 */
/**
 * 状態が変わってから、移動の検査を始めるまで (ms)。
 *
 * 湧き直しでは湧き地点へ正当に跳ぶ (倒れた場所から数十 m 動く)。
 * 繋ぎ直した直後も前の位置とは繋がっていない。その分をここで見逃す。
 */
const WARP_GRACE = 1000

/**
 * 遊べる範囲の半分 (m)。ステージから出す。
 *
 * 起動時に 1 回。毎回の位置で 53 個の箱を舐め直す理由が無い
 */
const arenaHalf = arenaHalfOf(solidBoxes)

function receiveSnapshot(roomName: string, player: Player, raw: ArrayBuffer | ArrayBufferView): void {
  const bytes =
    raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!isSnapshot(view)) {
    // 形が合わない位置は捨てるしかないが、**黙って捨てると原因が分からない**。
    //
    // 位置の大きさは作りを変えるたびに増えている (33 → 35 → 36 バイト)。
    // 古いクライアントが繋ぐと、その人の位置だけが全部落ちる。落ちた人は
    // 「まだ位置を知らせていない人」の扱いになるので、誰の位置も配られない —
    // 銃声だけ聞こえて姿が見えない、という形で表に出る。
    // 時刻はここで取る。**下の const now より前なので、そちらは参照できない** —
    // 参照すると ReferenceError で落ちる (形の合わない位置が届いた瞬間に、
    // 古いクライアントを知らせるはずの道でサーバーが例外を投げていた)
    const at = Date.now()
    if (at - player.badPacketAt > 5000) {
      player.badPacketAt = at
      console.warn(
        `[位置] ${player.name}: 形が合わない (${bytes.byteLength} バイト、期待は ${SNAPSHOT_BYTES})。` +
          'クライアントが古い可能性',
      )
    }
    return
  }

  const snapshot = decodeSnapshot(view, player.id)

  // 通信の様子を控える。/health に出す。
  //
  // 「見えない敵が居る」の原因は、遮蔽の判定・届く間隔・時計のずれの
  // どれでも起こる。判定だけ疑って何度も試すことになったので、
  // 残りの 2 つは常に測っておく
  const arrived = Date.now()
  if (player.lastPacketAt > 0) {
    const gap = arrived - player.lastPacketAt
    player.packetGap =
      player.packetGap > 0 ? player.packetGap + (gap - player.packetGap) * 0.1 : gap
  }
  player.lastPacketAt = arrived
  player.clockSkew = snapshot.time - arrived

  // 跳んだ / 抜けたを弾く。
  //
  // 通ったものはそのまま信じる (速さは測らない)。ここが緩いままだと、
  // 座標を書き換えるだけで「そこから見える相手」を配らせられる —
  // 位置が可視を決めているので、詐称は壁抜けの視界になる。
  //
  // **状態が変わった直後は見ない。** 湧き直しでは湧き地点へ正当に跳ぶし、
  // 繋ぎ直した直後も前の位置とは繋がっていない
  const settled = onBattlefield(player.life) && lifeElapsed(player, arrived) > WARP_GRACE
  if (settled) {
    const verdict = checkMove(player, snapshot, solidBoxes, arenaHalf)
    if (!verdict.ok) {
      player.rejected++
      if (arrived - player.badMoveAt > 5000) {
        player.badMoveAt = arrived
        console.warn(`[位置] ${player.name}: ${verdict.reason}`)
      }
      // 動かさない。姿勢や向きは受けてよいので、位置だけ据え置く
      return
    }
  }

  player.x = snapshot.x
  player.y = snapshot.y
  player.z = snapshot.z
  // 低くなった瞬間を控える。高くなったら即座に解く
  // (立ち上がりは「見えるようになる」方向なので、遅らせる理由が無い)
  const lowered = snapshot.crouching || snapshot.boxed
  if (!lowered) player.loweredAt = 0
  else if (player.loweredAt === 0) player.loweredAt = Date.now()
  player.crouching = snapshot.crouching
  player.boxed = snapshot.boxed
  player.yaw = snapshot.yaw
  player.cameraYaw = snapshot.cameraYaw
  player.pitch = snapshot.pitch
  player.aiming = snapshot.aiming
  player.locomotion = snapshot.locomotion
  // 持っている銃。威力と連射の上限をこれで引く
  player.weapon = snapshot.weapon
  // いま手にある物。撃てるかどうかの判断に使う
  player.held = snapshot.held
  // 振りかぶって持っているか。倒された瞬間に足元へ落とすのに要る
  player.holdingGrenade = snapshot.holdingGrenade
  // 位置が届いた。どこに居るか分かったので支度に進める
  if (player.life === 'joining') setLife(roomName, player, 'choosing')
  recordPose(player)

  // 足音は位置が動いた分から出す。見えない相手にも音だけは届ける。
  // 戦場に居ないうち (支度中) は鳴らさない — 湧き地点で選んでいるだけなので
  if (onBattlefield(player.life)) {
    const step = player.footsteps.update(player.x, player.z, player.locomotion, true)
    if (step) emitNoise(roomName, player, { kind: 'step', ...step })
  }

  const now = Date.now()
  if (!snapshot.concentrating) player.concentratingSince = 0
  else if (player.concentratingSince === 0) player.concentratingSince = now

  stampSlot(view, player.slot)
  // 無敵かどうかはこちらが知っている。送り主に名乗らせない
  stampProtected(view, isProtected(player))
  // 切れたときに配り直せるよう、写しを取っておく。
  // bytes は受信バッファなので、持ち回すなら複製が要る
  player.lastPayload = new Uint8Array(bytes)
  relayState(roomName, player, bytes)
}

/**
 * 足音が届く距離 (m)。
 *
 * クライアントの音の設定 (audio.ts の step: max 20) と揃える。
 * 姿勢ごとの倍率を掛けたものが実際に届く距離になる。
 */
const STEP_RANGE = 20

/** 銃声が届く距離 (m)。rifle: max 130 と揃える */
const SHOT_RANGE = 130

/** 乗り越えられる段差 (m)。collision.ts の STEP_UP と揃える */
const STEP_UP = 0.25

/**
 * しゃがみが体に現れるまで (ms)。
 *
 * クライアント側のモーション補間に合わせてある。この間は立った高さで見る。
 * 迷ったら送る側に倒す — 見えるはずの相手を送り忘れるほうが、
 * 見えない相手を少し長く送ってしまうより困る。
 */
const LOWER_SETTLE_MS = 300

/** 遮蔽の判定に使う頭の高さ。沈み切るまでは立った高さで見る */
function visibleHead(player: Player, now: number): number {
  const settled = player.loweredAt > 0 && now - player.loweredAt >= LOWER_SETTLE_MS
  return settled ? headHeight(player.crouching, player.boxed) : headHeight(false, false)
}

/**
 * 飛んでいる手榴弾。
 *
 * **サーバーが自分で飛ばす。** クライアントは初速だけ受け取って同じ物理を解くので、
 * 位置を毎フレーム配らなくてよい (src/sim/ballistic.ts が両側で同じ結果を出す)。
 *
 * 弾と違って遡らない。投げた瞬間からこちらが飛ばしているので、爆発した時点の
 * 位置がそのまま正しい。
 */
interface Grenade {
  id: number
  room: string
  owner: string
  team: Team
  body: Projectile
  /** 爆発するまでの残り (秒) */
  fuse: number
}

const grenades: Grenade[] = []

/**
 * 置かれたクレイモア。
 *
 * 手榴弾と違って**飛ばない**ので軌道は持たない。置いた瞬間に位置と向きが決まり、
 * 起爆するまでそこに在り続ける。置いた本人が死んでも残る — 置いて離れる道具なので、
 * 本人が生きているかは関係ない。
 */
interface Claymore extends Placed {
  id: number
  room: string
  owner: string
  team: Team
}

const claymores: Claymore[] = []
let nextClaymoreId = 1

/**
 * 置く。**位置も向きもサーバーが決める** — 送らせると壁の中に置ける。
 *
 * 置けるのは自分の前 0.9m。そこが壁の中や段差の外なら**置かせない**
 * (sim/claymore.ts の canPlaceAt)。高さは地面に乗せる — 足元の y をそのまま
 * 使うと、段差の上に置いたときに床へ沈む。
 */
function placeClaymore(roomName: string, from: Player): void {
  if (!canAct(from.life) || from.support !== 'claymore' || from.grenades <= 0) return

  const forward = [-Math.sin(from.yaw), -Math.cos(from.yaw)]
  const x = from.x + forward[0] * PLACE_FORWARD
  const z = from.z + forward[1] * PLACE_FORWARD

  // 壁の中や縁の外へは置けない。**弾いても数は減らさない** —
  // 置けなかったのに手札が減ると、押し間違いが取り返しの付かない損になる
  const ground = groundUnder(x, z, from.y, solidBoxes, STEP_UP).top
  if (!canPlaceAt(x, z, from.y, ground, solidBoxes)) return

  from.grenades--
  const claymore: Claymore = {
    id: nextClaymoreId++,
    room: roomName,
    owner: from.id,
    team: from.team,
    x,
    // 地面に乗せる。足元をそのまま使うと、段差の上に置いたときに沈む
    y: ground,
    z,
    // 置いた本人と同じ向き。自分が来た方を向く形になる
    yaw: from.yaw,
  }
  claymores.push(claymore)

  // ここでは配らない。**見えている人にだけ**、tick が配る (relayClaymores)
}

/**
 * 置かれたクレイモアを、見えている人にだけ配る。
 *
 * 位置の配り方 (relayState) と同じ規則。味方には無条件、敵にはカメラから線が
 * 通ったときだけ。**見えなくなったら消す** — 一度見せたまま置きっぱなしにすると、
 * 物陰へ回った相手の画面に残り続けて「そこに在る」ことが漏れ続ける。
 *
 * 本体は 26cm しかないので、体のように 3 点で見ずに 1 点で見る。
 */
function relayClaymores(roomName: string, room: Match): void {
  for (const viewer of connected(room)) {
    for (const claymore of claymores) {
      if (claymore.room !== roomName) continue

      // 味方の物は無条件。どこに置いたか分からないと自分が引っ掛かる
      let visible = viewer.team === claymore.team
      if (!visible && stageBoxes.length > 0) {
        const eye = viewOf(viewer)
        visible = hasLineOfSight(
          eye.x, eye.y, eye.z,
          claymore.x, claymore.y, claymore.z,
          // 本体の高さ。頭の高さと同じ引数の意味 (足元からどれだけ上か)
          0.2,
          stageBoxes,
        )
      } else if (!visible) {
        visible = true
      }

      const known = viewer.seenClaymores.has(claymore.id)
      if (visible && !known) {
        viewer.seenClaymores.add(claymore.id)
        viewer.socket.send(
          JSON.stringify({
            type: 'claymorePlaced',
            id: claymore.id,
            at: [claymore.x, claymore.y, claymore.z],
            yaw: claymore.yaw,
            team: claymore.team,
          } satisfies ServerMessage),
        )
      } else if (!visible && known) {
        viewer.seenClaymores.delete(claymore.id)
        viewer.socket.send(
          JSON.stringify({ type: 'claymoreGone', id: claymore.id, blast: false } satisfies ServerMessage),
        )
      }
    }
  }
}

/**
 * 撃たれたクレイモアを起爆させる。
 *
 * **申告を増やさない。** shot は銃口と着弾点を既に送ってきているので、その線分と
 * 当たりを見れば済む。「クレイモアを撃った」と言わせると、見えていない物を
 * 撃ったことにできる。
 *
 * 見つけて壊せることが、置く側への答えになる — 通り道を塞がれたら、
 * 迂回するか壊すかを選べる。
 */
function shotHitsClaymore(roomName: string, from: readonly number[], to: readonly number[]): void {
  for (let i = claymores.length - 1; i >= 0; i--) {
    const claymore = claymores[i]
    if (claymore.room !== roomName) continue
    const box: StageBox = {
      name: 'claymore',
      min: [claymore.x - SHOT_HALF, claymore.y, claymore.z - SHOT_HALF],
      max: [claymore.x + SHOT_HALF, claymore.y + SHOT_TOP, claymore.z + SHOT_HALF],
    }
    if (!segmentHitsBox(from[0], from[1], from[2], to[0], to[1], to[2], box)) continue
    detonateClaymore(claymore)
    claymores.splice(i, 1)
  }
}

/** 起爆。前に居た敵だけを巻き込む */
function detonateClaymore(claymore: Claymore): void {
  const room = rooms.get(claymore.room)
  // 起爆は隠さない。音も光も壁を回り込んで届く (手榴弾と同じ規則)
  broadcast(claymore.room, { type: 'claymoreGone', id: claymore.id, blast: true })
  const here = rooms.get(claymore.room)
  if (here) for (const viewer of connected(here)) viewer.seenClaymores.delete(claymore.id)
  if (!room || room.phase !== 'playing') return

  for (const victim of connected(room)) {
    if (!canBeHurt(victim.life)) continue
    // 味方は巻き込まない。**置いた本人だけは例外** — 手榴弾を足元に落としたときと
    // 同じ規則で、自分の物で死ぬことがある
    if (victim.team === claymore.team && victim.id !== claymore.owner) continue

    const amount = blastFrom(claymore, victim)
    if (amount <= 0) continue
    applyBlastDamage(claymore.room, room, victim, amount, claymore.x, claymore.z, claymore.owner, 'claymore', false)
  }
}
let grenadeId = 0

/** 信管 (秒)。投げてから爆発するまで */
const FUSE = 3

/**
 * 手を離れる高さ (m)。足元からの差。
 *
 * 投擲モーションで手が一番高くなる所 (実測 1.74m) に合わせてある。
 * クライアントの GRENADE_RELEASE_HEIGHT と揃えること — ずれると、
 * 落下点の予測線と実際に飛ぶ軌道が食い違う。
 */
const RELEASE_HEIGHT = 1.7

/**
 * 手を離れる位置を、投げる向きへどれだけ前に出すか (m)。
 * クライアントの GRENADE_RELEASE_FORWARD と揃える。
 *
 * 体の中心から出すと、真下へ投げたときに自分の足元をすり抜ける。
 */
const RELEASE_FORWARD = 0.45

/**
 * 1 つの命で持てる数は support の表 (sim/weapons.ts) が決める。
 *
 * **数を持っているのはこちら。** 投げられるか置けるかを決めているのがこちらなので、
 * 表を読む側もこちらでないと、画面の数だけ減って実際には投げられる、が起きる。
 * 手榴弾 3 / クレイモア 2 という差もそこに書いてある。
 */

function throwGrenade(roomName: string, from: Player, event: ClientMessage): void {
  if (event.type !== 'grenade') return
  const room = rooms.get(roomName)
  if (!room) return
  if (!canAct(from.life) || from.grenades <= 0) return

  // 向きは信じる (どこを向いているかは本人にしか分からない) が、
  // 位置と速さは信じない。位置は控えてあるものを使い、初速はこちらで作り直す。
  // 壁の中から投げる / 地図の反対側まで飛ばす、を初速の捏造で作れなくする
  const [dx, dy, dz] = event.dir
  const length = Math.hypot(dx, dy, dz)
  if (!(length > 0.001)) return
  // 速さと上向きの下駄は共有の式で決める。予測線と同じ軌道になる
  const v = throwVelocity(dx / length, dy / length, dz / length)

  from.grenades--
  // 投げた時点で無敵は切れる。守られたまま攻撃はできない
  if (from.life === 'spawning') setLife(roomName, from, 'alive')
  const id = ++grenadeId
  // 前へ出す量は水平方向だけで測る (上下を向いても手の位置が動かないように)
  const flat = Math.hypot(v.x, v.z) || 1
  const body: Projectile = {
    x: from.x + (v.x / flat) * RELEASE_FORWARD,
    y: from.y + RELEASE_HEIGHT,
    z: from.z + (v.z / flat) * RELEASE_FORWARD,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    bounces: 0,
    resting: false,
  }
  grenades.push({ id, room: roomName, owner: from.id, team: from.team, body, fuse: FUSE })

  // 初速だけ配る。受け取った側が同じ物理を解いて同じ軌道を描く。
  //
  // 弾倉の囮と違って、**全員に見せる**。落ちてきたのに気付けないと、
  // 逃げるという手が最初から無い。避けられるからこそ投げる場所に意味が出る。
  broadcast(roomName, {
    type: 'grenade',
    id,
    from: [body.x, body.y, body.z],
    velocity: [body.vx, body.vy, body.vz],
    fuse: FUSE,
  })
}

/**
 * 倒された人が握っていた手榴弾を足元に落とす。
 *
 * 振りかぶった所で止めて持てるようにした以上、持ちっぱなしにできてはいけない。
 * 落ちて爆ぜるなら、**振りかぶっている間ずっと自分が的**になる。
 * 撃つ側にも「今撃てば道連れになる」という読みが生まれる。
 *
 * 投げるときと同じ経路に乗せるので、見た目も音も爆風も全部そのまま働く。
 */
function dropGrenade(roomName: string, from: Player): void {
  if (!from.holdingGrenade || from.grenades <= 0) return
  from.holdingGrenade = false
  from.grenades--

  const id = ++grenadeId
  const body: Projectile = {
    x: from.x,
    // 手から落ちる高さ。地面に埋まった状態で始めない
    y: from.y + 0.6,
    z: from.z,
    vx: 0,
    vy: 0,
    vz: 0,
    bounces: 0,
    resting: false,
  }
  grenades.push({ id, room: roomName, owner: from.id, team: from.team, body, fuse: FUSE })
  broadcast(roomName, {
    type: 'grenade',
    id,
    from: [body.x, body.y, body.z],
    velocity: [0, 0, 0],
    fuse: FUSE,
  })
}

/** 爆発させる。届いた相手を削って、近ければ吹き飛ばす */
function detonate(nade: Grenade): void {
  const room = rooms.get(nade.room)
  if (!room) return
  const { x, y, z } = nade.body

  // 爆発の位置は隠さない。音も光も壁を回り込んで届くので、伏せる意味が無い
  broadcast(nade.room, { type: 'explosion', id: nade.id, at: [x, y, z] })

  // 削るのは試合中だけ。支度の間や結果を読んでいる間に得点が動くと、
  // 何が起きたのか分からなくなる (銃と同じ規則)。
  // 飛ぶことと爆ぜることは止めない — 一人で立ち上げて試せなくなる
  if (room.phase !== 'playing') return

  for (const victim of connected(room)) {
    // 撃たれる状態に居る人だけ。まだ湧いていない・無敵・倒れている最中は通らない
    if (!canBeHurt(victim.life)) continue
    // 味方は巻き込まない。銃と同じ規則にする (誤爆で試合が壊れるより分かりやすい)。
    // 投げた本人だけは例外 — 足元に落とせば自分が吹き飛ぶ
    if (victim.team === nade.team && victim.id !== nade.owner) continue

    const result = blastAt(x, y, z, victim, stageBoxes)
    if (!result) continue

    applyBlastDamage(nade.room, room, victim, result.damage, x, z, nade.owner, 'grenade', result.knock)
  }
}

/**
 * 爆風のダメージを 1 人に入れる。
 *
 * **手榴弾とクレイモアが同じ道を通る。** 倒したときに動くものが多い
 * (体力・残機・戦績・キル表示・握っていた物・倒した相手を映す先) ので、
 * 2 つ目の爆発物を足すときにここを写すと、必ずどれかを写し忘れる。
 *
 * @param amount 与える量。届くかどうかと、どれだけ届くかは呼ぶ側が決める
 * @param knock 転ばせるか。クレイモアは転ばせない (踏んだら死ぬか掠るかなので)
 */
/**
 * 落下速度の上限 (m/s)。
 *
 * これ以上は同じ扱い。**申告に頼っているので、青天井にしない** — 移動を持って
 * いるのがクライアントなので、あり得ない速さを送られても分からない。
 * ステージの一番高い所 (7.5m) から落ちて 16.3 m/s なので、そこに余裕を足した値。
 */
const MAX_FALL_SPEED = 25

/** 死因の表示。表にしておかないと、増やしたときに三項演算子が伸びる */
const KILL_LABEL = { grenade: 'grenade', claymore: 'CLAYMORE', fall: '落下' } as const

function applyBlastDamage(
  roomName: string,
  room: Match,
  victim: Player,
  amount: number,
  fromX: number,
  fromZ: number,
  ownerId: string,
  weapon: 'grenade' | 'claymore' | 'fall',
  knock: boolean,
): void {
  victim.health = Math.max(0, victim.health - amount)
  // 爆風でも集中は途切れる
  victim.concentratingSince = 0

  // 爆心の方向。撃たれたときと同じで、どこから来たかだけ渡す
  const bearing = Math.atan2(fromX - victim.x, -(fromZ - victim.z))

  if (victim.health > 0) {
    sendHealth(roomName, victim, amount, false, bearing)
    if (knock && isSeated(victim.life)) {
      victim.socket.send(JSON.stringify({ type: 'knockdown' }))
    }
    return
  }

  victim.deaths++
  // 切れている間に倒された。戻ってきても続きは無い
  victim.wasAlive = false
  const killer = room.players.get(ownerId)
  // 自爆なら映すものが無い。空にしておくと画面は自分の体を映したままになる
  victim.killedBy = killer && killer.id !== victim.id ? killer.id : ''
  setLife(roomName, victim, 'downed')
  // 握っていたものは足元に落ちる。誘爆する
  dropGrenade(roomName, victim)
  if (killer && killer.id !== victim.id) {
    killer.kills++
    killer.killsByWeapon[weapon] = (killer.killsByWeapon[weapon] ?? 0) + 1
  } else if (killer) {
    // 自分の物で死んだ。手柄は誰にも付かない。
    // 置いた/投げた本人が既に居ない場合は自死に数えない — 残っていた物で
    // 死んだのは自分の落ち度ではない
    victim.suicides++
  }
  // 死因を問わず、倒された側の残機が 1 減る
  loseTicket(room, victim.team)
  sendHealth(roomName, victim, amount, false, bearing)
  broadcast(roomName, matchState(room))
  broadcast(roomName, {
    type: 'kill',
    killer: killer?.id ?? victim.id,
    killerName: killer?.name ?? victim.name,
    killerTeam: killer?.team ?? victim.team,
    victim: victim.id,
    victimName: victim.name,
    victimTeam: victim.team,
    weapon: KILL_LABEL[weapon],
    headshot: false,
  })
}

/**
 * 音を配る。
 *
 * **見えている相手には送らない。** 見えていれば位置が届いているので、
 * 受け取った側が自分で鳴らせる。ここで送るのは「姿は見えないが音は届く」場合だけ。
 *
 * 位置は入れない。方向と距離だけ渡す — それが耳で分かることの全部だから。
 */
function emitNoise(
  roomName: string,
  from: Player,
  noise: { kind: 'step' | 'shot'; volume?: number; range?: number },
): void {
  const room = rooms.get(roomName)
  if (!room) return

  const reach =
    noise.kind === 'shot' ? SHOT_RANGE : STEP_RANGE * (noise.range ?? 1)
  const head = headHeight(from.crouching, from.boxed)

  // 何の上を踏んだかは地形から出す。申告させるものではない
  const surface =
    noise.kind === 'step'
      ? surfaceOf(groundUnder(from.x, from.z, from.y, stageBoxes, STEP_UP).name)
      : undefined

  for (const listener of connected(room)) {
    if (listener.id === from.id) continue
    if (!canSee(listener.life)) continue

    const distance = Math.hypot(from.x - listener.x, from.z - listener.z)
    if (distance > reach) continue

    // 見えているなら位置が届いている。二重に鳴らさない。
    // 「見えている」の定義は位置を配るときと同じでなければならない —
    // ずれると、姿が見えている相手の音が輪にも出る (二重) か、
    // 見えていないのに音が出ない (無音の敵) のどちらかになる
    const eye = viewOf(listener)
    const visible =
      listener.team === from.team ||
      stageBoxes.length === 0 ||
      hasLineOfSight(eye.x, eye.y, eye.z, from.x, from.y, from.z, head, stageBoxes)
    if (visible) continue

    listener.socket.send(
      JSON.stringify({
        type: 'noise',
        kind: noise.kind,
        bearing: Math.atan2(from.x - listener.x, -(from.z - listener.z)),
        distance,
        surface,
        weapon: noise.kind === 'shot' ? from.weapon : undefined,
        range: noise.range,
        volume: noise.volume,
      }),
    )
  }
}

/**
 * 発砲を配る。見えている相手には曳光ごと、見えない相手には音だけ。
 */
function relayShot(roomName: string, from: Player, message: ServerMessage): void {
  const room = rooms.get(roomName)
  if (!room) return
  const payload = JSON.stringify(message)
  const head = headHeight(from.crouching, from.boxed)

  for (const listener of connected(room)) {
    if (listener.id === from.id) continue

    const eye = viewOf(listener)
    const visible =
      listener.team === from.team ||
      stageBoxes.length === 0 ||
      !canSee(listener.life) ||
      hasLineOfSight(eye.x, eye.y, eye.z, from.x, from.y, from.z, head, stageBoxes)

    if (visible) listener.socket.send(payload)
  }

  // 見えない相手には音として届ける
  emitNoise(roomName, from, { kind: 'shot' })
}

/**
 * 位置を、見えている相手にだけ配る。
 *
 * これがこのゲームの肝。全員へ流すと、ブラウザの JS を覗くだけで壁の向こうの
 * 相手が読める。接敵するまではステルス、という前提が丸ごと崩れる。
 *
 * 味方には無条件で配る。TDM で味方の位置が分からないと連携のしようがないし、
 * 隠すべき情報は敵に対するものだけ。判定の回数も半分以下になる。
 *
 * 見えなくなった相手には何も送らない。「見えなくなった」と伝えると、
 * それ自体が「さっきまで見ていた」という情報になる。受け取る側は最後に
 * 届いた位置のまま置いておく。
 */
/**
 * 遡れる長さ (ms)。
 *
 * 通信の往復 + 補間の遅れ (0.1 秒) を覆える幅にする。広く取るほど当てた側の
 * 体感は正しくなり、避けた側は「隠れたのに撃たれた」が増える。
 */
const LAG_WINDOW = 400

/**
 * 履歴に残す数。遡れる長さを覆えるだけ持つ。
 *
 * **送る間隔から出す。** 20Hz の頃に 12 個 (= 0.6 秒) と決め打ちしていたのを、
 * 64Hz へ上げたときに直し忘れていた。12 個では 0.19 秒しか遡れず、
 * LAG_WINDOW が 0.4 秒あっても半分より前は届かない — 回線の遠い人ほど
 * 「当てたのに通らない」が増える、という形で静かに効いていた。
 */
const HISTORY_SIZE = Math.ceil(LAG_WINDOW / (SNAPSHOT_INTERVAL * 1000)) + 2

function recordPose(player: Player): void {
  player.history.push({
    time: Date.now(),
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    crouching: player.crouching,
    boxed: player.boxed,
    // ナイフが刺さる姿勢かの判定に要る。**遡って照合するので履歴に持つ** —
    // 「いまの姿勢」で見ると、刺した瞬間は立っていた相手が
    // 爆風で転んだ直後に届いた申告を弾いてしまう
    stance: stanceOf(player.locomotion),
  })
  if (player.history.length > HISTORY_SIZE) player.history.shift()
}

/** カメラ位置の置き場。毎フレーム作らないよう使い回す */
const viewEye = { x: 0, y: 0, z: 0 }

/**
 * その人の画面がどこから見ているか。
 *
 * 可視を問うところは全部これを通す。位置を配るとき・銃声を配るとき・
 * 足音を配るときで別々に出すと、定義がずれて「姿も音も無い敵」が生まれる。
 */
function viewOf(player: Player): { x: number; y: number; z: number } {
  return cameraPoint(
    player.x,
    player.y,
    player.z,
    player.cameraYaw,
    player.pitch,
    player.aiming,
    // 壁に寄せる。省くと壁を背にした瞬間にカメラが壁の中へ入り、
    // その人だけ全方位が見えなくなる
    stageBoxes,
    viewEye,
  )
}

/**
 * 状態を移す。**書き換えるのはここだけ。**
 *
 * 直に代入させないのは、遷移が飛ぶと辻褄が合わなくなるため。倒れた人を
 * 支度を経ずに湧かせると装備が配り直されないし、離脱中の席を生き返らせると
 * 誰も居ない場所に人が立つ。通ってよい道は lifecycle.ts の表が持っている。
 *
 * 変わったことは全員へ知らせる。知らせないと、受け取る側がまた
 * 「位置が来ないから倒れたのだろう」と推し量ることになる。
 */
function setLife(roomName: string, player: Player, next: Life, now = Date.now()): void {
  if (player.life === next) return
  if (!canTransition(player.life, next)) {
    console.warn(`[状態] ${player.name}: ${player.life} → ${next} は通れない`)
    return
  }
  player.life = next
  player.lifeAt = now
  broadcast(roomName, { type: 'life', id: player.id, state: next })
}

/** その状態に入ってから経った時間 (ms) */
function lifeElapsed(player: Player, now = Date.now()): number {
  return now - player.lifeAt
}

/** いま無敵か */
function isProtected(player: Player): boolean {
  return player.life === 'spawning'
}

function relayState(roomName: string, from: Player, payload: Uint8Array): void {
  const room = rooms.get(roomName)
  if (!room) return

  const now = Date.now()
  const head = visibleHead(from, now)
  // 戦場に居ない人 (支度中・まだ位置を知らせていない) は誰にも配らない。
  // 倒れた場所に体が 30 秒残ることになる
  const present = onBattlefield(from.life)

  for (const viewer of connected(room)) {
    if (viewer.id === from.id) continue

    // 見る側として成立するか。どこから見ているか分からない相手には配らない
    let visible = present && canSee(viewer.life)

    // 倒された側には、倒した相手だけ遮蔽を無視して配る。
    //
    // その画面はいまその人を映している (kill cam)。映すものが無いと画面が
    // 成立しない。倒れている間だけで、支度に移った瞬間に切れる。
    //
    // **代償**: 倒された人は撃ってきた相手の居場所を 5 秒間見られる。
    // 味方に伝えられるので、隠れている側の利は少し削られる。それでも
    // 「どこから撃たれたのか分からないまま死ぬ」よりは読み合いになる、
    // という判断で入れてある。
    const killCam = viewer.life === 'downed' && viewer.killedBy === from.id

    // 味方は無条件。TDM で味方の位置が分からないと連携のしようがないし、
    // 隠すべき情報は敵に対するものだけ。判定の回数も半分以下になる
    if (visible && !killCam && viewer.team !== from.team && stageBoxes.length > 0) {
      // **目ではなくカメラから**線を引く。三人称なので、画面に映るものを
      // 決めているのはカメラの位置。目で見ると、遮蔽の裏にしゃがんだ相手が
      // 「カメラからは見えているのに送られてこない」ことになる。
      //
      // カメラのほうが後ろ上から見下ろすぶん、目より広く見える。そこは許す —
      // 描いている物と送る物がずれているほうが困る
      const eye = viewOf(viewer)
      visible = hasLineOfSight(eye.x, eye.y, eye.z, from.x, from.y, from.z, head, stageBoxes)
    }

    if (!visible) {
      // 配るのをやめる瞬間に 1 通だけ知らせる。
      //
      // 黙って止めると、受け取る側は沈黙の長さから察するしかない。
      // 沈黙は「隠れた」でも「相手の機械が遅れている」でも起きるので、
      // 区別が付かず、遅れて届く相手が見えたり消えたりする。
      if (viewer.seen.delete(from.id)) {
        viewer.socket.send(JSON.stringify({ type: 'hidden', id: from.id } satisfies ServerMessage))
      }
      continue
    }

    viewer.seen.add(from.id)
    viewer.socket.send(payload)
  }
}

function sendHealth(
  roomName: string,
  player: Player,
  damage: number,
  flinch: boolean,
  fromBearing?: number,
  zone?: HitZone,
): void {
  // 撃たれた方向と部位は本人にだけ渡す。
  //
  // 全員へ流すと、位置と合わせて撃った側を逆算できてしまう。被害者の座標は
  // 状態として配られているので、そこから方向へ線を引けば射手の居場所が出る。
  // 「誰に撃たれたかは渡さない」と決めた意味が無くなる。
  if (isSeated(player.life)) {
    player.socket.send(
      JSON.stringify({
        type: 'health',
        id: player.id,
        health: player.health,
        damage,
        flinch,
        fromBearing,
        zone,
      }),
    )
  }

  // 他の人に要るのは、誰がどれだけ削られたかまで。倒れた表現に使う
  broadcast(
    roomName,
    { type: 'health', id: player.id, health: player.health, damage, flinch },
    player.id,
  )
}

/**
 * 被害者から見た攻撃者の方向 (rad)。ワールド基準で 0 が -Z。
 *
 * 位置そのものは渡さない。方向だけなら、遮蔽の向こうに居る相手を
 * 特定する手掛かりにならない。
 */
function bearingTo(from: Player, to: Player): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z))
}

/**
 * ダメージの申告を処理する。
 *
 * 倒れている相手への攻撃は捨てる。これが無いと、同じ死体に当てた全員が
 * キルを取ることになる (撃った側の画面ではまだ生きて見えているため、
 * 申告そのものは正当に届く)。
 */
/**
 * 連射の検査に持たせる余裕 (0..1)。
 *
 * 通信のゆらぎで詰まって届くことがあるので、武器の間隔をそのまま使わず
 * 少し緩める。0.85 なら 15% 早い連射までは通す。
 */
const FIRE_INTERVAL_SLACK = 0.85

/**
 * 申告を弾く。
 *
 * 落とすだけで、撃った側には何も返さない。「弾かれた」と伝えると、
 * 何が通って何が通らないかを試して回れてしまう。
 */
function reject(attacker: Player, reason: string): void {
  attacker.rejected++
  console.warn(`[却下] ${attacker.name}: ${reason}`)
}

function applyDamage(roomName: string, attacker: Player, event: ClientMessage): void {
  if (event.type !== 'damage') return
  const room = rooms.get(roomName)
  const victim = room?.players.get(event.target)
  if (!room || !victim || !canBeHurt(victim.life)) return
  // 撃った時点で自分の無敵は切れる。盾にしたまま撃たせない
  if (attacker.life === 'spawning') setLife(roomName, attacker, 'alive')
  // 湧いた直後の相手には当たらない
  if (isProtected(victim)) return
  // 味方は撃てない。誤射で試合が壊れるより、当たらないほうが分かりやすい
  if (victim.team === attacker.team) return
  // 試合中以外は削らない。支度の間や結果を読んでいる間に得点が動くと、
  // 何が起きたのか分からなくなる
  if (room.phase !== 'playing') return

  // --- ここから、申告が本当かを調べる ---
  //
  // 当たり判定そのものはクライアントが持っている (骨の姿勢を持っているのが
  // あちらだけなので)。だからこそ、位置から分かることは信じない。
  // 撃った本人しか知り得ないことは信じ、こちらで確かめられることは確かめる。

  // 連射の速さ。0.09 秒間隔が上限なので、それを超えて届いたら作り物
  if (event.kind === 'bullet') {
    const now = Date.now()
    const limit = weaponOf(attacker.weapon).fireInterval * 1000 * FIRE_INTERVAL_SLACK
    if (now - attacker.lastShotAt < limit) {
      reject(attacker, `連射が速すぎる (${now - attacker.lastShotAt}ms)`)
      return
    }
    attacker.lastShotAt = now
  }

  const verdict = verifyHit(
    attacker.history,
    victim.history,
    {
      kind: event.kind,
      zone: event.zone,
      distance: event.distance,
      fromBehind: event.fromBehind,
    },
    stageBoxes,
    LAG_WINDOW,
  )
  if (!verdict.ok) {
    reject(attacker, verdict.reason)
    return
  }

  const amount =
    event.kind === 'melee'
      ? meleeDamage(event.fromBehind ?? false)
      : bulletDamage(weaponOf(attacker.weapon), (event.zone ?? 'BODY') as HitZone, event.distance ?? 0)

  victim.health = Math.max(0, victim.health - amount)
  // 撃たれたら集中は途切れる。回復は最初から待ち直し。
  victim.concentratingSince = 0

  if (victim.health > 0) {
    // 頭に当たったのに倒れなかったときだけ怯ませる。
    // 胴でも出すと、連射している間ずっと怯み続けて棒立ちになる。
    sendHealth(
      roomName,
      victim,
      amount,
      event.kind === 'bullet' && event.zone === 'HEAD',
      bearingTo(victim, attacker),
      event.zone,
    )
    return
  }

  victim.killedBy = attacker.id
  // 切れている間に倒された。戻ってきても続きは無い — 死んだので支度から
  victim.wasAlive = false
  setLife(roomName, victim, 'downed')
  victim.deaths++

  // 記録に残す分。**表示名ではなく安定した id で数える**
  const headshot = event.kind === 'bullet' && event.zone === 'HEAD'
  if (headshot) {
    attacker.headshots++
    victim.headDeaths++
  }
  const by = event.kind === 'melee' ? 'knife' : attacker.weapon
  attacker.killsByWeapon[by] = (attacker.killsByWeapon[by] ?? 0) + 1
  // 振りかぶったまま倒されたら、足元に落ちて爆ぜる。
  // 撃った側にとっては「今撃つと道連れになる」という読みになる
  dropGrenade(roomName, victim)
  attacker.kills++
  // 減るのは倒された側の残機だけ。倒した側には何も入らない
  loseTicket(room, victim.team)
  sendHealth(roomName, victim, amount, false, bearingTo(victim, attacker))
  broadcast(roomName, matchState(room))
  broadcast(roomName, {
    type: 'kill',
    killer: attacker.id,
    killerName: attacker.name,
    killerTeam: attacker.team,
    victim: victim.id,
    victimName: victim.name,
    victimTeam: victim.team,
    // 背後から刺したかは表記に出さない。即死かどうかで結果は既に出ているし、
    // 倒された側に「背後を取られた」と明示しても、次に活かせる情報にならない。
    // 倒したときに使っていた銃。表から引く (直書きすると増やすたびに嘘になる)
    weapon: event.kind === 'melee' ? 'KNIFE' : weaponOf(attacker.weapon).kill,
    headshot: event.kind === 'bullet' && event.zone === 'HEAD',
  })
}

/**
 * 残っているのが片側だけならその陣営。両方居るか、誰も居なければ null。
 *
 * 不戦勝を出すかどうかの判断に使う。
 */
function soleTeam(seats: Player[]): Team | null {
  const blue = seats.some((p) => p.team === 'blue')
  const red = seats.some((p) => p.team === 'red')
  if (blue === red) return null
  return blue ? 'blue' : 'red'
}

/**
 * 試合の進行。
 *
 * 時間切れで決着、しばらく結果を見せてから次の試合を始める。
 * クライアント側で時計を回すと、タブが裏に回ったぶんだけずれるのでサーバーが持つ。
 */
function updateMatch(roomName: string, room: Match, now: number): void {
  const seats = holdingSeats(room, now)
  // 続けられるかは頭数ではなく**両陣営に居るか**で決まる。
  //
  // 数だけ見ていると、片側に 2 人残って反対側が空でも「2 人居るから続行」に
  // なる。相手の居ない試合が時間切れまで走ることになる。
  const enough = seats.some((p) => p.team === 'blue') && seats.some((p) => p.team === 'red')
  const previous = room.phase

  // 結果を見せている間は人数を見ない。見せ終わってから次を決める。
  //
  // ここを人数で割り込ませると、不戦勝を出した次の刻みで待ちへ落ちて、
  // 勝ったことが画面に出ないまま消える
  if (room.phase === 'over') {
    if (now < room.endsAt) {
      // まだ見せている最中
    } else if (enough) {
      room.phase = 'countdown'
      room.endsAt = now + COUNTDOWN
      room.blue = TICKETS
      room.red = TICKETS
      room.winner = undefined
      resetPlayers(roomName, room)
    } else {
      room.phase = 'waiting'
      room.endsAt = 0
      room.winner = undefined
    }
  } else if (!enough && room.phase !== 'waiting') {
    // 相手が居なくなった。
    //
    // 試合中なら**残っている側の勝ち**にする。待ちへ戻すだけだと、
    // 抜けた側は負けを付けられずに済むので、劣勢になったら抜ければよい
    // ことになる。席を空けて待つ猶予 (30 秒) を過ぎるまでは畳まないので、
    // 一瞬の離脱で勝ちが転がり込むことはない。
    const survivor = soleTeam(seats)
    if (room.phase === 'playing' && survivor) {
      room.phase = 'over'
      room.winner = survivor
      room.endsAt = now + INTERMISSION
      finishMatch(roomName, room)
    } else {
      room.phase = 'waiting'
      room.endsAt = 0
      room.winner = undefined
    }
  } else if (room.phase === 'waiting' && enough) {
    room.phase = 'countdown'
    room.endsAt = now + COUNTDOWN
    room.blue = TICKETS
    room.red = TICKETS
    room.winner = undefined
    resetPlayers(roomName, room)
  } else if (room.phase === 'countdown' && now >= room.endsAt) {
    room.phase = 'playing'
    room.endsAt = now + MATCH_DURATION
    // ここで身元が決まる。以後この試合の記録は全部これに紐づく
    room.matchId = crypto.randomUUID()
    room.startedAt = now
    // 支度がまだ済んでいない人はここで押し出す。始まっているのに
    // 装備画面の裏で立ち尽くす人が出ないように
    for (const player of connected(room)) {
      if (player.life === 'choosing') spawn(roomName, player, now)
    }
  } else if (room.phase === 'playing' && (room.blue <= 0 || room.red <= 0)) {
    // **削り切った。** 残機が 0 になった側の負け。時間を待たずにその場で終わる
    room.phase = 'over'
    room.winner = room.blue <= 0 && room.red <= 0 ? 'draw' : room.blue <= 0 ? 'red' : 'blue'
    room.endsAt = now + INTERMISSION
    finishMatch(roomName, room)
  } else if (room.phase === 'playing' && now >= room.endsAt) {
    // 時間切れ。**多く残っているほうが勝ち**
    room.phase = 'over'
    room.winner = room.blue === room.red ? 'draw' : room.blue > room.red ? 'blue' : 'red'
    room.endsAt = now + INTERMISSION
    finishMatch(roomName, room)
  }

  // 段階が変わったら即座に配る。残り時間の表示のために定期的にも配る
  if (previous !== room.phase || now - room.lastBroadcast >= MATCH_BROADCAST) {
    room.lastBroadcast = now
    broadcast(roomName, matchState(room))
  }
}

/**
 * サーバーの刻み (ms)。64Hz。
 *
 * 描画ループとは無関係に進む必要があるのでサーバーが持つ。クライアントの
 * タブが裏に回っても止まらない。
 *
 * いま刻んでいるのは復帰と回復の時計だけで、そこには 10Hz でも足りていた。
 * 先に上げてあるのは、これから載せるもの (投げ物の飛翔、弾道) が
 * 刻みの細かさをそのまま精度にするため。420 m/s の弾は 10Hz だと
 * 1 刻みで 42m 進む — ステージの端から端まで 2 刻みで着いてしまう。
 */
const TICK_MS = 1000 / 64

/**
 * 切れた人の体を配り直す間隔 (ms)。
 *
 * 動かないので細かく送る意味が無い。受け取る側が「途切れた」と判断しない
 * 程度で足りる (相手ごとの猶予は届く間隔の 3 倍、下限 0.35 秒)。
 */
const LIMBO_MS = 100

setInterval(() => {
  const now = Date.now()
  for (const [roomName, room] of rooms) {
    // 切れた人の体をその場に残す。
    //
    // 位置は「届いたときに配る」形なので、送ってこなくなれば自然に止まり、
    // 相手の画面から消える。消えると**ブラウザを閉じるのが逃げ道**になる
    // (閉じれば消え、戻れば続きから)。最後のパケットを配り直して、
    // 撃てるし倒せる的として残す。
    //
    // 姿勢だけ away に差し替える。そのまま配ると、走っていた人がその場で
    // 走り続ける絵になる
    if (now - room.lastLimbo >= LIMBO_MS) {
      room.lastLimbo = now
      for (const player of room.players.values()) {
        if (player.life !== 'dropped' || !player.lastPayload) continue
        const view = new DataView(
          player.lastPayload.buffer,
          player.lastPayload.byteOffset,
          player.lastPayload.byteLength,
        )
        stampLocomotion(view, 'away')
        stampProtected(view, false)
        relayState(roomName, player, player.lastPayload)
      }
    }

    // 待ち切った席を畳む。部屋が空になったらここで初めて部屋も消える
    for (const player of room.players.values()) {
      if (player.life === 'dropped' && lifeElapsed(player, now) >= RECONNECT_GRACE) {
        // 待ち切っても戻らなかった。走っている試合を置いて消えたのと同じ
        if (room.phase === 'playing') recordSeat(roomName, room, player, true)
        room.players.delete(player.id)
        // ここで初めて消してもらう。切れた時点では配らない —
        // 配ると受け取った側が実体を捨ててしまい、そのあと届く体を
        // 新品として作り直して状態を見失う
        broadcast(roomName, { type: 'leave', id: player.id })
      }
    }
    if (room.players.size === 0) {
      rooms.delete(roomName)
      continue
    }

    updateMatch(roomName, room, now)
    relayClaymores(roomName, room)
    for (const player of connected(room)) {
      // --- 時間で進む遷移 ---
      //
      // 状態ごとに別の時計を持たない。「その状態に入ってから何秒経ったか」
      // だけを見る。以前は respawnAt と protectedUntil が別々にあり、
      // 置き忘れた場所 (途中参加) だけ無敵が付かなかった。
      switch (player.life) {
        case 'downed':
          // 倒れる尺が終わったら支度へ。ここで初めて装備画面が出る
          if (lifeElapsed(player, now) >= DOWN_DURATION * 1000) {
            setLife(roomName, player, 'choosing', now)
          }
          continue
        case 'choosing':
          // 決めないまま放っておかれた。相手の試合を止めないために打ち切る
          if (lifeElapsed(player, now) >= CHOOSE_TIMEOUT * 1000) spawn(roomName, player, now)
          continue
        case 'spawning':
          if (lifeElapsed(player, now) >= SPAWN_PROTECT * 1000) {
            setLife(roomName, player, 'alive', now)
          }
          break
        case 'joining':
          continue
      }

      // --- 回復 ---
      // 集中し続けた時間で買う。全快はせず、瀕死を脱するところまで。
      // 撃ち合いに負けた傷は残り、次の撃ち合いは不利なまま始まる。
      if (player.health <= 0 || player.health >= RECOVER_CAP) continue
      if (player.concentratingSince === 0) continue
      if (now - player.concentratingSince < RECOVER_DELAY * 1000) continue

      const healed = Math.min(RECOVER_CAP, player.health + (RECOVER_RATE * TICK_MS) / 1000)
      if (healed === player.health) continue
      player.health = healed

      // 回復そのものは毎刻み進めるが、配るのは表示が変わるときだけ。
      // 刻みを 64Hz に上げたぶんをそのまま流すと、回復中だけ通信が跳ね上がる。
      // 受け取る側は整数に丸めて出しているので、変わらない値を送る意味が無い。
      const shown = Math.ceil(player.health)
      if (shown === player.healthShown && player.health < RECOVER_CAP) continue
      player.healthShown = shown
      sendHealth(roomName, player, 0, false)
    }
  }
  // --- 手榴弾 ---
  // 固定の刻みで解く。クライアントも同じ刻みで解くので軌道が一致する
  for (let i = grenades.length - 1; i >= 0; i--) {
    const nade = grenades[i]
    const steps = Math.max(1, Math.round(TICK_MS / 1000 / FIXED_STEP))
    for (let k = 0; k < steps; k++) stepProjectile(nade.body, solidBoxes)
    nade.fuse -= TICK_MS / 1000
    if (nade.fuse <= 0) {
      detonate(nade)
      grenades.splice(i, 1)
    }
  }

  // クレイモア。前を敵が通ったら起爆する
  for (let i = claymores.length - 1; i >= 0; i--) {
    const claymore = claymores[i]
    const room = rooms.get(claymore.room)
    if (!room) {
      claymores.splice(i, 1)
      continue
    }
    if (room.phase !== 'playing') continue
    // 起爆させるのも同じ顔ぶれ。**置いた本人が前を通れば起爆する**
    const hit = connected(room).some(
      (p) =>
        canBeHurt(p.life) &&
        (p.id === claymore.owner || p.team !== claymore.team) &&
        triggeredBy(claymore, p),
    )
    if (!hit) continue
    detonateClaymore(claymore)
    claymores.splice(i, 1)
  }
}, TICK_MS)

/**
 * 認証の発行元。設定が無ければ起動しない。
 *
 * 「設定が無ければ素通し」にすると、設定を書き忘れた本番が黙って
 * 誰でも入れる状態で立ち上がる。落ちるほうが安全。
 */
const AUTH_URL = process.env.SUPABASE_URL ?? ''
/**
 * 署名を確かめずに ID を名乗れる入口。**明示的に立てたときだけ**開く。
 *
 * 試験用。アカウントを人数分作らずに、遮蔽や当たり判定を確かめられるようにする。
 */
const TEST_AUTH = process.env.MGO2_TEST_AUTH === '1'
if (TEST_AUTH) {
  console.warn('⚠ MGO2_TEST_AUTH=1 — 署名を確かめずに ID を名乗れる。試験用')
}
// 署名を確かめるのに要る。**試験用の入口を開けているときは要らない** —
// そちらは token を見ないので、公開鍵を取りに行く先も要らない。
//
// ここで落ちると、.env の無い環境 (CI) では起動すらできない。手元では bun が
// cwd の .env を勝手に読むので気づけず、CI でだけ「サーバーが起きない」になった。
if (!AUTH_URL && !TEST_AUTH) {
  console.error('SUPABASE_URL が無い。.env を読ませて起動する:\n  bun run serve')
  process.exit(1)
}

async function resolveIdentity(url: URL): Promise<Identity | null> {
  const token = url.searchParams.get('token')
  if (token) {
    const identity = await verifyToken(token, AUTH_URL)
    if (!identity) console.warn('[認証] token を確かめられない')
    return identity
  }

  if (TEST_AUTH) {
    const id = url.searchParams.get('id')
    return id ? { subject: id } : null
  }
  return null
}

/** 一覧を取りに来るのは別のポートで動いている画面。読み取りだけなので開けてよい */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
}

const server = Bun.serve<Client>({
  port: PORT,

  async fetch(request, server) {
    const url = new URL(request.url)

    // ブラウザは別のポート (Vite) から一覧を取りに来る
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    if (url.pathname === '/health') {
      const lines = [...rooms].map(
        ([name, room]) =>
          `${name}: [${room.phase}] 青 ${room.blue} - 赤 ${room.red}  残り ${Math.max(0, Math.round((room.endsAt - Date.now()) / 1000))}s\n` +
          [...room.players.values()]
            .map(
              (p) =>
                `  ${p.team === 'blue' ? '青' : '赤'} ${p.name} (${Math.ceil(p.health)})` +
                // 通信の様子。姿が出ない相手が居るときはここを先に見る。
                // 64 通/秒 から落ちていれば途切れがち (1 通/秒 まで落ちて
                // いれば、その人のタブが裏に回っている)。時計差が大きければ
                // 時計の合っていない機械が混ざっている
                (p.packetGap > 0
                  ? ` ${(1000 / p.packetGap).toFixed(1)}通/秒 時計差 ${(p.clockSkew / 1000).toFixed(2)}s`
                  : '') +
                // 記録に残る分。数えられているかをここで見られる
                ` ${p.kills}/${p.deaths}` +
                (p.headshots > 0 ? ` HS${p.headshots}` : '') +
                (p.headDeaths > 0 ? ` 被HS${p.headDeaths}` : '') +
                (p.suicides > 0 ? ` 自爆${p.suicides}` : '') +
                (Object.keys(p.killsByWeapon).length > 0
                  ? ` [${Object.entries(p.killsByWeapon)
                      .map(([id, n]) => `${id}:${n}`)
                      .join(' ')}]`
                  : '') +
                (p.rejected > 0 ? ` 却下 ${p.rejected}` : '') +
                ` [${p.life}]`,
            )
            .join('\n'),
      )
      return new Response(`ok\n${lines.join('\n')}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    // --- 部屋の一覧 ---
    if (url.pathname === '/rooms') {
      // 返す形は src/net/types.ts の RoomSummary。画面側も同じ宣言を読む。
      // satisfies なので、増やしても減らしてもここで落ちる
      const summaries = ROOM_NAMES.map((name) => {
        const room = rooms.get(name)
        const here = room ? connected(room) : []
        return {
          name,
          players: here.length,
          capacity: ROOM_CAPACITY,
          phase: room?.phase ?? 'waiting',
          // 誰が居るか。入る前に見せる
          roster: here.map((p) => ({ id: p.id, name: p.name, team: p.team })),
          blue: room?.blue ?? 0,
          red: room?.red ?? 0,
          // 残り時間はこちらで秒に直す。時計を合わせる話を持ち込まない
          remaining: room?.endsAt ? Math.max(0, Math.round((room.endsAt - Date.now()) / 1000)) : 0,
        } satisfies RoomSummary
      })
      return Response.json(summaries, { headers: CORS })
    }

    // 誰なのかを決める。
    //
    // token があれば署名を検証して、そこから ID を導く。名乗った ID は使わない。
    // 認証を設定していない環境 (LAN で遊ぶだけ) では今までどおり名乗らせる。
    // 遊ぶのに外部サービスが要る状態にはしない。
    const identity = await resolveIdentity(url)
    if (!identity) return new Response('誰なのか分からない', { status: 401 })

    // 部屋は決まったものだけ。知らない名前で新しく作らせない
    const roomName = url.searchParams.get('room') ?? ROOM_NAMES[0]
    if (!isRoomName(roomName)) return new Response('そんな部屋は無い', { status: 404 })

    // 満員。ただし席を持っている本人 (繋ぎ直し) は通す
    const existing = rooms.get(roomName)
    const seated = existing?.players.has(identity.subject) ?? false
    if (!seated && existing && connected(existing).length >= ROOM_CAPACITY) {
      return new Response('満員', { status: 503 })
    }

    const upgraded = server.upgrade(request, {
      data: {
        id: identity.subject,
        name: identity.name,
        room: roomName,
      },
    })
    return upgraded ? undefined : new Response('WebSocket でつないでほしい', { status: 426 })
  },

  websocket: {
    open(socket) {
      const room = roomOf(socket.data.room)
      const seat = room.players.get(socket.data.id)
      /** 続きへ戻す人。名簿を送ったあとに渡す */
      let resumed: Player | null = null

      if (seat && seat.life === 'dropped') {
        // 席が残っていた。**その命の続きから始める。**
        //
        // 猶予を 30 秒空けているのは「うっかり切れた人が戻ってこられるように」で
        // あって、湧き直させるためではない。支度からやり直させていた頃は、
        // **瀕死でリロードすれば全快して、装備も選び直せて、弾も満タン**になった。
        // 撃ち合いで不利になったらリロードするのが最適解になる。
        //
        // 所属と名前も引き継ぐ。少ない側へ割り振り直すと、リロードしただけで
        // 敵味方が入れ替わる。
        seat.socket = socket
        // 倒れている最中に切れた人だけは支度から。どのみち次は湧く。
        //
        // 戻す先は **alive**。spawning にすると 3 秒の無敵がタダで手に入り、
        // 「不利になったらリロードして無敵を貰う」ができてしまう。
        // クライアント側でも spawning は respawnSelf を呼ぶので、弾が満タンに戻る
        const resuming = seat.wasAlive
        setLife(socket.data.room, seat, resuming ? 'alive' : 'choosing')
        // 続きを返すのは名簿のあと (下)。**順番が要る** — 名簿を受けた
        // クライアントは placeAtSpawn で湧き地点へ自分を置くので、先に
        // 続きを渡すと上書きされて**湧き地点へワープする**
        resumed = resuming ? seat : null
        // 繋いだ直後は誰も見えていない。前の接続の分を残すと、隠れたことを
        // 知らせる 1 通が出ないまま「見えている」ことになる
        seat.seen.clear()
        seat.seenClaymores.clear()
        // 繋ぎ直しの間は測っていない。前回の値を引き継ぐと巨大な間隔になる
        seat.packetGap = 0
        seat.lastPacketAt = 0
        // 離脱前の姿は当てにならない。遡って照合すると過去の位置で当たってしまう
        seat.history = []
        seat.lastShotAt = 0
        seat.concentratingSince = 0
        seat.holdingGrenade = false

      } else {
        // 名前は発行元が持っていればそれ、無ければ join で名乗るまで仮のもの
        room.players.set(socket.data.id, {
          id: socket.data.id,
          name: socket.data.name ?? socket.data.id.slice(0, 4).toUpperCase(),
          team: assignTeam(room),
          health: MAX_HEALTH,
          life: 'joining',
          lifeAt: Date.now(),
          killedBy: '',
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
          cameraYaw: 0,
          pitch: 0,
          aiming: false,
          crouching: false,
          boxed: false,
          history: [],
          lastShotAt: 0,
          healthShown: MAX_HEALTH,
          kills: 0,
          deaths: 0,
          headshots: 0,
          headDeaths: 0,
          suicides: 0,
          killsByWeapon: {},
          footsteps: new Footsteps(),
          locomotion: 'idle',
          weapon: 'rifle',
          ammo: startingAmmo(),
          slot: nextSlot(room),
          rejected: 0,
          concentratingSince: 0,
          grenades: SUPPORT_SPECS.grenade.count,
          support: 'grenade',
          primary: 'rifle',
          held: 'rifle',
          holdingGrenade: false,
          wasAlive: false,
          lastPayload: null,
          badPacketAt: 0,
          badMoveAt: 0,
          seen: new Set(),
          seenClaymores: new Set(),
          packetGap: 0,
          lastPacketAt: 0,
          clockSkew: 0,
          loweredAt: 0,
          socket,
        })
      }

      // 今いる全員と試合の状態を渡す。
      // 参加の通知を 1 通取りこぼしても、名簿で回復できる。
      socket.send(
        JSON.stringify({
          type: 'roster',
          players: connected(room).map((p) => ({
            id: p.id,
            name: p.name,
            health: p.health,
            team: p.team,
            slot: p.slot,
            // 状態も載せる。life は変わった時にしか配らないので、後から
            // 繋いだ人はここで受け取らないと既定値 (joining) のままになり、
            // **その人たちが一度も描かれない**
            life: p.life,
          })),
        } satisfies ServerMessage),
      )
      socket.send(JSON.stringify(matchState(room)))

      // **名簿のあとに渡す。** 名簿を受けたクライアントは placeAtSpawn で
      // 自分を湧き地点へ置くので、先に渡すと上書きされてワープになる
      if (resumed) {
        socket.send(
          JSON.stringify({
            type: 'resume',
            x: resumed.x,
            y: resumed.y,
            z: resumed.z,
            health: resumed.health,
            magazine: resumed.ammo.magazine,
            reserve: resumed.ammo.reserve,
            grenades: resumed.grenades,
            support: resumed.support,
            primary: resumed.primary,
          } satisfies ServerMessage),
        )
      }
    },

    message(socket, raw) {
      const room = rooms.get(socket.data.room)
      const player = room?.players.get(socket.data.id)
      if (!player) return

      // 位置だけ 2 進。数が桁違いに多いので、ここだけ詰めてある
      if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
        receiveSnapshot(socket.data.room, player, raw)
        return
      }

      let message: ClientMessage
      try {
        message = JSON.parse(String(raw))
      } catch {
        // 壊れた 1 通で対戦が止まる理由はない
        return
      }

      switch (message.type) {
        case 'join':
          player.name = message.name
          // 所属と席番号を足してから配る。本人が名乗った内容をそのまま流さない
          broadcast(
            socket.data.room,
            { ...message, team: player.team, slot: player.slot },
            player.id,
          )
          break

        case 'damage':
          // 送り主を信じない。名乗った ID ではなく接続の ID を使う。
          applyDamage(socket.data.room, player, { ...message, id: player.id })
          break

        case 'state':
          // 位置は 2 進でしか受け取らない。
          //
          // JSON で来たものをここで捨てないと、下の default に落ちて
          // **遮蔽の判定を通さずに全員へ配られる**。見えない相手の位置を
          // 配らない、という仕掛けが丸ごと迂回できてしまう。
          return

        case 'grenade':
          throwGrenade(socket.data.room, player, message)
          break

        case 'loadout': {
          player.support = message.support
          player.primary = message.primary
          // 支度中なら**すぐ**効かせる。次の湧きを待つと、選び直した分が
          // 1 つ遅れて効くことになる
          if (canChoose(player.life)) {
            player.grenades = SUPPORT_SPECS[player.support].count
          }
          break
        }

        // 支度ができた。ここで初めて戦場へ出す。
        //
        // 湧く時刻を本人に握らせる。自動で湧かせていた頃は、選んでいる途中で
        // 湧いて装備画面が消えていた。ただし早く選んだぶん早く戻れる、には
        // しない (CHOOSE_FLOOR)。選ぶのが速いことは腕前ではない
        case 'spawn':
          if (canChoose(player.life) && lifeElapsed(player) >= CHOOSE_FLOOR * 1000) {
            spawn(socket.data.room, player)
          }
          break

        // 自分から部屋を出た。**戻りを待たない。**
        //
        // 席を空けて待つのは「うっかり切れた人が戻ってこられるように」で、
        // 出ると決めた人には要らない。待つと、残った側は居ない相手を相手に
        // 最大 30 秒立たされる (試合は続いているのに誰も来ない)。
        case 'claymore':
          placeClaymore(socket.data.room, player)
          break

        /*
         * 落ちた。**量はこちらで決める** — 速さだけ受け取って共有の式に通す。
         * 量を送らせると好きな値を申告できる。
         *
         * 手柄は誰にも付かない。自分でやったことなので自死に数える
         * (爆風で自分の手榴弾に巻き込まれたときと同じ扱い)。
         */
        case 'fall': {
          const room = rooms.get(socket.data.room)
          if (!room || room.phase !== 'playing') break
          if (!canBeHurt(player.life)) break
          // 速さそのものも信じ切らない。落ちきる前に着地を申告しても
          // 上限を超えた分は効かない
          const amount = fallDamage(Math.min(message.speed, MAX_FALL_SPEED))
          if (amount <= 0) break
          applyBlastDamage(
            socket.data.room, room, player, amount,
            player.x, player.z, player.id, 'fall', false,
          )
          break
        }
        case 'leave':
          leaveRoom(socket.data.room, player)
          return

        case 'shot': {
          /*
           * **撃てない物を持っている間の射撃は弾く。**
           *
           * 手榴弾やナイフに持ち替えている間は引き金が効かない、というのが
           * 持ち替えの代償 (docs/design.md の 5)。手元でそう作っても、申告は
           * 別に送れるので、こちらでも見る。
           *
           * 空の弾倉と違って**通信のずれで正当な 1 発が消える心配が無い**。
           * 持ち替えは位置と同じ流れで届くので、撃った瞬間の状態と揃っている。
           */
          if (!HELD[player.held]?.shoots) break
          // 弾数の写しを減らす。**空でも拒否しない** — 空撃ちの判断は
          // クライアントがやっている (押した瞬間に音が要る)。ここで拒めば、
          // 通信のずれで正当な 1 発が消える
          const left = player.ammo.magazine[player.weapon]
          if (left > 0) player.ammo.magazine[player.weapon] = left - 1
          // 弾道の上にクレイモアがあれば起爆する
          shotHitsClaymore(socket.data.room, message.from, message.to)
          // 銃声だけは扱いが違う。
          //
          // 曳光を描くには銃口の座標が要るが、それは「どこに居るか」そのもの。
          // 姿が見えている相手にだけ座標を渡し、見えない相手には音として配る。
          // 銃声は遠くまで届く設計なので位置がおおよそ漏れるのは想定内だが、
          // 座標は耳より精度が高い。
          relayShot(socket.data.room, player, message)
          break
        }

        // 装填が**終わった**。尺はクライアントが持っているので、
        // こちらは移すだけでよい
        case 'reload':
          reloadInto(player.ammo, message.weapon)
          break

        default:
          // 見た目のもの (knock) は中身を見ずに流す
          broadcast(socket.data.room, message, player.id)
      }
    },

    close(socket) {
      const room = rooms.get(socket.data.room)
      const player = room?.players.get(socket.data.id)
      if (!player) return
      // 同じ ID で繋ぎ直したあとに、古い接続の後始末が届くことがある。
      // それで新しいほうを離脱扱いにしないよう、送り主を確かめる。
      if (player.socket !== socket) return

      // 席は残す。畳むのは待ち切ってから (tick)
      // 続きへ戻せる状態だったかを控える。倒れている最中なら、どのみち次は湧く
      player.wasAlive = player.life === 'alive' || player.life === 'spawning'
      setLife(socket.data.room, player, 'dropped')

      // **leave は配らない。**
      //
      // 以前はここで配っていた (「閉じた側が立ち尽くしたまま残る」のを防ぐため)
      // が、いまはその立ち尽くしこそが欲しい挙動になった — 閉じても体は残って
      // 撃たれる。leave を配ると受け取った側は実体ごと捨てるので、そのあと
      // 体のパケットが届いても**新品として作り直され、状態が既定の joining に
      // 戻る**。戦場に居ない扱いになって、一度も描かれない。
      //
      // 配るのは席を畳むとき (猶予切れ / 自分から出たとき) だけ。
    },
  },
})

console.info(`対戦サーバー: ws://localhost:${server.port}  (確認: http://localhost:${server.port}/health)`)

/**
 * 止める合図。**配置のたびにここを通る。**
 *
 * 部屋はメモリにしか無いので、そのまま落ちると走っていた試合の戦績が丸ごと
 * 消える。ここで書き出せば、決着は付かない (ended_at は null のまま) が
 * 数字は残る。
 *
 * **離脱にはしない。** 抜けさせたのはこちらの都合であって、本人ではない。
 * 配置のたびに全員へ離脱が付くようだと、その数字は誰も信用しなくなる。
 */
function shutdown(signal: string): void {
  console.info(`[終了] ${signal}。走っている試合を書き出す`)
  for (const [roomName, room] of rooms) {
    if (room.phase !== 'playing') continue
    for (const player of room.players.values()) recordSeat(roomName, room, player, false)
  }
  // 送り終わるのを待ってから落ちる。待たないと書いた意味が無い
  void flush().then(() => process.exit(0))
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
