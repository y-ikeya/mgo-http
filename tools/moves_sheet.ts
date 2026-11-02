/**
 * 動作の表 (体の状態 × 動作) を**スプレッドシートと行き来させる。正はシート。**
 *
 *     bun tools/moves_sheet.ts import         シートを読んで src/domain/player/moves.csv と movesTable.ts を作り直す
 *     bun tools/moves_sheet.ts import <file>  手元の CSV から作り直す (シートに貼る前の確かめ)
 *     bun tools/moves_sheet.ts export         いまの表を moves.csv に書き出す (シートへ取り込む元)
 *
 * シート: https://docs.google.com/spreadsheets/d/1_Mu0DE7iOZPF-MqR14LDATwexhTkOLOsB23_zOtAps8 (リンクを知っている人が閲覧可)
 *
 * --- 形 ---
 *   1 行目   左上は凡例。3 列目から動作の id (roll, fire …)
 *   2 行目   動作の名前 (日本語)
 *   3 行目〜 1 列目が体の状態の id (rolling, cqc …)、2 列目がその説明。升目は
 *              ×   この状態ならできない (Rule.not)
 *              要  この状態でないとできない (Rule.needs)
 *              空  関係ない
 *   最後の行  1 列目が「メモ」。動作ごとの決めた理由
 *
 * 動作や状態を**足す**ときは、シートに列 / 行を足してから、コードの側 (moves.ts の Move / BodyState と、
 * 呼ぶ入口) を足す。表に知らない名前があれば型の確認で落ちる
 */

const SHEET = 'https://docs.google.com/spreadsheets/d/1_Mu0DE7iOZPF-MqR14LDATwexhTkOLOsB23_zOtAps8/export?format=csv&gid=0'
const ROOT = new URL('..', import.meta.url).pathname
const CSV_PATH = `${ROOT}src/domain/player/moves.csv`
const TABLE_PATH = `${ROOT}src/domain/player/movesTable.ts`
const LEGEND = '状態＼動作 (×=できない / 要=この状態でないとできない)'
const NOTE = 'メモ'

/** CSV を読む (引用符の中の , と改行と "" に対応) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export interface SheetTable {
  moves: { id: string; label: string; note: string; needs: string[]; not: string[] }[]
  flags: { id: string; label: string }[]
}

/** CSV の升目を表にする。**変な升目は止める** (黙って空扱いにすると、×を書き損じた所が通る) */
export function readSheet(rows: string[][]): SheetTable {
  const ids = rows[0].slice(2).map((s) => s.trim())
  const labels = (rows[1] ?? []).slice(2)
  const end = ids.findIndex((id) => id === '')
  const count = end < 0 ? ids.length : end
  const moves = ids.slice(0, count).map((id, i) => ({ id, label: (labels[i] ?? '').trim(), note: '', needs: [] as string[], not: [] as string[] }))
  const flags: SheetTable['flags'] = []
  for (const row of rows.slice(2)) {
    const id = (row[0] ?? '').trim()
    if (!id) continue
    if (id === NOTE) {
      moves.forEach((m, i) => (m.note = (row[i + 2] ?? '').trim()))
      continue
    }
    flags.push({ id, label: (row[1] ?? '').trim() })
    moves.forEach((m, i) => {
      const mark = (row[i + 2] ?? '').trim()
      if (mark === '×' || mark === 'x' || mark === 'X') m.not.push(id)
      else if (mark === '要') m.needs.push(id)
      else if (mark !== '' && mark !== '○' && mark !== '-') throw new Error(`知らない升目「${mark}」 (${id} × ${m.id})`)
    })
  }
  return { moves, flags }
}

function writeCsv(table: SheetTable): string {
  const lines = [
    [LEGEND, '', ...table.moves.map((m) => m.id)],
    ['', '', ...table.moves.map((m) => m.label)],
    ...table.flags.map((f) => [
      f.id,
      f.label,
      ...table.moves.map((m) => (m.not.includes(f.id) ? '×' : m.needs.includes(f.id) ? '要' : '')),
    ]),
    [NOTE, '', ...table.moves.map((m) => m.note)],
  ]
  return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n'
}

function writeTable(table: SheetTable): string {
  const q = (list: string[]) => `[${list.map((s) => `'${s}'`).join(', ')}]`
  const lines = [
    '// 書き出した物。手で直さない。**正はスプレッドシート** — 直したら `bun tools/moves_sheet.ts import`',
    "import type { Move, Rule } from './moves'",
    '',
    'export const MOVE_RULES: Record<Move, Rule> = {',
  ]
  for (const m of table.moves) {
    lines.push(`  /** ${m.label}${m.note ? `。${m.note.replaceAll('*/', '* /')}` : ''} */`)
    lines.push(`  ${m.id}: { needs: ${q(m.needs)}, not: ${q(m.not)} },`)
  }
  lines.push('}', '')
  return lines.join('\n')
}

if (import.meta.main) {
  const [command, file] = process.argv.slice(2)
  if (command === 'import') {
    const text = file ? await Bun.file(file).text() : await (await fetch(SHEET)).text()
    const table = readSheet(parseCsv(text))
    if (table.moves.length === 0 || table.flags.length === 0) throw new Error('表が空 (シートの共有か、1 行目の形を見る)')
    await Bun.write(CSV_PATH, writeCsv(table))
    await Bun.write(TABLE_PATH, writeTable(table))
    console.info(`動作 ${table.moves.length} × 状態 ${table.flags.length} を書いた: ${CSV_PATH} / ${TABLE_PATH}`)
  } else if (command === 'export') {
    const { MOVES } = await import('../src/domain/player/moves')
    const seed = await import('./moves_sheet_seed')
    const table: SheetTable = {
      flags: seed.FLAG_LABELS,
      moves: Object.entries(MOVES).map(([id, rule]) => ({
        id,
        label: seed.MOVE_LABELS[id]?.label ?? id,
        note: seed.MOVE_LABELS[id]?.note ?? '',
        needs: [...rule.needs],
        not: [...rule.not],
      })),
    }
    await Bun.write(CSV_PATH, writeCsv(table))
    console.info(`書いた: ${CSV_PATH}`)
  } else {
    console.error('使い方: bun tools/moves_sheet.ts import [file] | export')
    process.exit(1)
  }
}
