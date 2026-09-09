import type { Locomotion } from '../../domain/player/locomotion'
import type { HitZone } from '../../domain/rule/damage'
import type { Surface } from '../../domain/stage'
import type { SupportId, WeaponId } from '../../domain/item/weapons'
import type { HeldId } from '../../domain/item/held'
import type { Life } from '../../domain/player/lifecycle'

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

/**
 * 所属。**定義は src/domain/player/player.ts に在る。**
 *
 * 通信の型が陣営を宣言していたのは順番が逆で、protocol はゲームの言葉を
 * 借りて話す側。ここから出しているのは、読む側の import を変えないため。
 */
import type { Team } from '../../domain/player/player'
import type { Mode } from '../../domain/match/room'
export type { Team }

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
  /**
   * 手榴弾を振りかぶって持っているか。
   *
   * **held から導く。** 通信に載っているのは held のほうで、これは読みやすさの
   * ための別名。持ち物の在り処を 1 つにするため (docs/design.md の 5)。
   */
  holdingGrenade: boolean
  /**
   * いま手にある物。銃・投げ物・ナイフ・ダンボールが同じ 1 つの場所に載る。
   *
   * 銃 (weapon) は別に持つ。手にあるのが手榴弾でも、**背中に提げている銃**は
   * 描かないといけないし、サーバーは威力の計算にそれを使う。
   */
  held: HeldId
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
   * 同じドメインルールで止めるほうが小さいし、途中で取りこぼしても次で復帰する。
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
 * 音を鳴らせてしまう。弾倉は嘘をつくための道具だが、**嘘のつき方は地形に
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
 * 割り出せてしまう。方向と距離だけなら、耳で分かることと通信に乗る情報が一致する。
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
 * 同じ軌道を解ける (src/sim/judge/ballistic.ts)。爆発の判定はサーバーが持つ。
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
  /**
   * 爆心から見て、どちらへ飛ぶか (単位ベクトル、水平)。
   *
   * **向きだけ渡して、動かすのはクライアント。** 位置を持っているのは
   * あちらなので (checkMove で検算する形)、ここで座標を決めると権威が
   * 逆向きになる。距離は一律 — 転ぶ型が 1 つしか無いので、近さで距離を
   * 変えても絵が合わない。
   */
  dirX: number
  dirZ: number
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
 * 投げる物の数はサーバーが持っている (投げられるかを決めているのがあちら) ので、
 * 何を選んだかを知らせる必要がある。
 *
 * 主武器は送らない。何を構えているかは位置に乗っている。
 */
export interface LoadoutEvent {
  type: 'loadout'
  /** support の枠に何を入れたか。弾倉はここに入らない (撃った弾から勝手に増える) */
  support: SupportId
  /**
   * 主武器。**持たせない部屋では null。**
   *
   * 遊びの上では要らない (何を構えているかは位置に乗っている) が、**繋ぎ直したときに
   * 返すために持たせる**。持っていないと、読み直した人だけが突撃銃へ戻る。
   */
  primary: WeaponId | null
  /**
   * 副武器。**省ける。**
   *
   * 拳銃が 1 挺しか無かった頃は選ぶ余地が無く、送る意味も無かった。麻酔銃
   * (M9) と殺傷 (M1911) に分かれてからは選択になったので載せる。
   *
   * 古い版は送ってこないので、**省かれたら今のまま**。
   */
  secondary?: WeaponId
}

/**
 * スキルの選択。**両向き。**
 *
 *     client → server   これにしたい
 *     server → client   これになった
 *
 * --- なぜ装備と別の通にするか ---
 * 選び直せる窓が違う。装備は 1 つの命ごと、**スキルは 1 試合に 1 度**
 * (domain/player/skill.ts の canChooseSkills)。同じ通に混ぜると、湧くたびに
 * 送られてくるスキルを毎回弾くことになり、「弾いた」のか「変えていない」のかが
 * 送る側から見えなくなる。
 *
 * --- なぜサーバーからも来るか ---
 * **途中参加した人は自分で選んでいない。** 走っている試合に入ると窓は閉じて
 * いて、前回の選択をサーバーが DB から持ってくる (server/skills.ts)。本人の
 * 画面に何が効いているかを出すには、こちらから知らせるしかない。
 *
 * 段は 1..3。取っていないスキルは**載せない** (0 を送らない) — 「取っていない」
 * と「Lv0 を取った」を区別しないため。
 */
export interface SkillsEvent {
  type: 'skills'
  skills: Record<string, number>
}

