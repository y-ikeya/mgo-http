import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, spawnAlive, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'
import { STAGES } from '../src/domain/stage'
import { ROOMS } from '../src/domain/match/room'

/**
 * 撃ち返す的 (練習部屋、ステージの的の表で fires を付けた物)。
 *
 * 見たいのは 2 つ: **正面に立てば撃ってきて削られる**、**背後に立てば気づかない**。
 * 当たりの割合は domain/rule/botGun.test.ts が見る。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

const STAGE = STAGES[ROOMS.golf.stages.stages[0]]
// 立ったままの撃ち返す的 (lean の的は狙撃銃で、角から出入りしながら撃つので弾の数が揃わない)
const INDEX = STAGE.targets.findIndex((t) => t.fires && !t.stance)
const SHOOTER = STAGE.targets[INDEX]
const ID = `target-${INDEX}`

/** 的から distance (m) の所。toward が true なら青の基地の側 (的が向いている側)、false なら反対 (背後) */
function spot(distance: number, toward: boolean): [number, number, number] {
  const base = STAGE.bases.blue
  const dx = base.x - SHOOTER.x
  const dz = base.z - SHOOTER.z
  const length = Math.hypot(dx, dz)
  const sign = toward ? 1 : -1
  return [SHOOTER.x + (dx / length) * distance * sign, 0, SHOOTER.z + (dz / length) * distance * sign]
}

async function enter(id: string, at: [number, number, number]): Promise<Client> {
  const client = new Client(server, id, at, 'golf')
  await client.ready()
  client.live()
  await spawnAlive(client)
  return client
}

/** 弾の線 (from → to、平面) と点の近さ (m) */
function passDistance(from: number[], to: number[], at: [number, number, number]): number {
  const dx = to[0]! - from[0]!
  const dz = to[2]! - from[2]!
  const length = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((at[0] - from[0]!) * dx + (at[2] - from[2]!) * dz) / length))
  return Math.hypot(from[0]! + dx * t - at[0], from[2]! + dz * t - at[2])
}
/**
 * 的が自分へ撃った弾の数。**弾の線が自分の 3m 以内を通る物だけ** — 前の試験の人を撃った曳光も見えて届く。
 * 着弾点で見ていた頃は、外れた弾が後ろの 15m 先の壁に落ちて数えられず、3 発そろう前に撃ち殺されて落ちた
 */
const shotsAt = (client: Client, at: [number, number, number]) =>
  client.messages.filter((m) => m.type === 'shot' && m.id === ID && passDistance(m.from, m.to, at) < 3).length
const hurt = (client: Client) =>
  client.messages.some((m): m is Extract<ServerMessage, { type: 'health' }> => m.type === 'health' && m.id === client.id && (m.health ?? 100) < 100)

describe('撃ち返す的', () => {
  test('ステージの表に撃ち返す的がある', () => {
    expect(INDEX).toBeGreaterThanOrEqual(0)
  })

  test('正面 10m に立てば撃ってきて削られる', async () => {
    const at = spot(10, true)
    const me = await enter('facing', at)
    // 1 発で見る。頭に 2 発当たれば倒れて、倒れた人にはもう撃たない (3 発待っていた頃に落ちた)
    await waitFor(() => shotsAt(me, at) >= 1, '的の射撃', 8000)
    await waitFor(() => hurt(me), '撃たれて削られる', 8000)
    me.close()
  }, 30000)

  test('背後 10m に立てば気づかない', async () => {
    const at = spot(10, false)
    const me = await enter('behind', at)
    await Bun.sleep(2500)
    expect(shotsAt(me, at)).toBe(0)
    expect(hurt(me)).toBe(false)
    me.close()
  }, 30000)
})
