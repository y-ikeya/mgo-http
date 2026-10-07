import { afterEach, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **入り直しても陣営は変わらない。** 古い接続が閉じる前に入り直しても
 * (リロード)、席を畳んでから入り直しても (戻る) 同じ側に座る。
 * 負けている側から入り直して勝っている側へ移れていた (2026-10-06)。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

/** /health からその人の陣営を読む */
async function teamOf(server: Server, name: string): Promise<string> {
  const line = ((await server.health()).match(new RegExp(`([青赤]) ${name} `)) ?? [])[1]
  if (!line) throw new Error(`${name} が居ない:\n${await server.health()}`)
  return line
}

test('古い接続が閉じる前に入り直しても同じ側', async () => {
  server = await startServer()
  // 青 a・赤 b・青 x。a の古い席を数えると青 2 赤 1 になり、赤へ回されていた
  const a = await new Client(server, 'rj-a', spot(0, -6)).ready()
  const b = await new Client(server, 'rj-b', spot(0, 6)).ready()
  const x = await new Client(server, 'rj-x', spot(6, 0)).ready()
  a.live()
  b.live()
  x.live()
  await Bun.sleep(300)
  const before = await teamOf(server, 'rj-a')
  // 古い a を閉じずに、同じ人で入り直す
  const again = await new Client(server, 'rj-a', spot(0, -6)).ready()
  again.live()
  await Bun.sleep(300)
  a.close()
  await Bun.sleep(300)
  expect(await teamOf(server, 'rj-a')).toBe(before)
  again.close()
  b.close()
  x.close()
}, 30000)

test('戻るで出てから入り直しても同じ側', async () => {
  server = await startServer()
  const a = await new Client(server, 'rj-c', spot(0, -6)).ready()
  const b = await new Client(server, 'rj-d', spot(0, 6)).ready()
  const c = await new Client(server, 'rj-e', spot(6, 0)).ready()
  a.live()
  b.live()
  c.live()
  await Bun.sleep(300)
  const before = await teamOf(server, 'rj-c')
  a.send({ type: 'leave', id: a.id })
  a.close()
  await Bun.sleep(300)
  // 抜けた間に 1 人入る (青 1 赤 1 → 青)。戻った c は少ない側 (赤) へ回されていた
  const d = await new Client(server, 'rj-f', spot(-6, 0)).ready()
  d.live()
  await Bun.sleep(300)
  const again = await new Client(server, 'rj-c', spot(0, -6)).ready()
  again.live()
  await Bun.sleep(300)
  expect(await teamOf(server, 'rj-c')).toBe(before)
  again.close()
  b.close()
  c.close()
  d.close()
}, 30000)
