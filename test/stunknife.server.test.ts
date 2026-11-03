import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, spawnAlive, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'
import { STAGES } from '../src/domain/stage'
import { ROOMS } from '../src/domain/match/room'
import { stunChargeSeconds } from '../src/domain/player/skill'
import { SLEEP_KNEEL_SECONDS } from '../src/domain/player/stance'

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

const [FIRST, SECOND] = STAGES[ROOMS.golf.stages.stages[0]].targets

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
  const me = new Client(server, 'stun1', [FIRST!.x, 0, FIRST!.z + 1], 'golf')
  await me.ready()
  me.live()
  await spawnAlive(me)
  await waitFor(() => me.last.has('roster') && targets(me).length >= 2, '的が名簿に揃う')
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
  await Bun.sleep(stunChargeSeconds({}) * 1000)
  stab(me, second!, true)
  await Bun.sleep(400)
  expect(me.poses.get(second!.slot)?.locomotion).toBe('sleep')
  me.close()
}, 50_000)

test('眠っている的は、しゃがんで見下ろさないと刺せない', async () => {
  const me = new Client(server, 'stun2', [SECOND!.x, 0, SECOND!.z + 1], 'golf')
  await me.ready()
  me.live()
  await spawnAlive(me)
  await waitFor(() => me.last.has('roster') && targets(me).length >= 2, '的が名簿に揃う')
  const target = targets(me)[1]!
  // 先の試験が眠らせていなければ眠らせる (起きるのは 30 秒後)
  stab(me, target, true)
  await Bun.sleep(400)
  expect(me.poses.get(target.slot)?.locomotion).toBe('sleep')
  /*
   * **倒れ切るまで待つ。** 眠った直後はまだ立った/屈んだ高さとして扱われ
   * (stance.ts の stanceAt、SLEEP_KNEEL_SECONDS まで)、その間は真っ直ぐ
   * 前の刺突も届いてしまう — 「届かない」を見るのは倒れ切ってから。
   * 前は開始手順の眠り (7 秒) が偶然これを兼ねていた
   */
  await Bun.sleep(SLEEP_KNEEL_SECONDS * 1000 + 400)

  // 真っ直ぐ前を見たまま殺す刺突。寝ている体には届かない
  me.pitch = 0
  await Bun.sleep(200)
  stab(me, target, false)
  await Bun.sleep(400)
  expect(me.poses.get(target.slot)?.locomotion).toBe('sleep')

  // 立ったまま見下ろしても届かない (腕は床まで届かない)
  me.pitch = -0.6
  await Bun.sleep(200)
  stab(me, target, false)
  await Bun.sleep(400)
  expect(me.poses.get(target.slot)?.locomotion).toBe('sleep')

  // しゃがんで見下ろせば刺さる
  me.pose = 'crouch_idle'
  await Bun.sleep(700)
  stab(me, target, false)
  await Bun.sleep(400)
  expect(me.poses.get(target.slot)?.locomotion).toMatch(/^death/)
  me.close()
}, 30_000)
