import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { openSpot, startServer, twoPlayers, type Server } from './server'
import type { ServerMessage } from '../src/net/types'

/**
 * 武器を地面へ置く / 拾う。
 *
 * **奪えることが要点。** 置いた本人の物ではなくなるので、敵の銃を拾って使える。
 * 距離を決めているのはサーバー — 離れた所の物を「拾った」と言われても通らない。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

const dropped = (client: { messages: ServerMessage[] }) =>
  client.messages.filter((m) => m.type === 'dropped')

describe('置いて拾う', () => {
  test('置いた物は全員に配られ、近づいた相手が拾える', async () => {
    const { a, b } = await twoPlayers(server)
    a.reset()
    b.reset()

    a.send({ type: 'drop', weapon: 'rifle', ammo: 12, reserve: 30 })
    await Bun.sleep(300)

    // **置いた本人にも届く。** 見えている物として描くのは全員同じ
    expect(dropped(a).length).toBe(1)
    expect(dropped(b).length).toBe(1)

    // 離れたまま押しても拾えない
    b.send({ type: 'pickup' })
    await Bun.sleep(300)
    expect(b.messages.some((m) => m.type === 'picked')).toBe(false)

    // 近づけば拾える (半径 1m)。**中身は拾った人にだけ返る**
    b.moveTo(...openSpot(0, -5.5))
    await Bun.sleep(400)
    b.send({ type: 'pickup' })
    await Bun.sleep(300)

    const picked = b.messages.find((m) => m.type === 'picked')
    expect(picked?.type === 'picked' && picked.weapon).toBe('rifle')
    expect(picked?.type === 'picked' && picked.ammo).toBe(12)
    expect(picked?.type === 'picked' && picked.reserve).toBe(30)
    expect(a.messages.some((m) => m.type === 'picked')).toBe(false)

    // 消えたことは全員に届く
    expect(a.messages.some((m) => m.type === 'droppedGone')).toBe(true)
    expect(b.messages.some((m) => m.type === 'droppedGone')).toBe(true)

    // 二度は拾えない
    b.reset()
    b.send({ type: 'pickup' })
    await Bun.sleep(300)
    expect(b.messages.some((m) => m.type === 'picked')).toBe(false)

    a.close()
    b.close()
  }, 30000)

  test('**ナイフは置けない。** 手ぶらにさせない', async () => {
    const { a, b } = await twoPlayers(server)
    a.reset()
    a.send({ type: 'drop', weapon: 'knife' })
    await Bun.sleep(300)
    expect(dropped(a).length).toBe(0)
    a.close()
    b.close()
  }, 30000)
})

/**
 * 振りかぶったまま撃たれる / 転ばされる。
 *
 * **ピンは抜けている。** そのまま何事もなく投げ切れるなら、手榴弾を構えている
 * 相手を撃つ意味が薄くなる。足元に落ちて爆ぜるからこそ、「今撃つと道連れになる」
 * という読みが生まれる。
 */
describe('握ったまま撃たれる', () => {
  test('頭に当たって仰け反ると、手榴弾が足元に落ちる', async () => {
    const { a, b } = await twoPlayers(server)
    // **倒れない距離まで離れる。** 25m まで頭 1 発なので、それより遠くから
    a.moveTo(...openSpot(0, -15))
    b.moveTo(...openSpot(0, 15))
    // b が振りかぶる (位置に holdingGrenade を立てて送り続ける)
    b.holdGrenade(true)
    await Bun.sleep(400)
    a.reset()
    b.reset()

    a.send({
      type: 'damage',
      id: 'alice',
      target: 'bob',
      kind: 'bullet',
      zone: 'HEAD',
      distance: 30,
    })
    await Bun.sleep(400)

    // 手を離れた手榴弾が全員に配られる
    expect(a.messages.some((m) => m.type === 'grenade')).toBe(true)
    expect(b.messages.some((m) => m.type === 'grenade')).toBe(true)

    // **手にしているだけなら落ちない。** ピンを抜いていなければ手は緩まない
    b.holdGrenade(false)
    await Bun.sleep(300)
    a.reset()
    b.reset()
    a.send({
      type: 'damage', id: 'alice', target: 'bob',
      kind: 'bullet', zone: 'HEAD', distance: 30,
    })
    await Bun.sleep(400)
    expect(a.messages.some((m) => m.type === 'grenade')).toBe(false)
    b.holdGrenade(false)
    a.close()
    b.close()
  }, 30000)
})
