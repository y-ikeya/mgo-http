import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, twoPlayers, type Server } from './server'
import { DEPLOY_SECONDS } from '../src/domain/item/decoy'
import type { ServerMessage } from '../src/application/protocol/types'

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
    b.moveTo(...spot(0, -5.5))
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
    a.moveTo(...spot(0, -15))
    b.moveTo(...spot(0, 15))
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

/**
 * クレイモアは**置けたときだけ**数が減る。
 *
 * 置ける場所かを決めているのはサーバー (壁の中や縁の外へは置けない)。断られた
 * ことが画面に伝わらないと、置けていないのに手元の残り数だけが減る。
 */
describe('クレイモアを置く', () => {
  test('置けたら owner 付きで配られる', async () => {
    const { a, b } = await twoPlayers(server, 'claymore', ['carol', 'dave'])
    a.holdClaymore(true)
    await Bun.sleep(300)
    a.reset()

    a.send({ type: 'claymore' })
    await Bun.sleep(400)

    const placed = a.messages.find((m) => m.type === 'claymorePlaced')
    expect(placed?.type === 'claymorePlaced' && placed.owner).toBe('carol')

    a.holdClaymore(false)
    a.close()
    b.close()
  }, 30000)

  /**
   * 置いた物は**前を通った敵で起爆する**。壁や階で区切る方 (sensedBy) は
   * 地形の要る話なので sim の試験 (judge/claymore.test.ts)。ここは開けた所で
   * 鳴ること — 遮蔽の判定を足して、何も無い所でも鳴らなくなっていないか
   */
  test('前を通った敵で起爆して、削れる', async () => {
    const { a, b } = await twoPlayers(server, 'claymore', ['erin', 'frank'])
    // a は z=-6 で +Z (b の方) を向いて置く。置く所は 0.9m 先 (z=-5.1)、正面は +Z
    a.cameraYaw = Math.PI
    a.holdClaymore(true)
    await Bun.sleep(300)
    a.send({ type: 'claymore' })
    await Bun.sleep(400)
    expect(a.messages.some((m) => m.type === 'claymorePlaced')).toBe(true)
    a.holdClaymore(false)
    a.reset()
    b.reset()

    // b が正面 2m に踏み込む
    b.moveTo(0, 0, -3)
    await Bun.sleep(600)

    const gone = b.messages.find((m) => m.type === 'claymoreGone')
    expect(gone?.type === 'claymoreGone' && gone.blast).toBe(true)
    const text = await server.health()
    const line = text.match(/frank \((\d+)\)/)
    expect(line ? Number(line[1]) : 100).toBeLessThan(100)

    a.close()
    b.close()
  }, 30000)

  /**
   * **爆風で誘爆する。** 近くに並べた物は 1 つ鳴れば全部鳴る。
   * 置く側に「並べ過ぎると一掃される」代償が付く (claymore.ts の blastPlaced)
   */
  test('爆風の中の別のクレイモアは誘爆する', async () => {
    const { a, b } = await twoPlayers(server, 'claymore', ['gail', 'hank'])
    // a: z=-6 で +Z を向いて置く → z=-5.1、正面 +Z (扇は z -5.1〜-1.1)
    a.cameraYaw = Math.PI
    a.holdClaymore(true)
    await Bun.sleep(300)
    a.send({ type: 'claymore' })
    await Bun.sleep(400)
    a.holdClaymore(false)
    // b: z=-1 で +Z を向いて置く → z=-0.1、正面 +Z (誰も居ない方)。a の物から 5m
    b.moveTo(0, 0, -1)
    b.cameraYaw = Math.PI
    b.holdClaymore(true)
    await Bun.sleep(300)
    b.send({ type: 'claymore' })
    await Bun.sleep(400)
    b.holdClaymore(false)
    expect(b.messages.filter((m) => m.type === 'claymorePlaced').length).toBe(2)
    a.reset()
    b.reset()

    // b が a の物の正面へ踏み込む。a の物が鳴り、5m 先の b の物も鳴る
    b.moveTo(0, 0, -3)
    await Bun.sleep(600)
    const gone = b.messages.filter((m) => m.type === 'claymoreGone' && m.blast)
    expect(gone.length).toBe(2)

    a.close()
    b.close()
  }, 30000)

  test('**手にしていなければ置けない。** 何も配られない', async () => {
    const { a, b } = await twoPlayers(server)
    a.reset()
    a.send({ type: 'claymore' })
    await Bun.sleep(400)
    expect(a.messages.some((m) => m.type === 'claymorePlaced')).toBe(false)
    a.close()
    b.close()
  }, 30000)
})

/**
 * **爆風で DECOY は破れる。** 手榴弾 1 個で罠を掃除できる (claymore.ts の blastPlaced)。
 * 置き主を晒しはしない — 投げた側は「人かもしれない物」を遠くから処理しただけで、
 * 罠に掛かった訳ではない。
 */
describe('爆風と DECOY', () => {
  test('手榴弾の爆風の中の DECOY は破れる', async () => {
    // a は手榴弾、b は DECOY。支度で別々に選ぶので twoPlayers は使えない
    const a = await new Client(server, 'ivan', spot(0, -6)).ready()
    const b = await new Client(server, 'judy', spot(0, 6)).ready()
    a.live()
    b.live()
    a.send({ type: 'loadout', primary: 'rifle', support: 'grenade' })
    b.send({ type: 'loadout', primary: 'rifle', support: 'decoy' })
    await Bun.sleep(400)
    a.send({ type: 'ready', ready: true })
    b.send({ type: 'ready', ready: true })
    await Bun.sleep(3400)
    a.send({ type: 'spawn' })
    b.send({ type: 'spawn' })
    await Bun.sleep(3600)

    // b が a の 3m 手前に置く
    b.moveTo(0, 0, -3)
    b.holdDecoy(true)
    await Bun.sleep(300)
    b.send({ type: 'decoy' })
    await Bun.sleep(DEPLOY_SECONDS * 1000 + 300)
    b.holdDecoy(false)
    expect(b.messages.some((m) => m.type === 'decoyPlaced')).toBe(true)
    a.reset()
    b.reset()

    // a が足元へ落とす。導火線 3 秒
    a.send({ type: 'grenade', dir: [0, -1, 0] })
    await Bun.sleep(4000)
    const gone = b.messages.find((m) => m.type === 'decoyGone')
    expect(gone?.type === 'decoyGone' && gone.popped).toBe(true)

    a.close()
    b.close()
  }, 30000)
})
