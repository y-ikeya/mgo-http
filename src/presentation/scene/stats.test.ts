import { describe, expect, test } from 'bun:test'
import { weaponOf } from '../../domain/item/weapons'
import { CHOOSE_FLOOR, CHOOSE_TIMEOUT } from '../../domain/player/lifecycle'
import { VOICE_CATEGORIES } from '../../domain/player/voice'
import {
  TARGET_NOTICE_LEAVE_MS,
  TARGET_NOTICE_MS,
  downLeftOf,
  loadoutClock,
  secondsUntil,
  targetNoticeOf,
  voiceMenuOf,
  weaponCard,
} from './stats'

/** HUD に何を出すかの判断。Game.ts の publishStats の中にあった頃は描画器なしで試せなかった */
const inHand = { weapon: 'rifle' as const, ammoOf: () => 7, reserveOf: () => 30, magazine: 30 }

describe('武器のカード', () => {
  test('**支度の間はこれから湧く銃を映す。** 前の命の銃 (AK) ではなく選んでいる銃 (P90)', () => {
    const card = weaponCard(true, 'smg', inHand)
    expect(card.shown).toBe('smg')
    expect(card.ammo).toBe(weaponOf('smg').magazine)
    expect(card.reserve).toBe(weaponOf('smg').reserve)
  })

  test('銃を持たない部屋の支度ではナイフ', () => {
    expect(weaponCard(true, null, inHand).shown).toBe('knife')
  })

  test('戦場では手にある銃の残り', () => {
    expect(weaponCard(false, 'smg', inHand)).toEqual({ shown: 'rifle', ammo: 7, magazine: 30, reserve: 30 })
  })
})

describe('装備の画面の残り秒', () => {
  test('**支度の段階では試合が始まるまで。** 装備の打ち切りではない', () => {
    expect(loadoutClock('ready', 42_500, 100, 0).left).toBe(43)
    expect(loadoutClock('countdown', 3_000, 100, 0).left).toBe(3)
  })

  test('試合中に倒れた後は装備の打ち切りまで。OK は CHOOSE_FLOOR 秒経つまで効かない', () => {
    expect(loadoutClock('playing', 0, 1, 0)).toEqual({ left: Math.ceil(CHOOSE_TIMEOUT - 1), wait: Math.ceil(CHOOSE_FLOOR - 1) })
    expect(loadoutClock('playing', 0, CHOOSE_TIMEOUT + 5, 0)).toEqual({ left: 0, wait: 0 })
  })
})

describe('倒れたままの残り', () => {
  test('**倒されるたびに延びる部屋 (CAP) で、倒れている間だけ**', () => {
    expect(downLeftOf(true, 'downed', 9, 1000, 4000)).toBe(6)
    expect(downLeftOf(false, 'downed', 9, 1000, 4000)).toBe(0)
    expect(downLeftOf(true, 'alive', 9, 1000, 4000)).toBe(0)
    expect(downLeftOf(true, 'downed', 9, 0, 60_000)).toBe(0)
  })
})

test('残り秒は過ぎたら 0、無ければ 0', () => {
  expect(secondsUntil(5000, 2000)).toBe(3)
  expect(secondsUntil(1000, 2000)).toBe(0)
  expect(secondsUntil(undefined, 2000)).toBe(0)
})

describe('ターゲットの帯', () => {
  const notice = { text: 'alice がターゲットを取得した', team: 'blue' as const, at: 1000 }
  test('出しておく間だけ。最後の少しで退き始める', () => {
    expect(targetNoticeOf(notice, 1000)).toEqual({ text: notice.text, team: 'blue', leaving: false })
    expect(targetNoticeOf(notice, 1000 + TARGET_NOTICE_MS - TARGET_NOTICE_LEAVE_MS)?.leaving).toBe(true)
    expect(targetNoticeOf(notice, 1000 + TARGET_NOTICE_MS)).toBeNull()
    expect(targetNoticeOf(null, 0)).toBeNull()
  })
})

describe('ボイスの一覧', () => {
  test('**分類を選ぶ前は分類の並び、選んだ後はその中の台詞。** 締め切りを過ぎたら閉じる', () => {
    expect(voiceMenuOf(2000, null, false, 1000)?.items).toEqual(VOICE_CATEGORIES.map((c) => c.label))
    const inside = voiceMenuOf(2000, 0, true, 1000)
    expect(inside?.title).toBe(VOICE_CATEGORIES[0]!.label)
    expect(inside?.items).toHaveLength(VOICE_CATEGORIES[0]!.lines.length)
    expect(voiceMenuOf(1000, null, false, 1000)).toBeNull()
  })
})
