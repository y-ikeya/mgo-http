/**
 * 点の付け方。
 *
 * --- なぜキル数で決めないか ---
 * キルだけを数えると、**死ぬ側にコストが無い**。突っ込んで 1 人道連れにすれば
 * 差し引きゼロ、というのが常に成り立つので、隠れる意味が薄れる。
 * 「動かない側が有利」という遊びの形と噛み合わない。
 *
 * 倒された側から引くようにすると、死なないこと自体に価値が出る。
 *
 * --- 共有する理由 ---
 * 陣営の点はサーバーが持つ (各自が数え上げると、途中から入った人はそれまでの
 * 分を知らないし、1 通取りこぼせばずっとずれる)。一方で成績表に出す個人の点は
 * 手元で出す — kills と deaths は既に配られているので、同じ式を通せば足りる。
 * その「同じ式」がここ。
 */

/** 倒したとき、その陣営に入る点 */
export const KILL_POINTS = 3

/** 倒されたとき、その陣営から引く点 */
export const DEATH_POINTS = -2

/**
 * 自分で死んだときに引く点。
 *
 * --- ここは詰め切れていない ---
 * 倒されると自陣 -2 / 敵陣 +3 で、差は 5 開く。自死は自陣 -2 だけなので差は 2。
 * **つまり自死のほうがまだ得**で、「殺されるくらいなら自死する」は完全には
 * 潰せていない。潰すなら -5 (DEATH_POINTS - KILL_POINTS) にする。そうすれば
 * どちらで死んでも差が 5 で揃い、自死が点を渋る手にならない。
 *
 * いまは -2 のまま置いてある。自死する手立てが自分の手榴弾しか無く、信管に
 * 3 秒かかるので、撃ち合いの最中に間に合わせるのが難しいため。
 * 自決の操作を足すなら、その時に -5 へ変える。
 */
export const SUICIDE_POINTS = DEATH_POINTS

/**
 * その人の点。
 *
 * **自死を別に受け取る。** deaths には自死も含まれているので、引き算で
 * 「倒された数」を出す。SUICIDE_POINTS を DEATH_POINTS と別の値にした瞬間、
 * これが無いと個人の点と陣営の点が黙って食い違う。
 */
export function pointsOf(record: {
  kills: number
  deaths: number
  suicides: number
}): number {
  const killed = record.deaths - record.suicides
  return record.kills * KILL_POINTS + killed * DEATH_POINTS + record.suicides * SUICIDE_POINTS
}
