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
 *     protocol    線の上での形              domain の語彙だけ
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

/** import 文を丸ごと拾う。**行では見ない** — 複数行に折れた import をすり抜ける */
function importsOf(source: string): { from: string; typeOnly: boolean }[] {
  const found: { from: string; typeOnly: boolean }[] = []
  for (const match of source.matchAll(/import\s+([\s\S]*?)from\s*['"]([^'"]+)['"]/g)) {
    found.push({ from: match[2], typeOnly: match[1].trimStart().startsWith('type ') })
  }
  return found
}

/** その import が着地する層。src の外や外部パッケージなら null */
function layerOf(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const target = resolve(dirname(file), spec)
  const rel = relative(SRC, target)
  if (rel.startsWith('..')) return null
  return rel.split('/')[0].replace(/\.tsx?$/, '')
}

describe('層の順序', () => {
  for (const [layer, allowed] of Object.entries(LAYERS)) {
    test(`${layer} が読んでよいのは ${allowed.join(' / ') || '(何も無い)'}`, () => {
      const guilty: string[] = []
      for (const file of sourcesOf(join(SRC, layer))) {
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
      for (const file of sourcesOf(join(SRC, layer))) {
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
    for (const file of sourcesOf(join(SRC, 'sim'))) {
      for (const { from, typeOnly } of importsOf(readFileSync(file, 'utf8'))) {
        if (typeOnly) continue
        if (layerOf(file, from) === 'domain') guilty.push(`${relative(SRC, file)} → ${from}`)
      }
    }
    expect(guilty).toEqual([])
  })
})
