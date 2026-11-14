import { describe, expect, test } from 'bun:test'
import { SKILLS, type SkillId } from './skill'
import { skillDetail } from './skillDetail'

/** 説明の数字は表から出す。**全スキルに説明があり、段の数と値の数が合う** */
describe('スキルの説明', () => {
  for (const id of Object.keys(SKILLS) as SkillId[]) {
    test(`${id}: 段ごとの値が揃っている`, () => {
      const detail = skillDetail(id)
      expect(detail.summary.length).toBeGreaterThan(0)
      expect(detail.effects.length).toBeGreaterThan(0)
      for (const effect of detail.effects) {
        // 気付く時のような段で文が変わる行も、段の数だけある
        expect(effect.values.length).toBe(effect.values.length === 1 ? 1 : SKILLS[id].levels)
      }
    })
  }

  test('FAST MOVE は表の値 (Lv3 で +10%)', () => {
    expect(skillDetail('runner').effects[0]!.values).toEqual(['+3%', '+6%', '+10%'])
  })

  test('KNIFE MASTERY はスタンの充電を秒で (20 → 16 / 13 / 10)', () => {
    const charge = skillDetail('knifeMastery').effects[1]!
    expect(charge.label).toContain('20 秒')
    expect(charge.values).toEqual(['16 秒', '13 秒', '10 秒'])
  })
})

/**
 * **英語の画面でも日本語が出ない** (2026-11-14 本人「skill の desc が JA しかなくない？」)。
 * 数字は同じ関数から出すので、日本語と英語で行の数と値の並びは揃う
 */
describe('英語の説明', () => {
  const japanese = /[぀-ヿ一-鿿]/
  for (const id of Object.keys(SKILLS) as SkillId[]) {
    test(id, () => {
      const en = skillDetail(id, 'en')
      const ja = skillDetail(id, 'ja')
      const texts = [en.summary, ...en.notes, ...en.effects.flatMap((e) => [e.label, ...e.values]), SKILLS[id].hint.en]
      for (const text of texts) expect(text).not.toMatch(japanese)
      expect(en.effects.map((e) => e.values.length)).toEqual(ja.effects.map((e) => e.values.length))
      expect(en.notes.length).toBe(ja.notes.length)
    })
  }
})
