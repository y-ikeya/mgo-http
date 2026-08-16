import type { Locomotion } from '../sim/locomotion'
import type { HitZone } from '../sim/damage'
import type { Surface } from '../sim/surface'
import type { WeaponId } from '../sim/weapons'
import type { Life } from '../sim/lifecycle'

/**
 * ネットワークで流す型。
 *
 * 権威の所在で 2 つに分かれる。
 *
 *   クライアント → サーバー … 見た目の状態と、「当てた」という*申告*
 *   サーバー → クライアント … 体力・生死・キル。ここは覆せない
 *
 * 申告できる範囲を狭くしてあるのが要点。ダメージの数値は送らせず、
 * 「誰に・どこに・どれだけの距離で」だけを受け取ってサーバーが計算する。
 * 権威を強めていくとき、変える場所がサーバーの中だけで済む。
 */

/** 所属。サーバーが割り当てる */
export type Team = 'blue' | 'red'

/** 1 人分の見た目の状態。体力はここに含めない (サーバーが持つ) */
export interface PlayerSnapshot {
  id: string
  /** 送信時刻 (Date.now)。補間の基準になる */
  time: number
  x: number
  y: number
  z: number
  /** 体の向き (rad) */
  yaw: number
  /** 照準の上下 (rad)。上半身の傾きに使う */
  pitch: number
  /**
   * 視点 (カメラ) の向き (rad)。体の向きとは別物。
   *
   * 構えていないとき、体は進行方向を向くのでカメラとずれる。
   * サーバーが**どこから見ているか**を出すのに要る — 三人称なので
   * 画面に映るものを決めているのはカメラの位置で、目の位置ではない。
   */
  cameraYaw: number
  /** 再生すべき移動アニメ。速度から推定するより確実で、帯域も食わない */
  locomotion: Locomotion
  aiming: boolean
  /**
   * 持っている銃。
   *
   * サーバーが威力と連射の上限を引くのに要る。送らないと全員ライフル扱いになり、
   * 狙撃銃で遠くから当てても距離減衰で死ななくなる (実際にそうなっていた)。
   */
  weapon: WeaponId
  crouching: boolean
  /** ダンボールを被っているか。受け取った側は箱を出す */
  boxed: boolean
  /**
   * リロード中か。
   *
   * **相手に見せる。** 撃ち返せない時間が見えていることが、詰めるか下がるかの
   * 判断材料になる。隠す情報ではない — 音でも分かるし、姿でも分かるべき。
   *
   * 別のメッセージではなく位置に乗せているのは、遮蔽の判定を通すため。
   * 位置は見えている相手にしか配られないので、隠れている人がリロードしたことは
   * 伝わらない。別便で送ると、そこだけ遮蔽を素通りする。
   */
  reloading: boolean
  /**
   * 無敵か。**サーバーが書き込む** ので、送る側は常に false でよい。
   *
   * 湧いた直後の数秒。撃たれずに位置を取り直すための時間で、
   * 見た目は半透明になる。撃てば切れる — 盾にして撃つのを塞ぐ。
   */
  protectedNow: boolean
  /**
   * 手榴弾を振りかぶって持っているか。
   *
   * サーバーが要る。**この状態で倒されると、足元に落ちて爆発する**ので、
   * 倒した瞬間に持っていたかどうかを知らないと決められない。
   * 見た目には既にモーションで出ているので、隠す情報ではない。
   */
  holdingGrenade: boolean
  /**
   * 集中しているか (しゃがんで動いていない)。
   *
   * 見た目には出ないが、回復の条件なのでサーバーが知る必要がある。
   * 体力を持っているのはサーバーなので、条件を満たしているかは
   * こちらから申告するしかない。
   */
  concentrating: boolean
  /**
   * 敬礼を保っているか。
   *
   * locomotion が 'salute' であることだけでは、手を挙げたままなのか
   * 下ろしている途中なのかが区別できない。再生位置を送るより、
   * 「まだ押している」という 1 ビットを送って、受け取った側が
   * 同じ規則で止めるほうが小さいし、途中で取りこぼしても次で復帰する。
   */
  saluteHeld: boolean
}

export interface StateMessage {
  type: 'state'
  snapshot: PlayerSnapshot
}

/**
 * 発砲の見た目。曳光弾と発砲音のためだけにある。
 *
 * 当たったかどうかはここに載せない。見た目と判定を別の便に分けておくと、
 * 「撃ったのは見えたがダメージは無効だった」をサーバーが自由に決められる。
 */
