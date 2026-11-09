import { describe, expect, test } from 'bun:test'
import { deflateSync, inflateSync } from 'node:zlib'
import { parseSkyTable, skyTableAt } from './skyTable'

/**
 * 空の見え方の升の表 (tools/sky_grid.py の 'SKY2')。読めるか、人の明るさを正しく引けるか。
 * 表は試験の中で小さく作る (焼く道具と同じ形)
 */

const KEPT = 0x80000000

/** 上 (+z) の値を v (0〜15) に、他の向きは 0 にした語。blocked は隣との間の印 (向きの番号) */
function word(up: number, blocked: number[] = []): number {
  let w = KEPT | (up << 16)
  for (const q of blocked) w |= 1 << (24 + q)
  return w >>> 0
}

function encode(n: [number, number, number], coarse: number[], fine: number[] = []): ArrayBuffer {
  const cells = n[0] * n[1] * n[2]
  const mask = new Uint8Array(Math.ceil(cells / 8))
  const words: number[] = []
  coarse.forEach((w, idx) => {
    if (!w) return
    mask[idx >> 3]! |= 0x80 >> (idx & 7)
    words.push(w)
  })
  const head = new TextEncoder().encode(
    JSON.stringify({ lo: [0, 0, 0], cell: 1, n, levels: 16, floor: 0.06, kept: words.length, fine: fine.length / 8 }),
  )
  const parts = [mask, new Uint8Array(new Uint32Array(words).buffer), new Uint8Array(new Uint32Array(fine).buffer)].map((p) =>
    deflateSync(p),
  )
  const size = 8 + head.length + parts.reduce((s, p) => s + 4 + p.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode('SKY2'), 0)
  view.setUint32(4, head.length, true)
  out.set(head, 8)
  let at = 8 + head.length
  for (const p of parts) {
    view.setUint32(at, p.length, true)
    out.set(p, at + 4)
    at += 4 + p.length
  }
  return out.buffer
}

const inflate = async (bytes: Uint8Array) => {
  const out = inflateSync(bytes)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

/** Blender (x, y, z) の升の中心を three の座標にする (三 x = x, 三 y = z, 三 z = -y) */
const centre = (i: number, j: number, k: number) => [i + 0.5, k + 0.5, -(j + 0.5)] as const

describe('空の見え方の升の表', () => {
  test('読めて、升の中心ではその升の上の値になる', async () => {
    // 2 × 1 × 1。x = 0 の升は上が 15 (開けている)、x = 1 は 3
    const table = (await parseSkyTable(encode([2, 1, 1], [word(15), word(3)]), inflate))!
    expect(table.n).toEqual([2, 1, 1])
    expect(skyTableAt(table, ...centre(0, 0, 0))).toBeCloseTo(1)
    expect(skyTableAt(table, ...centre(1, 0, 0))).toBeCloseTo(3 / 15)
    // 真ん中は混ざる
    expect(skyTableAt(table, 1.0, 0.5, -0.5)).toBeCloseTo((1 + 3 / 15) / 2)
  })

  test('**面をまたぐ升は混ぜない** — 基準の升から見てふさがっている向きの升は外す', async () => {
    // x = 0 の升の +x (向きの番号 0) がふさがっている。境のすぐ手前 (x = 0.9) で引くと、x = 1 の升を混ぜない
    const table = (await parseSkyTable(encode([2, 1, 1], [word(15, [0]), word(3, [1])]), inflate))!
    expect(skyTableAt(table, 0.9, 0.5, -0.5)).toBeCloseTo(1)
    expect(skyTableAt(table, 1.1, 0.5, -0.5)).toBeCloseTo(3 / 15)
  })

  test('表の外や持たない所は一番暗い値', async () => {
    const table = (await parseSkyTable(encode([2, 1, 1], [word(15), 0]), inflate))!
    expect(skyTableAt(table, 50, 50, 50)).toBeCloseTo(0.06)
  })

  test('形が違えば読まない', async () => {
    expect(await parseSkyTable(new TextEncoder().encode('SKY1xxxx').buffer as ArrayBuffer, inflate)).toBeNull()
  })
})
