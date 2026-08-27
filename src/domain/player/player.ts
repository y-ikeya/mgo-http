/**
 * 人。**試合に出ている 1 人分の状態と、その遷移。**
 *
 * --- なぜサーバーから出したか ---
 * ここは server/index.ts (2364 行) の中に居た。設計 (docs/design.md) が
 * 「誰が何を持って、どういう状態に居るか」の話をしているのに、コードでは
 * その言葉が**通信の帳簿と同じ構造体**に混ざっていた。socket も packetGap も
 * seen も、人ではなく**接続**の持ち物。
 *
 * 分けた形:
 *
 *     Player   (ここ)         体力・状態・位置・持ち物・成績
 *     Session  (server 側)    socket・届く間隔・時計のずれ・配った控え
 *
 * こうしておくと、**クライアントも同じ Player を読める**。いまは片方が
 * three を抱えた src/presentation/scene/actor/player.ts で、同じ人物のことを別々の言葉で
 * 書いている。そこを寄せていく足場になる。
 *
 * 置き場所の決めごとは docs/design.md の 7。ここは domain なので幾何 (src/sim) を
 * 知らない — 知ると「弾がどう飛ぶか」を変えるたびに「何発で死ぬか」が動く。
 */
import { canTransition, type Life } from './lifecycle'
import type { Locomotion } from './locomotion'
import type { Stance } from './stance'
import { creditOf, takeDamage, type Credit, type Wound } from '../rule/damage'
import type { HeldId } from '../item/held'
import {
  SUPPORT_SPECS,
  type SupportId,
  type WeaponId,
} from '../item/weapons'
import { MAX_HEALTH } from '../rule/damage'
import { Footsteps } from '../rule/footsteps'
import { Inventory } from '../item/inventory'
import type { Skills } from './skill'

/**
 * ある時刻の姿。**当てたという申告を遡って照合する**のに使う。
 *
 * 判定に使うのは sim/hitcheck だが、形はここに置く — これは人の過去の姿で
 * あって、幾何の道具ではない。的 (練習部屋の棒立ち) も同じものを持つ。
 */
export interface Pose {
  /** 記録した時刻 (Date.now) */
  time: number
  x: number
  y: number
  z: number
  /** 体の向き (rad)。ローカル -Z が前 */
  yaw: number
  /**
   * 見ている上下 (rad)。**下が負。**
   *
   * 倒れている相手にナイフが通るかの判断に使う。刺した瞬間にどこを向いていたかは
   * 遡って照合しないと分からないので、履歴に載せる。
   */
  pitch: number
  crouching: boolean
  boxed: boolean
  /**
   * そのときの構え。**ナイフが刺さる姿勢かどうか**に使う。
   *
   * crouching / boxed とは別に持つ。あれは「しゃがんでいるか / 箱を被っているか」
   * という操作の状態で、**吹っ飛んで倒れているかは表せない** (本人は何も
   * 押していない)。倒れているかを知っているのはモーションのほう。
   */
  stance: Stance
}

/**
 * 所属。サーバーが割り当てる。
 *
 * **本人に選ばせない。** 人数が偏ったまま始まると、腕前より頭数で決まる。
 */
export type Team = 'blue' | 'red'