export interface ShotEvent {
  type: 'shot'
  id: string
  /** 銃口 */
  from: [number, number, number]
  /** 着弾点 */
  to: [number, number, number]
}

/**
 * 「当てた」という申告。サーバーが受けてダメージを決める。
 *
 * まだ当たったかどうかはクライアントの言い分でしかない。壁抜けも自動照準も
 * これでは防げない。防ぐにはサーバーが位置と地形を持つ必要があり、それは
 * pose.json と collision を切り出した後の話。
 */
export interface DamageEvent {
  type: 'damage'
  /** 攻撃した側 (送り主) */
  id: string
  target: string
  kind: 'bullet' | 'melee'
  /** 弾のとき。部位と距離からダメージが決まる */
  zone?: HitZone
  distance?: number
  /** ナイフのとき。背後からなら即死 */
  fromBehind?: boolean
}

/**
 * ローリングの体当たり。位置をずらすだけでダメージは無いので、
 * サーバーは中身を見ずに相手へ流す。
 */
export interface KnockEvent {
  type: 'knock'
  id: string
  hit: string
  /** 押しのける量 (m)。ワールド座標の XZ */
  x: number
  z: number
}

/**
 * 物を投げた。
 *
 * 送るのは**投げ出した位置と向きだけ**。落下点も跳ねた場所も送らない。
 * 受け取った側が同じ物理を同じ地形に対して解くので、結果は一致する。
 *
 * 落下点を直接送る形にすると、壁の中でも地図の反対側でも好きな場所で
 * 音を鳴らせてしまう。囮は嘘をつくための道具だが、**嘘のつき方は地形に
 * 縛られていてほしい**。初速だけ渡せば、受け取った側が実際の地形で解くので、
 * 物理的に届かない場所で音は鳴らない。
 *
 * 跳ねるたびに音が鳴るが、送るのは 1 通で済む。
 */
export interface ThrowEvent {
  type: 'throw'
  id: string
  /** 投げ出した位置 */
  from: [number, number, number]
  /** 投げる向き (正規化済み) */
  dir: [number, number, number]
}

/**
 * 参加。名前はここで 1 回だけ名乗り、サーバーが名簿に持つ。
 *
 * 所属はクライアントが決められない。人数の偏りを見て割り当てるので、
 * サーバーが埋めてから他へ配る。
 */
export interface JoinEvent {
  type: 'join'
  id: string
  name: string
  team?: Team
  /** 位置の 2 進で使う席番号。サーバーが足す */
  slot?: number
}

/**
 * 音だけが届いた、という知らせ。
 *
 * 見えない相手の位置は配らないが、音は壁を回り込んで届く。位置を送らずに
 * 「音が鳴った」だけを伝えるための形。
 *
 * **ID を入れない。** 入れると足音を時系列で繋いで、複数の方向から位置を
 * 割り出せてしまう。方向と距離だけなら、耳で分かることと線に乗る情報が一致する。
 */
export interface NoiseEvent {
  type: 'noise'
  kind: 'step' | 'shot'
  /** 聞いた側から見た方向 (rad)。ワールド基準で 0 が -Z */
  bearing: number
  /** そこまでの距離 (m)。減衰は受け取った側が掛ける */
  distance: number
  /** 足音のとき、踏んだ面。耳で分かることなので渡してよい */
  surface?: Surface
  /** 銃声のとき、撃った銃。耳で聞き分けられることなので渡してよい */
  weapon?: WeaponId
  /** 足音の届く距離の倍率。しゃがみやダンボールは小さい */
  range?: number
  /** 近くで聞いたときの大きさ (0..1) */
  volume?: number
}

/**
 * 手榴弾を投げた。
 *
 * 位置は毎フレーム配らない。初速だけ渡せば、受け取った側が同じ物理で
 * 同じ軌道を解ける (src/sim/ballistic.ts)。爆発の判定はサーバーが持つ。
 */
/**
 * 手榴弾を投げる (クライアント → サーバー)。
 *
 * **向きしか送らない。** 位置は控えてあるものを使い、速さは共有の式で作り直す。
 * 壁の中から投げる / 地図の反対側まで飛ばす、を初速の捏造で作れなくするため。
 *
 * 配るときの形 (GrenadeSpawn) とは別にしてある。1 つにまとめていた頃は、
 * サーバーしか知らないはずの id と from と fuse を、クライアントが
 * **0 で埋めて送っていた** — 型がその向きで何を送るのかを表していなかった。
 */
