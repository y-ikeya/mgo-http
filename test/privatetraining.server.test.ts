import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * 練習 (/training) は**自分だけの部屋。** 同じ練習の部屋に入っても他の人と出会わない。
 * 普通に echo へ入った人どうしは今までどおり同じ部屋。
 */
let server: Server
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server.stop())

function people(client: Client): string[] {
  const roster = client.last.get('roster') as Extract<ServerMessage, { type: 'roster' }> | undefined
  return (roster?.players ?? []).filter((p) => !p.id.startsWith('target')).map((p) => p.id)
}

test('自分だけの練習部屋どうしは名簿に互いが居ない', async () => {
  const a = await new Client(server, 'pt-a', [0, 0, 0], 'echo', { privateRoom: true }).ready()
  const b = await new Client(server, 'pt-b', [0, 0, 0], 'echo', { privateRoom: true }).ready()
  a.live()
  b.live()
  await Bun.sleep(500)
  expect(people(a)).toEqual(['pt-a'])
  expect(people(b)).toEqual(['pt-b'])
  // 一覧には出ない (共有の echo は空のまま)
  const rooms = (await (await fetch(`http://localhost:${server.port}/rooms`)).json()) as { name: string; players: number }[]
  expect(rooms.find((r) => r.name === 'echo')?.players ?? 0).toBe(0)
  a.close()
  b.close()
}, 20_000)

test('共有の echo に入った人どうしは今までどおり同じ部屋', async () => {
  const a = await new Client(server, 'pt-c', [0, 0, 0], 'echo').ready()
  const b = await new Client(server, 'pt-d', [0, 0, 0], 'echo').ready()
  a.live()
  b.live()
  await Bun.sleep(500)
  // 後から入った人の名簿に先の人が居る (先の人には名簿ではなく join で届く)
  expect(people(b).sort()).toEqual(['pt-c', 'pt-d'])
  a.close()
  b.close()
}, 20_000)

test('対戦の部屋は private を付けても人ごとに分かれない', async () => {
  const a = await new Client(server, 'pt-e', [0, 0, 0], 'bravo', { privateRoom: true }).ready()
  const b = await new Client(server, 'pt-f', [0, 0, 0], 'bravo', { privateRoom: true }).ready()
  a.live()
  b.live()
  await Bun.sleep(500)
  expect(people(b).sort()).toEqual(['pt-e', 'pt-f'])
  a.close()
  b.close()
}, 20_000)
