/**
 * 動作の表 (体の状態の軸 × 動作) を**スプレッドシートと行き来させる。正はシート。**
 *
 *     bun tools/moves_sheet.ts import         シートの軸のタブを読んで src/domain/player/moves.csv と movesTable.ts を作り直す
 *     bun tools/moves_sheet.ts import <file>  手元の CSV から作り直す
 *     bun tools/moves_sheet.ts export         いまの表を moves.csv の形で書き出す (シートへ取り込む元)
 *
 * シート: https://docs.google.com/spreadsheets/d/1_Mu0DE7iOZPF-MqR14LDATwexhTkOLOsB23_zOtAps8 の軸のタブ
 * (gid=1911869645、リンクを知っている人が閲覧可)
 *
 * --- 形 (2026-11-03 本人と決めた軸の表) ---
 *   1 行目    「軸」「値」、3 列目から動作の名前 (日本語)
 *   読み方の行 (1 列目が「読み方」) は読まない
 *   軸の行     1 列目が軸 (姿勢 / 動作中 / 倒れ / 手)、2 列目が値。升目は ⭕ = その値ならできる、空 = できない
 *   メモの行   1 列目が「メモ」。動作ごとの決めた理由
 *
 * 軸の中は どれか (OR)、軸どうしは 全部 (AND)。**軸の升目がまるごと空なら、その軸は関係ない。**
 * 動作・軸・値の日本語とコードの名前の対応は下の表。知らない名前があれば止まる —
 * 動作や値を**足す**ときは、シートに列 / 行を足してから、ここの対応とコードの側を足す
 */
import { AXES, MOVES, type Axis, type Move } from '../src/domain/player/moves'

const SHEET = 'https://docs.google.com/spreadsheets/d/1_Mu0DE7iOZPF-MqR14LDATwexhTkOLOsB23_zOtAps8/export?format=csv&gid=1911869645'
const ROOT = new URL('..', import.meta.url).pathname
const CSV_PATH = `${ROOT}src/domain/player/moves.csv`
const TABLE_PATH = `${ROOT}src/domain/player/movesTable.ts`
const LEGEND = '⭕ = その値ならできる。軸の中は「どれか」(OR)、軸どうしは「全部」(AND)。軸がまるごと空 = 関係ない'
/** 「その値ならできる」の印。丸の書き方は揺れるので全部受ける */
const OK = new Set(['⭕️', '⭕', '○', '〇', '◯'])

export const MOVE_LABELS: Record<Move, string> = {
  roll: '転がる',
  vault: '跳び越える / 乗る',
  hang: '縁に掴まる',
  prone: '伏せる (伏せ始める)',
  rise: '起き上がる (伏せから)',
  crouch: 'しゃがむ (立ち⇄しゃがみ)',
  standUp: '立ち直る (倒れから)',
  box: '箱を被る',
  unbox: '箱を脱ぐ',
  ladder: '梯子を掴む',
  aim: '構える',
  fire: '撃つ',
  reload: 'リロードする',
  stab: 'ナイフで刺す',
  throw: '投げる',
  place: '置く (クレイモア)',
  cqc: 'CQC を掛ける',
  swap: '持ち替える',
  step: '一歩下がる',
  salute: '敬礼',
  pat: '叩いて起こす',
  struggle: 'もがく',
}

export const AXIS_LABELS: Record<Axis, string> = { posture: '姿勢', action: '動作中', down: '倒れ', hand: '手' }

export const VALUE_LABELS: { [A in Axis]: Record<(typeof AXES)[A][number], string> } = {
  posture: { stand: '立ち', crouch: 'しゃがみ', prone: '伏せ', box: '箱', ladder: '梯子', hang: 'ぶら下がり', air: '空中', water: '水中' },
  action: {
    none: 'なし',
    roll: '転がり',
    vault: '跳び越え',
    proneShift: '伏せへの出入り',
    crawl: '這い',
    stab: '刺突',
    cqc: 'CQC',
    step: '一歩下がる',
    landing: '着地の硬直',
    salute: '敬礼',
    bump: '棒立ち (箱を落とされた)',
    flinch: '怯み',
  },
  down: { none: 'なし', downed: '倒れている (爆風・散弾・CQC)', standingUp: '立ち直り中', sleep: '眠り', trapped: '猫に釘付け', dead: '死' },
  hand: { aiming: '構えている', relaxed: '構えていない' },
}

