/**
 * 引き金。**押しっぱなしで撃ち続けられるかを決める。**
 *
 * --- なぜ独立させるか ---
 * 「単発の銃は押しっぱなしでは 1 発しか出ない」というドメインルールが、
 * presentation の 3,000 行の中に**離れた 3 行**として置かれていた。
 *
 *     if (!input.firing) triggerReleased = true       // 離したら戻す
 *     const pulled = weapon.auto || triggerReleased   // 引けるか
 *     if (!weapon.auto) triggerReleased = false       // 撃ったら使い切る
 *
 * 3 つが揃って初めて意味を持つのに、間に 70 行が挟まっていて、名前も
 * `triggerReleased` という変数 1 つしか手掛かりが無い。**どれか 1 つを消しても
 * 気づけない** — 実際、表に auto があるのに誰も読まず、M9 が押しっぱなしで
 * 撃ち続けられていた。
 *
 * --- 何を持たないか ---
 * 連射の間隔 (fireInterval) も、ボルト操作の尺も持たない。あちらは
 * 「次の 1 発までどれだけ待つか」で、時計が要る。ここが決めるのは
 * **「引き金がもう一度引かれたか」**だけ。
 *
 * 武器の表も読まない。受け取るのは auto の真偽だけで、**ナイフのように
 * 表を持たない物も同じ仕組みに乗る** (押した瞬間だけ振る = auto ではない)。
 */

export class Trigger {
  /**
   * 引き金が戻っているか。**単発の銃はこれが立っていないと撃てない。**
   *
   * 既定は true。持ち替えた直後や湧いた直後に、一度離させる理由が無い。
   */
  private released = true

  /**
   * 引き金の状態を進める。**毎フレーム 1 回。**
   *
   * 離した瞬間ではなく「離している間」で見る。押した瞬間だけを拾う形にすると、
   * 通信や描画が詰まって 1 フレーム飛んだときに離したことを取りこぼす。
   */
  update(held: boolean): void {
    if (!held) this.released = true
  }

  /**
   * いま引ける状態か。
   *
   * 連射できる銃 (auto) はいつでも引ける。単発は**離してから押し直す**まで
   * 引けない。「離した瞬間に撃てる」ではないのは、押しっぱなしのまま
   * 連打の速さを稼ぐ余地を消すため。
   */
  pulled(auto: boolean): boolean {
    return auto || this.released
  }

  /** 使った。連射できない物はここで引き金を使い切る */
  fired(auto: boolean): void {
    if (!auto) this.released = false
  }

  /** 持ち替えや湧き直しで、引き金を戻す */
  reset(): void {
    this.released = true
  }
}
