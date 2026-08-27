import { describe, expect, test } from 'bun:test'
import {
  assignTeam, isLeaking, leaderOf, leakingOf, loseTicket, newMatch, shuffleTeams, type Match,
} from './match'
import { newPlayer } from '../player/player'

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

/**
 * 光る = 位置が公になっている。
 *
 * **壁を無視して位置を配るかどうか**を決めているので、ここがずれると
 * 「表示がおかしい」では済まない。配る側 (relay) と名簿 (matchState) が
 * 同じ答えを見ていることを、問いを 1 つにすることで守る。
 */
describe('光っている人', () => {
  test('個人戦の 1 位は光る', () => {
    const match = room('DM')
    join(match, 'a', 3)
    join(match, 'b', 1)
    expect(isLeaking(match, match.players.get('a')!)).toBe(true)
    expect(isLeaking(match, match.players.get('b')!)).toBe(false)
  })

  test('**陣営戦では誰も光らない。** 1 位は居ても札が付かない', () => {
    const match = room('TDM')
    join(match, 'a', 3)
    join(match, 'b', 1)
    // 1 位は決まっている
    expect(leaderOf(match)?.id).toBe('a')
    // それでも光らない。ドメインルールが違う
    expect(leakingOf(match)).toBe(null)
    expect(isLeaking(match, match.players.get('a')!)).toBe(false)
  })

  test('同数なら誰も光らない。**序盤に 1 人だけ狙われるのを避ける**', () => {
    const match = room('DM')
    join(match, 'a', 2)
    join(match, 'b', 2)
    expect(leakingOf(match)).toBe(null)
  })

  test('抜かれたら札が移る。**蓄えていないので書き直しが要らない**', () => {
    const match = room('DM')
    join(match, 'a', 3)
    join(match, 'b', 1)
    expect(leakingOf(match)?.id).toBe('a')

    match.players.get('b')!.kills = 5
    expect(leakingOf(match)?.id).toBe('b')
    expect(isLeaking(match, match.players.get('a')!)).toBe(false)
  })
})

/**
 * 陣営の切り直し。**試合ごとに顔ぶれが変わる。**
 *
 * 入室で 1 回決めたきりだと、同じ面子が同じ側で何試合も続く。強い側が
 * 勝ち続け、負けている側から抜けていく。人が少ないうちほど効く。
 */
describe('陣営を切り直す', () => {
  /** 決まった目を返す。**乱数を引数で受ける**ので、答えが動かない */
  const rolls = (...values: number[]) => {
    let at = 0
    return () => values[at++ % values.length]
  }

  const teamsOf = (match: Match) => [...match.players.values()].map((p) => p.team)

  test('人数は偏らない。**偶数なら半々**', () => {
    const match = room('TDM')
    for (const id of ['a', 'b', 'c', 'd']) join(match, id)
    shuffleTeams(match, rolls(0.1, 0.9, 0.5, 0.3))
    const teams = teamsOf(match)
    expect(teams.filter((t) => t === 'blue')).toHaveLength(2)
    expect(teams.filter((t) => t === 'red')).toHaveLength(2)
  })

  /** どちらかへ寄せるしかないので、決め打ちにして揺らさない */
  test('奇数なら青が 1 人多い', () => {
    const match = room('TDM')
    for (const id of ['a', 'b', 'c']) join(match, id)
    shuffleTeams(match, rolls(0.4, 0.6))
    expect(teamsOf(match).filter((t) => t === 'blue')).toHaveLength(2)
  })

  /** **同じ目なら同じ結果。** 乱数を中で引いていたら成り立たない */
  test('同じ目を渡せば同じ分かれ方', () => {
    const one = room('TDM')
    const two = room('TDM')
    for (const id of ['a', 'b', 'c', 'd']) {
      join(one, id)
      join(two, id)
    }
    shuffleTeams(one, rolls(0.7, 0.2, 0.9))
    shuffleTeams(two, rolls(0.7, 0.2, 0.9))
    expect(teamsOf(one)).toEqual(teamsOf(two))
  })

  /** **切り直す物が無い部屋。** 個人戦は全員同じ色 */
  test('陣営で分かれない部屋では何もしない', () => {
    const match = room('DM')
    for (const id of ['a', 'b', 'c', 'd']) join(match, id)
    shuffleTeams(match, rolls(0.9))
    expect(teamsOf(match).every((t) => t === 'blue')).toBe(true)
  })

  test('目が違えば分かれ方も変わりうる', () => {
    const seen = new Set<string>()
    for (const roll of [0.0, 0.25, 0.5, 0.75, 0.99]) {
      const match = room('TDM')
      for (const id of ['a', 'b', 'c', 'd']) join(match, id)
      shuffleTeams(match, rolls(roll))
      seen.add(teamsOf(match).join(''))
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
