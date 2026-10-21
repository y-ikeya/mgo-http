/**
 * DOLL (猫の置物)。**近づいた敵を釘付けにする置く道具。**
 *
 * 名前は DOLL (本人 2026-10-20「cat じゃなくて doll にしよう」)。形は猫なので、註では猫とも呼ぶ。
 *
 * 本人 2026-10-20:
 *
 *     置く       ステージに猫の置物を置く (decoy と同じ置き方)
 *     効く所     猫の半径 1.5m の円。入ってきた敵は猫に釘付けになる (型 trapped)
 *     止まる     猫のほうへ 2 歩ほど歩いて寄り、trapped でしゃがみ込んで、猫を撫で続ける (型 TreatCat、
 *                本人 2026-10-21)。掛かってから 8 秒 (TRAP_SECONDS)。
 *                終わったら猫は消え、trapped を逆に流して動けるようになる
 *     効かない   CBOX を被った敵。伏せた敵には効く (伏せの型は無いので同じ型)
 *     壊す       撃ち抜けば猫は消え、円も消える (止まっていた人も解ける)
 *     解ける     止まっている間に撃たれたら解ける
 *     円         置いた本人と味方にはうっすら見える (置く前の構えから)。敵には見えない
 *     数         3 匹。1 匹に何人でも掛かる (掛かった後も、消えるまでに円へ入った敵は掛かる)
 *     TSNE       攻める側だけ
 *
 * ここは決まりだけ。いつ問うかはサーバー (server/arms/doll.ts) が決める。
 */

/** 釘付けになる円の半径 (m、水平) */
export const LURE_RADIUS = 1.5
/** 釘付けになる高さの差 (m)。上下の階を歩く人は掛からない */
export const LURE_HEIGHT = 1.6
/** 型 trapped の尺 (秒)。しゃがみ込んで手を伸ばし切るまで (public/models/soldier*.glb の trapped) */
export const TRAPPED_CLIP_SECONDS = 2.0
/**
 * しゃがみ込み終える所 (秒)。trapped の型はこの後に両手を前へ伸ばすが、そこは流さずに撫でる型
 * (TreatCat) へ移る (本人 2026-10-21「しゃがんだ後に一瞬手を伸ばしちゃってる」)。立ち上がる時も
 * ここから逆に流す。型の 45 コマ目 (腰が下り切る) と、右手が前へ出始める 49 コマ目の間
 */
export const TRAPPED_CROUCH_SECONDS = 1.3
/*
 * ↑ 1.5 秒だった。しゃがみ切ってから撫で始めるのが不自然で、0.2 秒削った (本人 2026-10-21)
 */
/**
 * 掛かったら、まず猫のほうへ歩いて手の届く所まで寄る (本人 2026-10-21「猫のほうに 2 歩くらい歩いて」)。
 * 猫からこの距離 (m) まで寄ってからしゃがみ込む
 */
export const TRAP_REACH = 0.7
/** 寄る長さの上限 (秒)。壁などで寄れなくても、これでしゃがみ込む */
export const TRAP_APPROACH_SECONDS = 1.5
/** 手を伸ばした姿で止まっている長さ (秒) */
export const HOLD_SECONDS = 6
/** 掛かってから猫が消えて解けるまで (秒)。型を流し切って、止まっている間 */
export const TRAP_SECONDS = TRAPPED_CLIP_SECONDS + HOLD_SECONDS
/**
 * 解けてから、どの猫にも掛からない間 (秒)。**立ち上がる間 (型を逆に流す 2 秒) + 1 秒。**
 * 無いと、猫を並べて置かれた所で解けたそばから隣の猫に掛かり、ずっと足止めされる
 * (本人 2026-10-20「一度引っかかったら 1 秒くらい引っかからないように」)
 */
export const IMMUNE_SECONDS = TRAPPED_CLIP_SECONDS + 1

/** 撃たれたときの当たり (m)。置物は高さ 0.3m・長さ 0.4m ほど。**少しだけ大きく** — 小さすぎて当たらない的にしない */
export const SHOT_HALF = 0.3
export const SHOT_TOP = 0.4

/**
 * 釘付けの段。**猫へ寄っている (approach)・しゃがみ込んでいる (in)・撫で続けている (hold)・
 * 解けて立ち上がっている途中 (out)・どちらでもない (null)。**
 * trappedBy は掛けている猫、trapFreeAt は解けた時刻 + IMMUNE_SECONDS (server/world.ts の freeFromTrap)。
 * 的 (bot) の姿をサーバーが決めるのに使う (人の姿は本人の手元が決める)
 */
export function trapStage(
  trappedBy: number,
  trapFreeAt: number,
  now: number,
  /**
   * しゃがみ込み始めた時刻 (ms)。0 ならまだ猫へ寄っている (approach)。しゃがみ込み終えたら
   * (TRAPPED_CROUCH_SECONDS) 撫で続ける (hold)
   */
  crouchAt = 0,
): 'approach' | 'in' | 'hold' | 'out' | null {
  if (trappedBy !== 0) {
    if (crouchAt === 0) return 'approach'
    return now - crouchAt < TRAPPED_CROUCH_SECONDS * 1000 ? 'in' : 'hold'
  }
  const releasedAt = trapFreeAt - IMMUNE_SECONDS * 1000
  return trapFreeAt > 0 && now >= releasedAt && now - releasedAt < TRAPPED_CROUCH_SECONDS * 1000 ? 'out' : null
}

export interface LureTarget {
  x: number
  y: number
  z: number
}

/** その人が猫の円の中に居るか (高さも見る) */
export function inLure(doll: LureTarget, x: number, y: number, z: number): boolean {
  return Math.hypot(x - doll.x, z - doll.z) <= LURE_RADIUS && Math.abs(y - doll.y) <= LURE_HEIGHT
}