/**
 * クレイモアを置く。
 *
 * **位置も向きも送らない。** サーバーが持っている位置と向きから決める —
 * 送らせると、壁の中や相手の足元へ置ける。置くのは「自分の前」だけでよい。
 */
/**
 * decoy を置く。
 *
 * クレイモアと同じで**位置も向きも送らない。** サーバーが持っている位置から
 * 決める。人形は見せる物なので、置ける場所の判定はあちらと同じで足りる。
 */
export interface PlaceDecoyEvent {
  type: 'decoy'
}

export interface PlaceClaymoreEvent {
  type: 'claymore'
}

/** 置かれたクレイモア。見えている人にだけ配る */
export interface ClaymorePlaced {
  type: 'claymorePlaced'
  id: number
  /**
   * 置いた人。
   *
   * **本人が「置けた」ことを知るのに要る。** 置けるかどうかを決めているのは
   * サーバー (壁の中や縁の外へは置けない) で、断られたことが分からないと
   * 手元の残り数だけが減る。
   */
  owner: string
  at: [number, number, number]
  /** 正面の向き (rad) */
  yaw: number
  team: Team
}

/** 起爆した / 消えた */
export interface ClaymoreGone {
  type: 'claymoreGone'
  id: number
  /** 起爆したなら爆発を見せる。試合の仕切り直しで消えただけなら false */
  blast: boolean
}

/**
 * decoy が置かれた。
 *
 * **クレイモアと逆で、敵にも配る。** 見えないと撃たせられない — 見せることが
 * 仕事の道具なので、遮蔽で隠す以上のことはしない。
 */
export interface DecoyPlaced {
  type: 'decoyPlaced'
  id: number
  /** 置いた人。**本人が「置けた」ことを知るのに要る** (claymorePlaced と同じ) */
  owner: string
  at: [number, number, number]
  /** 正面の向き (rad) */
  yaw: number
  team: Team
  /**
   * 見た目。**置いた本人と同じ姿。**
   *
   * 「その人が居る」と読ませるのが仕事なので、別の姿だと誰か分からない
   * 人形になって撃つ理由が薄れる。
   */
  skin: string
  /**
   * 膨らみ切るまであと何秒か。**0 なら既に立っている。**
   *
   * 途中から見えるようになった人にも、残りだけ渡せば同じ形が出る。
   * サーバーの時刻で終わりを渡すと、時計のずれがそのまま大きさのずれになる。
   */
  readyIn: number
}

/**
 * 人形が押しのけられた。**誰かが触った。**
 *
 * 見えている全員へ配る。離れた所から自分の decoy が揺れるのが見えたら
 * 「誰かがそこを通った」と読める — 撃たせる道具であると同時に、
 * **見張る道具**でもある。
 *
 * **申告は受けない。** 触っていないのに揺らせると、「そこに誰か居る」という
 * 嘘の合図を作り放題になる。判定はサーバーが持っている位置から出す。
 */
export interface DecoyBumped {
  type: 'decoyBumped'
  id: number
  /** 押された先の向き (世界)。触った人から人形へ向かう向き */
  dirX: number
  dirZ: number
}

/** 割れた / 消えた */
export interface DecoyGone {
  type: 'decoyGone'
  id: number
  /** 割れた場所。**破裂音をそこで鳴らす** */
  at: [number, number, number]
  /** 撃たれて割れたなら音と破片を出す。仕切り直しで消えただけなら false */
  popped: boolean
}

/**
 * 落ちた。
 *
 * **速さだけ送る。** 受ける量を送らせると、好きな値を申告できる。式は共有 (damage.ts)
 * なので、サーバーが同じ速さから同じ量を出す。
 *
 * 落ちたことを知っているのは本人だけ (移動を持っているのがクライアント) なので、
 * ここは申告に頼る。撃たれた申告と違って**自分が損をする**方向なので、嘘をつく
 * 動機があるとすれば「送らない」ほう。そこは移動そのものをサーバーが持つまで残る穴。
 */
export interface FallEvent {
  type: 'fall'
  /** 着地したときの落下速度 (m/s) */
  speed: number
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
 * 状態は src/domain/player/lifecycle.ts が定義している。以前は「体力が 0 になった」
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
  /** 残りの投げ物 / 置き物 */
  grenades: number
  /**
   * 選んである装備。
   *
   * **画面を読み直しても席は残る** (30 秒は繋ぎ直しを待つ) ので、選んだ物も
   * サーバー側に残っている。返さないと、クライアントだけが既定値へ戻って
   * 食い違う — クレイモアを選んで読み直すと、手元は手榴弾のつもりで投げの型を
   * 出すのに、数を持っているサーバーはクレイモアのまま、という形で出た。
   */
  support: SupportId
  /** 主武器。持たせない部屋では null */
  primary: WeaponId | null
  /** 副武器。持たせない部屋では null */
  secondary: WeaponId | null
}

