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

import { SAMPLE_RATIOS, type SightBlocker } from '../space/vision'

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
 * **返すのは事実だけ。** 何ダメージかを決めるのはドメインルールの側 (domain)。以前は
 * ここで `BLAST_DAMAGE * near * shade` まで計算していたが、**遠くでどれだけ
 * 削れるか**は遊びの調整そのもので、レイと三角関数の隣に置くものではない。
 *
 * 体の何点が爆心から見えているかを数える。1 点だけで見ると「頭が壁から出て
 * いるのに無傷」が起きるし、**体の半分だけ壁から出ている**が表せない。
 *
 * **半径も頭の高さも受け取る。** どちらも遊びの数字 (domain) で、こちらが
 * import すると幾何の層がドメインルールに縛られる。
 *
 * @param head 相手の頭の高さ (m)。足元からの高さ
 * @param radius 届く距離 (m)
 * @returns 届かなければ null
 */
export function blastExposure(
  cx: number,
  cy: number,
  cz: number,
  target: { x: number; y: number; z: number },
  head: number,
  radius: number,
  world: SightBlocker,
): Exposure | null {
  // 体の中ほどまでの距離で測る。足元で測ると、真上で爆ぜたときに遠く見える
  const distance = Math.hypot(target.x - cx, target.y + head / 2 - cy, target.z - cz)
  if (distance >= radius) return null

  let exposed = 0
  for (const ratio of SAMPLE_RATIOS) {
    if (world.clear(cx, cy, cz, target.x, target.y + head * ratio, target.z)) exposed++
  }
  return { distance, cover: exposed / SAMPLE_RATIOS.length }
}
