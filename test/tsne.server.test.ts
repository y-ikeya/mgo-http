import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * 潜入 / 防御 (charlie、TSNE)。
 *
 * 見たいのは 3 つ — 攻める側と守る側に分かれること、攻める側に当たるとステルスが
 * 解けること、復活なし (lives 0) で相手の側が全員倒れたら決着すること。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

const match = (client: Client) =>
  [...client.messages].reverse().find((m) => m.type === 'match') as
    | Extract<ServerMessage, { type: 'match' }>
    | undefined

/** 2 人を charlie へ入れて、撃てる状態まで進める。先に入った alice が青 (最初の試合は攻める側) */
async function twoInTsne(): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server, 'alice', spot(0, -6), 'charlie').ready()
  const b = await new Client(server, 'bob', spot(0, 6), 'charlie').ready()
  a.live()
  b.live()
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  await Bun.sleep(3400)
  // 守る側は殺傷の銃を選ぶ (名乗る銃と揃える)
  b.send({ type: 'loadout', primary: 'rifle', support: 'grenade' })
  await Bun.sleep(200)
  a.send({ type: 'spawn' })
  b.send({ type: 'spawn' })
  await Bun.sleep(3600)
  return { a, b }
}

describe('TSNE', () => {
  test('攻める色が配られ、試合中はステルスが効いている', async () => {
    const { a, b } = await twoInTsne()
    expect(match(a)?.mode).toBe('TSNE')
    expect(match(a)?.attack).toBe('blue')
    expect(match(a)?.stealth).toBe(true)
    a.close()
    b.close()
  }, 30000)

  test('**守る側の攻撃が当たると、攻める側のステルスが解ける**', async () => {
    const { a, b } = await twoInTsne()
    a.reset()
    b.send({ type: 'damage', id: 'bob', target: 'alice', kind: 'bullet', zone: 'BODY', distance: 12 })
    await Bun.sleep(400)
    expect(match(a)?.stealth).toBe(false)
    a.close()
    b.close()
  }, 30000)

  test('**守る側の攻撃が当たると CAUTION。両方の画面に同じ切れる時刻が届く**', async () => {
    const { a, b } = await twoInTsne()
    expect(match(a)?.cautionUntil).toBeUndefined()
    b.send({ type: 'damage', id: 'bob', target: 'alice', kind: 'bullet', zone: 'BODY', distance: 12 })
    await Bun.sleep(400)
    const ca = match(a)?.cautionUntil
    const cb = match(b)?.cautionUntil
    expect(ca).toBeGreaterThan(Date.now())
    expect(ca).toBe(cb)
    a.close()
    b.close()
  }, 30000)

  // **最後に置く。** 試合が終わるので、後の試験は次の試合の支度 (10 秒の結果) を待つことになる
  test('**復活なし。攻める側が全員倒れたら、守る側の勝ちで終わる**', async () => {
    const { a, b } = await twoInTsne()
    for (let i = 0; i < 6 && match(a)?.phase === 'playing'; i++) {
      b.send({ type: 'damage', id: 'bob', target: 'alice', kind: 'bullet', zone: 'HEAD', distance: 12 })
      await Bun.sleep(300)
    }
    await Bun.sleep(400)
    expect(match(a)?.phase).toBe('over')
    expect(match(a)?.winner).toBe('red')
    a.close()
    b.close()
  }, 30000)

})
