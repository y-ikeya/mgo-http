import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, spawnAlive, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'
import { STAGES } from '../src/domain/stage'

/**
 * **吹き飛ばされた的は壁で止まる** (本人 2026-11-03「wall 近くにおいた敵を吹っ飛ばすと壁の中に埋もれる」
 * 「foxtrot の target7 とかね」)。的はサーバーが滑らせるので、地形を読んだサーバーで見る
 */
let server: Server

beforeAll(async () => {
  server = await startServer({ MGO2_LOCAL_ROOMS: '1', MGO2_NO_STAGE: '0' })
})

afterAll(() => server.stop())

test('**背中が窓の壁の的を正面から散弾で飛ばしても、壁の手前で止まる**', async () => {
  // TARGET 7 (target-6)。窓の壁 (z = -10) の手前に背中を付けて立つ
  const spot = STAGES.lab.targets[6]
  const me = new Client(server, 'wall-sg', [spot.x, 0.1, spot.z + 3], 'foxtrot')
  await me.ready()
  me.live()
  me.send({ type: 'loadout', primary: 'shotgun', support: 'grenade' })
  me.claimedWeapon = 'shotgun'
  await spawnAlive(me)
  await waitFor(() => {
    const r = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }> | undefined
    return !!r?.players.some((p) => p.id === 'target-6')
  }, '的が名簿に居る')

  const roster = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
  const target = roster.players.find((p) => p.id === 'target-6')!
  me.send({ type: 'damage', id: me.id, target: target.id, kind: 'bullet', zone: 'BODY', distance: 3 })
  await Bun.sleep(600)

  /*
   * 届いている姿を一度捨てて、滑り終わった後の姿を取り直す。**壁に埋まった的は見えなくなって
   * 配られない** — 捨てずに見ると、埋まる前に届いた最後の姿 (壁の手前) で通ってしまう
   */
  me.poses.delete(target.slot!)
  await Bun.sleep(500)
  const after = me.poses.get(target.slot!)
  expect(after).toBeDefined()
  expect(after!.locomotion).toBe('shotgun_sweep')
  // 壁の面 (z = -10 の手前の面) より内側。体の半径ぶん手前で止まる
  expect(after!.z).toBeGreaterThan(-10)
  me.close()
}, 30000)
