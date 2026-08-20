import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 置き場所の規則を試験で留める。
 *
 * **依存は一方通行** (docs/design.md の 7)。domain は語彙と規則で、sim は
 * それを動かす幾何と物理。規則が幾何を知っていると、「弾がどう飛ぶか」を
 * 変えるたびに「何発で死ぬか」が動く。
 *
 * 文書に書くだけだと、半年後に import を 1 本足した所で誰も気づかない。
 */
const DOMAIN = join(import.meta.dir)

/** domain の下を全部 (item/ rule/ の中まで) */
function sourcesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n)
    if (statSync(full).isDirectory()) return sourcesOf(full)
    return n.endsWith('.ts') && !n.endsWith('.test.ts') ? [full] : []
  })
}

describe('置き場所', () => {
  test('domain は sim を知らない', () => {
    const guilty = sourcesOf(DOMAIN).filter((n) =>
      /from\s+['"][^'"]*\/sim\//.test(readFileSync(n, 'utf8')),
    )
    expect(guilty).toEqual([])
  })

  test('domain は three にも DOM にも触らない', () => {
    const guilty = sourcesOf(DOMAIN).filter((n) =>
      /from\s+['"]three/.test(readFileSync(n, 'utf8')),
    )
    expect(guilty).toEqual([])
  })

  /**
   * **通信も知らない。** protocol (src/net) はゲームの言葉を借りて話す側で、
   * 逆ではない。Team の定義をここへ移したのはそのため。
   */
  test('domain は通信の形を知らない', () => {
    const guilty = sourcesOf(DOMAIN).filter((n) =>
      /from\s+['"][^'"]*\/net\//.test(readFileSync(n, 'utf8')),
    )
    expect(guilty).toEqual([])
  })

  /**
   * 描画と入力 (src/game) を知らないのも同じ理由。こちらは通信 (src/net) より
   * 強い規則で、**共有の層はサーバーがそのまま読む**ので import した時点で落ちる。
   */
  test('domain は描画を知らない', () => {
    const guilty = sourcesOf(DOMAIN).filter((n) =>
      /from\s+['"][^'"]*\/(game|ui|screens)\//.test(readFileSync(n, 'utf8')),
    )
    expect(guilty).toEqual([])
  })
})
