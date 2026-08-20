import { describe, expect, test } from 'bun:test'
import { assignTeam, leaderOf, loseTicket, newMatch, type Match } from './match'
import { newPlayer } from './player'

function room(mode: 'DM' | 'TDM'): Match {
  const match = newMatch(mode)
  match.blue = 20
  match.red = 20
  return match
}

function join(match: Match, id: string, kills = 0, team: 'blue' | 'red' = 'blue'): void {
  const player = newPlayer({ id, name: id, team, slot: match.players.size, now: 0 })
  player.kills = kills
  player.life = 'alive'
  match.players.set(id, player)
}

describe('個人戦の残機', () => {
  test('**部屋で 1 つ**。誰が死んでも同じ砂時計が減る', () => {
    const match = room('DM')
    loseTicket(match, 'blue')
    loseTicket(match, 'red')
    expect(match.blue).toBe(18)
  })

  test('陣営戦は色ごと', () => {
    const match = room('TDM')
    loseTicket(match, 'blue')
    loseTicket(match, 'red')
    expect(match.blue).toBe(19)
    expect(match.red).toBe(19)
  })
})

describe('1 位', () => {
  test('倒した数が一番多い人', () => {
    const match = room('DM')
    join(match, 'a', 3)
    join(match, 'b', 1)
    expect(leaderOf(match)?.id).toBe('a')
  })

  test('**同数なら誰も光らない。** 最初の 1 キルで狙われ続けるのを避ける', () => {
    const match = room('DM')
    join(match, 'a', 2)
    join(match, 'b', 2)
    expect(leaderOf(match)).toBe(null)
  })

  test('全員 0 なら誰も光らない', () => {
    const match = room('DM')
    join(match, 'a')
    join(match, 'b')
    expect(leaderOf(match)).toBe(null)
  })

  test('的 (bot) は数に入らない', () => {
    const match = room('DM')
    join(match, 'a', 1)
    join(match, 'target-0', 5)
    const bot = match.players.get('target-0')
    if (bot) bot.bot = true
    expect(leaderOf(match)?.id).toBe('a')
  })
})

describe('陣営の割り振り', () => {
  test('個人戦は全員同じ色。**色が分かれていると味方が居ると読める**', () => {
    const match = room('DM')
    join(match, 'a', 0, 'blue')
    expect(assignTeam(match)).toBe('blue')
  })

  test('陣営戦は少ないほうへ', () => {
    const match = room('TDM')
    join(match, 'a', 0, 'blue')
    expect(assignTeam(match)).toBe('red')
  })
})
