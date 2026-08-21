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
import { BLAST_RADIUS } from '../../domain/item/grenade'

/** 爆心から見た相手の姿。**量はここで決めない** (domain/item/grenade.ts) */
export interface Exposure {
  /** 爆心からの距離 (m)。体の中ほどまでで測る */
  distance: number
  /** 体のどれだけが爆心から見えていたか (0..1) */
  cover: number
}

/**
 * 爆心から相手がどう見えていたか。
 *
 * **返すのは事実だけ。** 何ダメージかを決めるのは規則の側 (domain)。以前は
 * ここで `BLAST_DAMAGE * near * shade` まで計算していたが、**遠くでどれだけ
 * 削れるか**は遊びの調整そのもので、レイと三角関数の隣に置くものではない。
 *
 * 体の何点が爆心から見えているかを数える。1 点だけで見ると「頭が壁から出て
 * いるのに無傷」が起きるし、**体の半分だけ壁から出ている**が表せない。
 *
 * @param feetY 相手の足元の高さ
 * @returns 届かなければ null
 */
export function blastExposure(
  cx: number,
  cy: number,
  cz: number,
  target: { x: number; y: number; z: number; crouching: boolean; boxed: boolean },
  boxes: StageBox[],
): Exposure | null {
  const head = headHeight(target.crouching, target.boxed)
  // 体の中ほどまでの距離で測る。足元で測ると、真上で爆ぜたときに遠く見える
  const distance = Math.hypot(target.x - cx, target.y + head / 2 - cy, target.z - cz)
  if (distance >= BLAST_RADIUS) return null

  let exposed = 0
  for (const ratio of SAMPLE_RATIOS) {
    if (isPathClear(cx, cy, cz, target.x, target.y + head * ratio, target.z, boxes)) exposed++
  }
  return { distance, cover: exposed / SAMPLE_RATIOS.length }
}
