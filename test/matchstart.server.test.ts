import { afterEach, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **秒読みに入ったら、支度の画面に居る人も戦場へ出す。** 秒読みの間も
 * 試合中も装備の画面は出さない (server/match.ts の ready → countdown)。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

test('秒読みに入った時に支度の画面に居た人は湧かされる', async () => {
  server = await startServer()
  const a = await new Client(server, 'ms-a', spot(0, -6)).ready()
  const b = await new Client(server, 'ms-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  // 全員が READY を押すと秒読みに入る。OK は押さない。秒読み (5 秒) の途中で見る
  await Bun.sleep(1500)
  const respawned = new Set(
    a.messages.filter((m) => m.type === 'respawn').map((m) => (m as { id: string }).id),
  )
  expect(respawned.has(a.id)).toBe(true)
  expect(respawned.has(b.id)).toBe(true)
  a.close()
  b.close()
}, 30000)
