/**
 * 爆風。
 *
 * --- なぜ弾と作りが違うか ---
 * 弾は撃った側が当たり判定を持っていて、サーバーは申告を**検算する** (hitcheck.ts)。
 * 骨の姿勢を持っているのがクライアントだけだからで、そのぶん過去へ遡る必要がある。
 *
 * 手榴弾は逆。投げた瞬間からサーバーが飛ばしているので、爆発した時点で
 * サーバーが知っている位置がそのまま正しい。申告が無いので、検算も遡りも要らない。
 *
 * three.js に依存しない。
 */

import { headHeight, isPathClear, SAMPLE_RATIOS, type StageBox } from './vision'

/** 爆風が届く距離 (m) */
export const BLAST_RADIUS = 7

/**
 * 爆心での威力。体力 100 に対する点数。
 *
 * **足元で爆ぜても死なない。** 満タンなら 75 削られて 25 残る。
 * 手榴弾は倒す道具ではなく、**動きを止める道具**にしてある。
 *
 * 一撃で倒せると、撃ち合う前に投げるのが常に最善になって読み合いが消える。
 * 削って転ばせるだけなら、投げたあとに詰めるか退くかを選ぶ必要が残るし、
 * 投げられた側にも「削られた体力で撃ち合うか、下がって回復を待つか」が残る。
 *
 * 距離で 3 つの帯に分かれる (半径 7m、線形で落とす):
 *
 *   0〜2m  60〜75 削られて転ぶ
 *   2〜5m  20〜60 削られて転ぶ
 *   5〜7m  0〜20 削られるが立っていられる
 *
 * 削られた相手に止めを刺せば得点にはなる。手榴弾だけで完結しない、というだけ。
 */
export const BLAST_DAMAGE = 75

/**
 * 遮蔽の裏でどれだけ残るか。
 *
 * 0 にすると壁 1 枚で完全に無傷になり、部屋へ投げ込む意味が消える。
 * 残しておくと「隠れても少しは食らう」になり、退く判断に重みが出る。
 */
const SHADOWED = 0.25

export interface BlastResult {
  /** 与えるダメージ */
  damage: number
  /** 吹き飛ばすか。遮蔽の外で、近くで受けたときだけ倒れる */
  knock: boolean
}

/**
 * 爆心からの距離と遮蔽で威力を決める。
 *
 * 体の何点が爆心から見えているかを数え、その割合をそのまま威力に掛ける。
 * 1 点だけで見ると「頭が壁から出ているのに無傷」が起きるし、
 * **体の半分だけ壁から出ている**が表せない。
 *
 * @param feetY 相手の足元の高さ
 * @returns 届かなければ null
 */
export function blastAt(
  cx: number,
  cy: number,
  cz: number,
  target: { x: number; y: number; z: number; crouching: boolean; boxed: boolean },
  boxes: StageBox[],
): BlastResult | null {
  const head = headHeight(target.crouching, target.boxed)
  // 体の中ほどまでの距離で測る。足元で測ると、真上で爆ぜたときに遠く見える
  const distance = Math.hypot(target.x - cx, target.y + head / 2 - cy, target.z - cz)
  if (distance >= BLAST_RADIUS) return null

  // 近いほど強い。中心付近だけ極端にせず、素直に線形で落とす
  const near = 1 - distance / BLAST_RADIUS

  let exposed = 0
  for (const ratio of SAMPLE_RATIOS) {
    if (isPathClear(cx, cy, cz, target.x, target.y + head * ratio, target.z, boxes)) exposed++
  }
  const cover = exposed / SAMPLE_RATIOS.length
  const shade = SHADOWED + (1 - SHADOWED) * cover

  return {
    damage: BLAST_DAMAGE * near * shade,
    // 5m 以内 (= near > 0.28) で転ぶ。壁の裏で削られただけの相手まで
    // 転ばせると理不尽になるので、遮蔽の外に居ることも条件にする。
    //
    // 死なない以上、転倒がこの武器の主な効き目になる。ここが狭いと、
    // ただ少し削れるだけの物になって投げる理由が無くなる
    knock: cover > 0 && near > 0.28,
  }
}
