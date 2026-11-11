import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_VOICE,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN,
  VOICE_STYLES,
  fitVoice,
} from './voice'

describe('声の選びの構造', () => {
  test('喋り方は man1 と woman1 の 2 種', () => {
    expect(VOICE_STYLES).toEqual(['man1', 'woman1'])
  })

  test('既定は man1 で高さ 1', () => {
    expect(DEFAULT_VOICE).toEqual({ style: 'man1', pitch: 1 })
  })
})

describe('fitVoice (申告の丸め)', () => {
  test('申告が無ければ既定', () => {
    expect(fitVoice(undefined)).toEqual(DEFAULT_VOICE)
    expect(fitVoice(null)).toEqual(DEFAULT_VOICE)
    expect(fitVoice({})).toEqual(DEFAULT_VOICE)
  })

  test('知っている style はそのまま通る', () => {
    expect(fitVoice({ style: 'woman1' })).toEqual({ style: 'woman1', pitch: 1 })
    expect(fitVoice({ style: 'man1', pitch: 1.1 })).toEqual({ style: 'man1', pitch: 1.1 })
  })

  test('知らない style は既定に落ちる', () => {
    expect(fitVoice({ style: 'robot' }).style).toBe('man1')
    expect(fitVoice({ style: 42 }).style).toBe('man1')
  })

  test('範囲内の高さはそのまま、範囲外は端に丸める', () => {
    expect(fitVoice({ pitch: 0.9 }).pitch).toBe(0.9)
    expect(fitVoice({ pitch: VOICE_PITCH_MIN }).pitch).toBe(VOICE_PITCH_MIN)
    expect(fitVoice({ pitch: VOICE_PITCH_MAX }).pitch).toBe(VOICE_PITCH_MAX)
    expect(fitVoice({ pitch: 3 }).pitch).toBe(VOICE_PITCH_MAX)
    expect(fitVoice({ pitch: 0.1 }).pitch).toBe(VOICE_PITCH_MIN)
  })

  test('高さが数でなければ既定の 1', () => {
    expect(fitVoice({ pitch: 'high' }).pitch).toBe(1)
    expect(fitVoice({ pitch: Number.NaN }).pitch).toBe(1)
    expect(fitVoice({ pitch: Number.POSITIVE_INFINITY }).pitch).toBe(1)
  })
})
