/**
 * 面の材質。足音の種類が変わる。
 *
 * 見た目と足音を 1 つの宣言から決めるための型。別々に持つと、
 * 金属に見える箱からコンクリートの足音が鳴る、が起きる。
 *
 * サーバーも読む。見えない相手の足音を配るには、その相手が何の上に
 * 立っているかをサーバーが知っている必要がある。
 *
 * **ガラスは見た目のほうが主。** 透けて、日の光を通す (presentation/scene/world
 * /stage.ts)。足音は専用の音を持たないので石と同じに落ちる — 天井や仕切りに
 * 使う物で、その上を歩く場面がまだ無いため。**歩ける床に使うなら音を足す。**
 *
 * 止める対象 (人 / 弾 / 視線) はここでは決めない。それは名前の別のタグ
 * (stage/flags.ts の noeye / nobullet)。**材質と、何を止めるかは別の軸。**
 * 見通せるガラスにしたいなら glass_wall_noeye と書く。
 */
export type Surface = 'concrete' | 'metal' | 'wood' | 'glass'

/** 名前のタグから材質を引く。組み合わせられる (col_metal_wall) */
const SURFACE_TAGS: Record<string, Surface> = {
  metal_: 'metal',
  concrete_: 'concrete',
  wood_: 'wood',
  glass_: 'glass',
}

/** タグが無いときの材質。構造物は金属を既定にする */
export const DEFAULT_SURFACE: Surface = 'metal'

export function surfaceOf(name: string): Surface {
  for (const [tag, surface] of Object.entries(SURFACE_TAGS)) {
    if (name.includes(tag)) return surface
  }
  return DEFAULT_SURFACE
}
