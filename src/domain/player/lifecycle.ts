import { RESPAWN_DELAY } from '../rule/damage'

/**
 * プレイヤーが今どういう状態に居るか。
 *
 * --- なぜ状態を持つのか ---
 * ここまで、状態という物は無かった。必要な場所で必要な条件をその都度
 * 組み立てていた:
 *
 *   health <= 0            倒れている
 *   respawnAt > 0          復帰待ち
 *   droppedAt > 0          接続だけ切れている
 *   positioned === false   まだ位置を知らせていない
 *   phase === 'waiting'    試合が始まっていない
 *
 * 同じ問いに対する答えが場所ごとに少しずつ違っていて、それが**そのまま
 * 不具合になっていた**:
 *
 *   - 装備を組めるかを「試合の段階」から出していたので、先に部屋へ入って
 *     30 秒待った人は、相手が来て始まる時にはもう画面が閉じていた
 *   - 同じ理由で、試合中に入ってきた人には最初から出なかった
 *   - 無敵は protectedUntil を置く 3 か所を数えないと分からず、
 *     途中参加の人にだけ置き忘れていた (撃たれ得る状態で放り込まれる)
 *   - 倒れる尺が終わってから湧くまでの 3 秒に装備画面を出していたので、
 *     選んでいる途中で湧いて画面が消えた
 *
 * どれも「条件を書き忘れた / 書き方がずれた」であって、判断そのものは
 * 間違っていない。**問いを 1 か所に集めれば起きない**種類の不具合だった。
 *
 * --- 読む場所 ---
 * サーバーとクライアントが同じこのファイルを読む。移植しないので、
 * 片方だけ直して忘れる、が起きない (domain/rule/damage.ts と同じ扱い)。
 *
 * 権威はサーバーにある。クライアントが持つのはレプリカで、遷移は知らせで届く。
 */
export type Life =
  /**
   * 席はあるが、まだ自分の位置を知らせていない。
   *
   * 知らせてくるまでは原点に居ることになっていて、そこからは何でも見える。
   * この間に位置を配ると、入った直後の一瞬だけ壁の向こうが漏れる。
   */
  | 'joining'
  /**
   * 装備を組んでいる。**戦場には居ない。**
   *
   * 湧く前と、倒れて次に湧くまでがここ。位置は誰にも配らないし、
   * 誰からも撃たれない。選び終える (OK) か、時間切れで湧く。
   */
  | 'choosing'
  /**
   * 湧いた直後。戦場に居るが、まだ撃たれない。
   *
   * 湧き地点は決まっているので、無敵が無いと「湧き待ち」が成立する。
   * 撃てば自分から解く — 撃てる側が撃たれないのは不公平なので。
   */
  | 'spawning'
  /** 戦場に居て、撃たれる */
  | 'alive'
  /**
   * 倒れている。倒れるモーションが終わるまで。
   *
   * この間は装備画面を出さない。倒れた瞬間に画面が被さると、
   * 何が起きて死んだのかを見られない。
   */
  | 'downed'
  /**
   * 接続が切れて、席だけ残っている。
   *
   * うっかりリロードしただけで所属も試合も失われるのが理不尽なので、
   * しばらく席を空けて待つ。**送る先としては数えない** (もう聞いていない)。
   *
   * ただし**体はその場に残る。** 消してしまうと、撃ち合いで不利になったら
   * ブラウザを閉じる、が逃げ道になる (閉じれば消え、戻れば続きから)。
   * 残しておけば撃たれるし倒される — 閉じることに命 1 つの代価が付く。
   *
   * サーバーからは「閉じた」と「回線が切れた」の区別が付かないので、
   * 一瞬切れただけの人も同じ扱いになる。そこは避けられない。
   */
  | 'dropped'

/**
 * 倒されてから支度に移るまで (秒)。
 *
 * この間、画面は**倒した相手**を映している。倒れるモーションの尺 (3.1 秒) より
 * 長くしてあるのは、誰にどこから倒されたのかを読む時間だから。短いと、
 * 何が起きたのか分からないまま次の支度に移る。
 */
export const DOWN_DURATION = 5

/**
 * 選び終えても、ここまでは湧けない (秒)。
 *
 * 倒された直後に戻ってこられると、撃ち合いに勝った側が休めない。
 * 「早く選べば早く戻れる」にはしない — 選ぶのが速いことは腕前ではない。
 */
export const CHOOSE_FLOOR = RESPAWN_DELAY

/**
 * 選ばないまま放っておいたら湧かせるまで (秒)。
 *
 * 本人が握る形にすると、席を離れた人がそのまま抜けた扱いにならず、
 * 相手の試合が止まる。決めないという選択も一定の時間で打ち切る。
 */
export const CHOOSE_TIMEOUT = 30

/** 湧いてから撃たれるようになるまで (秒) */
export const SPAWN_PROTECT = 3

/**
 * 戦場に居るか。
 *
 * 位置を配る対象かどうかがこれで決まる。選んでいる間の人は、まだそこに居ない
 * — 倒れた場所に体が 30 秒残るのはおかしい。
 *
 * **切れた人 (dropped) は居る。** 体をその場に残すため。
 */
export function onBattlefield(life: Life): boolean {
  return (
    life === 'spawning' || life === 'alive' || life === 'downed' || life === 'dropped'
  )
}

/**
 * 撃たれるか。爆風も刃も含む。
 *
 * **切れた人も撃たれる。** そうしないと、閉じれば無敵になる。
 */
export function canBeHurt(life: Life): boolean {
  return life === 'alive' || life === 'dropped'
}