export interface Player {
  id: string
  name: string
  team: Team
  health: number
  /**
   * いまどういう状態に居るか。src/domain/player/lifecycle.ts に定義がある。
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
  /** 体の向き (rad)。ナイフの背後判定に要る */
  yaw: number
  /**
   * 視点の向きと上下 (rad)、構えているか。
   *
   * どこから見ているかを出すのに要る。三人称なので、画面に映るものを
   * 決めているのはカメラの位置であって目の位置ではない (src/sim/space/eyepoint.ts)。
   */
  cameraYaw: number
  pitch: number
  aiming: boolean
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
   * 取っているスキルと、その段。**4 コストの予算で選ぶ** (player/skill.ts)。
   *
   * 湧き直しても変わらない — 装備と同じく、支度で選び直すまで持ち越す。
   * **効果を引くのは持っている側**なので、サーバーもクライアントも同じ表から
   * 同じ倍率を出す。
   */
  skills: Skills
  /**
   * 光っているフラグが切れる時刻 (Date.now)。0 なら光っていない。
   *
   * ENEMY EXPOSURE を持つ相手に当てられると付く。**死ねば消える** — 死が
   * 漏洩を止める手段になっている (docs/design.md の 3)。
   *
   * 見る側 × 見られる側の表は作らない。**見られる側に 2 つ持たせる** —
   * いつまで (leakedUntil) と、誰に (leakedTo)。当人が光るので抜かれた本人にも
   * 分かるし、配信のドメインルールは 1 行のままで済む。
   */
  leakedUntil: number
  /**
   * 誰に漏れているか。`team:blue` か `id:alice` の形 (leakTag)。
   *
   * **1 位の光とはここが違う。** あちらは全員に公開されるフラグなので誰に、が要らない。
   * EE は当てた側の陣営だけが見えるので、宛先を持たないと「当てられた側の陣営にも
   * 自分が光って見える」ことになり、抜かれたことが相手に丸見えになる。
   *
   * **後から当てた側が上書きする。** 個人戦で 2 人が同じ相手に当てると、
   * 先に当てた人の側が消える。1 人ぶんしか持たないのは、複数を持つと
   * 「誰に見えているか」の表が結局要るため — そこまでの価値は無いと見ている。
   */
  leakedTo: string
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
   * 席番号。位置の 2 進で誰のものかを表すのに使う。
   *
   * id をそのまま載せると長さが可変になる。抜けた番号は空くまで使い回さない
   */
  slot: number
  /**
   * 持ち物。**クライアントと同じ物を、サーバーも持つ。**
   *
   * --- なぜ寄せたか ---
   * 同じ「持ち物」が 2 か所に別の形で書かれていた。クライアントは Inventory、
   * サーバーは kit (id の配列) と ammo (銃ごとの弾数) という**別々の欄**。
   * 拾う・落とすたびに 2 つを揃えて書く必要があり、**片方だけ消し忘れる余地**が
   * あった。
   *
   * 「打った相手の銃を数秒使えなくする」「CQC で主武器を落とさせる」の
   * ように、サーバーが権威を持つ操作を入れるとき、置き場所が 2 つあると必ずずれる。
   *
   * 持てるか (equip.ts の canHold) も、拾う・落とす (server/arms/drops.ts) も
   * ここを通る。**ammo はまだ別に残っている** — 繋ぎ直した人へ返すための
   * レプリカなので、そちらも順に寄せる。
   */
  inventory: Inventory
  /**
   * 過去の姿。当てたという申告を遡って照合するのに使う。
   *
   * **接続ではなく人が持つ。** 練習部屋の的は接続を持たないが、撃たれる以上
   * 照合の相手にはなる。長さは呼ぶ側が決める (送る間隔から出す)。
   */
  history: Pose[]
  /**
   * 人ではなく的か。
   *
   * **接続を持たない Player。** 練習部屋に並ぶ棒立ちがこれで、倒すと数秒後に
   * 同じ場所へ戻る。戦績には残さない。
   */
  bot: boolean
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
  /** 歩いた距離の積算。足音を出す間隔を決める */
  footsteps: Footsteps
  /** いまどの動きの中に居るか。足音の間隔と、他の人に見せる姿勢に効く */
  locomotion: Locomotion
  /** 持っている銃。威力と連射の上限をこれで引く */
  weapon: WeaponId
}

/**
 * 席に着いた瞬間の人。
 *
 * **既定値を実体の側に置く。** 以前はこの 35 個の初期値が socket の open の中に
 * 直接書いてあり、フィールドを足すたびに「初期化を書き忘れる」余地があった。
 */
export function newPlayer(seed: {
  id: string
  name: string
  team: Team
  slot: number
  now: number
}): Player {
  return {
    id: seed.id,
    name: seed.name,
    team: seed.team,
    slot: seed.slot,
    health: MAX_HEALTH,
    life: 'joining',
    lifeAt: seed.now,
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
    loweredAt: 0,
    locomotion: 'idle',
    footsteps: new Footsteps(),
    concentratingSince: 0,
    inventory: new Inventory({ primary: 'rifle', secondary: 'pistol', support: 'grenade' }),
    skills: {},
    leakedUntil: 0,
    leakedTo: '',
    weapon: 'rifle',
    primary: 'rifle',
    held: 'rifle',
    support: 'grenade',
    grenades: SUPPORT_SPECS.grenade.count,
    holdingGrenade: false,
    wasAlive: false,
    history: [],
    bot: false,
    kills: 0,
    deaths: 0,
    headshots: 0,
    headDeaths: 0,
    suicides: 0,
    killsByWeapon: {},
  }
}

/**
 * 練習部屋の的。**接続を持たない Player。**
 *
 * 動かない・撃たない・戦績に残らない。撃たれて倒れ、数秒後に同じ場所へ戻る。
 * 位置を固定で持つのは、**距離の練習**がこの部屋の用だから — 何 m の的かが
 * 変わってしまうと確かめようが無い。
 */
export function newBot(seed: {
  id: string
  name: string
  slot: number
  team: Team
  x: number
  z: number
  now: number
}): Player {
  const bot = newPlayer({ id: seed.id, name: seed.name, team: seed.team, slot: seed.slot, now: seed.now })
  bot.bot = true
  bot.x = seed.x
  bot.z = seed.z
  bot.life = 'alive'
  // 撃ってくる側 (青) を向いて立つ。背後判定が常に成立すると練習にならない
  bot.yaw = Math.PI
  return bot
}

/**
 * 的を戻す。**人の遷移表を通さない。**
 *
 * 表には `downed → alive` が無い。人は倒れたら支度 (choosing) を挟んで湧く
 * ので要らない遷移で、そこを塞いでいるのは正しい。**的は装備を選ばない**ので、
 * 同じ道を通れない。
 *
 * これに気づかず enterLife(bot, 'alive') を呼んでいて、的が倒れたきり戻って
 * こなかった。試験は通っていた — 撃った本人の respawn を数えていたため。
 */