/**
 * 支度が済んだ / まだ、と言う。**準備画面の READY が送る。**
 *
 * 全員が済んだと言えば待たずに始まる。押さなくても 60 秒で始まるので、
 * これは早く始めるための物。押し間違えたときのために取り消せる。
 */
export interface ReadyEvent {
  type: 'ready'
  ready: boolean
}

/** 支度ができたので湧かせてほしい。装備画面の OK が送る */
export interface SpawnRequest {
  type: 'spawn'
}

/**
 * 名簿をもう一度くれ。**取りこぼしに気づいたクライアントが頼む。**
 *
 * --- なぜ頼む形が要るか ---
 * 名簿はサーバーが決まった時 (入室・試合の頭) に送っていた。押し付ける形だと、
 * **落ちたことに誰も気づけない**。名簿が欠けると人が描かれず、陣営が古いと
 * 味方を撃ちに行くのに削れない (敵味方はクライアントが陣営で判断している)。
 *
 * 頼む形にすると、**来なければもう一度頼める**。落ちるのは頼みのほうかも
 * しれないので、「言えば必ず来る」ではなく「来るまで言う」が本体になる。
 *
 * サーバーからの自発的な送信は残してある。普段は 1 往復ぶん速い。
 */
export interface RefetchRoster {
  type: 'refetchRoster'
}

/**
 * 往復の時間を測る。**サーバーが投げて、クライアントが打ち返す。**
 *
 * --- なぜサーバーから投げるか ---
 * 測った値で**席を空けてもらう**ので、測るのはサーバーでなければならない。
 * クライアントが測って申告する形にすると、遅い人が「速い」と名乗れる。
 *
 * --- なぜ測った値を一緒に載せるか ---
 * 打ち返した側は自分の遅れを知りようがない (往路も復路も片道しか見えない)。
 * 次に投げるときへ**前回の答え**を載せておけば、画面に出せる。1 秒遅れの
 * 値だが、出すのは診断のためなので困らない。
 */
export interface PingMessage {
  type: 'ping'
  /** サーバーの時計。**打ち返す側はこれをそのまま返す** */
  at: number
  /** 前回測れた往復の時間 (ms)。まだ測れていなければ 0 */
  rtt: number
}

/**
 * 遅れで席を空けてもらうときの閉じ符号。
 *
 * **約束の側に置く。** 遅れの限界そのものは遊びの規則 (domain/match/lag.ts)
 * だが、**どう閉じたかを伝える手段**は線の上の取り決めで、繋ぎ直す側
 * (infra/link) が読む。
 *
 * サーバーとクライアントが同じ数字を見る。落ちたのか断られたのかを受け取る
 * 側で見分けられないと、断られた人が繋ぎ直しては切られる輪に入る。
 *
 * 4000-4999 は私用に空けてある範囲。
 */
export const LAG_CLOSE_CODE = 4001

/** ping を打ち返す。**中身は預かった値をそのまま返すだけ** */
export interface PongMessage {
  type: 'pong'
  at: number
}

/**
 * 自分の本当の値。**3 秒ごとに、1 人ずつ届く。**
 *
 * --- なぜ要るか ---
 * 体力も弾数もサーバーが持っているのに、**弾数は届いていなかった**。
 * クライアントは自分で数えていて、サーバーも別に数えていて、突き合わせるのは
 * 繋ぎ直したときだけ。ずれても直しようが無い。
 *
 * --- 予測は残す ---
 * 撃った瞬間に残弾が減り、体力が 0 で倒れる、という反応はクライアントが
 * 自分の数でやる。**押した瞬間に返らないと手触りが壊れる**ので、届くのを
 * 待たない。これはサーバーが正しい値を後から渡すだけで、**ずれていたら
 * 合わせる**ためにある。
 *
 * roster が「全員のこと」を運ぶのに対して、こちらは「自分のこと」。
 *
 * 試合の便 (match) より粗い。あちらは全員へ同じ物を 1 通だが、こちらは
 * **人ごとに違う物を人数分**送るので、同じ間隔だと 8 人部屋で 8 倍になる。
 */
export interface SelfMessage {
  type: 'self'
  /** 体力 */
  health: number
  /** 銃ごとの装填済み。持っていない銃は 0 */
  magazine: Record<WeaponId, number>
  /** 銃ごとの予備 */
  reserve: Record<WeaponId, number>
  /** 残りの投擲物 */
  grenades: number
}

