import { afterEach, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **秒読みに入ったら装備の画面で武器を選ぶ。** 試合は秒読みの後に待たずに始まり、
 * OK を押した人から出る。選んでいる人は始まっても出さない — 秒読みに入ってから
 * 30 秒 (lifecycle.ts の CHOOSE_TIMEOUT) で打ち切る (server/match.ts、2026-10-15 本人)。
 * 打ち切りの 30 秒そのものは domain の試験 (advanceLife) が見ている
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

test('始まっても選んでいる人は出さず、OK を押した人から出る', async () => {
  server = await startServer()
  const a = await new Client(server, 'ms-a', spot(0, -6)).ready()
  const b = await new Client(server, 'ms-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  const respawnedIds = () =>
    new Set(a.messages.filter((m) => m.type === 'respawn').map((m) => (m as { id: string }).id))
  // 秒読み (5 秒) が終わって始まった後。どちらも OK を押していないので、まだ出ていない
  await Bun.sleep(6500)
  const phase = (a.last.get('match') as { phase?: string } | undefined)?.phase
  expect(phase).toBe('playing')
  expect(respawnedIds().has(a.id)).toBe(false)
  expect(respawnedIds().has(b.id)).toBe(false)
  // a だけ OK。a は出て、b は選んだまま
  a.send({ type: 'spawn' })
  await Bun.sleep(400)
  expect(respawnedIds().has(a.id)).toBe(true)
  expect(respawnedIds().has(b.id)).toBe(false)
  a.close()
  b.close()
}, 30000)
