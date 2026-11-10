import { afterEach, expect, test } from 'bun:test'
import { Client, spawnAlive, spot, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * **位置を断ったら、本人を据え置いた位置へ戻す** (server/relay.ts の moveRejected)。
 *
 * 断ったまま知らせないと、本人の画面は動き続けてサーバーは古い位置のまま、差が開いて
 * 二度と通らなかった。他の人の画面では、その人がずっと古い位置に居た (2026-11-09)
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

const rejections = (client: Client) =>
  client.messages.filter((m): m is Extract<ServerMessage, { type: 'moveRejected' }> => m.type === 'moveRejected')

test('跳んだ位置を断ったら、据え置いた位置へ戻れと届く。届くのは間隔を空けて', async () => {
  server = await startServer()
  const a = await new Client(server, 'sb-a', spot(0, -6)).ready()
  const b = await new Client(server, 'sb-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await spawnAlive(a, b)
  // 湧いた直後の見逃し (WARP_GRACE) を過ぎてから跳ぶ
  await Bun.sleep(1500)
  const before = (await server.health()).match(/sb-a .*@\(([-\d.]+), [-\d.]+, ([-\d.]+)\)/)
  a.moveTo(40, 0, 40)
  await waitFor(() => rejections(a).length > 0, '戻れが届く', 5000)
  const [x, , z] = rejections(a)[0]!.at
  // 戻る先はサーバーが持っている位置 (跳ぶ前)
  if (before) {
    expect(x).toBeCloseTo(Number(before[1]), 0)
    expect(z).toBeCloseTo(Number(before[2]), 0)
  }
  expect(Math.hypot(x - 40, z - 40)).toBeGreaterThan(20)
  // 位置は毎秒 64 通届くが、戻れは 0.5 秒に 1 通まで
  const count = rejections(a).length
  await Bun.sleep(1000)
  expect(rejections(a).length - count).toBeLessThanOrEqual(3)
  a.close()
  b.close()
}, 30000)
