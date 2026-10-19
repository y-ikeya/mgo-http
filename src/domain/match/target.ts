import type { Spot } from '../stage'

/**
 * TSNE のターゲット (人形)。**攻める側が守る側の陣地から持ち出して、自陣まで運べば勝ち。**
 *
 * 本人 2026-10-19:
 *
 *     置き場所   blend の空 target1 / target2。守る側の基地に近いほうを使う
 *     守る側     ターゲットの位置が常に分かる (光っている、壁越しでも)
 *     攻める側   触れると取る。頭の少し上に浮く — 守る側には運んでいる人の位置が分かる
 *                ステルスのまま持てる。持ち物の一覧から選んで落とせる
 *     落ちた物   30 秒動かされなければ元の位置へ戻る (取って落としてを繰り返して少しずつ運ぶのもあり)
 *                運ぶ人が倒されたり眠らされたりしたら、その場に落ちる。守る側が触れても何も起きない
 *     取った時   守る側の全員に「{名前}がターゲットを取得した」(黒い帯)
 *     勝ち       攻める側の基地の枠 (補給できる所と同じ) まで運んだら、攻める側の勝ち
 *
 * ここは決まりだけ。いつ問うかはサーバー (server/match.ts) が決める。
 */

/** 触れると取れる距離 (m、水平)。人形の大きさ + 手を伸ばしたくらい */
export const TARGET_TOUCH = 1.2
/** 触れたことにする高さの差 (m)。上の階の床越しには取れない */
export const TARGET_TOUCH_HEIGHT = 1.6
/** 落ちたまま動かされなければ戻るまで (ms) */
export const TARGET_RETURN_MS = 30_000
/**
 * 落とした本人が拾い直せるまで (ms)。**足元に落ちるので、無いと落とした次の刻みで拾い直す**。
 * 少し歩いて拾い直す (取って落としてで少しずつ運ぶ) のは止めない
 */
export const TARGET_REPICK_MS = 2000

export interface Target {
  /** 置き場所 (戻る先) */
  home: Spot
  /** いまの位置。運ばれている間は運んでいる人の足元 */
  x: number
  y: number
  z: number
  /** 運んでいる人。置いてある / 落ちているなら null */
  carrier: string | null
  /** 落ちた時刻 (ms)。置き場所にあるか運ばれていれば 0 */
  droppedAt: number
  /** 落とした人 (運んでいて倒れた人も)。しばらく拾い直せない。落ちていなければ null */
  droppedBy: string | null
}

/** 置き場所に置く */
export function placeTarget(home: Spot): Target {
  return { home, x: home.x, y: home.y ?? 0, z: home.z, carrier: null, droppedAt: 0, droppedBy: null }
}

/**
 * 使う置き場所。**守る側の基地に近いほう** — 守る側は自分の陣地の近くの物を守る。
 * 置き場所が無いステージなら null (ターゲットの決まりは働かない)
 */
export function targetHomeFor(homes: readonly Spot[], defenceBase: Spot): Spot | null {
  let best: Spot | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const home of homes) {
    const d = Math.hypot(home.x - defenceBase.x, home.z - defenceBase.z)
    if (d < bestDistance) {
      best = home
      bestDistance = d
    }
  }
  return best
}

/**
 * その人がターゲットに触れて取れるか (置いてある / 落ちている物だけ。運ばれている物は取れない。
 * 落とした本人は少しの間取れない)
 */
export function touches(target: Target, who: string, x: number, y: number, z: number, now: number): boolean {
  if (target.carrier) return false
  if (target.droppedBy === who && now - target.droppedAt < TARGET_REPICK_MS) return false
  return Math.hypot(x - target.x, z - target.z) <= TARGET_TOUCH && Math.abs(y - target.y) <= TARGET_TOUCH_HEIGHT
}

/** 取った */
export function take(target: Target, carrier: string): Target {
  return { ...target, carrier, droppedAt: 0, droppedBy: null }
}

/** 落とした / 運ぶ人が倒れた。**その人の足元に落ちる** */
export function drop(target: Target, x: number, y: number, z: number, now: number): Target {
  return { ...target, x, y, z, carrier: null, droppedAt: now, droppedBy: target.carrier }
}

/** 運ばれている間は運ぶ人と一緒に動く */
export function carryTo(target: Target, x: number, y: number, z: number): Target {
  return { ...target, x, y, z }
}

/** 落ちたまま 30 秒経ったら置き場所へ戻す。戻したら新しい物、そのままなら同じ物 */
export function returnIfIdle(target: Target, now: number): Target {
  if (target.carrier || target.droppedAt === 0 || now - target.droppedAt < TARGET_RETURN_MS) return target
  return placeTarget(target.home)
}
