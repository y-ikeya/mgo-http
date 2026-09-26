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
export type Surface = 'concrete' | 'metal' | 'wood' | 'glass' | 'sand'

/** 名前のタグから材質を引く。組み合わせられる (col_metal_wall) */
const SURFACE_TAGS: Record<string, Surface> = {
  metal_: 'metal',
  concrete_: 'concrete',
  // 煉瓦。音も当たりもコンクリート。絵は Blender で貼る (材質に絵があればゲームはそのまま使う)
  brick_: 'concrete',
  wood_: 'wood',
  glass_: 'glass',
  /*
   * 砂地。足音は砂。絵は Blender で貼る (コードからは貼らない)。
   *
   * **三角の網には乗らない。** 網は材質を 2 ビット (4 種、SURFACE_ORDER) で
   * 持つので、書き出し (tools/export_stage.py) は砂をコンクリートの番号で
   * 出す。網から引く材質は弾の着弾の見た目にしか使わないので、それで足りる。
   * 足音と絵は箱の名前から引くので、こちらは砂として分かれる。
   */
  sand_: 'sand',
}

/**
 * 番号との対応。**tools/export_stage.py の SURFACE_IDS と揃えること。**
 *
 * 三角の網は材質を 1 枚ごとに 2 ビットで持つ (infra/codec/stagemesh.ts)。
 * 名前から引くのはこのファイルの仕事なので、番号の並びもここに置く —
 * 別々に持つと、書き出しが木と言った面が石の音で鳴る。
 */
export const SURFACE_ORDER: readonly Surface[] = ['concrete', 'metal', 'wood', 'glass']

/** タグが無いときの材質。構造物は金属を既定にする */
export const DEFAULT_SURFACE: Surface = 'metal'

export function surfaceOf(name: string): Surface {
  for (const [tag, surface] of Object.entries(SURFACE_TAGS)) {
    if (name.includes(tag)) return surface
  }
  return DEFAULT_SURFACE
}
