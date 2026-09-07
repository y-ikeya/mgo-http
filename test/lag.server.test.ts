import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'
import { LAG_LIMIT_MS, LAG_STRIKES } from '../src/domain/match/lag'

/**
 * 往復の時間。**サーバーが測って、遅すぎる人には席を空けてもらう。**
 *
 * 測るのをサーバーにしてあるのは、クライアントが測って申告する形にすると
 * 遅い人が「速い」と名乗れるため (protocol/types.ts の PingMessage)。
 */
let server: Server
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server.stop())

describe('往復の時間', () => {
  test('**測りに来る。** 打ち返せば、次の便に答えが乗る', async () => {
    const a = await new Client(server, 'pingpong').ready()
    a.live()
    // 1 秒に 1 度なので、3 秒あれば往復が 2 回は済む
    await Bun.sleep(3200)
    const pings = a.messages.filter((m) => m.type === 'ping')
    expect(pings.length).toBeGreaterThanOrEqual(2)
    // 手元で打ち返しているので、答えは出ているし小さい
    const last = pings[pings.length - 1]
    expect(last?.type === 'ping' && last.rtt).toBeLessThan(LAG_LIMIT_MS)
    a.close()
  }, 20000)

  /**
   * **一瞬の跳ねでは切らない。** 続いたときだけ切る。
   *
   * ここでは打ち返しを遅らせて、限界を超え続ける人を作る。
   */
  test('遅れが続いたら切られる', async () => {
    const a = await new Client(server, 'laggy', [0, 0, 0], 'bravo', {
      pongDelay: LAG_LIMIT_MS + 200,
    }).ready()
    a.live()
    // 1 往復に (1 秒 + 遅らせる分) かかるので、切られるまで待つ
    await Bun.sleep((LAG_LIMIT_MS + 1400) * LAG_STRIKES)
    expect(a.closedWith).toBe(4001)
    a.close()
  }, 30000)
})
