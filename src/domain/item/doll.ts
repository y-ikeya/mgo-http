/**
 * DOLL (猫の置物)。**近づいた敵を釘付けにする置く道具。**
 *
 * 名前は DOLL (本人 2026-10-20「cat じゃなくて doll にしよう」)。形は猫なので、註では猫とも呼ぶ。
 *
 * 本人 2026-10-20:
 *
 *     置く       ステージに猫の置物を置く (decoy と同じ置き方)
 *     効く所     猫の半径 1.5m の円。入ってきた敵は猫に釘付けになる (型 trapped)
 *     止まる     trapped の最後、手を伸ばした姿で 6 秒止まる。終わったら猫は消え、
 *                trapped を逆に流して動けるようになる
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
 * 釘付けの段。**掛かっている (in)・解けて立ち上がっている途中 (out)・どちらでもない (null)。**
 * trappedBy は掛けている猫、trapFreeAt は解けた時刻 + IMMUNE_SECONDS (server/world.ts の freeFromTrap)。
 * 的 (bot) の姿をサーバーが決めるのに使う (人の姿は本人の手元が決める)
 */
export function trapStage(trappedBy: number, trapFreeAt: number, now: number): 'in' | 'out' | null {
  if (trappedBy !== 0) return 'in'
  const releasedAt = trapFreeAt - IMMUNE_SECONDS * 1000
  return trapFreeAt > 0 && now >= releasedAt && now - releasedAt < TRAPPED_CLIP_SECONDS * 1000 ? 'out' : null
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