export interface GrenadeThrow {
  type: 'grenade'
  /** 投げる向き (正規化は問わない)。長さは無視される */
  dir: [number, number, number]
}

/** 飛び始めた手榴弾 (サーバー → クライアント)。受け取った側が同じ物理を解く */
export interface GrenadeSpawn {
  type: 'grenade'
  /** サーバーが振る番号。爆発を同じ手榴弾に結びつけるのに使う */
  id: number
  from: [number, number, number]
  /** 初速 (m/s)。向きと強さを兼ねる */
  velocity: [number, number, number]
  /** 爆発までの残り時間 (秒) */
  fuse: number
}

/**
 * 爆風で吹き飛ばされた。倒れる本人にだけ送る。
 *
 * 周りには姿勢として伝わる (snapshot の locomotion が sweep になる) ので、
 * 別に配る必要が無い。ローリングの体当たり (KnockEvent) とは別物 —
 * あちらは位置をずらすだけで、こちらは起き上がるまで動けなくなる。
 */
export interface KnockDownEvent {
  type: 'knockdown'
}

/** 爆発した。位置は全員に配る (音も光も届くので隠す意味が無い) */
export interface ExplosionEvent {
  type: 'explosion'
  id: number
  at: [number, number, number]
}

/**
 * 装備を伝える。
 *
 * 手榴弾の数はサーバーが持っている (投げられるかを決めているのがあちら) ので、
 * 何を選んだかを知らせないと弾倉を選んでも手榴弾が配られる。
 *
 * 主武器は送らない。何を構えているかは位置に乗っている。
 */
export interface LoadoutEvent {
  type: 'loadout'
  support: 'grenade' | 'magazine'
}

export interface LeaveEvent {
  type: 'leave'
  id: string
}

/**
 * この相手はもう見えない、という知らせ。
 *
 * 位置は見えている相手にしか配られないので、隠れたことは「位置が来なくなった」
 * ことからも読める。読めるが、**それだけでは決められない**。位置が来ないのは
 * 隠れたときだけでなく、相手の機械が遅れているときにも起きる。区別が付かないと、
 * 送るのが遅い相手が見えたり消えたりを繰り返す (実際に起きた)。
 *
 * 見えなくなった理由を知っているのはサーバーなので、そちらに言わせる。
 * 沈黙から測るほうは、相手ごと丸ごと落ちた場合の保険として残す。
 */
/**
 * その人がどういう状態に居るか。サーバーが変わるたびに配る。
 *
 * 状態は src/sim/lifecycle.ts が定義している。以前は「体力が 0 になった」
 * 「位置が来なくなった」から各自が推し量っていて、場所ごとに答えがずれていた。
 */
export interface LifeEvent {
  type: 'life'
  id: string
  state: Life
}

/**
 * 装填が終わった (クライアント → サーバー)。
 *
 * **終わった瞬間に送る。** 始まりではなく終わりを送ることで、サーバーは
 * 銃ごとの装填の尺を持たなくてよくなる。受け取ったら予備から弾倉へ移すだけ。
 */
export interface ReloadEvent {
  type: 'reload'
  weapon: WeaponId
}

/**
 * 繋ぎ直した人へ返す、離脱前の続き (サーバー → 本人)。
 *
 * 30 秒の猶予は「その命を続けさせる」ためにある。支度からやり直させると、
 * **瀕死でリロードすれば全快して装備も選び直せる**ことになる。
 * サーバーが持っている続きをそのまま返す。
 */
export interface ResumeMessage {
  type: 'resume'
  x: number
  y: number
  z: number
  health: number
  /** 銃ごとの装填済みと予備 */
  magazine: Record<WeaponId, number>
  reserve: Record<WeaponId, number>
  /** 残りの手榴弾 */
  grenades: number
}

/** 支度ができたので湧かせてほしい。装備画面の OK が送る */
export interface SpawnRequest {
  type: 'spawn'
}

export interface HiddenEvent {
  type: 'hidden'
  id: string
}

/** 接続した直後にサーバーから届く、今いる全員 */
export interface RosterMessage {
  type: 'roster'
  /** slot は位置の 2 進で使う席番号。通信層が ID との対応表を持つ */
  players: { id: string; name: string; health: number; team: Team; slot?: number }[]
}

/**
 * 試合の状態。
 *
 * 得点も残り時間もサーバーが持つ。クライアントが自分で時計を回すと、
 * タブが裏に回ったぶんだけずれて、終わったはずの試合が続く。
 */
