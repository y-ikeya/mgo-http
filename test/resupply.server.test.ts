import { afterEach, describe, expect, test } from 'bun:test'
import { startServer, twoPlayers, type Server } from './server'
import { STAGES } from '../src/domain/stage'
import { RESUPPLY_RADIUS } from '../src/domain/rule/resupply'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * 補給。**自分の基地の上でだけ、弾と支援が満タンに戻る。**
 *
 * 部屋は bravo (商店街、陣営あり)。基地は STAGES.city.bases。
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

describe('補給', () => {
  test('基地の上で頼めば通り、弾倉が満タンに戻る', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'grenade', ['rs-a1', 'rs-b1'])
    const roster = a.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const team = roster.players.find((p) => p.id === a.id)!.team
    const base = STAGES.city.bases[team]

    // 1 発撃って弾を減らす
    a.send({ type: 'shot', id: a.id, from: [0, 1.4, -6], to: [0, 1.4, 6] })
    await Bun.sleep(200)

    // 基地の上へ。位置が届いてから頼む
    a.moveTo(base.x, base.y ?? 0, base.z)
    await Bun.sleep(300)
    a.reset()
    a.send({ type: 'resupply' })
    await Bun.sleep(300)

    expect(a.got('resupplied')).toBe(1)
    const self = a.messages.find((m) => m.type === 'self') as Extract<ServerMessage, { type: 'self' }> | undefined
    expect(self).toBeDefined()
    // 主武器 (rifle) の弾倉が満タン (30)
    expect(self!.magazine.rifle).toBe(30)
    expect(self!.grenades).toBe(3)
    void b
  }, 30000)

  test('基地から離れていれば通らない', async () => {
    server = await startServer()
    const { a } = await twoPlayers(server, 'grenade', ['rs-a2', 'rs-b2'])
    const roster = a.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const team = roster.players.find((p) => p.id === a.id)!.team
    const base = STAGES.city.bases[team]

    a.moveTo(base.x + RESUPPLY_RADIUS + 2, base.y ?? 0, base.z)
    await Bun.sleep(300)
    a.reset()
    a.send({ type: 'resupply' })
    await Bun.sleep(300)

    expect(a.got('resupplied')).toBe(0)
  }, 30000)
})
