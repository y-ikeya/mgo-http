import { afterEach, expect, test } from 'bun:test'
import { beginMatch, Client, spot, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * **敬礼で繋がる** (server/link.ts)。結ぶのも切るのもサーバー。
 * 繋がった味方とだけ、暴いた情報を分け合う (2026-11-09 本人)。どちらかが倒れたら切れる
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

const teamOf = (client: Client) => {
  const match = client.last.get('match')
  if (match?.type !== 'match') throw new Error('match が来ていない')
  return match.players.find((p) => p.id === client.id)?.team
}
const linksOf = (client: Client): string[] => {
  const links = client.last.get('links') as Extract<ServerMessage, { type: 'links' }> | undefined
  return links?.ids ?? []
}

test('近くで互いに敬礼した味方が繋がり、片方が倒れたら両方から切れる', async () => {
  server = await startServer()
  const clients = await Promise.all(
    ['ln-a', 'ln-b', 'ln-c'].map((name, i) => new Client(server!, name, spot(i * 6, -6)).ready()),
  )
  for (const c of clients) c.live()
  await beginMatch(...clients)
  // 同じ色の 2 人と、相手
  const [x, y] = clients.filter((c) => clients.some((o) => o !== c && teamOf(o) === teamOf(c)))
  const enemy = clients.find((c) => teamOf(c) !== teamOf(x!))
  if (!x || !y || !enemy) throw new Error('陣営が分かれていない')
  // 湧いた直後の見逃し (WARP_GRACE) の間に並べる
  x.moveTo(0, 0, -6)
  y.moveTo(2, 0, -6)
  enemy.moveTo(0, 0, 6)
  await Bun.sleep(200)
  // 片方だけでは繋がらない
  x.pose = 'salute'
  await Bun.sleep(400)
  expect(linksOf(x)).toEqual([])
  y.pose = 'salute'
  await waitFor(() => linksOf(x).includes(y.id) && linksOf(y).includes(x.id), '繋がる', 5000)

  // 手を下ろしても繋がったまま
  x.pose = 'idle'
  y.pose = 'idle'
  await Bun.sleep(300)
  expect(linksOf(x)).toContain(y.id)

  // x が倒される。y の側からも切れる
  for (let i = 0; i < 6 && x.life !== 'downed'; i++) {
    enemy.send({ type: 'damage', id: enemy.id, target: x.id, kind: 'bullet', zone: 'HEAD', distance: 12 })
    await Bun.sleep(300)
  }
  await waitFor(() => linksOf(x).length === 0 && linksOf(y).length === 0, '切れる', 5000)
  for (const c of clients) c.close()
}, 60_000)
