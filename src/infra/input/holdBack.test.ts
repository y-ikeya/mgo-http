import { describe, expect, test } from 'bun:test'
import { Input } from './index'

/**
 * 装備の画面で押した物を、**離すまで効かせない** (Input.holdBack)。
 *
 * パッドの × は決定でもしゃがみ / 転がりでもある。決めた押下が画面の閉じた後も
 * 押されたままだと、そこから長押しが成立して転がった (2026-11-08)。仕組みは
 * 鍵盤とパッドで同じ (操作ごとに飲み込む) なので、鍵盤のしゃがみ (Space) で確かめる
 */

/** 鍵盤の押下を渡す。DOM は要らない (掴んでいなければ document を見ない) */
function key(input: Input, code: string, down: boolean): void {
  const handler = (input as unknown as Record<string, (e: Partial<KeyboardEvent>) => void>)[down ? 'onKeyDown' : 'onKeyUp']
  handler!({ code, preventDefault: () => {} })
}

/** 1 コマ進める。画面が出ていれば Game.tick と同じく飲み込む */
function frame(input: Input, loadout: boolean, dt = 1 / 60): void {
  input.advance(dt)
  if (loadout) input.holdBack(['menuUp', 'menuDown', 'menuLeft', 'menuRight', 'spawn', 'menu'])
}

describe('装備の画面で押した物は、離すまで効かない', () => {
  test('画面で押したしゃがみの指を、閉じた後も押し続けても転がらず、離してもしゃがまない', () => {
    const input = new Input()
    input.wantsLock = false
    key(input, 'Space', true)
    frame(input, true)
    // 画面が閉じた。押したまま長押しの閾値 (0.17 秒) を越える
    for (let i = 0; i < 30; i++) {
      frame(input, false)
      expect(input.holding('stance')).toBe(false)
    }
    key(input, 'Space', false)
    frame(input, false)
    expect(input.tapped('stance')).toBe(false)
  })

  test('離して押し直せば効く', () => {
    const input = new Input()
    input.wantsLock = false
    key(input, 'Space', true)
    frame(input, true)
    key(input, 'Space', false)
    frame(input, false)
    key(input, 'Space', true)
    frame(input, false)
    key(input, 'Space', false)
    frame(input, false)
    expect(input.tapped('stance')).toBe(true)
  })

  test('画面の操作 (決定) は飲み込まない', () => {
    const input = new Input()
    input.wantsLock = false
    key(input, 'Enter', true)
    frame(input, true)
    expect(input.pushed('spawn')).toBe(true)
  })
})
