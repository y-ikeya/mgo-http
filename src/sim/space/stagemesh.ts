/**
 * ステージの三角の網を読む。
 *
 * --- なぜ生の数値か ---
 * 三角 14 万枚を json で持つと 4MB を超えるうえ、読む側が解析に時間を使う。
 * 生で書けば `Float32Array` に載せるだけで済む。書き出しは
 * tools/export_stage.py。
 *
 *   [uint32 枚数][float32 頂点 × 枚数×9][uint8 印 × 枚数]
 *
 * --- なぜここに置くか ---
 * **サーバーとクライアントの両方が読む。** 印の意味を別々に持つと、片方だけ
 * 直したときに静かにずれる (実際、視線と弾の 2 つだけだった頃はサーバーの
 * 中に写しがあった)。
 *
 * 通信の符号化 (infra/codec) ではなく、**世界の形の置き方**なので、木を組む
 * bvh.ts の隣に置く。読むのは判定の層で、回線は通らない。
 */

/**
 * 面が何を止めるか。**tools/export_stage.py と揃えること。**
 *
 * 1 バイトに詰めてある。印を増やしてもファイルの大きさは変わらない。
 */
export const MESH_EYE = 1
export const MESH_BULLET = 2
export const MESH_PLAYER = 4
export const MESH_CAMERA = 8
/**
 * 材質は上位 2 ビット。**番号の意味はここでは決めない。**
 *
 * どの番号が木でどれが石かは遊びの話 (domain/stage/surface.ts の
 * SURFACE_ORDER)。判定の層は番号をそのまま運ぶだけで、名前へ直すのは
 * 受け取った側 — 幾何が遊びの数字を読まない、という約束のため。
 */
export const MESH_SURFACE_SHIFT = 4
const MESH_SURFACE_MASK = 3

export interface StageMesh {
  /** 頂点。三角 1 枚につき 9 個 */
  positions: Float32Array
  /** 三角 1 枚ごとの印 */
  marks: Uint8Array
}

/** 三角と印だけ。木を組むのは読んだ側 (sim/space/bvh.ts) */
export function decodeStageMesh(buffer: ArrayBuffer): StageMesh {
  const count = new Uint32Array(buffer, 0, 1)[0] ?? 0
  return {
    positions: new Float32Array(buffer, 4, count * 9),
    marks: new Uint8Array(buffer, 4 + count * 9 * 4, count),
  }
}

/**
 * その印が付いた三角だけを抜き出す。**用途ごとに別の木を組む。**
 *
 * 1 本の木に混ぜて引くたびに印を見ると、**枝を捨てられなくなる** —
 * 捨てた枝に別用途の面が混ざっているかもしれないので。
 *
 * 材質も一緒に持ち出す。足元の面から足音を引くのに要る。
 */
export function meshSubset(
  mesh: StageMesh,
  bit: number,
): { positions: Float32Array; surfaces: Uint8Array } {
  let count = 0
  for (const mark of mesh.marks) if (mark & bit) count++
  const positions = new Float32Array(count * 9)
  const surfaces = new Uint8Array(count)
  let at = 0
  for (let i = 0; i < mesh.marks.length; i++) {
    const mark = mesh.marks[i]!
    if (!(mark & bit)) continue
    positions.set(mesh.positions.subarray(i * 9, i * 9 + 9), at * 9)
    surfaces[at] = (mark >> MESH_SURFACE_SHIFT) & MESH_SURFACE_MASK
    at++
  }
  return { positions, surfaces }
}
