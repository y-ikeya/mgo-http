/**
 * スタミナと、眠り。
 *
 * --- なぜ体力と別に持つのか ---
 * 麻酔銃 (M9) は人を殺さない。**倒すのではなく、止める。** 同じ「削る」でも、
 * 削り切ったときに起きることが違うので、同じ数字を共有できない。
 *
 *     体力が 0    倒れる。残機が 1 減り、湧き直す
 *     スタミナが 0 眠る。**その場に在り続ける** — 誰かが仕留めるまで
 *
 * 眠っている人は戦場から消えない。無防備な体がそこに残るので、**眠らせた側は
 * まだ仕事が終わっていない** (仕留めるか、置いて先へ進むかを選ぶ)。倒すのとは
 * 別の手だ、という形をここで作っている。
 *
 * --- 数字の出どころ ---
 * 削る量は武器の zone をそのまま使う (domain/item/weapons.ts)。麻酔銃の
 * 数字は体力を削っていた頃と同じで、意味だけが移った。
 *
 *     頭 100   1 発
 *     胴  25   4 発
 *     脚  12.5 8 発
 *
 * 距離の減衰も体力と同じ式を通る。**遠くの麻酔は効きが薄い** — 麻酔だけ
 * 距離を無視すると、当たりさえすればよい銃になって狙撃と競合する。
 *
 * --- 屈んで待てば戻る ---
 * 戻るのは**しゃがんで動いていない間だけ** (player.ts の isConcentrating)。
 * 体力の回復と同じ条件で、「屈んで、止まって、待つ」の 3 つが揃って初めて
 * 進む。立っただけでも歩いただけでも 0 からやり直し。
 *
 * 時間で勝手に戻る形にはしない。それだと**当てても待てば無かったことになる**
 * ので、当て続けられる者だけが眠らせられる銃になる。逆に一切戻らない形にも
 * しない — 減ったスタミナは手ブレと視界に効くので、戻せないとその命の間ずっと
 * 不利を背負うことになって重すぎる。
 *
 * **戻す代償は時間と場所。** 屈んで止まっている間は撃ち合いに出られない。
 */

/** スタミナの上限。体力と同じ 100 にして、読むときの目盛りを揃える */
export const MAX_STAMINA = 100

/**
 * 眠っている長さ (秒)。
 *
 * **長い。** 倒された人が湧き直すまで (倒れる 5 秒 + 支度) と同じくらいで、
 * 「一時的に無力化した」ではなく「その試合の一場面から消した」に近い重み。
 *
 * 短くすると、眠らせても起きるのを待つ意味が無くなって**その場で仕留めるだけ**
 * の手になる。長いから、置いて先へ進むという選択が生まれる。
 */
export const SLEEP_SECONDS = 30

/**
 * 集中し始めてから、スタミナが戻り始めるまで (秒)。
 *
 * 屈んだ瞬間から戻ると、撃ち合いの合間にしゃがむだけで回復してしまう。
 * **留まる時間を代償にする**ので、少し待たせる。
 */
export const STAMINA_RECOVER_DELAY = 1.5

/**
 * 戻る速さ (毎秒)。
 *
 * 胴 1 発 (25) を取り戻すのに 5 秒。**麻酔を 1 発もらったら、5 秒どこかに
 * 屈んでいる**という重さ。空から満ちるまでは 20 秒かかるが、空になった時点で
 * 眠っているので、そこまで戻すことはない。
 */
export const STAMINA_RECOVER_RATE = 5

/** 削った結果 */
export interface Drain {
  /** 残ったスタミナ */
  stamina: number
  /** これで眠ったか。**0 になった瞬間の 1 回だけ true** */
  slept: boolean
}

/**
 * スタミナを削る。
 *
 * **既に眠っている人は削らない。** 眠っている相手を撃ち続けて眠りが伸びる、
 * では起きる見込みが無くなる。無防備な体を仕留めるかどうかは撃つ側の判断で、
 * 眠りを延長する手にはしない。
 */
export function drainStamina(stamina: number, amount: number, asleep: boolean): Drain {
  if (asleep) return { stamina, slept: false }
  const left = Math.max(0, stamina - amount)
  return { stamina: left, slept: left <= 0 && stamina > 0 }
}

/**
 * 屈んで待った分を戻す。**眠っている間は戻らない。**
 *
 * @param concentratingFor 集中し続けている時間 (秒)。途切れたら 0
 */
export function recoverStamina(
  stamina: number,
  concentratingFor: number,
  dt: number,
): number {
  if (stamina >= MAX_STAMINA) return MAX_STAMINA
  if (concentratingFor < STAMINA_RECOVER_DELAY) return stamina
  return Math.min(MAX_STAMINA, stamina + STAMINA_RECOVER_RATE * dt)
}

/** 眠っているか */
export function isAsleep(sleepUntil: number, now: number): boolean {
  return sleepUntil > now
}

/** 起きるまで残り何秒か。眠っていなければ 0 */
export function sleepLeft(sleepUntil: number, now: number): number {
  return Math.max(0, (sleepUntil - now) / 1000)
}


/**
 * スタミナが減ったぶん、手が泳ぐ倍率。**満タンで 1、空で 2.6 倍。**
 *
 * --- なぜ目盛りではなく手ブレで出すか ---
 * 画面の隅に棒を出しても、撃ち合いの最中は誰も読まない。**狙いが定まらない**
 * ことで分かるほうが早いし、そのまま不利にもなっている — 読む物ではなく
 * 効く物にする。
 *
 * 効きは弱いところから始める。1 発 (胴 25) もらった時点で 1.4 倍で、そこは
 * まだ撃てる。3 発で 2.2 倍になると、遠くの頭は狙えない。**麻酔を受けた側は
 * 詰められる前に屈んで戻すか、不利なまま撃ち合うかを選ぶ**ことになる。
 */
export function staminaSwayScale(stamina: number): number {
  const lost = 1 - Math.max(0, Math.min(1, stamina / MAX_STAMINA))
  return 1 + lost * 1.6
}

/**
 * 視界のぼやけ (0..1)。**満タンで 0、空で 1。**
 *
 * 効き始めを遅らせてある。1 発では気づかない程度で、2 発目から目に見えて
 * 曇る。手ブレと違って**当たるかどうかには効かない**ので、こちらは
 * 「そろそろ危ない」を知らせるためだけの物。
 */
export function staminaBlur(stamina: number): number {
  const lost = 1 - Math.max(0, Math.min(1, stamina / MAX_STAMINA))
  return lost * lost
}
