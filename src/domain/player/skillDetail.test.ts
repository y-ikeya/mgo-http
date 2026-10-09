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