/** 自分で動けるか。撃つ・投げる・走るを受け付けるか */
export function canAct(life: Life): boolean {
  return life === 'spawning' || life === 'alive'
}

/**
 * この人の画面から他人が見えるか。
 *
 * 見る側として成立するかを問う。位置を知らせてきていない人は、
 * どこから見ているかが分からないので判定のしようがない。
 */
export function canSee(life: Life): boolean {
  return onBattlefield(life)
}

/** 装備を組めるか */
export function canChoose(life: Life): boolean {
  return life === 'choosing'
}

/**
 * まだ自分の位置を知らせていないか。
 *
 * 席はあるが場所が分からない状態。位置が届いた時点で支度へ進める
 * (server/relay.ts)。
 */
export function isJoining(life: Life): boolean {
  return life === 'joining'
}

/**
 * 湧いた直後の無敵の最中か。
 *
 * 人を持っているなら `isProtected(player)` (domain/player/player.ts) のほうが読みやすい。
 * こちらは `Life` しか手元に無い側 (画面のレプリカ) のための形。
 */
export function isSpawning(life: Life): boolean {
  return life === 'spawning'
}

/**
 * 倒れているか。
 *
 * **`life === 'downed'` を外で書かせないための問い。** 倒れている間に何が
 * 起きるかは場所ごとに違う (的は湧き直す / 死体の型を流す / キルカメラを許す)
 * が、**倒れているかどうかの判断は 1 つ**。段階を足したときに読み直す場所を
 * ここだけにする。
 */
export function isDowned(life: Life): boolean {
  return life === 'downed'
}

/**
 * 席を空けて待っている人か。
 *
 * 切れたが席は残してある状態。**待つ長さは RECONNECT_GRACE_MS** で、
 * 過ぎたら席を畳む (server/index.ts)。
 *
 * `isSeated` と裏返しの値になるが、問いが違う — あちらは「送っても届くか」で、
 * こちらは「戻ってくるのを待っている席か」。実装が同じでも、片方の意味が
 * 変わったときに巻き添えにならないよう分けてある。
 */
export function isAwaitingReturn(life: Life): boolean {
  return life === 'dropped'
}

/**
 * **送れる相手か。**
 *
 * 切れた人はもう聞いていないので、送っても意味が無い。戦場に居るか
 * (onBattlefield) とは別の問い — 切れた人は体が残るので戦場には居る。
 */
export function isSeated(life: Life): boolean {
  return life !== 'dropped'
}

/**
 * 時計だけで進む遷移の結果。**やることは返り値で返す。**
 *
 * `setLife` は他の人へ配りもするし、`spawn` は装備を配り直す。どちらも
 * 権威 (server) の仕事なので、ここは**何をすべきか**だけを言う。
 * `application/replica` の `RosterEffect` と同じ形。
 */
type LifeEffect =
  /** この状態へ移す */
  | { kind: 'life'; to: Life }
  /** 湧かせる。装備を配り直すので、状態を書き換えるだけでは足りない */
  | { kind: 'spawn' }

/**
 * 時間だけで進む遷移。**何も起きなければ null。**
 *
 * 状態ごとに別の時計を持たない。「その状態に入ってから何秒経ったか」だけを見る。
 * 以前は respawnAt と protectedUntil が別々にあり、置き忘れた場所 (途中参加)
 * だけ無敵が付かなかった。
 *
 * ここに置くのは、**尺も遷移先も遊びの数字**だから (倒れて 5 秒・選ばず 30 秒・
 * 湧いて 3 秒)。数字はここに在るのに if だけ server に在ると、規則の続きが
 * 片方だけ外に出る。回すのは server の仕事 — 毎 tick 全員を見るのも、
 * 返ってきたことを実際にやるのも。
 *
 * @param elapsed その状態に入ってから経った時間 (ms)
 */
export function advanceLife(life: Life, elapsed: number): LifeEffect | null {
  switch (life) {
    // 倒れる尺が終わったら支度へ。ここで初めて装備画面が出る
    case 'downed':
      return elapsed >= DOWN_DURATION * 1000 ? { kind: 'life', to: 'choosing' } : null
    // 決めないまま放っておかれた。相手の試合を止めないために打ち切る
    case 'choosing':
      return elapsed >= CHOOSE_TIMEOUT * 1000 ? { kind: 'spawn' } : null
    case 'spawning':
      return elapsed >= SPAWN_PROTECT * 1000 ? { kind: 'life', to: 'alive' } : null
    default:
      return null
  }
}

/**
 * 通ってよい遷移。
 *
 * 表にしておくと、書き換える側が「どこから来てどこへ行くのか」を
 * 見ないまま状態を代入することができなくなる。
 */
const ALLOWED: Record<Life, readonly Life[]> = {
  // 位置が届いたら支度へ。切れたら席だけ残す
  joining: ['choosing', 'dropped'],
  // 選び終えた (OK か時間切れ) ら湧く
  choosing: ['spawning', 'dropped'],
  // 無敵が切れるか、自分で撃つと解ける。無敵中でも爆風で転ぶことはある
  spawning: ['alive', 'downed', 'choosing', 'dropped'],
  // 倒される。試合の仕切り直しでも支度へ戻る
  alive: ['downed', 'choosing', 'dropped'],
  // 倒れる尺が終わったら支度へ
  downed: ['choosing', 'dropped'],
  // 繋ぎ直し。**その命の続きへ戻れる** (alive) — 猶予はそのために空けてある。
  // 切れている間に倒されることもある (downed)。その場合は戻ってきても支度から
  dropped: ['choosing', 'alive', 'downed'],
}

export function canTransition(from: Life, to: Life): boolean {
  return ALLOWED[from].includes(to)
}
