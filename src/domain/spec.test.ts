import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELD, SWITCH_TIME, type HeldId } from './item/held'
import { SUPPORT_SPECS, WEAPONS, type SupportId, type WeaponId } from './item/weapons'
import { MAX_HEALTH } from './rule/damage'
import { CHOOSE_FLOOR, CHOOSE_TIMEOUT, DOWN_DURATION, SPAWN_PROTECT } from './lifecycle'
import { MIN_PLAYERS, RECONNECT_GRACE } from './match'

/**
 * **README が数字の出どころ。** そこに書いた表と実装が合っているかを見る。
 *
 * --- なぜ試験にするか ---
 * 「文書のほうが正しい」と決めても、守る仕掛けが無ければ半年で嘘になる。
 * 表を見ても、それが古いかどうかは読んでも分からない — 武器の表を生成に
 * したのと同じ理由 (Makefile の docs)。
 *
 * こちらは生成しない。**数字を決めるのは人の側**で、コードはそれに従う。
 * だから「書き直す」ではなく「食い違ったら落とす」にしてある。
 *
 * 表の増減に強くしてある: 検査の枠に載っている行だけを見て、README に無い
 * 行は見ない。逆に **README にあってコードに無い id は落ちる** (綴り間違い)。
 */
const README = readFileSync(join(import.meta.dir, 'README.md'), 'utf8')

/**
 * `<!-- 検査:名前 -->` から `<!-- /検査 -->` までの表を読む。
 *
 * 返すのは 1 行ぶんの升目の配列。見出しと区切り (|---|) は落とす。
 */
function tableOf(name: string): string[][] {
  const open = `<!-- 検査:${name} -->`
  const from = README.indexOf(open)
  if (from < 0) throw new Error(`README に ${open} が無い`)
  const to = README.indexOf('<!-- /検査 -->', from)
  const rows = README.slice(from + open.length, to)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  // 1 行目が見出し、2 行目が区切り
  return rows.slice(2)
}

/** 「| 名前 | 値 |」の 2 列の表を引き当てる */
function valueOf(name: string, label: string): number {
  const row = tableOf(name).find((cells) => cells[0].includes(label))
  if (!row) throw new Error(`README の ${name} に「${label}」の行が無い`)
  return Number(row[1])
}

describe('README が数字の出どころ', () => {
  test('部位ごとの基準ダメージ', () => {
    for (const [id, head, body, legs] of tableOf('部位')) {
      const spec = WEAPONS[id as WeaponId]
      expect(spec, `README に無い武器: ${id}`).toBeDefined()
      expect([id, spec.zone.HEAD, spec.zone.BODY, spec.zone.LEGS]).toEqual([
        id,
        Number(head),
        Number(body),
        Number(legs),
      ])
    }
  })

  test('装弾数・予備・重さ・リロード', () => {
    for (const [id, name, mag, reserve, weight, reload] of tableOf('銃')) {
      const spec = WEAPONS[id as WeaponId]
      expect(spec, `README に無い武器: ${id}`).toBeDefined()
      // 名前は kill (キルログに出る型番)。label は役どころ (「ライフル」)
      expect([id, spec.kill, spec.magazine, spec.reserve, spec.weight, spec.reload]).toEqual([
        id,
        name,
        Number(mag),
        Number(reserve),
        Number(weight),
        Number(reload),
      ])
    }
  })

  test('1 つの命で持てる数', () => {
    for (const [id, label, count] of tableOf('支援')) {
      const spec = SUPPORT_SPECS[id as SupportId]
      expect(spec, `README に無い支援: ${id}`).toBeDefined()
      expect([id, spec.label, spec.count]).toEqual([id, label, Number(count)])
    }
  })

  test('手に持てる物', () => {
    for (const [id, label, family, weight, shoots] of tableOf('持てる物')) {
      const spec = HELD[id as HeldId]
      expect(spec, `README に無い持ち物: ${id}`).toBeDefined()
      expect([id, spec.label, spec.family, spec.weight, spec.shoots]).toEqual([
        id,
        label,
        family,
        Number(weight),
        shoots === '○',
      ])
    }
    // **README に並んでいないものを手に持てるようにしない。** 一覧に無い物が
    // 手にあると、切り替えの HUD から辿り着けない持ち物ができる
    expect(tableOf('持てる物').map((cells) => cells[0]).sort()).toEqual(
      Object.keys(HELD).sort(),
    )
  })

  test('体力', () => {
    expect(MAX_HEALTH).toBe(100)
    expect(README).toContain('体力は **100** とする')
  })

  test('試合', () => {
    expect(valueOf('試合', '始めるのに要る人数')).toBe(MIN_PLAYERS)
    expect(valueOf('試合', '席を空けて待つ')).toBe(RECONNECT_GRACE / 1000)
  })

  test('時間', () => {
    expect(valueOf('時間', '湧いた直後の無敵')).toBe(SPAWN_PROTECT)
    expect(valueOf('時間', '倒れてから湧けるまで')).toBe(DOWN_DURATION)
    expect(valueOf('時間', '支度の打ち切り')).toBe(CHOOSE_TIMEOUT)
    expect(valueOf('時間', 'OK が効くまで')).toBe(CHOOSE_FLOOR)
    expect(valueOf('時間', '持ち替え')).toBe(SWITCH_TIME)
  })
})
