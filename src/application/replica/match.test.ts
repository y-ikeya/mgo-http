import { describe, expect, test } from 'bun:test'
import { applyMatch, newMatchReplica } from './match'
import { KILL_POINTS, DEATH_POINTS, SUICIDE_POINTS } from '../../domain/match/scoring'
import type { MatchMessage, ServerMessage } from '../protocol/types'

/**
 * **レプリカは GL 無しで試せる。**
 *
 * ここは長いあいだ Game.ts の receive() の中にあり、three のオブジェクトを直に
 * 触っていたので、218 秒かかる統合試験でしか触れなかった。レプリカに出したので
 * 「報せを入れて、状態を見る」で済む。
 */
const SELF = 'alice'

function matchMessage(over: Partial<MatchMessage> = {}): ServerMessage {
  return {
    type: 'match',
    mode: 'TDM',
    phase: 'playing',
    tickets: { blue: 20, red: 20 },
    scores: [],
    ...over,
  } as ServerMessage
}


/**
 * 眠らせた知らせ。**色は送られてきた陣営で出す。**
 *
 * 見ている本人の陣営で代用していた頃は、青の人が眠らせても赤い名前で出て
 * いた。誰が誰を、は色でも読ませている。
 */
describe('眠らせた知らせ', () => {
  test('**両方の陣営が届いたまま**キルログに並ぶ', () => {
    const replica = newMatchReplica()
    replica.team = 'red'
    applyMatch(
      replica,
      {
        type: 'stun',
        by: 'blueman',
        byName: 'pepa',
        byTeam: 'blue',
        target: 'redman',
        targetName: 'nanashi',
        targetTeam: 'red',
        weapon: 'MOSIN',
        head: true,
      },
      'someone',
      0,
    )
    const line = replica.killFeed[0]
    expect(line.event.killerTeam).toBe('blue')
    expect(line.event.victimTeam).toBe('red')
    // 使った物も決め打ちにしない。麻酔銃は 2 挺ある
    expect(line.event.weapon).toBe('MOSIN')
    expect(line.stun).toBe(true)
  })
})

describe('試合のレプリカ', () => {
  test('ルールは入った時点では分からない。**最初の報せで決まる**', () => {
    const replica = newMatchReplica()
    applyMatch(replica, matchMessage({ mode: 'DM' }), SELF, 0)
    expect(replica.mode).toBe('DM')
  })

  test('段階が変わったときだけ知らせる。毎秒届くが、毎秒畳まれては困る', () => {
    const replica = newMatchReplica()
    const first = applyMatch(replica, matchMessage(), SELF, 0)
    const again = applyMatch(replica, matchMessage(), SELF, 1000)
    expect(first).toEqual([{ kind: 'phase', to: 'playing', teams: true }])
    expect(again).toEqual([])
  })

  test('**陣営が無い部屋には基地も無い。** 段階の知らせに乗せて渡す', () => {
    const replica = newMatchReplica()
    const [effect] = applyMatch(replica, matchMessage({ mode: 'DM' }), SELF, 0)
    expect(effect).toEqual({ kind: 'phase', to: 'playing', teams: false })
  })

  test('1 位が自分なら光る。他人なら光らない', () => {
    const replica = newMatchReplica()
    applyMatch(replica, matchMessage({ leader: SELF }), SELF, 0)
    expect(replica.leaking).toBe(true)
    applyMatch(replica, matchMessage({ leader: 'bob', phase: 'over' }), SELF, 0)
    expect(replica.leaking).toBe(false)
  })

  test('所属は名簿で決まる。**湧き地点がこれで決まる**ので知らせる', () => {
    const replica = newMatchReplica()
    const effects = applyMatch(
      replica,
      { type: 'roster', players: [{ id: SELF, name: 'A', health: 100, team: 'red', slot: 0 }] } as ServerMessage,
      SELF,
      0,
    )
    expect(replica.team).toBe('red')
    expect(effects).toEqual([{ kind: 'team', team: 'red' }])
  })

  test('自分が居ない名簿では何も起きない', () => {
    const replica = newMatchReplica()
    const effects = applyMatch(
      replica,
      { type: 'roster', players: [{ id: 'bob', name: 'B', health: 100, team: 'red', slot: 1 }] } as ServerMessage,
      SELF,
      0,
    )
    expect(effects).toEqual([])
    expect(replica.team).toBe('blue')
  })
})

