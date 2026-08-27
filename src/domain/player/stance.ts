/**
 * 構え。**頭の高さと、足音の届く距離がこれで決まる。**
 *
 * 屈めば頭が 1.47m から 0.94m へ下がる。壁の陰に隠れられるかも、遠くから
 * 見えるかも、この値で変わる — **遊びを変えたくなったら触る数字**なので、
 * ここ (domain) に置く。
 *
 * --- なぜ 1 本にするか ---
 * 構えは 3 か所で解釈されている。動かす側 (presentation/scene/actor/player)、映す側
 * (presentation/scene/actor/remotePlayer)、判定する側 (server)。同じ名前の状態を別の意味で
 * 読むと、片方だけ壊れる。
 *
 * 頭の高さがまさにその穴だった。遮蔽の判定に使う 1.47 / 0.94 はクリップから
 * 実測した値なのに、モーションを差し替えても黙って古いままになる。
 *
 * **どのモーションを流すか**は見た目の話なので、ここには無い
 * (presentation/scene/actor/motion.ts)。
 */

import type { Locomotion } from './locomotion'

/**
 * 体の構え。頭の高さと足音の届く距離がこれで決まる。
 *
 * 8 方向の区別は含めない。向きは「どちらへ歩いているか」であって構えではない。
 */
export type Stance = 'stand' | 'crouch' | 'box' | 'prone' | 'down'

/** そのモーションのときの構え */
export function stanceOf(locomotion: Locomotion): Stance {
  if (locomotion === 'death') return 'down'
  // 爆風で倒れている間。起き上がりの途中も含めて低い姿勢として扱う
  if (locomotion === 'sweep' || locomotion === 'stand') return 'prone'
  if (locomotion === 'sneak' || locomotion === 'sit') return 'box'
  // クレイモアはかがんで置く。頭が下がるので、見つかりにくさもしゃがみと同じ
  if (locomotion === 'claymore_windup' || locomotion === 'claymore_place') return 'crouch'
  if (locomotion === 'crouch_idle' || locomotion.startsWith('crouch_')) return 'crouch'
  return 'stand'
}

/**
 * 構えごとの頭の高さ (m)。tools/measure/crouch_size.js の実測値。
 *
 * ダンボールで静止すると 0.59m まで下がるが、遮蔽の判定では採らない。
 * 見えるはずの相手を送り忘れると「居るのに映らない」になるのに対し、
 * 見えない相手を送ってしまうのは覗き見の余地が少し残るだけで済む。
 * 迷ったら送る側に倒す。
 */
export const HEAD_HEIGHT: Record<Stance, number> = {
  stand: 1.47,
  crouch: 0.94,
  box: 0.94,
  // 伏せている間。実測で頭が 0.11m まで下がるが、起き上がりの途中は上がるので
  // その中間を採る。低く採りすぎると「見えているのに映らない」が起きる
  prone: 0.5,
  down: 0.3,
}

/** そのモーションのときの頭の高さ */
export function headHeightOf(locomotion: Locomotion): number {
  return HEAD_HEIGHT[stanceOf(locomotion)]
}


/**
 * しゃがみ / 箱の別から頭の高さ (m)。
 *
 * 遮蔽の判定も足音も、**モーションではなく操作の状態**から引きたい場面がある
 * (過去の姿を遡って照合するとき、姿勢のフラグしか残っていない)。
 *
 * 元は sim/space/vision.ts に置いてあったが、これは幾何ではなくドメインルール —
 * **屈めば隠れられる**の数字そのものなので、こちらに引き上げた。
 */
export function headHeightWhen(crouching: boolean, boxed: boolean): number {
  return HEAD_HEIGHT[boxed ? 'box' : crouching ? 'crouch' : 'stand']
}
