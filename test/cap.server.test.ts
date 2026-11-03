import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { beginMatch, Client, spawnAlive, spot, startServer, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * キャプチャー (echo、CAP)。
 *
 * 試験のサーバーは地形なしで立つ (MGO2_NO_STAGE) ので、target と設置ポイントは置かれない。
 * 運んで数える決まりは domain/match/capture.test.ts で見る。ここで見るのは部屋の側 —
 * カウントが配られること、倒しても残機が減らないこと、倒されるたびに倒れたままの時間が延びること
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

const match = (client: Client) =>
  [...client.messages].reverse().find((m) => m.type === 'match') as
    | Extract<ServerMessage, { type: 'match' }>
    | undefined

/** その人が倒れた知らせ (新しい順) */
const downs = (client: Client, id: string) =>
  client.messages.filter(
    (m): m is Extract<ServerMessage, { type: 'life' }> => m.type === 'life' && m.id === id && m.state === 'downed',
  )

async function twoInCap(): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server, 'cap-a', spot(0, -6), 'echo').ready()
  const b = await new Client(server, 'cap-b', spot(0, 6), 'echo').ready()
  a.live()
  b.live()
  await beginMatch(a, b)
  return { a, b }
}

describe('CAP', () => {
  test('**カウントが 60 秒ずつ配られ、倒しても残機は減らない。倒されるたびに倒れたままの時間が延びる**', async () => {
    const { a, b } = await twoInCap()
    expect(match(a)?.mode).toBe('CAP')
    expect(match(a)?.phase).toBe('playing')
    expect(match(a)?.capture).toEqual({ blue: 60, red: 60, suddenDeath: false, holding: null })
    const tickets = { blue: match(a)?.blue, red: match(a)?.red }

    // 1 回目: 5 秒
    for (let i = 0; i < 6 && downs(a, 'cap-a').length === 0; i++) {
      b.send({ type: 'damage', id: 'cap-b', target: 'cap-a', kind: 'bullet', zone: 'HEAD', distance: 12 })
      await Bun.sleep(300)
    }
    expect(downs(a, 'cap-a')[0]?.downFor).toBe(5)
    await Bun.sleep(1200)
    expect({ blue: match(a)?.blue, red: match(a)?.red }).toEqual(tickets)

    // 倒れたまま 5 秒 → 支度 → 出て alive に戻る (床と無敵は試験では 0。
    // 長さそのものは domain と test/spawntiming が見る)
    await spawnAlive(a)

    // 2 回目: 8 秒
    for (let i = 0; i < 6 && downs(a, 'cap-a').length < 2; i++) {
      b.send({ type: 'damage', id: 'cap-b', target: 'cap-a', kind: 'bullet', zone: 'HEAD', distance: 12 })
      await Bun.sleep(300)
    }
    expect(downs(a, 'cap-a')[1]?.downFor).toBe(8)
    a.close()
    b.close()
  }, 40000)
})
