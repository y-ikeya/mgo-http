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

import { headHeight, isPathClear, SAMPLE_RATIOS, type StageBox } from '../space/vision'
import {
  BLAST_DAMAGE,
  BLAST_RADIUS,
  BLAST_SHADOWED,
  KNOCK_NEAR,
} from '../../domain/item/grenade'

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
  const shade = BLAST_SHADOWED + (1 - BLAST_SHADOWED) * cover

  return {
    damage: BLAST_DAMAGE * near * shade,
    // 転ぶ近さは domain (KNOCK_NEAR)。ここで足すのは**遮蔽の外に居ること** —
    // 壁の裏で削られただけの相手まで転ばせると理不尽になる
    knock: cover > 0 && near > KNOCK_NEAR,
  }
}
