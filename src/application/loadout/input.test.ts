import { describe, expect, test } from 'bun:test'
import {
  READY_HOLD,
  closeBriefing,
  focusAt,
  holdRatio,
  newLoadoutInput,
  openBriefing,
  stepLoadoutInput,
  type LoadoutKeys,
  type LoadoutScene,
} from './input'

/** 何も押していない 1 フレーム */
const idle: LoadoutKeys = { up: false, down: false, left: false, right: false, confirm: false, confirmHeld: false, slot: null }
const standby: LoadoutScene = { ready: true, rows: 5, selfReady: false }
const HOLD_MS = READY_HOLD * 1000

describe('枠のカーソル', () => {
  test('上下で動き、端では回る', () => {
    const input = newLoadoutInput()
    stepLoadoutInput(input, { ...idle, up: true }, standby, 0)
    expect(focusAt(input, 5)).toBe(4)
    stepLoadoutInput(input, { ...idle, down: true }, standby, 0)
    expect(focusAt(input, 5)).toBe(0)
  })

  test('窓が切り替わって枠が減ったら、最後の枠に寄せる (スキル 5 つ → 装備 3 つ)', () => {
    const input = newLoadoutInput()
    input.at = 4
    expect(focusAt(input, 3)).toBe(2)
    stepLoadoutInput(input, { ...idle, down: true }, { ...standby, ready: false, rows: 3 }, 0)
    expect(focusAt(input, 3)).toBe(0)
  })

  test('左右はその枠の中を送る', () => {
    const input = newLoadoutInput()
    expect(stepLoadoutInput(input, { ...idle, right: true }, standby, 0)).toEqual([{ kind: 'step', step: 1 }])
    expect(stepLoadoutInput(input, { ...idle, left: true }, standby, 0)).toEqual([{ kind: 'step', step: -1 }])
  })
})

describe('READY の長押し', () => {
  test('**READY_HOLD 押し続けて初めて READY。** 1 押しでは入らない (2026-10-09 本人)', () => {
    const input = newLoadoutInput()
    expect(stepLoadoutInput(input, { ...idle, confirm: true, confirmHeld: true }, standby, 1000)).toEqual([])
    expect(holdRatio(input, 1000 + HOLD_MS / 2)).toBeCloseTo(0.5)
    // 途中で離すと頭から
    stepLoadoutInput(input, idle, standby, 1000 + HOLD_MS / 2)
    expect(holdRatio(input, 2000)).toBe(0)
    stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, 2000)
    expect(stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, 2000 + HOLD_MS)).toEqual([
      { kind: 'ready', ready: true },
    ])
  })

  test('**長押しで READY にした押下を離しても外れない。** 取り消しは次の 1 押し', () => {
    const input = newLoadoutInput()
    stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, 0)
    stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, HOLD_MS)
    const ready = { ...standby, selfReady: true }
    // 押したまま → 離す。どちらも何も起きない
    expect(stepLoadoutInput(input, { ...idle, confirmHeld: true }, ready, HOLD_MS + 100)).toEqual([])
    expect(stepLoadoutInput(input, idle, ready, HOLD_MS + 200)).toEqual([])
    // 次の 1 押しで取り消す
    expect(stepLoadoutInput(input, { ...idle, confirm: true, confirmHeld: true }, ready, HOLD_MS + 300)).toEqual([
      { kind: 'ready', ready: false },
    ])
  })

  test('倒れて湧くまでの装備の画面では、Enter は湧く (長押しではない)', () => {
    const input = newLoadoutInput()
    expect(stepLoadoutInput(input, { ...idle, confirm: true }, { ...standby, ready: false }, 0)).toEqual([{ kind: 'spawn' }])
  })
})

describe('ルールの説明', () => {
  test('**開いている間は Enter / × で閉じるだけ。** 枠も READY も数字キーも触らない', () => {
    const input = newLoadoutInput()
    openBriefing(input)
    const all = { up: true, down: true, left: true, right: true, confirm: false, confirmHeld: true, slot: 2 }
    expect(stepLoadoutInput(input, all, standby, 0)).toEqual([])
    expect(input.at).toBe(0)
    expect(stepLoadoutInput(input, { ...idle, confirm: true, confirmHeld: true }, standby, 0)).toEqual([])
    expect(input.briefing).toBe(false)
  })

  test('**説明を閉じた押下を押し続けても READY にならない。** 離してから押し直す', () => {
    const input = newLoadoutInput()
    openBriefing(input)
    stepLoadoutInput(input, { ...idle, confirm: true, confirmHeld: true }, standby, 0)
    expect(stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, HOLD_MS * 3)).toEqual([])
    stepLoadoutInput(input, idle, standby, HOLD_MS * 3)
    stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, HOLD_MS * 4)
    expect(stepLoadoutInput(input, { ...idle, confirmHeld: true }, standby, HOLD_MS * 5)).toEqual([
      { kind: 'ready', ready: true },
    ])
  })

  test('画面の OK で閉じても同じ (押したままの押下は数えない)', () => {
    const input = newLoadoutInput()
    openBriefing(input)
    closeBriefing(input)
    expect(input.briefing).toBe(false)
    expect(input.releaseWait).toBe(true)
  })
})

describe('数字キー', () => {
  test('説明が閉じていれば名指しを返す', () => {
    const input = newLoadoutInput()
    expect(stepLoadoutInput(input, { ...idle, slot: 3 }, standby, 0)).toEqual([{ kind: 'slot', index: 3 }])
  })
})
