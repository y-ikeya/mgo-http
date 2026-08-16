import { segmentHitsBox, type StageBox } from './vision'

/**
 * 「そこへ動いた」という申告を確かめる。
 *
 * hitcheck.ts が「当てた」を確かめるのと対になる。どちらも
 * **クライアントが言ってきたことが、地形の上で成立するか**しか見ない。
 *
 * --- なぜ要るか ---
 * サーバーは送られてきた座標をそのまま代入している。DevTools で書き換えれば
 * 地図のどこへでも跳べたし、壁の中にも立てた。
 *
 * それが**この game では致命的**になる。位置が可視を決めているからで、
 * 座標を詐称すると「そこから見える相手」をサーバーに配らせられる。
 * 壁の中に立って周りの敵を全部貰う、が成立してしまう。
 * 「接敵するまではステルス」という前提が座標 1 個で壊れる。
 *
 * --- 速さは測らない ---
 * 見るのは**跳んだか / 抜けたか**の 2 つだけ。速さを厳密に見ようとすると、
 * 通信が固まって届いた分をどう扱うか、ローリングや吹き飛びの上限をいくつに
 * するか、という話が芋づるで出てきて、そのどれもが「たまに動けない」に化ける。
 *
 * サーバーが自分で動かす (入力を受けて stepMovement を回し、クライアントは
 * 予測して巻き戻す) のが本筋で、そちらへ行くときに速さの話はまとめて解ける。
 * ここは、その前に**明らかに不可能な申告だけ**を落としておくもの。
 */

/**
 * 1 通で動ける距離の上限 (m)。
 *
 * 歩きは 3.04 m/s、拳銃だけ持って 3.51 m/s。位置は 64Hz で送っているので
 * 普段の 1 歩は 5cm ほどしかない。裏に回ったタブはブラウザに 1 通/秒まで
 * 間引かれるので、そこでも 4m 程度。
 *
 * **緩くしてある。** 狙いは詐称の排除であって移動の再現ではないし、
 * 地図は 120m 四方あるので、この値でも「地図の反対側へ跳ぶ」は通らない。
 *
 * 通信が固まっても大きな飛びにはならない。TCP は落とさず順に届けるので、
 * 途中の位置も後から全部来る。
 */
export const MAX_STEP = 15

/**
 * 遊べる範囲の半分 (m) を、**ステージそのものから出す**。
 *
 * ここは一度 40 と直書きしていた。いまの stage.json は外接が ±40.5 なので
 * 合っていたが、**ステージを広げた瞬間に、増えた分が全部「場外」になって
 * 誰も動けなくなる**。しかも広げた端でだけ起きるので気づきにくい。
 *
 * 地面の広さ (120m 四方) ではなく箱の外接を採る。地面で見ると、外周の壁の
 * 外側に 20m の「通ってしまう帯」ができる。
 *
 * 箱が 1 つも無ければ範囲を見ない (Infinity)。地形を読めなかった環境で
 * 全員が場外扱いになるほうが困る。
 */
export function arenaHalfOf(boxes: StageBox[]): number {
  let half = 0
  for (const box of boxes) {
    half = Math.max(
      half,
      Math.abs(box.min[0]),
      Math.abs(box.max[0]),
      Math.abs(box.min[2]),
      Math.abs(box.max[2]),
    )
  }
  return half > 0 ? half : Infinity
}

/**
 * 壁抜けを見る高さ (m)。**両端のうち高いほうから**この分だけ上。
 *
 * 足元で線を引くと、箱の上に登った / 坂を上ったときに箱の側面を跨いで
 * 誤検知する。高いほうを基準にすれば、登り切った先が箱の上でも線は箱より上を通る。
 */
const PROBE_HEIGHT = 0.9

/**
 * 壁抜けを見るのは、1 歩がこれ以下のときだけ (m)。
 *
 * この検査は 2 点を**直線で結んで**見るので、間隔が空くほど実際に歩いた道筋と
 * 離れる。64Hz なら 1 歩は 5cm しかなく直線とほぼ同じだが、遅れがちな機械は
 * 1m、裏に回ったタブは 3.7m 跳ぶ。その距離になると、角を曲がっただけで
 * 弦が台を掠めて**普通に歩いている人が弾かれる** (実測した)。
 *
 * 間隔が空いている人は諦めて通す。跳んだ判定と場外判定はそのまま効くので、
 * 大きな詐称は変わらず落ちるし、小さく刻んで壁へ入るのはここで落ちる。
 */
const PROBE_MAX_STEP = 0.5

/**
 * 上に乗っている箱と見なす高さの差 (m)。
 *
 * 台へ登る動きは、線を引けば必ずその台の側面を跨ぐ。足元の高さが
 * その箱の上面と一致していれば、抜けたのではなく**乗った**ということ。
 */
const STANDING_ON = 0.35

export interface Point {
  x: number
  y: number
  z: number
}

export interface MoveVerdict {
  ok: boolean
  /** 通らなかった理由。ログに出す */
  reason?: string
}

/**
 * その移動が成立するか。
 *
 * @param boxes 人を止める箱 (solidBlockers を通したもの)
 * @param arenaHalf 遊べる範囲の半分 (m)。arenaHalfOf で一度だけ出しておく
 */
export function checkMove(
  from: Point,
  to: Point,
  boxes: StageBox[],
  arenaHalf: number,
): MoveVerdict {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || !Number.isFinite(to.z)) {
    return { ok: false, reason: '数でない座標' }
  }

  if (Math.abs(to.x) > arenaHalf || Math.abs(to.z) > arenaHalf) {
    return { ok: false, reason: `場外 (${to.x.toFixed(0)}, ${to.z.toFixed(0)})` }
  }

  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  if (distance > MAX_STEP) {
    return { ok: false, reason: `跳んだ (1 通で ${distance.toFixed(0)}m)` }
  }

  // 壁の中を通っていないか。両端のうち高いほうを基準に、胸の高さで引く
  if (distance <= PROBE_MAX_STEP) {
    const y = Math.max(from.y, to.y) + PROBE_HEIGHT
    for (const box of boxes) {
      // 乗っている / 乗った箱は跨いで当たり前。抜けたのではない
      const top = box.max[1]
      if (Math.abs(top - from.y) < STANDING_ON || Math.abs(top - to.y) < STANDING_ON) continue
      if (segmentHitsBox(from.x, y, from.z, to.x, y, to.z, box)) {
        return { ok: false, reason: `壁を抜けた (${box.name})` }
      }
    }
  }

  return { ok: true }
}
