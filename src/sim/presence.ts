import { INTERPOLATION_DELAY } from '../net/types'
import { onBattlefield, type Life } from './lifecycle'

/**
 * 相手が「いま、どこに、見えているか」。
 *
 * --- なぜ描画から切り離すか ---
 * ここは three にも DOM にも触らない。届いた時刻と、送られてきた時刻と、
 * サーバーが言ってきた状態から、**出すか / どれだけ過去を描くか / いつ隠すか**
 * を決めるだけ。
 *
 * この判断が原因の不具合を 1 日に 4 つ出した:
 *
 *   - 相手の時計とこちらの時計を直に引き算していた → その人だけ一度も出ない
 *   - 沈黙の長さだけで隠していた → 送るのが遅い相手が明滅する
 *   - 遡る量が「相手は 64Hz で送る」前提だった → 遅い相手が瞬間移動する
 *   - 状態を知らないまま既定値 (joining) で居た → 位置が届いても描かれない
 *
 * どれも three と関係が無いのに、three を抱えたクラスの中に居たせいで
 * 試験できなかった。**ここに出せば単体で回せる。**
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

/** 補間に使う状態を何個まで溜めるか。64Hz なので 0.3 秒分 */
export const BUFFER_SIZE = 20

/**
 * 1 人ぶんの「見え方」。RemotePlayer が 1 つ持って、判断を委ねる。
 */
export class Presence {
  /** 最後に届いた時刻。**こちらの** Date.now */
  lastSeen = 0

  /**
   * 送り主の時計とこちらの時計の差 (ms)。届いた時刻から引いて求める。
   *
   * 最初の 1 通が来るまでは分からないので null。
   */
  private clockOffset: number | null = null

  /** 直近で位置が届いていた間隔 (ms)。最悪の値を覚えて、良くなったら忘れる */
  private packetGap = 0

  /** サーバーが「もう見えない」と言ってきたか。位置が来たら解ける */
  private hiddenByServer = false

  /** サーバーが決めた状態 */
  private life: Life = 'joining'

  /** 数えている窓の始まり (Date.now) と、その間に届いた数 */
  private rateWindowFrom = 0
  private rateCount = 0

  /**
   * 位置が届いた。**こちらの時計に直した時刻**を返す。
   *
   * --- 時刻はこちらの時計に直してから使う ---
   * 送られてくる時刻は**送り主の Date.now()**、つまり別の機械の時計であって、
   * こちらの Date.now() と直に引き算してよいものではない。
   *
   * 直に引いていたときに何が起きたか: 相手の時計が 0.35 秒以上遅れていると、
   * 届いた瞬間から「途切れて久しい」判定になり、その人だけ**一度も画面に
   * 出てこない**。逆に相手の時計が進んでいると、遮蔽に入って位置が止まっても
   * 消えない。同じ機械で 2 つ開いて試している限り時計は同一なので、絶対に出ない。
   *
   * 差は「いちばん速く届いた 1 通」がいちばん真値に近いので、観測した
   * 最小値を採る。時計は少しずつずれていくので、上へはゆっくり戻す。
   */
  push(sentAt: number, arrivedAt: number): number {
    const observed = arrivedAt - sentAt
    if (this.clockOffset === null || observed < this.clockOffset) {
      this.clockOffset = observed
    } else {
      this.clockOffset += (observed - this.clockOffset) * CLOCK_DRIFT
    }

    // 届く間隔を覚える。途切れたと見なすまでの猶予をここから決める。
    //
    // 隠れていた間の空白は混ぜない。それは遮蔽に入っていた時間であって、
    // その相手が送る速さではない。HIDE_LIMIT で頭も打っておく —
    // サーバーが古くて hidden を送ってこない場合の保険
    if (this.lastSeen > 0 && !this.hiddenByServer) {
      const gap = arrivedAt - this.lastSeen
      if (gap <= HIDE_LIMIT * 1000) {
        if (gap > this.packetGap) this.packetGap = gap
        else this.packetGap += (gap - this.packetGap) * GAP_DECAY
      }
    }

    // 届いた数を数える。1 秒ごとに窓を切り直す
    if (this.rateWindowFrom === 0 || arrivedAt - this.rateWindowFrom >= 1000) {
      this.rateWindowFrom = this.lastSeen > 0 ? this.lastSeen : arrivedAt
      this.rateCount = 0
    }
    this.rateCount++

    // 位置が来たということは、また見えている
    this.hiddenByServer = false
    this.lastSeen = arrivedAt
    return sentAt + this.clockOffset
  }

  /** サーバーが状態を移した */
  setLife(life: Life): void {
    if (this.life === life) return
    this.life = life
    // 戦場に居ないなら消す。支度中の相手が倒れた場所に立っていることになる
    if (!onBattlefield(life)) this.hiddenByServer = true
  }

  /** サーバーから「もう見えない」と届いた。次の位置が来るまで隠す */
  hide(): void {
    this.hiddenByServer = true
  }

  /**
   * 画面に出してよいか。
   *
   * 判断は 2 つある。**サーバーの知らせ**が本筋で、遮蔽に入った瞬間に消える。
   * **沈黙の長さ**はその保険で、相手が丸ごと落ちた (タブを閉じた、回線が
   * 切れた) ときに立ち尽くしたまま残るのを防ぐ。
   *
   * 沈黙だけで決めていた頃は、この 2 つが混ざっていた。遅れて届いているだけの
   * 相手と、隠れた相手の区別が付かず、送るのが遅い機械が相手だと明滅した。
   */
  visibleAt(now: number): boolean {
    const silence = this.lastSeen > 0 ? now - this.lastSeen : 0
    return onBattlefield(this.life) && !this.hiddenByServer && silence < this.hideAfter
  }

  /**
   * 何秒過去で描くか (ms)。
   *
   * 64Hz で届いている相手は既定の 50ms のまま。遅れている相手ほど深く遡って、
   * 補間の材料が前後に揃うようにする。
   */
  get renderDelay(): number {
    return Math.min(
      DELAY_LIMIT * 1000,
      Math.max(INTERPOLATION_DELAY * 1000, this.packetGap * DELAY_SLACK),
    )
  }

  /**
   * 途切れたと見なすまでの猶予 (ms)。
   *
   * 相手ごとに変わる。64Hz で届いている相手なら下限の 0.35 秒のまま。
   * 3 通/秒 しか出せていない相手には 1 秒近くまで伸びる — その人にとっては
   * 0.3 秒空くのが普通なので、そこで切ると見えたり消えたりになる。
   */
  get hideAfter(): number {
    return Math.min(
      HIDE_LIMIT * 1000,
      Math.max(HIDE_AFTER * 1000, this.packetGap * HIDE_SLACK),
    )
  }

  /**
   * 位置が届いている回数 (通/秒)。診断の表示に使う。
   *
   * **packetGap から割り出してはいけない。** あちらは「隠すまでの猶予」を
   * 決めるための推定器で、直近の**最悪の間隔**を覚えるようにしてある
   * (平均で切ると、たまの遅れで相手が消える)。悲観側に張り付くので、
   * 57 通/秒 届いていても 37 と出た。数えるなら素直に数える。
   */
  get rate(): number {
    const span = this.rateWindowFrom > 0 ? this.lastSeen - this.rateWindowFrom : 0
    return span > 0 ? (this.rateCount * 1000) / span : 0
  }
}
