import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'
import { STAGES } from '../src/domain/stage'
import { ROOMS } from '../src/domain/match/room'
import { WEAPONS } from '../src/domain/item/weapons'

/**
 * 麻酔銃。**当てても死なず、削り切ると眠る。**
 *
 * 練習部屋の的で見る。的はサーバーが姿勢まで決めているので、**眠った姿が
 * 他人にどう見えるか**までここで確かめられる (人だと画面が要る)。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

const TARGET = STAGES[ROOMS.echo.stages.stages[0]].targets[0]

async function shooter(id: string): Promise<Client> {
  const me = new Client(server, id, [TARGET.x, 0, TARGET.z + 3], 'echo')
  await me.ready()
  me.live()
  // **湧く前に選ぶ。** 走っている試合では持ち替えられない (domain/player/equip.ts)
  me.send({ type: 'loadout', primary: 'rifle', secondary: 'm9', support: 'grenade' })
  await Bun.sleep(3400)
  // **麻酔銃を持っていると名乗る。** 名乗った銃でサーバーが効き目を決める
  me.claimedWeapon = 'm9'
  me.send({ type: 'spawn' })
  await Bun.sleep(600)
  return me
}

function firstTarget(me: Client): { id: string; slot: number } {
  const roster = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
  const found = roster?.players.find((p) => p.id.startsWith('target'))
  if (!found || found.slot === undefined) throw new Error('的が名簿に居ない')
  return { id: found.id, slot: found.slot }
}

function shoot(me: Client, target: { id: string }, zone: 'HEAD' | 'BODY') {
  me.send({ type: 'damage', id: me.id, target: target.id, kind: 'bullet', zone, distance: 3 })
}

describe('麻酔銃を的に当てる', () => {
  test('**胴 4 発で眠る。** 3 発では眠らない', async () => {
    const me = await shooter('tranq1')
    const target = firstTarget(me)

    for (let n = 0; n < 3; n++) {
      shoot(me, target, 'BODY')
      await Bun.sleep(320)
    }
    expect(me.poses.get(target.slot)?.locomotion).toBe('idle')

    shoot(me, target, 'BODY')
    await Bun.sleep(400)
    expect(me.poses.get(target.slot)?.locomotion).toBe('sleep')
    me.close()
  }, 20_000)

  test('**頭は 1 発。** 削る量は武器の zone がそのまま効く', async () => {
    const me = await shooter('tranq2')
    const target = firstTarget(me)
    expect(WEAPONS.m9.zone.HEAD).toBe(100)

    shoot(me, target, 'HEAD')
    await Bun.sleep(400)
    expect(me.poses.get(target.slot)?.locomotion).toBe('sleep')
    me.close()
  }, 20_000)

  test('**倒れない。** 麻酔は体力を削らないので的は生きている', async () => {
    const me = await shooter('tranq3')
    const target = firstTarget(me)

    for (let n = 0; n < 6; n++) {
      shoot(me, target, 'BODY')
      await Bun.sleep(320)
    }
    // 倒れたなら death_front / death_back になる
    expect(me.poses.get(target.slot)?.locomotion).toBe('sleep')
    me.close()
  }, 20_000)
})