export interface HiddenEvent {
  type: 'hidden'
  id: string
}

/**
 * その相手が光り始めた。**ENEMY EXPOSURE で位置を抜いた。**
 *
 * **見える人にだけ送る。** 抜いた側の陣営 (個人戦なら抜いた本人) が受け取り、
 * 抜かれた本人には届かない — 光っていることを本人が知れると、
 * 「いま位置が漏れている」まで確定して抜いた側の利が消える。
 *
 * 残り時間は**秒**で送る。サーバーの時刻で終わりを渡すと、時計のずれが
 * そのまま光る長さのずれになる (ずれは実測で ±数百 ms ある)。
 * 受け取った側が自分の時計で数える。
 */
export interface ExposedEvent {
  type: 'exposed'
  id: string
  /** これから何秒光るか */
  seconds: number
}

/**
 * 接続した直後にサーバーから届く、今いる全員。
 *
 * **状態 (life) も載せる。** life は「変わった時」にしか配られないので、
 * 後から繋いだ人は既に居る人の状態を一度も知らされない。既定値のまま
 * (joining = 戦場に居ない) 扱いになって、**その人たちがずっと描かれない**。
 */
export interface RosterMessage {
  type: 'roster'
  /** slot は位置の 2 進で使う席番号。通信層が ID との対応表を持つ */
  players: {
    id: string
    name: string
    health: number
    team: Team
    slot?: number
    /** いまどういう状態に居るか。これが無いと描かれない (上記) */
    life?: Life
  }[]
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
export type MatchPhase = 'waiting' | 'ready' | 'countdown' | 'playing' | 'over'

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
  /** その部屋のルール。部屋ごとに固定 (src/domain/match/room.ts) */
  mode: Mode
  /** ルールの表示名 */
  label: string
  /**
   * 部屋の覚え書き。無ければ出さない。
   *
   * **ルールの名前だけでは伝わらないこと**を書く場所 (src/domain/match/room.ts)。
   * 同じ TDM でも、持ち込める銃を絞ってあれば別の遊びになる。
   */
  note?: string
  /** 入れるか。false なら一覧に出るが繋げない */
  active: boolean
  /** いま繋がっている人数 */
  players: number
  /**
   * いま居る人。
   *
   * **部屋は人数ではなく「誰が居るか」で選ぶ。**「この部屋は強いのばかり」
   * 「知り合いが居る」が入る前に分かるほうが、空き数を見るより効く。
   * 名前から戦績も開けるようにするので id も渡す。
   *
   * 位置は入っていない。ここで漏れるのは**部屋に居るという事実だけ**で、
   * 試合中の居場所ではない (それは state が遮蔽を見て配る)。
   */
  roster: { id: string; name: string; team: Team }[]
  capacity: number
  phase: MatchPhase
  blue: number
  red: number
  /** 今の段階が終わるまで (秒)。待機中は 0 */
  remaining: number
}