/** キルログと点。**自分が絡んだものだけ点になる** */
describe('キル', () => {
  const kill = (killer: string, victim: string): ServerMessage =>
    ({
      type: 'kill',
      killer,
      killerName: killer,
      killerTeam: 'blue',
      victim,
      victimName: victim,
      victimTeam: 'red',
      weapon: 'AK47',
      headshot: false,
    }) as ServerMessage

  test('他人同士のキルもログには残る。点は動かない', () => {
    const replica = newMatchReplica()
    applyMatch(replica, kill('bob', 'carol'), SELF, 100)
    expect(replica.killFeed).toHaveLength(1)
    expect(replica.pointFeed).toEqual([])
  })

  test('頭に入れて倒したら音で報いる。**自分の弾のときだけ**', () => {
    const replica = newMatchReplica()
    const hs = (killer: string, victim: string) =>
      ({ ...(kill(killer, victim) as object), headshot: true }) as ServerMessage
    expect(applyMatch(replica, hs(SELF, 'bob'), SELF, 100)).toEqual([{ kind: 'headshot' }])
    expect(applyMatch(replica, hs('bob', 'carol'), SELF, 100)).toEqual([])
    expect(applyMatch(replica, hs('bob', SELF), SELF, 100)).toEqual([])
    expect(applyMatch(replica, kill(SELF, 'bob'), SELF, 100)).toEqual([])
  })

  test('頭に入れて眠らせたときも同じ音', () => {
    const replica = newMatchReplica()
    const stun = (by: string, head: boolean) =>
      ({
        type: 'stun',
        by,
        byName: by,
        byTeam: 'blue',
        target: 'bob',
        targetName: 'bob',
        targetTeam: 'red',
        weapon: 'MOSIN',
        head,
      }) as ServerMessage
    expect(applyMatch(replica, stun(SELF, true), SELF, 100)).toEqual([{ kind: 'headshot' }])
    expect(applyMatch(replica, stun(SELF, false), SELF, 100)).toEqual([])
    expect(applyMatch(replica, stun('carol', true), SELF, 100)).toEqual([])
  })

  test('倒せば加点、倒されれば減点', () => {
    const replica = newMatchReplica()
    applyMatch(replica, kill(SELF, 'bob'), SELF, 100)
    applyMatch(replica, kill('bob', SELF), SELF, 200)
    expect(replica.pointFeed.map((p) => p.delta)).toEqual([DEATH_POINTS, KILL_POINTS])
    expect(replica.pointFeed[0].label).toBe('DEATH')
  })

  test('**自爆は自爆として数える。** 倒したことにはしない', () => {
    const replica = newMatchReplica()
    applyMatch(replica, kill(SELF, SELF), SELF, 100)
    expect(replica.pointFeed[0]).toMatchObject({ label: 'SUICIDE', delta: SUICIDE_POINTS })
  })

  test('倒された相手を覚える。**自爆なら映すものが無い**ので空', () => {
    const replica = newMatchReplica()
    applyMatch(replica, kill('bob', SELF), SELF, 100)
    expect(replica.killedBy).toBe('bob')
    applyMatch(replica, kill(SELF, SELF), SELF, 200)
    expect(replica.killedBy).toBe('')
  })

  test('ログは古いものから落ちる', () => {
    const replica = newMatchReplica()
    for (let i = 0; i < 8; i++) applyMatch(replica, kill('bob', `v${i}`), SELF, i)
    expect(replica.killFeed).toHaveLength(5)
    // 新しいものが先頭
    expect(replica.killFeed[0].event.victim).toBe('v7')
  })
})