export function reviveBot(bot: Player, now: number): void {
  refill(bot)
  bot.life = 'alive'
  bot.lifeAt = now
  bot.killedBy = ''
}

/**
 * 状態を移す。**通れない遷移は移さずに false を返す。**
 *
 * 知らせる (broadcast) のは呼ぶ側の仕事。ここは人の側の話だけで、
 * 誰に何を送るかは接続の話なので混ぜない。
 */
export function enterLife(player: Player, next: Life, now: number): boolean {
  if (player.life === next) return false
  if (!canTransition(player.life, next)) return false
  player.life = next
  player.lifeAt = now
  return true
}

/** その状態に入ってから経った時間 (ms) */
export function lifeElapsed(player: Player, now: number): number {
  return now - player.lifeAt
}

/** いま無敵か */
export function isProtected(player: Player): boolean {
  return player.life === 'spawning'
}

/**
 * 抜いた側を宛先の形にする。
 *
 * **陣営のある部屋は陣営ぜんぶ、無い部屋は本人だけ。** 抜いた情報を味方に
 * 渡せるからチーム戦で 1 枠割く価値が出る。個人戦には渡す相手が居ないので、
 * 同じドメインルールが自動的に「本人だけ」に落ちる — 部屋ごとに分岐を書かなくて済む。
 *
 * @param teams その部屋に陣営があるか (domain/match/room.ts の mode.teams)
 */
export function leakTag(attacker: Player, teams: boolean): string {
  return teams ? `team:${attacker.team}` : `id:${attacker.id}`
}

/**
 * その人にとって、相手が光って見えるか。
 *
 * **抜かれた側には見えない。** 自分が光っていることを本人が知れると、
 * 「どこかから撃たれた = いま位置が漏れている」まで確定してしまい、
 * 抜いた側の利が消える。当てられたこと自体は体力で分かるので、
 * そこから先を教えるかどうかがこの 1 行。
 */
export function isLeakedTo(target: Player, viewer: Player, now: number): boolean {
  if (now >= target.leakedUntil) return false
  return target.leakedTo === `team:${viewer.team}` || target.leakedTo === `id:${viewer.id}`
}

/**
 * 湧いたときの詰め直し。
 *
 * **装備から詰め直す。** 式は共有なので、画面に出る数と必ず一致する。
 * 状態を spawning にするのと、それを知らせるのは呼ぶ側 (接続の話が要るため)。
 */
export function refill(player: Player): void {
  player.killedBy = ''
  // **死ねば漏洩が止まる。** 死が情報を切る手段になっている
  player.leakedUntil = 0
  player.leakedTo = ''
  // **次の命は選んだ装備から始まる。** 拾った物は持ち越さない
  player.inventory.refill({
    primary: player.primary,
    secondary: 'pistol',
    support: player.support,
  })
  player.health = MAX_HEALTH
  player.grenades = SUPPORT_SPECS[player.support].count
  player.holdingGrenade = false
  player.concentratingSince = 0
  // 湧き地点へ跳ぶ。歩いた距離として積むと、着いた先で足音が連打される
  player.footsteps.warp(player.x, player.z)
}

/**
 * 削られる。**倒れたかどうかまでを返す。**
 *
 * 体力を引くのは審判 (server) の仕事に見えるが、「0 になったら倒れる」も
 * 「削られたら集中が切れる」も遊びの決めごとで、**同じ判断をクライアントも
 * 先に回している**。2 か所に書くと、片方だけドメインルールが変わる。
 */
export function hurt(player: Player, amount: number): Wound {
  const wound = takeDamage(player.health, amount)
  player.health = wound.health
  // 撃たれても爆風でも集中は途切れる。回復は最初からやり直し
  player.concentratingSince = 0
  return wound
}

/**
 * 倒された。**数える所を 1 か所にする。**
 *
 * 弾でもナイフでも爆風でも落下でも、ここを通る。倒した人が居なければ
 * (置いた本人がもう部屋に居ない) 誰の手柄にもならず、自死にも数えない —
 * 残っていた物で死んだのは落ち度ではない。
 *
 * 残機を減らすのは試合の側 (match.loseTicket)。人が持つのは自分の戦績だけ。
 */
export function downedBy(
  victim: Player,
  killer: Player | null,
  weapon: string,
  headshot = false,
): Credit {
  const credit = creditOf(victim.id, killer ? killer.id : null)
  victim.deaths++
  // 切れている間に倒された。戻ってきても続きは無い — 死んだので支度から
  victim.wasAlive = false
  // 自爆なら映すものが無い。空にしておくと画面は自分の体を映したままになる
  victim.killedBy = credit === 'kill' && killer ? killer.id : ''
  if (headshot) victim.headDeaths++
  if (credit === 'kill' && killer) {
    killer.kills++
    killer.killsByWeapon[weapon] = (killer.killsByWeapon[weapon] ?? 0) + 1
    if (headshot) killer.headshots++
  } else if (credit === 'suicide') {
    victim.suicides++
  }
  return credit
}

