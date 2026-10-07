import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'
import { STAGES } from '../src/domain/stage'
import { ROOMS } from '../src/domain/match/room'
import { STUN_CHARGE_SECONDS } from '../src/domain/rule/damage'

/**
 * スタンナイフ。**眠らせる刺突は 1 回で眠る。充電が満ちるまで次は効かない。**
 *
 * 練習部屋の的 2 体で見る (1 体目を眠らせた直後に 2 体目を刺す)。
 */
let server: Server
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server.stop())

const [FIRST, SECOND] = STAGES[ROOMS.echo.stages.stages[0]].targets

function targets(me: Client): { id: string; slot: number }[] {
  const roster = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
  return roster.players
    .filter((p) => p.id.startsWith('target') && p.slot !== undefined)
    .map((p) => ({ id: p.id, slot: p.slot! }))
}

function stab(me: Client, target: { id: string }, stun: boolean) {
  me.send({ type: 'damage', id: me.id, target: target.id, kind: 'melee', ...(stun ? { stun: true } : {}) })
}

test('眠らせる刺突は 1 回で眠り、充電が満ちるまで次は効かない', async () => {
  // 1 体目の正面 1m に立つ (的は +z を向いている)
  const me = new Client(server, 'stun1', [FIRST!.x, 0, FIRST!.z + 1], 'echo')
  await me.ready()
  me.live()
  await Bun.sleep(3400)
  me.send({ type: 'spawn' })
  await Bun.sleep(3600)
  const [first, second] = targets(me)

  stab(me, first!, true)
  await Bun.sleep(400)
  expect(me.poses.get(first!.slot)?.locomotion).toBe('sleep')

  // 2 体目の正面へ歩いて行き、すぐに眠らせる刺突。充電が空なので効かない
  await me.walkTo(SECOND!.x, 0, SECOND!.z + 1)
  await Bun.sleep(300)
  stab(me, second!, true)
  await Bun.sleep(400)
  expect(me.poses.get(second!.slot)?.locomotion).not.toBe('sleep')

  // 満ちるまで待てば、同じ所からの同じ刺突が効く (届いていなかったのではない)
  await Bun.sleep(STUN_CHARGE_SECONDS * 1000)
  stab(me, second!, true)
  await Bun.sleep(400)
  expect(me.poses.get(second!.slot)?.locomotion).toBe('sleep')
  me.close()
}, 45_000)