/**
 * 部屋の段階。
 *
 *   waiting   … 人が足りない。時計は止まっている
 *   countdown … 揃った。全員を湧き地点へ戻して数える
 *   playing   … 試合中。ダメージが入るのはここだけ
 *   over      … 決着。結果を見せている
 */
export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'over'

/**
 * 部屋の一覧 (`GET /rooms`) が返す 1 部屋ぶん。
 *
 * **サーバーが返す形とクライアントが読む形を、この 1 つの宣言にする。**
 * 以前はサーバーが直に組み立てたものを、画面側が手で書き写した interface で
 * 受けていた。いま一致しているだけで、片方を変えればもう片方は静かに
 * undefined を読む。サーバーは satisfies で名乗るので、増やしても減らしても落ちる。
 */
export interface RoomSummary {
  name: string
  /** いま繋がっている人数 */
  players: number
  capacity: number
  phase: MatchPhase
  blue: number
  red: number
  /** 今の段階が終わるまで (秒)。待機中は 0 */
  remaining: number
}

export interface MatchMessage {
  type: 'match'
  blue: number
  red: number
  /**
   * 部屋に居る全員と、その戦績。成績表はこれだけで描ける。
   *
   * 離脱中の人も入っている (away)。リロードのあいだ行が消えると、
   * 点差を見ている側には試合が壊れたように見える。
   */
  players: {
    id: string
    name: string
    team: Team
    kills: number
    deaths: number
    /** 接続が切れて戻りを待っている。数分で席ごと消える */
    away?: boolean
    /**
     * 位置が届いている回数 (通/秒)。名目は 64。
     *
     * 低い人は、その人の機械が送れていない (描画で手一杯など)。相手の画面では
     * その人がカクつく。**誰のせいかが全員に見える**のが大事で、
     * 見えないと「サーバーが悪い」という話になる。
     */
    rate?: number
  }[]
  /**
   * 今の段階が終わる時刻 (Date.now)。残り時間はここから引いて出す。
   * waiting は人が揃うまで進まないので 0。
   */
  endsAt: number
  /**
   * 部屋の段階。
   *
   *   waiting   … 人が足りない。時計は止まっている
   *   countdown … 揃った。全員を湧き地点へ戻して数える
   *   playing   … 試合中。ダメージが入るのはここだけ
   *   over      … 決着。結果を見せている
   */
  phase: MatchPhase
  /** 今いる人数と、始まるのに要る人数 */
  present: number
  required: number
  /** phase が over のときだけ */
  winner?: Team | 'draw'
}

/** サーバーが確定させた体力。0 なら倒れている */
export interface HealthMessage {
  type: 'health'
  id: string
  health: number
  /**
   * 当たった部位。頭に当たって耐えたときの反応を出すのに使う。
   *
   * 部位は撃たれた本人の体の話で、撃った側の居場所とは無関係なので渡してよい。
   */
  zone?: HitZone
  /** 直前に受けたダメージ。0 より大きければ被弾の表現を出す */
  damage: number
  /**
   * 撃たれた方向 (rad)。ワールド基準で、0 が -Z。
   *
   * **誰に撃たれたかは渡さない。** ID を渡すと、クライアントがそれを手掛かりに
   * 相手を特定できてしまう。見えていない相手の位置を送らない設計にする以上、
   * 見えていない相手の ID も送るべきではない。
   *
   * 方向だけならサーバーが計算して渡せる。クライアントは相手が誰かも
   * どこに居るかも知らないまま、「そっちから撃たれた」とだけ分かる。
   * 見えていない相手に撃たれた場合でも成立するのはこの形だけ。
   */
  fromBearing?: number
  /** 頭に当たったが倒れなかった。怯みの表現に使う */
  flinch: boolean
}

/** 誰が誰を倒したか。サーバーだけが出す */
export interface KillEvent {
  type: 'kill'
  killer: string
  killerName: string
  killerTeam: Team
  victim: string
  victimName: string
  victimTeam: Team
  /** 表示する武器名 */
  weapon: string
  headshot: boolean
}

/** 復帰してよい。位置はクライアントが決める (地形を知っているのはそちら) */
export interface RespawnMessage {
  type: 'respawn'
  id: string
}

