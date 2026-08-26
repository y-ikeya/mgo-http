import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'
import type { ServerMessage } from '../src/protocol/types'

/**
 * 個人戦 (alpha)。
 *
 * **陣営が無い。全員が敵。** 見たいのは 3 つ — 同じ色でも撃てること、残機が
 * 部屋で 1 つなこと、1 位が知らされること。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

/** 2 人を個人戦の部屋へ入れて、撃てる状態まで進める */
async function twoInDM(): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server, 'alice', spot(0, -6), 'alpha').ready()
  const b = await new Client(server, 'bob', spot(0, 6), 'alpha').ready()
  a.live()
  b.live()
  await Bun.sleep(3400)
  a.send({ type: 'spawn' })
  b.send({ type: 'spawn' })
  await Bun.sleep(3600)
  return { a, b }
}

const match = (client: Client) =>
  [...client.messages].reverse().find((m) => m.type === 'match') as
    | Extract<ServerMessage, { type: 'match' }>
    | undefined

describe('個人戦', () => {
  test('**同じ色でも撃てる。** 陣営が無い', async () => {
    const { a, b } = await twoInDM()
    const roster = a.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    // 全員同じ色 (色で味方に見えないように)
    expect(new Set(roster.players.map((p) => p.team)).size).toBe(1)

    a.reset()
    b.reset()
    a.send({
      type: 'damage', id: 'alice', target: 'bob',
      kind: 'bullet', zone: 'HEAD', distance: 12,
    })
    await Bun.sleep(400)

    // 削れている = 味方判定で弾かれていない
    const health = b.messages.find((m) => m.type === 'health' && m.id === 'bob')
    expect(health?.type === 'health' && health.damage).toBeGreaterThan(0)

    a.close()
    b.close()
  }, 30000)

  test('残機は部屋で 1 つ。**誰が死んでも同じ数が減る**', async () => {
    const { a, b } = await twoInDM()
    const before = match(a)?.blue ?? 0
    expect(before).toBeGreaterThan(0)

    // **申告する距離は実距離と合わせる** (12m 離れて置いてある)。
    // ずらすとサーバーの検算で弾かれて、何も起きない
    a.send({
      type: 'damage', id: 'alice', target: 'bob',
      kind: 'bullet', zone: 'HEAD', distance: 12,
    })
    await Bun.sleep(1200)

    const after = match(a)
    expect(after?.blue).toBe(before - 1)
    // 1 位は倒した人。**光って位置が漏れる**
    expect(after?.leader).toBe('alice')
    expect(after?.mode).toBe('DM')

    a.close()
    b.close()
  }, 30000)
})

/**
 * **申告した装備を鵜呑みにしない。**
 *
 * 手にある物は位置と一緒に流れてくる (37 バイトの中) ので、長らく素通りで
 * 書き込んでいた。狙撃銃を選んでいないのに「狙撃銃を持っている」と名乗れば、
 * サーバーはその威力で計算してしまう — 頭 1 発が 100 か 130 かが変わる。
 */
describe('持てない物は名乗れない', () => {
  test('選んでいない銃を名乗っても、削れるのは選んだ銃のぶん', async () => {
    const { a, b } = await twoInDM()
    // alice は既定のまま (rifle)。位置パケットだけ狙撃銃と名乗る
    a.claimedWeapon = 'sniper'
    await Bun.sleep(300)
    b.reset()

    a.send({
      type: 'damage', id: 'alice', target: 'bob',
      kind: 'bullet', zone: 'HEAD', distance: 12,
    })
    await Bun.sleep(400)

    const health = b.messages.find((m) => m.type === 'health' && m.id === 'bob')
    const damage = health?.type === 'health' ? health.damage : 0
    // XM2010 の頭は 130、AK47 は 100。**通ってしまえば 130 になる**
    expect(damage).toBeGreaterThan(0)
    expect(damage).toBeLessThanOrEqual(100)

    a.claimedWeapon = 'rifle'
    a.close()
    b.close()
  }, 30000)
})
