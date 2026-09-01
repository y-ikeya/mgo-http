import { describe, expect, test } from 'bun:test'
import {
  MAX_STAMINA, SLEEP_SECONDS, STAMINA_RECOVER_DELAY,
  drainStamina, isAsleep, recoverStamina, sleepLeft, staminaBlur, staminaSwayScale,
} from './stamina'
import { WEAPONS } from '../item/weapons'

/**
 * スタミナと眠り。
 *
 * --- なぜここを試すか ---
 * 「何発で眠るか」が麻酔銃の存在理由そのもの。頭 1 発・胴 4 発・脚 8 発と
 * 決めたが、その数字は**武器の zone をスタミナとして読む**ことで出ている
 * (体力を削っていた頃の数字が意味だけ移った)。どちらかを触ったときに
 * もう片方が付いてこないと、静かに 3 発や 5 発になる。
 */

const M9 = WEAPONS.m9

/** 満タンから当て続けて、何発で眠るか */
function shotsToSleep(amount: number): number {
  let stamina = MAX_STAMINA
  for (let n = 1; n <= 20; n++) {
    const drain = drainStamina(stamina, amount, false)
    stamina = drain.stamina
    if (drain.slept) return n
  }
  return -1
}

describe('麻酔で眠るまで', () => {
  test('**頭 1 発、胴 4 発、脚 8 発。** 麻酔銃の間合いはこの数で決まる', () => {
    expect(shotsToSleep(M9.zone.HEAD)).toBe(1)
    expect(shotsToSleep(M9.zone.BODY)).toBe(4)
    expect(shotsToSleep(M9.zone.LEGS)).toBe(8)
  })

  test('麻酔銃だけがスタミナを削る。**他の銃は体力のまま**', () => {
    expect(M9.tranquilizer).toBe(true)
    expect(WEAPONS.m1911.tranquilizer).toBeUndefined()
    expect(WEAPONS.rifle.tranquilizer).toBeUndefined()
  })

  test('削り切った 1 発だけが眠らせる。**0 のまま撃っても眠らない**', () => {
    const last = drainStamina(M9.zone.BODY, M9.zone.BODY, false)
    expect(last).toEqual({ stamina: 0, slept: true })
    // 空になった後にもう 1 発。**二度目は起きない**
    expect(drainStamina(0, M9.zone.BODY, false).slept).toBe(false)
  })

  test('**眠っている相手は削れない。** 撃ち続けて眠りが伸びない', () => {
    const drain = drainStamina(MAX_STAMINA, M9.zone.HEAD, true)
    expect(drain).toEqual({ stamina: MAX_STAMINA, slept: false })
  })

  test('**屈んで待った分だけ戻る。** 立っていても歩いていても戻らない', () => {
    const hurt = MAX_STAMINA - WEAPONS.m9.zone.BODY
    // 屈んだ直後はまだ戻らない。留まる時間そのものが代償
    expect(recoverStamina(hurt, 0, 1)).toBe(hurt)
    expect(recoverStamina(hurt, STAMINA_RECOVER_DELAY - 0.01, 1)).toBe(hurt)
    // 待てば戻る
    expect(recoverStamina(hurt, STAMINA_RECOVER_DELAY, 1)).toBeGreaterThan(hurt)
  })

  test('**胴 1 発を取り戻すのに 5 秒。** 屈んでいる間は撃ち合いに出られない', () => {
    let stamina = MAX_STAMINA - WEAPONS.m9.zone.BODY
    for (let i = 0; i < 5 * 60; i++) {
      stamina = recoverStamina(stamina, STAMINA_RECOVER_DELAY + i / 60, 1 / 60)
    }
    expect(stamina).toBeCloseTo(MAX_STAMINA, 1)
  })

  test('満タンを超えない', () => {
    expect(recoverStamina(MAX_STAMINA, 99, 10)).toBe(MAX_STAMINA)
  })
})

describe('眠っている間', () => {
  const now = 1_000_000

  test('起きる時刻を過ぎたら眠っていない', () => {
    expect(isAsleep(now + 1, now)).toBe(true)
    expect(isAsleep(now, now)).toBe(false)
    expect(isAsleep(0, now)).toBe(false)
  })

  test('**30 秒。** 倒された人が湧き直すのと同じくらい長い', () => {
    const until = now + SLEEP_SECONDS * 1000
    expect(sleepLeft(until, now)).toBe(SLEEP_SECONDS)
    expect(sleepLeft(until, now + SLEEP_SECONDS * 1000)).toBe(0)
  })
})


/**
 * 減ったスタミナの効き目。**読ませるのではなく効かせる。**
 *
 * 目盛りを出していたが、撃ち合いの最中に読む人は居なかった。狙いが定まらない
 * ことで分かるほうが早く、そのまま不利にもなっている。
 */
describe('スタミナの効き目', () => {
  test('満タンなら何も起きない', () => {
    expect(staminaSwayScale(MAX_STAMINA)).toBe(1)
    expect(staminaBlur(MAX_STAMINA)).toBe(0)
  })

  test('**減るほど手が泳ぐ。** 1 発ではまだ撃てる', () => {
    const one = staminaSwayScale(MAX_STAMINA - WEAPONS.m9.zone.BODY)
    const three = staminaSwayScale(MAX_STAMINA - WEAPONS.m9.zone.BODY * 3)
    expect(one).toBeCloseTo(1.4, 1)
    expect(three).toBeCloseTo(2.2, 1)
    expect(three).toBeGreaterThan(one)
  })

  test('**曇りは効き始めが遅い。** 手ブレより後から気づく', () => {
    const one = MAX_STAMINA - WEAPONS.m9.zone.BODY
    // 1 発では 6%。手ブレ (40% 増) より目立たない
    expect(staminaBlur(one)).toBeLessThan(0.1)
    // 眠る一歩手前で一番濃い
    expect(staminaBlur(WEAPONS.m9.zone.BODY)).toBeGreaterThan(0.5)
  })
})
