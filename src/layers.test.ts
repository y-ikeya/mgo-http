import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * 層の順序を、**1 つの表**で決める。
 *
 * --- なぜ 1 か所に集めたか ---
 * 見張りは domain と sim に 1 つずつあって、どちらも禁止先を**綴りで**
 * 持っていた (`/(game|ui|screens)/`)。おかげで名前を変えるたびに、見張りが
 * 黙って素通りになった — `game → scene → presentation/scene` と `net →
 * protocol / link / api` で 3 回踏んでいる。**規則を守るための試験が、
 * 名前の書き換えで壊れる**のは急所なので、順序の宣言をここ 1 つにする。
 *
 * --- 層 (docs/design.md の 7) ---
 *
 *     domain      遊びの語彙と数字          何も知らない
 *     sim         世界に訊く手続き          domain の**型だけ**
 *     protocol    通信で流れる形            domain の語彙だけ
 *     replica     こちら側の状態の写し      domain / protocol
 *     presentation 見せる・聞かせる         上の全部 + three
 *
 *     input       押されたか。何も知らない
 *     link        回線 (WebSocket)。protocol を運ぶ
 *     api / auth  外の口 (部屋一覧・戦績・認証)
 *
 * server/ は src の外なので、ここでは見ない (審判は上から全部を読む側)。
 */

/** 各層が import してよい相手。**自分自身は常に可** */
const LAYERS: Record<string, readonly string[]> = {
  domain: [],
  sim: ['domain'],
  protocol: ['domain'],
  replica: ['domain', 'protocol'],
  // 回線と外の口は**端**。認証の切符を持って行く先が同じなので auth を読む
  link: ['protocol', 'auth'],
  // サーバーの居場所 (serverHttpUrl) は回線と共有する。ws:// と http:// の
  // 書き分けを 2 か所に置かないため
  api: ['protocol', 'domain', 'auth', 'link'],
  auth: [],
  presentation: [
    'domain',
    'sim',
    'protocol',
    'replica',
    'link',
    'api',
    'auth',
    'input',
    'i18n',
  ],
  // 押されたか。**何も知らない** — 動詞に訳すのは domain/player/intent.ts で、
  // ここが持つのはキーコードとパッドの番号だけ
  input: [],
  i18n: [],
  // 組み立てる所。画面を並べて、認証が済むまで待たせる
  App: ['auth', 'presentation'],
  index: ['App'],
}

/** three も DOM も知らない層。**サーバーがそのまま読む**ので入れられない */
const HEADLESS = ['domain', 'sim', 'protocol', 'replica']

const SRC = join(import.meta.dir)

function sourcesOf(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourcesOf(full)
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return []
    return name.endsWith('.test.ts') ? [] : [full]
  })
}

/**
 * 依存を丸ごと拾う。
 *
 * **行では見ない** — 複数行に折れた import をすり抜ける。
 *
 * **`export … from` も依存。** import だけを見ていた頃は、再エクスポートで
 * いくらでも外へ出せた (`export { BLAST_RADIUS } from '../../domain/item/grenade'`
 * を sim に置いても素通りした)。書き方が変わっただけで見張りが黙るのは、
 * 綴りで禁止先を書いていた頃と同じ形の穴。
 *
 * `=` と `;` を挟まないことで、`export const A = 1` の後ろに続く import を
 * 巻き込まない (貪欲に読むと 2 文が 1 つに潰れる)。
 */
function importsOf(source: string): { from: string; typeOnly: boolean }[] {
  const found: { from: string; typeOnly: boolean }[] = []
  const statement = /(?:^|\n)\s*(?:import|export)\s+([^;=]*?)\bfrom\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(statement)) {
    found.push({ from: match[2], typeOnly: match[1].trimStart().startsWith('type ') })
  }
  return found
}

