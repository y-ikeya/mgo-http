/**
 * ステージの形。**サーバーも同じ箱を読む。**
 *
 * 遮蔽の判定も、物がぶつかる面も、これが無いと決められない。glb は解析せず、
 * 書き出しのときに一緒に書かれる json を読む — 片方だけ古い形を見る、が
 * 起きない。
 */

import { arenaHalfOf } from '../src/sim/judge/motioncheck'
import { type StageBox, sightBlockers, solidBlockers } from '../src/sim/space/vision'

/**
 * ステージの箱。用途で 2 つに分ける。
 *
 * 遮蔽 (stageBoxes) と、物がぶつかる面 (solidBoxes) は別の集合になる。
 * 当たり判定専用のブロック (col_) は視線を止めないので遮蔽から外れるが、
 * 手榴弾はそこで跳ねる。逆に見えない壁 (vis_) は視線を止めるだけで物は通る。
 */
export const [stageBoxes, solidBoxes]: [StageBox[], StageBox[]] = await (async () => {
  const path = new URL('../public/models/stage.json', import.meta.url)
  try {
    const data = (await Bun.file(path).json()) as { boxes: StageBox[] }
    const blockers = sightBlockers(data.boxes)
    const solids = solidBlockers(data.boxes)
    console.info(
      `ステージ: 箱 ${data.boxes.length} 個 / 視線を止める ${blockers.length} 個 / ` +
        `物が当たる ${solids.length} 個 / 範囲 ±${arenaHalfOf(solids).toFixed(1)}m`,
    )
    return [blockers, solids]
  } catch {
    // 形が無くても対戦は成立する。ただし全員が全員を見られる状態になる
    console.warn('stage.json が読めない。遮蔽の判定なしで動かす (位置は全員へ配られる)')
    return [[], []]
  }
})()

/**
 * 遊べる範囲の半分 (m)。ステージから出す。
 *
 * 起動時に 1 回。毎回の位置で 53 個の箱を舐め直す理由が無い
 */
export const arenaHalf = arenaHalfOf(solidBoxes)
