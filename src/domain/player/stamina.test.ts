import { describe, expect, test } from 'bun:test'
import {
  MAX_STAMINA, SLEEP_SECONDS, STAMINA_RECOVER_DELAY,
  drainStamina, isAsleep, recoverStamina, sleepLeft, staminaBlur, staminaSwayScale,
  STRUGGLE_RATE, STRUGGLE_SPEED, struggle, wakeFloor,
  PAT_INTERVAL_MS, pat,
} from './stamina'
import { TSNE_SLEEP_SECONDS } from '../match/room'
import { patSeconds, sleepScale } from './skill'
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

/**
 * もがいて早く起きる。**削る量と上限はサーバーが持つ** — 画面が送る量を偽っても、
 * 経った時間ぶんしか効かず、眠りの 1/3 より早くは起きられない。
 */
describe('もがいて早く起きる', () => {
  const now = 1_000_000

  test('1 回転で 2/3 秒早まる (全力の 1 秒 3 回転で 2 秒)', () => {
    const until = now + 60_000
    const next = struggle({ sleepUntil: until, struggleAt: now - 1000 }, 3, 0, now)
    expect(next.sleepUntil).toBe(until - STRUGGLE_SPEED * 1000)
  })

  test('一度に大きな数を送っても、経った時間ぶんしか効かない', () => {
    const until = now + 60_000
    const next = struggle({ sleepUntil: until, struggleAt: now - 500 }, 1000, 0, now)
    expect(next.sleepUntil).toBe(until - 0.5 * STRUGGLE_SPEED * 1000)
  })

  // 本人 2026-10-19「何もしなかったら 1min で回して 20 秒」「TSNE はめっちゃ頑張って 150 秒、何もしなかったら 450 秒」
  for (const [label, sleep, fastest] of [['普段', SLEEP_SECONDS, 20], ['TSNE', TSNE_SLEEP_SECONDS, 150]] as const) {
    test(`${label}: 何もしなければ ${sleep} 秒、全力でもがき続けると ${fastest} 秒で起きる`, () => {
      const start = now
      const floor = wakeFloor(start, sleep)
      let state = { sleepUntil: start + sleep * 1000, struggleAt: 0 }
      let t = start
      for (; isAsleep(state.sleepUntil, t); t += 100) state = struggle(state, STRUGGLE_RATE * 0.1, floor, t)
      expect((t - start) / 1000).toBeCloseTo(fastest, 0)
    })
  }

  test('速さの上限をすり抜けても、眠りの 1/3 より早くは起きられない', () => {
    const floor = wakeFloor(now, 60)
    const next = struggle({ sleepUntil: now + 60_000, struggleAt: now - 1000 }, 1e9, floor, now)
    expect(next.sleepUntil).toBeGreaterThanOrEqual(floor)
  })

  test('起きている間や、数でない量は何もしない', () => {
    const awake = { sleepUntil: now - 1, struggleAt: 0 }
    expect(struggle(awake, 1, 0, now)).toBe(awake)
    const asleep = { sleepUntil: now + 5000, struggleAt: 0 }
    expect(struggle(asleep, Number.NaN, 0, now)).toBe(asleep)
    expect(struggle(asleep, -3, 0, now)).toBe(asleep)
  })
})

/** 眠っている人を叩いて起こす。**1 回で 20 秒縮む (どのルールでも)。** 連打では縮めない */
describe('叩いて起こす', () => {
  const t0 = 1_000_000
  /** 間を空けて叩き続けて、起きるまでの回数 */
  const patsToWake = (sleep: number) => {
    let state = { sleepUntil: t0 + sleep * 1000, patAt: 0 }
    let n = 0
    for (let t = t0; isAsleep(state.sleepUntil, t); t += 1600) {
      state = pat(state, t)
      n++
    }
    return n
  }

  test('1 回で 20 秒縮む', () => {
    expect(pat({ sleepUntil: t0 + 60_000, patAt: 0 }, t0).sleepUntil).toBe(t0 + 40_000)
  })

  test('普段 (60 秒) は 3 回、TSNE (450 秒) は 20 回以上叩かないと起きない', () => {
    expect(patsToWake(SLEEP_SECONDS)).toBe(3)
    expect(patsToWake(TSNE_SLEEP_SECONDS)).toBeGreaterThan(20)
  })

  test('間が短すぎる叩きは効かない (ボタンの連打で縮めない)', () => {
    const first = pat({ sleepUntil: t0 + 60_000, patAt: 0 }, t0)
    expect(pat(first, t0 + PAT_INTERVAL_MS - 1)).toBe(first)
  })

  test('起きている人は叩いても変わらない', () => {
    const awake = { sleepUntil: t0 - 1, patAt: 0 }
    expect(pat(awake, t0)).toBe(awake)
  })
})

/** QUICK RECOVERY。**Lv3 なら 1 回叩けば起こせる** (TSNE の 450 秒でも)。自分の眠りも短い */
describe('QUICK RECOVERY', () => {
  const t0 = 1_000_000

  test('Lv3 は TSNE の眠りたてでも 1 回で起こせる', () => {
    const next = pat({ sleepUntil: t0 + TSNE_SLEEP_SECONDS * 1000, patAt: 0 }, t0, patSeconds({ quickRecovery: 3 }))
    expect(isAsleep(next.sleepUntil, t0)).toBe(false)
  })

  test('段が上がるほど叩いて縮める量が増える。取っていなければ 20 秒', () => {
    expect(patSeconds({})).toBe(20)
    expect(patSeconds({ quickRecovery: 1 })).toBeLessThan(patSeconds({ quickRecovery: 2 }))
  })

  test('Lv3 は自分の眠りが半分', () => {
    expect(sleepScale({})).toBe(1)
    expect(sleepScale({ quickRecovery: 3 })).toBe(0.5)
  })
})
