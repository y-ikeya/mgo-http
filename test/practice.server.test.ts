import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'
import type { ServerMessage } from '../src/net/types'

/**
 * 練習部屋 (echo)。
 *
 * 見たいのは 3 つ: **1 人で入れること**、的が並んでいること、倒すと戻ること。
 * どれもサーバーだけで決まる話なので、画面を出さずに確かめられる。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

/** 的の位置。server/index.ts の TARGET_SPOTS と揃えてある */
const NEAR = { x: -30, z: 12 }

async function enterPractice(id: string): Promise<Client> {
  const client = new Client(server, id, [NEAR.x, 0, NEAR.z + 3], 'echo')
  await client.ready()
  client.live()
  return client
}

describe('練習部屋', () => {
  test('1 人で入っても試合が始まっている', async () => {
    const solo = await enterPractice('solo')
    await Bun.sleep(600)
    const match = solo.last.get('match') as Extract<ServerMessage, { type: 'match' }>
    expect(match?.phase).toBe('playing')
    solo.close()
  })

  test('的が 5 体、赤で並んでいる', async () => {
    const solo = await enterPractice('watcher')
    await Bun.sleep(400)
    const roster = solo.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const targets = roster.players.filter((p) => p.id.startsWith('target-'))
    expect(targets.length).toBe(5)
    expect(targets.every((t) => t.team === 'red')).toBe(true)
    solo.close()
  })

  test('倒すと数秒で戻ってくる', async () => {
    const shooter = await enterPractice('shooter')
    // 支度に入ってから 3 秒 (CHOOSE_FLOOR) 待たないと湧けない。
    // **選ぶのが速いことは腕前ではない**、という規則がここにも効く
    await Bun.sleep(3400)
    shooter.send({ type: 'spawn' })
    await Bun.sleep(400)

    // **頭に当てたと申告する。** 位置は的のすぐ手前なので、遮蔽も距離も通る
    shooter.send({
      type: 'damage',
      id: 'shooter',
      target: 'target-0',
      kind: 'bullet',
      zone: 'HEAD',
      distance: 3,
    })
    await Bun.sleep(300)

    // **的の id で見る。** 種類だけで数えると、撃った本人の湧きを数えてしまう
    const downed = shooter.messages.some(
      (m) => m.type === 'life' && m.id === 'target-0' && m.state === 'downed',
    )
    expect(downed).toBe(true)

    // 戻るまで待つ (3 秒 + 余白)
    await Bun.sleep(3600)
    const revived = shooter.messages.some(
      (m) => m.type === 'life' && m.id === 'target-0' && m.state === 'alive',
    )
    expect(revived).toBe(true)
    const healed = shooter.messages.some(
      (m) => m.type === 'health' && m.id === 'target-0' && m.health === 100,
    )
    expect(healed).toBe(true)
    shooter.close()
  }, 20000)
})
