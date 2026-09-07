import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'

/**
 * 部屋を移ったとき、前の席が残らないこと。
 *
 * **接続の帳簿は人の id で引く。** 別の部屋に席が残っていると、そちらの席から
 * 引いた接続が**いま遊んでいる部屋の接続**になり、前の部屋の試合状況がいまの
 * 画面へ配られる。
 */
let server: Server
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server.stop())

describe('部屋を移る', () => {
  test('**前の部屋の席は畳まれる。** 2 つの部屋に同時に居ない', async () => {
    const first = await new Client(server, 'mover', [0, 0, 0], 'bravo').ready()
    first.live()
    await Bun.sleep(600)
    expect(await server.health()).toContain('mover')

    // 同じ id で別の部屋へ入り直す (画面から部屋を移ったのと同じ)
    const second = await new Client(server, 'mover', [0, 0, 0], 'delta').ready()
    second.live()
    await Bun.sleep(600)

    const health = await server.health()
    const rooms = health
      .split('\n')
      .reduce<{ room: string; here: boolean }[]>((out, line) => {
        if (/^\w+: \[/.test(line)) out.push({ room: line.split(':')[0]!, here: false })
        else if (line.includes('mover') && out.length > 0) out[out.length - 1]!.here = true
        return out
      }, [])
      .filter((r) => r.here)
      .map((r) => r.room)

    // **1 つだけ。** 2 つ出たら、前の部屋の試合状況がこちらへ配られている
    expect(rooms).toEqual(['delta'])

    first.close()
    second.close()
  }, 20000)
})
