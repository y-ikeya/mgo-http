/**
 * 音がどこまで届くか。**姿が見えない相手を知る唯一の手段。**
 *
 * このゲームは接敵するまでステルスなので、**音は情報そのもの**。どこまで届くかを
 * 変えると「足を止めて聞く」「屈んで近づく」という判断がそのまま変わる — だから
 * 遊びの規則としてここに置く。
 *
 * 距離と方角を測るのも、遮られているかを見るのも sim。ここが決めるのは
 * **その距離なら聞こえるか**だけ。
 */

import type { WeaponSpec } from '../item/weapons'

/**
 * 足音が届く距離 (m)。走り (音量 1.0) の値。
 *
 * 姿勢ごとの倍率 (rule/footsteps.ts の range) を掛けたものが実際に届く距離に
 * なる。しゃがみは 0.45 倍で 9m、箱は 0.25 倍で 5m。**屈めば近づける**という
 * 交換がこの倍率。
 */
export const STEP_RANGE = 20

/** その姿勢で足音が届く距離 (m) */
export function stepReach(scale: number): number {
  return STEP_RANGE * scale
}

/** その銃の音が届く距離 (m)。武器ごとに違う (weapons.ts の noiseRange) */
export function shotReach(spec: WeaponSpec): number {
  return spec.noiseRange
}

/**
 * その音が聞こえるか。
 *
 * **姿が見えている相手の音は鳴らさない。** 見えているなら位置は既に届いていて、
 * 音の輪まで出すと同じことを二重に伝えることになる。「見えている」の定義は
 * 位置を配るときと同じでなければならない — ずれると、姿が見えている相手の音が
 * 輪にも出るか、見えていないのに音がしない (無音の敵) のどちらかになる。
 *
 * @param visible 姿が見えているか。判断するのは sim (space/vision.ts)
 */
export function isHeard(distance: number, reach: number, visible: boolean): boolean {
  if (visible) return false
  return distance <= reach
}