/** その import が着地する層。src の外・外部パッケージ・資産なら null */
function layerOf(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const rel = relative(SRC, resolve(dirname(file), spec))
  if (rel.startsWith('..')) return null
  const head = rel.split('/')[0]
  if (/\.tsx?$/.test(head)) return head.replace(/\.tsx?$/, '')
  // css や glb は層ではない。棚 (拡張子の無い名前) だけを層として数える
  return head.includes('.') ? null : head
}

/**
 * その層のファイル。**棚でも、直下の 1 枚でも同じに扱う。**
 *
 * ディレクトリだけを見ていた頃は `src/input.ts` が永久に空を返していた —
 * 表に載せても検査されない。「押されたか。**何も知らない**」と README に
 * 書いてあるのに、それを留めるものが無かった。
 */
function filesOf(layer: string): string[] {
  const dir = join(SRC, layer)
  if (existsSync(dir) && statSync(dir).isDirectory()) return sourcesOf(dir)
  return ['.ts', '.tsx'].map((ext) => dir + ext).filter((file) => existsSync(file))
}

describe('層の順序', () => {
  for (const [layer, allowed] of Object.entries(LAYERS)) {
    test(`${layer} が読んでよいのは ${allowed.join(' / ') || '(何も無い)'}`, () => {
      const guilty: string[] = []
      for (const file of filesOf(layer)) {
        for (const { from } of importsOf(readFileSync(file, 'utf8'))) {
          const target = layerOf(file, from)
          if (target === null || target === layer) continue
          // 直下のファイル (input.ts など) も層として数える
          if (!allowed.includes(target)) {
            guilty.push(`${relative(SRC, file)} → ${target}`)
          }
        }
      }
      expect(guilty).toEqual([])
    })
  }

  /**
   * **表に載っていない置き場所を作らない。**
   *
   * 順序を宣言しても、宣言の外に置かれた物は検査されない。`input.ts` が
   * まさにそれで、README には「何も知らない」と書いてあるのに読み放題だった。
   * ここが落ちたら、増やした物を上の表に足す — **足すこと自体が「何を読んで
   * よいか」を決める作業**になる。
   */
  test('src の置き場所は全部、上の表に載っている', () => {
    const missing = readdirSync(SRC)
      .filter((name) => !name.startsWith('.') && name !== 'layers.test.ts')
      .map((name) => (/\.tsx?$/.test(name) ? name.replace(/\.tsx?$/, '') : name))
      // css などの資産は層ではない
      .filter((name) => !name.includes('.'))
      .filter((name) => !(name in LAYERS))
    expect(missing).toEqual([])
  })

  /**
   * **domain の直下に .ts を置かない。** 語彙は entity ごとの棚 (player /
   * match / item / stage / rule) に入れる。直下に積むと、20 個並んだところで
   * 「これは人の話か試合の話か」を名前から読むしかなくなる。
   */
  test('domain の語彙は棚に入っている', () => {
    const loose = readdirSync(join(SRC, 'domain')).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )
    expect(loose).toEqual([])
  })

  test('下の層は three にも DOM にも触らない', () => {
    const guilty: string[] = []
    for (const layer of HEADLESS) {
      for (const file of filesOf(layer)) {
        if (/from\s+['"]three/.test(readFileSync(file, 'utf8'))) guilty.push(relative(SRC, file))
      }
    }
    expect(guilty).toEqual([])
  })

  /**
   * **sim は domain から値も関数も import しない。受け取る。**
   *
   * 向きが一方通行なだけでは足りなかった。幾何の層が遊びの数字を直に読むと、
   * 間合いを 0.1m 変えただけで幾何の試験が動くし、「その数字で答えが変わる」
   * ことが呼ぶ側から見えない。型だけは共有する (Pose / Stance / Surface)。
   */
  test('sim は domain の型だけを借りる', () => {
    const guilty: string[] = []
    for (const file of filesOf('sim')) {
      for (const { from, typeOnly } of importsOf(readFileSync(file, 'utf8'))) {
        if (typeOnly) continue
        if (layerOf(file, from) === 'domain') guilty.push(`${relative(SRC, file)} → ${from}`)
      }
    }
    expect(guilty).toEqual([])
  })
})
