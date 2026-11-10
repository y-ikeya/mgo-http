/**
 * **空の見え方の升の表** (tools/sky_grid.py が焼く stage_<名>.sky.bin)。読むのと、CPU で引くのはここ。
 * 面ごとに GPU で引くのは skyGrid.ts。
 *
 * 升は 50cm、面の近くの升だけ持つ。升ごとに 6 つの向き (Blender の +x, -x, +y, -y, +z, -z) の
 * 半球で測った空の見え方 (16 段) と、隣の升との間が面でふさがっている印を持つ。中心が壁の中の
 * 升は、中に空気があれば 25cm に割って 8 つ持つ (細い窓の凹みの中)。語の形は sky_grid.py の注
 */

export interface SkyTable {
  /** 升の角 (Blender の座標) */
  lo: [number, number, number]
  cell: number
  n: [number, number, number]
  levels: number
  /** 一番暗い値 (空が全く見えない所) */
  floor: number
  /** 升ごとの語。番号は i + n0·(j + n1·k)。0 = 持たない */
  coarse: Uint32Array
  /** 細かく持つ升の語。8 つずつ (順は x·4 + y·2 + z) */
  fine: Uint32Array
}

/** 縮めた塊を戻す。ブラウザは DecompressionStream、試験は node:zlib */
export type Inflate = (bytes: Uint8Array) => Promise<ArrayBuffer>

const KEPT = 0x80000000
const FINE = 0x40000000

/** 'SKY2' の表を読む。形が違えば null */
export async function parseSkyTable(buf: ArrayBuffer, inflate: Inflate): Promise<SkyTable | null> {
  const view = new DataView(buf)
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'SKY2') return null
  let at = 4
  const headLen = view.getUint32(at, true)
  at += 4
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, at, headLen)))
  at += headLen
  const parts: ArrayBuffer[] = []
  for (let i = 0; i < 3; i++) {
    const len = view.getUint32(at, true)
    at += 4
    parts.push(await inflate(new Uint8Array(buf, at, len)))
    at += len
  }
  const [maskBuf, wordsBuf, fineBuf] = parts as [ArrayBuffer, ArrayBuffer, ArrayBuffer]
  const cells = head.n[0] * head.n[1] * head.n[2]
  const mask = new Uint8Array(maskBuf)
  const words = new Uint32Array(wordsBuf, 0, head.kept)
  const coarse = new Uint32Array(cells)
  let next = 0
  for (let idx = 0; idx < cells; idx++) {
    if (mask[idx >> 3]! & (0x80 >> (idx & 7))) coarse[idx] = words[next++]!
  }
  return {
    lo: head.lo,
    cell: head.cell,
    n: head.n,
    levels: head.levels,
    floor: head.floor,
    coarse,
    fine: new Uint32Array(fineBuf, 0, head.fine * 8),
  }
}

/** 隣との間がふさがっている印 (向きの番号 q の bit 24 + q) */
function blocked(word: number, q: number): boolean {
  return ((word >>> (24 + q)) & 1) === 1
}

/** 6 方向のうち 1 つの値 (0〜1) */
function valueOf(table: SkyTable, word: number, q: number): number {
  return ((word >>> (4 * q)) & 15) / (table.levels - 1)
}

/** 上の半球 (+z) の向きの番号 */
const UP = 4

/**
 * 格子の 8 升から引く。**面をまたぐ升は混ぜない** — 点に一番近い升を基準に、そこから見て
 * 隣との間がふさがっている向きへ 1 歩でもまたぐ升を外す (描く方の skyGrid.ts と同じ決まり)
 */
function lattice(
  table: SkyTable,
  bx: number,
  by: number,
  bz: number,
  step: number,
  cellAt: (i: number, j: number, k: number) => number,
): number | null {
  const g = [(bx - table.lo[0]) / step - 0.5, (by - table.lo[1]) / step - 0.5, (bz - table.lo[2]) / step - 0.5]
  const base = g.map(Math.floor) as [number, number, number]
  const f = g.map((v, a) => v - base[a]!) as [number, number, number]
  const near = f.map((v) => (v > 0.5 ? 1 : 0)) as [number, number, number]
  const ref = cellAt(base[0] + near[0], base[1] + near[1], base[2] + near[2])
  let total = 0
  let weight = 0
  for (let c = 0; c < 8; c++) {
    const d = [(c >> 2) & 1, (c >> 1) & 1, c & 1] as const
    const word = cellAt(base[0] + d[0], base[1] + d[1], base[2] + d[2])
    if (!(word & KEPT)) continue
    if (ref & KEPT) {
      let across = false
      for (let a = 0; a < 3; a++) {
        if (d[a] === 1 && near[a] === 0 && blocked(ref, 2 * a)) across = true
        if (d[a] === 0 && near[a] === 1 && blocked(ref, 2 * a + 1)) across = true
      }
      if (across) continue
    }
    const w = (d[0] ? f[0] : 1 - f[0]) * (d[1] ? f[1] : 1 - f[1]) * (d[2] ? f[2] : 1 - f[2])
    total += valueOf(table, word, UP) * w
    weight += w
  }
  return weight > 1e-3 ? total / weight : null
}

/**
 * その点から上の空がどれだけ見えるか (floor〜1)。**人の明るさに使う** (three の座標)。
 *
 * 前は人ごとに毎コマ光線を 9 本飛ばしていた (skylight.ts の skyAt)。地形と同じ表から引けば、
 * 人と地形の暗さの決まり方がそろう
 */
export function skyTableAt(table: SkyTable, x: number, y: number, z: number): number {
  // three (x, y, z) → Blender (x, -z, y)
  const bx = x
  const by = -z
  const bz = y
  const [n0, n1, n2] = table.n
  const inside = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < n0 && j < n1 && k < n2
  const coarseAt = (i: number, j: number, k: number) => {
    if (!inside(i, j, k)) return 0
    const word = table.coarse[i + n0 * (j + n1 * k)]!
    return word & KEPT ? word : 0
  }
  const fromCoarse = lattice(table, bx, by, bz, table.cell, coarseAt)
  if (fromCoarse !== null) return fromCoarse
  const fineAt = (i: number, j: number, k: number) => {
    const pi = i >> 1
    const pj = j >> 1
    const pk = k >> 1
    if (!inside(pi, pj, pk)) return 0
    const word = table.coarse[pi + n0 * (pj + n1 * pk)]!
    if (word & KEPT) return word
    if (!(word & FINE)) return 0
    return table.fine[(word & 0x3fffffff) * 8 + (i & 1) * 4 + (j & 1) * 2 + (k & 1)]!
  }
  return lattice(table, bx, by, bz, table.cell / 2, fineAt) ?? table.floor
}
