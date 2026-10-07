import { afterEach, expect, test } from 'bun:test'
import { startServer, type Server } from './server'

/**
 * **手元だけの部屋 (foxtrot) は公開しない。** 一覧に出さず、入らせもしない。
 * 手元で起こしたサーバー (MGO2_LOCAL_ROOMS=1) でだけ開く。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

async function listed(server: Server): Promise<string[]> {
  const rooms = (await (await fetch(`http://localhost:${server.port}/rooms`)).json()) as { name: string }[]
  return rooms.map((r) => r.name)
}

test('公開のサーバーでは foxtrot が一覧に無く、入れない', async () => {
  server = await startServer({ MGO2_LOCAL_ROOMS: '0' })
  const names = await listed(server)
  expect(names).not.toContain('foxtrot')
  expect(names).toContain('bravo')
  const join = await fetch(`http://localhost:${server.port}/?room=foxtrot&id=lr-a`)
  expect(join.status).toBe(404)
}, 30000)

test('手元のサーバーでは foxtrot が開く', async () => {
  server = await startServer({ MGO2_LOCAL_ROOMS: '1' })
  expect(await listed(server)).toContain('foxtrot')
}, 30000)
