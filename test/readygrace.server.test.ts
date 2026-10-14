import { afterEach, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **全員の READY が揃っても少し待つ。** その間に誰かが取り消せば支度へ戻る
 * (server/match.ts の READY_GRACE_MS)。試験の既定は 0 なので、ここだけ長さを戻す。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

function lastPhase(client: Client): string | undefined {
  return client.messages.filter((m) => m.type === 'match').map((m) => (m as { phase: string }).phase).at(-1)
}

test('揃ってもすぐ始まらず、取り消せば支度に戻り、また揃えば待ってから始まる', async () => {
  server = await startServer({ MGO2_READY_GRACE_MS: '1500' })
  const a = await new Client(server, 'rg-a', spot(0, -6)).ready()
  const b = await new Client(server, 'rg-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  await Bun.sleep(700)
  // 揃って 0.7 秒。まだ数え始めていない
  expect(lastPhase(a)).toBe('ready')
  // 取り消す。待ちが止まる
  b.send({ type: 'ready', ready: false })
  await Bun.sleep(1500)
  expect(lastPhase(a)).toBe('ready')
  // また揃える。待ってから数え始める
  b.send({ type: 'ready', ready: true })
  await Bun.sleep(2000)
  expect(lastPhase(a)).toBe('countdown')
  a.close()
  b.close()
}, 30_000)
