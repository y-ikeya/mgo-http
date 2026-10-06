import { afterEach, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **試合が始まったら、装備の画面に居る人も戦場へ出す。** OK を押さないまま
 * 秒読みを終えても、始まった時点で湧く (server/match.ts の countdown → playing)。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

test('始まった時に装備の画面に居た人は湧かされる', async () => {
  server = await startServer()
  const a = await new Client(server, 'ms-a', spot(0, -6)).ready()
  const b = await new Client(server, 'ms-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  // 秒読み (5 秒) の間は OK を押さない
  await Bun.sleep(6500)
  const respawned = new Set(
    a.messages.filter((m) => m.type === 'respawn').map((m) => (m as { id: string }).id),
  )
  expect(respawned.has(a.id)).toBe(true)
  expect(respawned.has(b.id)).toBe(true)
  a.close()
  b.close()
}, 30000)
