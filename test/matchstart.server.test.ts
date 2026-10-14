import { afterEach, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **秒読みの間は装備の画面で武器を選ぶ。** 始まった時にまだ選んでいる人は
 * 戦場へ出す — 試合中は装備の画面を出さない (server/match.ts の countdown → playing)。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

test('秒読みの間は湧かさず、始まった時に支度の画面に居た人は湧かされる', async () => {
  server = await startServer()
  const a = await new Client(server, 'ms-a', spot(0, -6)).ready()
  const b = await new Client(server, 'ms-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  // 全員が READY を押すと秒読みに入る。OK は押さない。秒読み (5 秒) の途中ではまだ湧かない
  const respawnedIds = () =>
    new Set(a.messages.filter((m) => m.type === 'respawn').map((m) => (m as { id: string }).id))
  await Bun.sleep(1500)
  expect(respawnedIds().has(a.id)).toBe(false)
  // 始まった後
  await Bun.sleep(5000)
  const respawned = respawnedIds()
  expect(respawned.has(a.id)).toBe(true)
  expect(respawned.has(b.id)).toBe(true)
  a.close()
  b.close()
}, 30000)
