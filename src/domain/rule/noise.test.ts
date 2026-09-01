import { describe, expect, test } from 'bun:test'
import { isHeard, shotReach, stepReach, STEP_RANGE } from './noise'
import { WEAPONS } from '../item/weapons'

/**
 * 音は**姿が見えない相手を知る唯一の手段**なので、届く距離は遊びそのもの。
 */
describe('音の届き方', () => {
  test('屈めば近づける。しゃがみの足音は走りの半分も届かない', () => {
    // 倍率は rule/footsteps.ts の StepProfile が持つ (走り 1 / しゃがみ 0.45)
    expect(stepReach(0.45)).toBeLessThan(stepReach(1) / 2)
    expect(stepReach(1)).toBe(STEP_RANGE)
  })

  test('**撃てば居場所が漏れる。** 銃声は足音よりずっと遠くまで届く', () => {
    for (const spec of Object.values(WEAPONS)) {
      if (spec.tranquilizer) continue
      expect(shotReach(spec)).toBeGreaterThan(STEP_RANGE * 3)
    }
  })

  /*
   * 麻酔銃だけが例外。**撃っても居場所が漏れない。**
   *
   * これが麻酔銃を選ぶ理由の半分になっている — 殺せないぶん、静かに 1 人
   * 抜ける。他の銃と同じだけ響くなら、撃った時点で周りに知らせることになって
   * 「静かに始末する道具」が成り立たない。
   *
   * ただし**無音ではない**。走る足音と同じだけは届く — そこを走り抜けるのと
   * 同じ、という所に置いてある。完全に消すと、近くに居る人にも何も起きて
   * いないことになる。
   */
  test('**麻酔銃だけは漏れない。** 走る足音と同じだけしか届かない', () => {
    const tranq = Object.values(WEAPONS).filter((spec) => spec.tranquilizer)
    expect(tranq.length).toBeGreaterThan(0)
    for (const spec of tranq) {
      expect(shotReach(spec)).toBeLessThanOrEqual(STEP_RANGE)
      expect(shotReach(spec)).toBeGreaterThan(0)
    }
  })

  test('狙撃銃の音が一番遠い。遠くから撃てる代償', () => {
    const widest = Object.values(WEAPONS).reduce((a, b) =>
      a.noiseRange >= b.noiseRange ? a : b,
    )
    expect(widest.id).toBe('sniper')
  })

  test('麻酔銃が一番静か。**気づかれずに撃つ道具**', () => {
    const quietest = Object.values(WEAPONS).reduce((a, b) =>
      a.noiseRange <= b.noiseRange ? a : b,
    )
    expect(quietest.id).toBe('m9')
  })

  test('届く距離の外では聞こえない', () => {
    expect(isHeard(19, 20, false)).toBe(true)
    expect(isHeard(21, 20, false)).toBe(false)
  })

  test('**姿が見えている相手の音は鳴らさない。** 二重に伝えない', () => {
    expect(isHeard(1, 20, true)).toBe(false)
  })
})
