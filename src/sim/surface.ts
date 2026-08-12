/**
 * 面の材質。足音の種類が変わる。
 *
 * 見た目と足音を 1 つの宣言から決めるための型。別々に持つと、
 * 金属に見える箱からコンクリートの足音が鳴る、が起きる。
 *
 * サーバーも読む。見えない相手の足音を配るには、その相手が何の上に
 * 立っているかをサーバーが知っている必要がある。
 */
export type Surface = 'concrete' | 'metal' | 'wood'

/** 名前の札から材質を引く。組み合わせられる (col_metal_wall) */
const SURFACE_TAGS: Record<string, Surface> = {
  metal_: 'metal',
  concrete_: 'concrete',
  wood_: 'wood',
}

/** 札が無いときの材質。構造物は金属を既定にする */
export const DEFAULT_SURFACE: Surface = 'metal'

export function surfaceOf(name: string): Surface {
  for (const [tag, surface] of Object.entries(SURFACE_TAGS)) {
    if (name.includes(tag)) return surface
  }
  return DEFAULT_SURFACE
}