/** 見出しの突き合わせ。括弧の補足は書き換わっても通す (「伏せる (伏せ始める)」と「伏せる」は同じ) */
const key = (label: string) => label.split(/[ (（]/)[0].trim()

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

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

export interface SheetMove {
  id: Move
  note: string
  /** 軸ごとの「その値ならできる」並び。軸がまるごと空なら入れない (関係ない) */
  rule: { [A in Axis]?: string[] }
}

/** CSV の升目を表にする。**知らない名前・知らない印は止める** (黙って空扱いにすると書き損じが通る) */
export function readSheet(rows: string[][]): SheetMove[] {
  const header = rows[0] ?? []
  const byLabel = new Map(Object.entries(MOVE_LABELS).map(([id, label]) => [key(label), id as Move]))
  const columns: { id: Move; col: number }[] = []
  for (let col = 2; col < header.length; col++) {
    const label = header[col].trim()
    if (!label) continue
    const id = byLabel.get(key(label))
    if (!id) throw new Error(`知らない動作「${label}」 (tools/moves_sheet.ts の MOVE_LABELS とコードに足す)`)
    columns.push({ id, col })
  }
  const missing = (Object.keys(MOVE_LABELS) as Move[]).filter((id) => !columns.some((c) => c.id === id))
  if (missing.length) throw new Error(`シートに無い動作: ${missing.join(', ')}`)

  const axisByLabel = new Map(Object.entries(AXIS_LABELS).map(([axis, label]) => [label, axis as Axis]))
  const moves: SheetMove[] = columns.map(({ id }) => ({ id, note: '', rule: {} }))
  const seen: { [A in Axis]?: Set<string> } = {}
  for (const row of rows.slice(1)) {
    const head = (row[0] ?? '').trim()
    if (head === 'メモ') {
      columns.forEach(({ col }, i) => (moves[i].note = (row[col] ?? '').trim()))
      continue
    }
    const axis = axisByLabel.get(head)
    if (!axis) continue // 読み方の行など
    const labels = VALUE_LABELS[axis] as Record<string, string>
    const value = Object.keys(labels).find((v) => key(labels[v]) === key(row[1] ?? ''))
    if (!value) throw new Error(`知らない値「${row[1]}」 (軸 ${head})`)
    ;(seen[axis] ??= new Set()).add(value)
    columns.forEach(({ col }, i) => {
      const mark = (row[col] ?? '').trim()
      if (OK.has(mark)) (moves[i].rule[axis] ??= []).push(value)
      else if (mark !== '') throw new Error(`知らない升目「${mark}」 (${head} ${row[1]} × ${MOVE_LABELS[moves[i].id]})`)
    })
  }
  for (const axis of Object.keys(AXES) as Axis[]) {
    const lacking = (AXES[axis] as readonly string[]).filter((v) => !seen[axis]?.has(v))
    if (lacking.length) throw new Error(`シートに無い値: ${AXIS_LABELS[axis]} の ${lacking.join(', ')}`)
  }
  return moves
}

function writeTable(moves: SheetMove[]): string {
  const lines = [
    '// 書き出した物。手で直さない。**正はスプレッドシートの軸のタブ** — 直したら `bun tools/moves_sheet.ts import`',
    '// 軸ごとに「その値ならできる」並び。軸の中は どれか、軸どうしは 全部。書いていない軸は関係ない',
    "import type { Move, Rule } from './moves'",
    '',
    'export const MOVE_RULES: Record<Move, Rule> = {',
  ]
  for (const m of moves) {
    lines.push(`  /** ${MOVE_LABELS[m.id]}${m.note ? `。${m.note.replaceAll('*/', '* /').replaceAll('\n', ' ')}` : ''} */`)
    const parts = (Object.keys(AXES) as Axis[])
      .filter((axis) => m.rule[axis])
      .map((axis) => `${axis}: [${m.rule[axis]!.map((v) => `'${v}'`).join(', ')}]`)
    lines.push(`  ${m.id}: { ${parts.join(', ')} },`)
  }
  lines.push('}', '')
  return lines.join('\n')
}

/** いまの表 (コード) をシートの形の CSV に。メモは movesTable.ts の注から取れないので空 */
function writeCsv(): string {
  const ids = Object.keys(MOVE_LABELS) as Move[]
  const out = [['軸', '値', ...ids.map((id) => MOVE_LABELS[id])], ['読み方', LEGEND, ...ids.map(() => '')]]
  for (const axis of Object.keys(AXES) as Axis[]) {
    for (const value of AXES[axis] as readonly string[]) {
      const label = (VALUE_LABELS[axis] as Record<string, string>)[value]
      out.push([AXIS_LABELS[axis], label, ...ids.map((id) => ((MOVES[id][axis] as readonly string[] | undefined)?.includes(value) ? '⭕' : ''))])
    }
  }
  return out.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

if (import.meta.main) {
  const [command, file] = process.argv.slice(2)
  if (command === 'import') {
    const response = file ? null : await fetch(SHEET)
    if (response && !response.headers.get('content-type')?.includes('text/csv')) {
      throw new Error('シートが CSV で読めない (共有が「リンクを知っている全員」になっているか、タブの gid を見る)')
    }
    const text = (file ? await Bun.file(file).text() : await response!.text()).replaceAll('\r\n', '\n')
    const moves = readSheet(parseCsv(text))
    await Bun.write(CSV_PATH, text.endsWith('\n') ? text : text + '\n')
    await Bun.write(TABLE_PATH, writeTable(moves))
    console.info(`動作 ${moves.length} 個を書いた: ${CSV_PATH} / ${TABLE_PATH}`)
  } else if (command === 'export') {
    await Bun.write(CSV_PATH, writeCsv())
    console.info(`書いた: ${CSV_PATH}`)
  } else {
    console.error('使い方: bun tools/moves_sheet.ts import [file] | export')
    process.exit(1)
  }
}