/**
 * 向きで分ける。
 *
 * --- なぜ 1 つの union ではいけないか ---
 * 以前は全部まとめた `NetMessage` を、送る側も受ける側も使っていた。
 * つまり**クライアントから `health` や `kill` を送るコードが型で通る**。
 * サーバーの default はそれを中身を見ずに配るので、実際に流れてしまう。
 * 表 (doc の「メッセージ」) では向きを分けているのに、型は分けていなかった。
 *
 * 両方に出てくる物がある。素通しする物 (`shot` `knock` `throw`) は
 * クライアントが送り、サーバーがそのまま配るので、両向きに現れる。
 * `state` も同じ (位置は 2 進で往復する)。`join` と `leave` は、
 * サーバーが所属を足してから配り直す。
 */

/** クライアント → サーバー。**申告と操作**しか無い */
export type ClientMessage =
  | StateMessage
  | JoinEvent
  | LeaveEvent
  | DamageEvent
  | GrenadeThrow
  | LoadoutEvent
  | SpawnRequest
  | ReloadEvent
  // 見た目だけの物。当たったかどうかに関わらないので素通しする
  | ShotEvent
  | KnockEvent
  | ThrowEvent

/** サーバー → クライアント。**覆せない事実**がここに乗る */
export type ServerMessage =
  | StateMessage
  | JoinEvent
  | LeaveEvent
  | RosterMessage
  | MatchMessage
  | HealthMessage
  | KillEvent
  | RespawnMessage
  | NoiseEvent
  | LifeEvent
  | HiddenEvent
  | ExplosionEvent
  | KnockDownEvent
  | GrenadeSpawn
  | ResumeMessage
  // 素通しされてきた物
  | ShotEvent
  | KnockEvent
  | ThrowEvent

/** 通信路の上を流れうる全部。符号化のように向きを問わない所だけが使う */
export type NetMessage = ClientMessage | ServerMessage

/**
 * 通信路。
 *
 * BroadcastChannel (同じブラウザのタブ同士) と WebSocket (別のマシン) の
 * どちらでも同じように使えるようにしておく。上を流れるメッセージが同じなら、
 * ゲーム側はどちらで繋がっているかを知る必要がない。
 *
 * ただし体力を持つのはサーバーなので、BroadcastChannel では権威がいない。
 * 見た目を確かめる用と割り切る。
 */
export interface NetTransport {
  /** 自分の ID。通信路を変えても変わらない */
  readonly id: string
  /** 送れるのはクライアント側の物だけ。体力や得点を名乗ることはできない */
  send(message: ClientMessage): void
  onMessage(listener: (message: ServerMessage) => void): void
  dispose(): void
}

/**
 * プレイヤー ID を作る。
 *
 * 通信路ごとに採番すると、繋ぎ直しや切り替えのたびに別人になる。
 * クライアント側で 1 回だけ作って、どの通信路でも同じものを名乗る。
 */
/**
 * 状態を送る間隔 (秒)。64Hz。
 *
 * 20Hz から上げた。詰まっていたのは Hz ではなく符号化のほうで、
 * JSON をやめたら 64Hz でも以前の 20Hz より軽くなった (実測 16 kbps / 131 kbps)。
 *
 * 効くのは滑らかさより**遮蔽の粒度**。サーバーは位置が届いたときに
 * 「見えるか」を判定するので、20Hz だと角から出てきた相手が最大 50ms 遅れて
 * 配られていた。64Hz なら 16ms。動いた側が一方的に得をするズレが縮む。
 */
export const SNAPSHOT_INTERVAL = 1 / 64

/**
 * 遠隔プレイヤーを何秒過去の状態で描くか。
 *
 * 受信した状態をそのまま描くと、届いた瞬間だけ動いて間が止まる。
 * わざと遅らせて 2 つの状態の間を補間すると滑らかになる。
 *
 * 送る間隔の 3 倍あれば、1 通落ちても間が空かない。64Hz なら 0.05 秒で足りる。
 * ここは短いほど「見えている相手が実際に居る場所」に近づくので、
 * 足りる範囲で詰める。
 */
export const INTERPOLATION_DELAY = 0.05

/**
 * この時間だけ音沙汰が無ければ姿を隠す (秒)。
 *
 * かつては「退出とみなして消す」ための値だった。サーバーが見えている相手にしか
 * 位置を配らなくなったので、音沙汰が無いことは切断ではなく遮蔽を意味する。
 * 消す判断は leave に任せ、こちらは表示だけを止める (remotePlayer.ts の HIDE_AFTER)。
 */
export const PLAYER_TIMEOUT = 10
