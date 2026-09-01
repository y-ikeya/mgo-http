import { describe, expect, test } from 'bun:test'
import { MAX_STAMINA, SLEEP_SECONDS, drainStamina, isAsleep, sleepLeft } from './stamina'
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

  test('時間では戻らない。**戻るのは眠って起きたときだけ**', () => {
    // 回復の関数を持たない、というのがそのまま規則
    expect(Object.keys({ drainStamina, isAsleep, sleepLeft })).not.toContain('recoverStamina')
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