export interface MatchMessage {
  type: 'match'
  /** その部屋のルール。陣営で分かれるか、何を表示するかがこれで決まる */
  mode: Mode
  /**
   * いま 1 位の人 (個人戦だけ)。**この人は光って位置が漏れる。**
   *
   * 同数なら誰も居ない。0 キルの人は 1 位にならない。
   */
  leader?: string
  /**
   * 陣営の**残機**。得点ではない。
   *
   * 死因を問わず 1 ずつ減り、0 になった側が負け。時間切れなら多いほうが勝ち。
   * 増えることは無いので、**減っていく数として読む**
   */
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
    /**
     * 自分で死んだ数 (deaths に含まれる)。
     *
     * 個人の点を手元で出すのに要る。自死の引き方を倒された時と変えたときに、
     * これが無いと個人の点と陣営の点が黙って食い違う
     */
    suicides: number
    /**
     * 眠らせた数。**倒した数には入らない。**
     *
     * 眠らせても残機は減らないので、倒したのと同じ欄に混ぜると陣営の勝敗と
     * 食い違って見える。点は同じ 3 点入る (domain/match/scoring.ts) が、
     * **何をした人なのかは別の列で読ませる**。
     */
    stuns: number
    /** 支度が済んだと言ったか。**準備画面で誰を待っているかが分かる** */
    ready: boolean
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
  /**
   * 背後から撃たれたか。**倒れる向きを決めるのに使う** (倒された 1 通だけ)。
   *
   * 撃たれた側の向きと撃った側の位置の両方を持っているのはサーバーなので、
   * そこで決めて渡す。前へ倒れるか後ろへ倒れるかが絵に出るので、倒れた人を
   * 見た側が「どこから撃たれたか」を読める。
   */
  fromBehind?: boolean
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

/**
 * 誰が誰を眠らせたか。**倒したのとは別の出来事。**
 *
 * 残機は減らず、体はその場に残る。倒した知らせ (KillEvent) と同じ形で流すと
 * 「倒された」と読まれるので、別の型にして受け取る側に区別させる。
 */
export interface StunEvent {
  type: 'stun'
  by: string
  byName: string
  target: string
  targetName: string
  /** 頭に当たって一発で眠らせたか */
  head: boolean
}

/**
 * スタミナの残り。**本人にだけ届く。**
 *
 * 相手の眠気が見えると「あと 1 発」が読めてしまう。当てた手応えは自分の
 * 目盛りだけで測る。
 */
export interface StaminaMessage {
  type: 'stamina'
  id: string
  stamina: number
  /** 眠りが明ける時刻 (ms)。0 なら眠っていない */
  sleepUntil: number
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
/**
 * 武器を地面へ置く。
 *
 * **中身も一緒に送る。** 持ち物を持っているのはクライアント側で、サーバーは
 * 銃ごとの弾のレプリカしか持っていない (繋ぎ直し用)。置いた物の残弾は本人しか
 * 知らないので、申告してもらう。
 *
 * 撃ち合いの結果に効くのは「拾った人がその銃を使えるか」までで、残弾を多めに
 * 申告しても**弾は結局サーバーが数える** (shot が届くたびに減らす)。
 */
export interface DropWeaponEvent {
  type: 'drop'
  weapon: HeldId
  /** 装填 / 予備。投げ物なら count に入れる */
  ammo?: number
  reserve?: number
  count?: number
}

/** 落ちている物を拾う。どれを拾うかはサーバーが決める (一番近い物) */
export interface PickUpEvent {
  type: 'pickup'
}

/** 地面に落ちている武器。**見えている / 見えていないは問わない** */
export interface DroppedMessage {
  type: 'dropped'
  id: number
  weapon: HeldId
  ammo?: number
  reserve?: number
  count?: number
  at: [number, number, number]
  yaw: number
}

/** 拾われた / 消えた */
export interface DroppedGoneMessage {
  type: 'droppedGone'
  id: number
}

/**
 * 拾えた。**中身は拾った本人にだけ返す。**
 *
 * 他の人に要るのは「そこから消えた」ことだけで、何発入っていたかは要らない。
 */
export interface PickedMessage {
  type: 'picked'
  id: number
  weapon: HeldId
  ammo?: number
  reserve?: number
  count?: number
}

export type ClientMessage =
  | StateMessage
  | JoinEvent
  | LeaveEvent
  | DamageEvent
  | GrenadeThrow
  | LoadoutEvent
  | SkillsEvent
  | PlaceClaymoreEvent
  | PlaceDecoyEvent
  | DropWeaponEvent
  | PickUpEvent
  | FallEvent
  | SpawnRequest
  | ReadyEvent
  | RefetchRoster
  | ReloadEvent
  // 見た目だけの物。当たったかどうかに関わらないので素通しする
  | ShotEvent
  | KnockEvent
  | ThrowEvent
  | PongMessage

/** サーバー → クライアント。**覆せない事実**がここに乗る */
export type ServerMessage =
  | StateMessage
  | JoinEvent
  | LeaveEvent
  | RosterMessage
  | MatchMessage
  | HealthMessage
  | KillEvent
  | StunEvent
  | StaminaMessage
  | RespawnMessage
  | DroppedMessage
  | DroppedGoneMessage
  | PickedMessage
  | NoiseEvent
  | LifeEvent
  | SkillsEvent
  | HiddenEvent
  | ExposedEvent
  | SelfMessage
  | PingMessage
  | ExplosionEvent
  | KnockDownEvent
  | GrenadeSpawn
  | ResumeMessage
  // 素通しされてきた物
  | ShotEvent
  | KnockEvent
  | ThrowEvent
  | ClaymorePlaced
  | ClaymoreGone
  | DecoyPlaced
  | DecoyBumped
  | DecoyGone

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
  /**
   * 断られた理由。**入っていれば繋ぎ直しを諦めている。**
   *
   * 落ちた (回線が切れた) のと区別する。あちらは繋ぎ直すので、画面に出す
   * ことは無い — 出すのは**もう戻らない**ときだけ。
   */
  readonly rejected?: string | null
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
 * 消す判断は leave に任せ、こちらは表示だけを止める (remoteSoldier.ts の HIDE_AFTER)。
 */
export const PLAYER_TIMEOUT = 10
