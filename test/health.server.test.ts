import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * /health は**外には数だけ** (2026-11-03 のレビュー「/health が無認証で、部屋・プレイヤー名・体力・K/D まで
 * 返してる」)。詳しい行は名前・位置・誰が誰を見ているかまで出すので、外に開けると壁越しの透視になる。
 * 外からの問い合わせは必ず Caddy を通り X-Forwarded-For が付くので、それで分ける
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

test('**手元からは名前と位置まで、Caddy 越しには部屋の数だけ**', async () => {
  const me = await new Client(server, 'health-alice', spot(0, 0)).ready()
  me.live()
  await Bun.sleep(600)

  const direct = await (await fetch(`http://localhost:${server.port}/health`)).text()
  expect(direct).toContain('health-alice')
  expect(direct).toContain('@(')

  const proxied = await (
    await fetch(`http://localhost:${server.port}/health`, { headers: { 'x-forwarded-for': '203.0.113.9' } })
  ).text()
  expect(proxied.startsWith('ok\n')).toBe(true)
  expect(proxied).not.toContain('health-alice')
  expect(proxied).not.toContain('@(')
  expect(proxied).toContain('1 人')
  me.close()
}, 30000)
