/**
 * 体がいまどの動きの中に居るか。
 *
 * --- なぜ src/game から出したか ---
 * ここは**共有の層**。サーバーも、位置の符号化も、足音も、姿勢の規則も
 * この型を読む。にもかかわらず src/game/animation.ts (three を読み込む)
 * に置いてあったので、three に依存しないはずの src/sim と src/net が
 * **型の上では three へ繋がっていた**。
 *
 * 動いてはいた (bun は型を剥がすだけなので) が、サーバー側を型検査に
 * 入れようとした途端に表に出る。判定の層が描画の層を参照している、
 * という向きそのものが逆だった。
 *
 * クリップ名との対応 (どの .fbx を流すか) は描画の話なので animation.ts に残る。
 * ここに置くのは「どの状態があるか」だけ。
 */

/** 移動の 8 方向。前を 0 として時計回り */
export const MOVE_DIRECTIONS = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'] as const
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number]

/** 下半身レイヤーの状態 = 移動アニメ */
export type Locomotion =
  | 'idle'
  | 'crouch_idle'
  // ダンボールを被っている姿勢。全身クリップなので上下を分けない
  | 'sneak'
  | 'sit'
  | 'stab'
  | 'roll'
  // 倒れるのは全身。怯みは上半身だけなので Locomotion には含めない
  // (脚まで止めると被弾のたびに 1.6 秒棒立ちになる)。
  | 'death'
  // 敬礼。全身の型なので上下を分けない
  | 'salute'
  /**
   * 接続が切れて、体だけ残っている姿。
   *
   * 自分でこの状態になることは無い — **サーバーが書き込む**。切れた人の
   * 最後の位置を配り続けるときに、この姿勢に差し替える。
   */
  | 'away'
  // 爆風で倒れる / そこから立ち上がる。倒れている間も撃てるよう、
  // 下半身だけ倒れた姿勢のまま留める
  | 'sweep'
  | 'stand'
  // 落下は 3 分割。滞空時間がクリップ尺と一致しなくても破綻しない。
  | 'jump_up'
  | 'jump_loop'
  | 'jump_down'
  | `run_${MoveDirection}`
  | `crouch_${MoveDirection}`

/** 立ち / しゃがみ、それぞれの 8 方向の状態を引く */
export function locomotionFor(crouching: boolean, direction: MoveDirection): Locomotion {
  return crouching ? `crouch_${direction}` : `run_${direction}`
}
