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
 * protocol / link / api` で 3 回踏んでいる。**層の決めごとを守るための試験が、
 * 名前の書き換えで壊れる**のは急所なので、順序の宣言をここ 1 つにする。
 *
 * --- 層 (docs/design.md の 7) ---
 *
 *     domain      遊びの語彙と数字          依存なし
 *     sim         世界に訊く手続き          domain の**型だけ**
 *     protocol    通信で流れる形            domain の語彙だけ
 *     replica     こちら側の状態のレプリカ      domain / protocol
 *     presentation 見せる・聞かせる         上の全部 + three
 *
 *     input       押されたか。依存なし
 *     link        回線 (WebSocket)。protocol を運ぶ
 *     api / auth  外の口 (部屋一覧・戦績・認証)
 *
 * server/ は src の外にあり、上から全部を読む側なので順序では縛らない。
 * 代わりに**循環が無いこと**だけ見る (下の「審判の中に循環が無い」)。
 */

/** 各層が import してよい相手。**自分自身は常に可** */
const LAYERS: Record<string, readonly string[]> = {
  domain: [],
  sim: ['domain'],

  /**
   * 外と繋ぐ口。**輸送・HTTP・発行元・装置。**
   *
   * どれも「どう届けるか / どこから来るか」であって、遊びの状態は持たない。
   * infra が消えても状態は残るが、application が消えたら運ぶ物が無くなる —
   * その向きが層の位置を決めている。
   *
   * 差し替えの壁でもある。WebTransport にしても、認証を Supabase から
   * 移しても、**この下のファイルだけ書き換えれば済む**という形を保つ。
   */
  infra: [],
  /**
   * 位置をバイトへ詰める。**約束の形は読むが、意味は持たない。**
   *
   * 位置だけ他と桁違いに多いので、ここだけ JSON をやめている (1 通 264 バイトが
   * 33 バイト)。**輸送の都合**なので infra。読むのは回線とサーバーだけで、
   * 画面は読まない。
   */
  'infra/codec': ['domain', 'application/protocol'],
  // 回線。認証の切符を持って行く先が同じなので auth を読む
  'infra/link': ['application/protocol', 'infra/codec', 'infra/auth'],
  // サーバーの居場所 (serverHttpUrl) は回線と共有する。ws:// と http:// の
  // 書き分けを 2 か所に置かないため
  'infra/api': ['application/protocol', 'domain', 'infra/auth', 'infra/link'],
  /** 誰なのか。**発行元 (いまは Supabase) の都合をここから外へ出さない** */
  'infra/auth': [],
  /*
   * 押されたか。**どこにも依存しない。**
   *
   * 動詞に訳すのは domain/player/intent.ts で、ここが持つのは割り当て
   * (どのキーがどの操作か) と、単押し / 長押しの分け方だけ。
   *
   * 1 枚だったものを畳んで 1 つの葉にした。時間を数える部分 (hold.ts) は
   * 装置に触らないので、鍵盤もパッドも無しで確かめられる — 分けた理由が
   * それで、外から見た形は変わらない。
   */
  'infra/input': [],
  /**
   * アプリケーションの状態。**server/ と同じ高さの双子。**
   *
   * どちらも状態を持ち、報せを受けて更新する。違うのは**決めるか、従うか**だけ
   * (docs/design.md)。`server/` が「サーバーを立てる」という仕事を持つのに対し、
   * ここは**その状態の形**を持つ。
   *
   * いま入っているのはレプリカだけ。この先「部屋を選んで入るまでの流れ」や
   * 「支度の進み方」のような、画面ではなく**筋道**の側もここへ来る。
   */
  application: [],
  /**
   * 線を流れる形。**client と server の間の約束。**
   *
   * どちらか片方の持ち物ではないが、**約束の中身は遊びの語彙で書かれている**
   * (体力・残機・部位)。だから application の下で、infra ではない。
   *
   * バイトへ詰める所は別 (infra/codec)。あちらは「264 バイトを 33 バイトに」
   * という**輸送の都合**で、遊びの意味を 1 つも持っていない。
   */
  'application/protocol': ['domain'],
  /** サーバーの状態を追う。**決めない** — 報せを受けて進むだけ */
  'application/replica': ['domain', 'application/protocol'],
  presentation: [
    'domain',
    'sim',
    'application/protocol',
    'application/replica',
    'infra/link',
    'infra/api',
    'infra/auth',
    'infra/input',
    'i18n',
  ],
  i18n: [],
  // 組み立てる所。画面を並べて、認証が済むまで待たせる
  App: ['infra/auth', 'presentation'],
  index: ['App'],
}

/** three も DOM も知らない層。**サーバーがそのまま読む**ので入れられない */
const HEADLESS = ['domain', 'sim', 'application/protocol', 'application/replica', 'infra/codec']

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
  /*
   * **長い名前から先に当てる。**
   *
   * 先頭の 1 つだけを見ていると、入れ子にした層 (application/replica) が
   * 親 (presentation) として数えられて、**親に許した相手を全部読めてしまう**。
   * 表に載っている名前のうち、前方一致する一番長い物を採る。
   */
  const bare = rel.replace(/\.tsx?$/, '')
  for (const layer of NESTED) {
    if (bare === layer || rel.startsWith(layer + '/')) return layer
  }
  const head = rel.split('/')[0]
  if (/\.tsx?$/.test(head)) return head.replace(/\.tsx?$/, '')
  // css や glb は層ではない。棚 (拡張子の無い名前) だけを層として数える
  return head.includes('.') ? null : head
}

/** 入れ子の層。長い順に見るので、親より先に当たる */
const NESTED = Object.keys(LAYERS)
  .filter((name) => name.includes('/'))
  .sort((a, b) => b.length - a.length)

/**
 * その層のファイル。**棚でも、直下の 1 枚でも同じに扱う。**
 *
 * ディレクトリだけを見ていた頃は `input.ts` が永久に空を返していた —
 * 表に載せても検査されない。「押されたか。**依存なし**」と README に
 * 書いてあるのに、それを留めるものが無かった。
 */
function filesOf(layer: string): string[] {
  const dir = join(SRC, layer)
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    // **子の層は親から除く。** 入れ子にした層は自分の行で検査されるので、
    // 親の行にも混ぜると「親に許した相手」で通ってしまう
    const nested = NESTED.filter((name) => name.startsWith(layer + '/')).map((name) =>
      join(SRC, name),
    )
    return sourcesOf(dir).filter((file) => !nested.some((inner) => file.startsWith(inner)))
  }
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
   * まさにそれで、README には「依存なし」と書いてあるのに読み放題だった。
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

  /**
   * **審判 (server/) の中に循環が無い。**
   *
   * server は上から全部を読む側なので、層の順序では縛れない。代わりに
   * 「互いに呼び合わない」だけを見る — 呼び合うと**どちらが上か決まらず**、
   * 名前を付けても棚として機能しない。
   *
   * 実際 7 本あった。うち 4 本は `import { type X, f }` の形で、型しか使って
   * いない相手への実行時の依存が残っていたもの (`import type` に分ければ消える)。
   * 残り 3 本は本物で、こう解いた:
   *
   *   world → match      部屋を建てるときの的の設置を world 側へ
   *   damage → match     体力を配るのは中継の仕事 (sendHealth を relay へ)
   *   damage → arms      削った結果を**返す**ようにして、落とすのは呼ぶ側
   */
  test('審判の中に循環が無い', () => {
    const dir = resolve(SRC, '..', 'server')
    const files = sourcesOf(dir)
    const edges = new Map<string, Set<string>>()
    for (const file of files) {
      const out = new Set<string>()
      for (const { from, typeOnly } of importsOf(readFileSync(file, 'utf8'))) {
        if (typeOnly || !from.startsWith('.')) continue
        const target = `${resolve(dirname(file), from)}.ts`
        if (files.includes(target)) out.add(target)
      }
      edges.set(file, out)
    }
    const cycles: string[] = []
    for (const [file, out] of edges) {
      for (const other of out) {
        if (edges.get(other)?.has(file) && file < other) {
          cycles.push(`${relative(dir, file)} ↔ ${relative(dir, other)}`)
        }
      }
    }
    expect(cycles).toEqual([])
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
