import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **sim は何も import しないで動く層にする。**
 *
 * domain (規則) と sim (幾何) は向きが一方通行なだけでは足りなかった。sim が
 * domain の値や関数を import していると、
 *
 *   - 間合いを 0.1m 変えただけで**幾何の試験が動く**
 *   - 幾何を試すのに、本物の遊びの数字を持ち出すことになる
 *   - 「その数字で答えが変わる」ことが、呼ぶ側から見えない
 *
 * 数字も関数も**引数で受け取る**。渡す物は domain がひとまとめにして持って
 * いるので (rule/damage.ts の HIT_RULES など)、写しが増えるわけではない。
 *
 * 型だけは共有する。実行時には消えるし、Pose も Stance も**このゲームの語彙**
 * であって、別の言い方を sim 側で用意しても混乱するだけ。
 */
const SIM = join(import.meta.dir)

function sourcesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n)
    if (statSync(full).isDirectory()) return sourcesOf(full)
    return n.endsWith('.ts') && !n.endsWith('.test.ts') ? [full] : []
  })
}

/**
 * `import type { … }` ではない import が、どこから引いているか。
 *
 * **行で見ない。** 複数行に折れた import は 1 行目に相手先が無いので、
 * 行単位だと素通りする — 規則を守るための試験が**書き方で破れる**。
 * 文全体 (import … from '…') を取ってから見る。
 */
function valueImportSources(source: string): string[] {
  const found: string[] = []
  const pattern = /import\s+(?!type\s)([\s\S]*?)from\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) found.push(match[2])
  return found
}

describe('置き場所 (sim)', () => {
  test('domain から値も関数も import しない。**受け取る**', () => {
    const guilty = sourcesOf(SIM).filter((file) =>
      valueImportSources(readFileSync(file, 'utf8')).some((from) => from.includes('/domain/')),
    )
    expect(guilty).toEqual([])
  })

  /**
   * **通信も描画も知らない。** 一度 presence.ts が net から補間の遅れを
   * 読んでいた (層の図に無い向き)。domain しか見張っていなかったので、
   * 誰も気づかないまま入っていた。
   */
  test('net / scene / ui / server を知らない', () => {
    const guilty = sourcesOf(SIM).filter((file) =>
      /from\s+['"][^'"]*\/(net|scene|game|ui|screens|input)\b/.test(readFileSync(file, 'utf8')),
    )
    expect(guilty).toEqual([])
  })

  test('three にも DOM にも触らない', () => {
    const guilty = sourcesOf(SIM).filter((file) =>
      /from\s+['"]three/.test(readFileSync(file, 'utf8')),
    )
    expect(guilty).toEqual([])
  })
})
