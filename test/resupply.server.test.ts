import { afterEach, describe, expect, test } from 'bun:test'
import { Client, spawnAlive, startServer, twoPlayers, type Server } from './server'
import { STAGES } from '../src/domain/stage'
import { RESUPPLY_COOLDOWN_MS, RESUPPLY_RADIUS } from '../src/domain/rule/resupply'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * 補給。**自分の基地の上でだけ、弾と支援が満タンに戻る。**
 *
 * 部屋は bravo (商店街、陣営あり)。基地は STAGES.mm.bases。
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

describe('補給', () => {
  test('基地の上で頼めば通り、予備で弾の総数が満タンに戻る (弾倉はそのまま)', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'grenade', ['rs-a1', 'rs-b1'])
    const roster = a.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const team = roster.players.find((p) => p.id === a.id)!.team
    const base = STAGES.mm.bases[team]

    // 1 発撃って弾を減らす
    a.send({ type: 'shot', id: a.id, from: [0, 1.4, -6], to: [0, 1.4, 6] })
    await Bun.sleep(200)

    // 基地の上へ歩いて行く (1 通で跳ぶと弾かれる)。位置が届いてから頼む
    await a.walkTo(base.x, base.y ?? 0, base.z)
    await Bun.sleep(300)
    a.reset()
    a.send({ type: 'resupply' })
    await Bun.sleep(300)

    expect(a.got('resupplied')).toBe(1)
    const self = a.messages.find((m) => m.type === 'self') as Extract<ServerMessage, { type: 'self' }> | undefined
    expect(self).toBeDefined()
    // 主武器 (rifle) の弾倉は撃った後のまま (29)、予備が 1 発ぶん増えて総数は満タン (30 + 90)。
    // 弾倉を替えるのは本人のリロード
    expect(self!.magazine.rifle).toBe(29)
    expect(self!.reserve.rifle).toBe(91)
    expect(self!.grenades).toBe(3)
    void b
  }, 30000)

  test('基地から離れていれば通らない', async () => {
    server = await startServer()
    const { a } = await twoPlayers(server, 'grenade', ['rs-a2', 'rs-b2'])
    const roster = a.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const team = roster.players.find((p) => p.id === a.id)!.team
    const base = STAGES.mm.bases[team]

    await a.walkTo(base.x + RESUPPLY_RADIUS + 2, base.y ?? 0, base.z)
    await Bun.sleep(300)
    a.reset()
    a.send({ type: 'resupply' })
    await Bun.sleep(300)

    expect(a.got('resupplied')).toBe(0)
  }, 30000)

  /**
   * **個人戦はどの基地でも補給できるが、同じ基地では続けて補給できない** (2026-11-19 本人)。
   * 部屋は alpha (個人戦、MM)
   */
  test('個人戦はどの基地でも補給でき、同じ基地は続けて使えない', async () => {
    server = await startServer()
    const { blue, red } = STAGES.mm.bases
    const a = await new Client(server, 'rs-dm1', [blue.x, blue.y ?? 0, blue.z], 'alpha').ready()
    a.live()
    await spawnAlive(a)
    await a.walkTo(blue.x, blue.y ?? 0, blue.z)
    await Bun.sleep(300)
    a.send({ type: 'resupply' })
    await Bun.sleep(300)
    expect(a.got('resupplied')).toBe(1)

    // 間隔を空けても同じ基地では通らない
    await Bun.sleep(RESUPPLY_COOLDOWN_MS)
    a.send({ type: 'resupply' })
    await Bun.sleep(300)
    expect(a.got('resupplied')).toBe(1)

    // 別の基地なら通る
    await a.walkTo(red.x, red.y ?? 0, red.z)
    await Bun.sleep(300)
    a.send({ type: 'resupply' })
    await Bun.sleep(300)
    expect(a.got('resupplied')).toBe(2)
  }, 60000)
})
