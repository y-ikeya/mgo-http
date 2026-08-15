import { RESPAWN_DELAY } from './damage'

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
 * 片方だけ直して忘れる、が起きない (sim/damage.ts と同じ扱い)。
 *
 * 権威はサーバーにある。クライアントが持つのは写しで、遷移は知らせで届く。
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
   * しばらく席を空けて待つ。人数にも配信にも入れない。
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
 * 位置を配る対象かどうかがこれで決まる。選んでいる間の人は、
 * まだそこに居ない — 倒れた場所に体が 30 秒残るのはおかしい。
 */
export function onBattlefield(life: Life): boolean {
  return life === 'spawning' || life === 'alive' || life === 'downed'
}

/** 撃たれるか。爆風も刃も含む */
export function canBeHurt(life: Life): boolean {
  return life === 'alive'
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

/** 人数に数えるか。離脱中の席は数えない */
export function isSeated(life: Life): boolean {
  return life !== 'dropped'
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
  // 繋ぎ直したら支度から。前の命の続きからは始めない
  dropped: ['choosing'],
}

export function canTransition(from: Life, to: Life): boolean {
  return ALLOWED[from].includes(to)
}
