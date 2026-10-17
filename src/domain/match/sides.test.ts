import { describe, expect, test } from 'bun:test'
import { newMatch, type Match } from './match'
import { newMatchPlayer, type MatchPlayer, type Team } from '../player/player'
import {
  STEALTH_BREAK_MS, canRespawn, disturbStealth, isOut, isStealthed, sideOf, standing, stealthActive, swapSides,
} from './sides'
import { livesOf, primariesOf, secondariesOf, supportsOf } from './room'
import { isTranquilizer } from '../item/weapons'
import { advanceLife } from '../player/lifecycle'

function tsne(): Match {
  const match = newMatch('TSNE')
  match.phase = 'playing'
  return match
}

function seat(match: Match, id: string, team: Team): MatchPlayer {
  const player = newMatchPlayer({ id, name: id, team, slot: match.players.size, now: 0 })
  player.life = 'alive'
  match.players.set(id, player)
  return player
}

describe('攻守', () => {
  test('攻める色の側が attack。**試合ごとに入れ替わる**', () => {
    const match = tsne()
    expect(sideOf(match, 'blue')).toBe('attack')
    expect(sideOf(match, 'red')).toBe('defence')
    swapSides(match)
    expect(sideOf(match, 'blue')).toBe('defence')
    expect(sideOf(match, 'red')).toBe('attack')
  })

  test('分かれない部屋では側が無い', () => {
    expect(sideOf(newMatch('TDM'), 'blue')).toBeNull()
  })
})

describe('持ち込める物 (charlie)', () => {
  test('攻める側は非殺傷の銃と M9、デコイとロケーター', () => {
    expect(primariesOf('charlie', 'attack').every(isTranquilizer)).toBe(true)
    expect(primariesOf('charlie', 'attack').length).toBeGreaterThan(0)
    expect(secondariesOf('charlie', 'attack')).toEqual(['m9'])
    expect([...supportsOf('charlie', 'attack')].sort()).toEqual(['decoy', 'locator'])
  })

  test('守る側は殺傷の銃と M1911、手榴弾とクレイモア', () => {
    expect(primariesOf('charlie', 'defence').some(isTranquilizer)).toBe(false)
    expect(secondariesOf('charlie', 'defence')).toEqual(['m1911'])
    expect([...supportsOf('charlie', 'defence')].sort()).toEqual(['claymore', 'grenade'])
  })

  test('復活は 0 回。他の部屋は何度でも', () => {
    expect(livesOf('charlie')).toBe(0)
    expect(livesOf('bravo')).toBeNull()
  })
})

describe('復活', () => {
  test('倒れた回数が復活の回数を超えたら終わり', () => {
    const player = newMatchPlayer({ id: 'a', name: 'a', team: 'blue', slot: 0, now: 0 })
    expect(canRespawn(player, 0)).toBe(true)
    player.deaths = 1
    expect(canRespawn(player, 0)).toBe(false)
    expect(canRespawn(player, 1)).toBe(true)
    expect(canRespawn(player, null)).toBe(true)
  })

  test('**復活できない人は倒れたまま** (支度へ移らない)', () => {
    expect(advanceLife('downed', 60_000, false)).toBeNull()
    expect(advanceLife('downed', 6_000, true)).toEqual({ kind: 'life', to: 'choosing' })
  })
})

describe('決着の数え方', () => {
  test('眠っている人も、倒れて復活できない人も「もう戦えない」', () => {
    const match = tsne()
    const a = seat(match, 'a', 'blue')
    const b = seat(match, 'b', 'blue')
    seat(match, 'c', 'red')
    a.sleepUntil = 10_000
    b.life = 'downed'
    b.deaths = 1
    expect(isOut(a, 0, 5_000)).toBe(true)
    expect(isOut(b, 0, 5_000)).toBe(true)
    const seats = [...match.players.values()]
    expect(standing(seats, 'blue', 0, 5_000)).toBe(0)
    expect(standing(seats, 'red', 0, 5_000)).toBe(1)
  })

  test('倒れたが復活を待っている人はまだ戦える', () => {
    const match = tsne()
    const a = seat(match, 'a', 'blue')
    a.life = 'downed'
    a.deaths = 1
    expect(isOut(a, 1, 0)).toBe(false)
  })

  test('目が覚めたら数に戻る', () => {
    const match = tsne()
    const a = seat(match, 'a', 'blue')
    a.sleepUntil = 10_000
    expect(isOut(a, 0, 10_001)).toBe(false)
  })
})

describe('ステルス', () => {
  test('攻める側だけ。**待機中も効く** (1 人で着て確かめられる)', () => {
    const match = tsne()
    const attacker = seat(match, 'a', 'blue')
    const defender = seat(match, 'd', 'red')
    expect(isStealthed(match, attacker, 0)).toBe(true)
    expect(isStealthed(match, defender, 0)).toBe(false)
    match.phase = 'waiting'
    expect(isStealthed(match, attacker, 0)).toBe(true)
  })

  test('分かれない部屋では効かない', () => {
    const match = newMatch('TDM')
    const player = seat(match, 'a', 'blue')
    expect(isStealthed(match, player, 0)).toBe(false)
  })

  test('**攻める側の誰かに敵の攻撃が当たったら、攻める側全員が 5 秒解ける**', () => {
    const match = tsne()
    const a = seat(match, 'a', 'blue')
    const b = seat(match, 'b', 'blue')
    const d = seat(match, 'd', 'red')
    disturbStealth(match, a, d, 1_000)
    expect(isStealthed(match, a, 1_000)).toBe(false)
    expect(isStealthed(match, b, 1_000)).toBe(false)
    expect(isStealthed(match, b, 1_000 + STEALTH_BREAK_MS)).toBe(true)
  })

  test('解けている間に当たったら、そこから数え直す', () => {
    const match = tsne()
    const a = seat(match, 'a', 'blue')
    const d = seat(match, 'd', 'red')
    disturbStealth(match, a, d, 1_000)
    disturbStealth(match, a, d, 4_000)
    expect(stealthActive(match, 1_000 + STEALTH_BREAK_MS)).toBe(false)
    expect(stealthActive(match, 4_000 + STEALTH_BREAK_MS)).toBe(true)
  })

  test('味方の攻撃・守る側への攻撃では解けない', () => {
    const match = tsne()
    const a = seat(match, 'a', 'blue')
    const b = seat(match, 'b', 'blue')
    const d = seat(match, 'd', 'red')
    disturbStealth(match, a, b, 1_000)
    disturbStealth(match, d, a, 1_000)
    disturbStealth(match, a, null, 1_000)
    expect(stealthActive(match, 1_000)).toBe(true)
  })
})
