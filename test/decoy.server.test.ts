import { afterEach, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, twoPlayers, type Server } from './server'
import { DEPLOY_SECONDS } from '../src/domain/item/decoy'
import { SUPPORT_SPECS } from '../src/domain/item/weapons'

/**
 * decoy。**撃つことに代償を付ける道具。**
 *
 * ここで押さえるのは 2 つ。**割った人の位置が漏れること**と、
 * **漏れてはいけない場合に漏れないこと。**
 *
 * 後者のほうが大事で、間違うと「自分の物を撃って味方を晒す」「撃っていない
 * のに晒される」が起きる。前者は遊んでいれば気づくが、後者は気づけない。
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

/** 人形を置いて、膨らみ切るまで待つ */
async function placed(client: Client): Promise<void> {
  client.holdDecoy(true)
  // 手にある物は位置に乗って届く。置く前に 1 通は行き渡らせる
  client.sendState()
  await Bun.sleep(120)
  client.send({ type: 'decoy' })
  await Bun.sleep(DEPLOY_SECONDS * 1000 + 300)
}

/** 人形の在る所へ向けて 1 発撃つ */
function shootAt(client: Client, at: [number, number, number]): void {
  client.send({
    type: 'shot',
    id: client.id,
    from: [at[0], at[1] + 1.4, at[2] + 4],
    to: [at[0], at[1] + 1, at[2]],
  })
}

describe('decoy', () => {
  test('置いた人へ配られる', async () => {
    server = await startServer()
    const { a } = await twoPlayers(server, 'decoy', ['dec-a1', 'dec-b1'])
    await placed(a)
    expect(a.got('decoyPlaced')).toBe(1)
  }, 30000)

  /**
   * **敵にも配る。** クレイモアと逆で、見えないと撃たせられない。
   */
  test('敵にも配られる', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a2', 'dec-b2'])
    await placed(a)
    expect(b.got('decoyPlaced')).toBe(1)
  }, 30000)

  /**
   * **膨らみ切るまでは割れない。**
   *
   * 半分の大きさの物に、当たりだけ人の大きさで立っていると、見えている形と
   * 当たる形が食い違う。
   */
  test('膨らむ前は撃っても割れない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a3', 'dec-b3'])
    a.holdDecoy(true)
    a.sendState()
    await Bun.sleep(120)
    a.send({ type: 'decoy' })
    // 膨らみ切る前に撃つ
    await Bun.sleep(200)
    const at = a.last.get('decoyPlaced') as { at: [number, number, number] } | undefined
    expect(at).toBeDefined()
    shootAt(b, at!.at)
    await Bun.sleep(300)
    expect(b.got('decoyGone')).toBe(0)
  }, 30000)

  test('膨らんだ後に撃つと割れる', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a4', 'dec-b4'])
    await placed(a)
    const placedAt = a.last.get('decoyPlaced') as { at: [number, number, number] }
    shootAt(b, placedAt.at)
    await Bun.sleep(300)
    // 割れたことは全員に届く。**破裂音は隠さない**
    expect(a.got('decoyGone')).toBe(1)
    expect(b.got('decoyGone')).toBe(1)
  }, 30000)

  /**
   * **割った人の位置が、置いた人に漏れる。**
   *
   * これが道具の効き目そのもの。撃った側には届かない (exposed は本人へ
   * 送らない) ので、置いた側にだけ来る。
   */
  test('割った人の位置が、置いた人へ漏れる', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a5', 'dec-b5'])
    await placed(a)
    const placedAt = a.last.get('decoyPlaced') as { at: [number, number, number] }
    shootAt(b, placedAt.at)
    await Bun.sleep(300)

    expect(a.got('exposed')).toBe(1)
    expect((a.last.get('exposed') as { id: string }).id).toBe(b.id)
    // **撃った本人には届かない。** 光っていると分かると逃げる一択になる
    expect(b.got('exposed')).toBe(0)
  }, 30000)

  /**
   * **自分の物を撃っても晒されない。**
   *
   * 置いた本人が邪魔になって撃つことはある。それで自分が光ったら理不尽。
   */
  test('自分の人形を撃っても、誰も晒されない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a6', 'dec-b6'])
    await placed(a)
    const placedAt = a.last.get('decoyPlaced') as { at: [number, number, number] }
    // **人形を手にしたままでは撃てない** (HELD.decoy の shoots: false)。
    // 銃へ持ち替えてから撃つ — 本物のクライアントと同じ順序
    a.holdDecoy(false)
    a.sendState()
    await Bun.sleep(150)
    shootAt(a, placedAt.at)
    await Bun.sleep(300)

    expect(a.got('decoyGone')).toBe(1)
    expect(a.got('exposed')).toBe(0)
    expect(b.got('exposed')).toBe(0)
  }, 30000)
})

/**
 * **触られた人形は揺れる。**
 *
 * 台と膨らみに続く 3 つ目の「よく見れば分かる」手掛かり。同時に、揺れは
 * 見えている全員へ届くので**見張る道具**にもなる。
 *
 * 判定はサーバーが持つ。**申告は受けない** — 触っていないのに揺らせると、
 * 「そこに誰か居る」という嘘の合図を作り放題になる。
 */
describe('触られた人形', () => {
  test('近づくと揺れて、全員に届く', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a8', 'dec-b8'])
    await placed(a)
    const at = (a.last.get('decoyPlaced') as { at: [number, number, number] }).at

    b.moveTo(at[0], at[1], at[2])
    b.sendState('walk')
    await Bun.sleep(300)

    // 置いた本人にも届く。**離れた所から見ていれば「誰かが通った」と読める**
    expect(a.got('decoyBumped')).toBe(1)
    expect(b.got('decoyBumped')).toBe(1)
  }, 30000)

  /**
   * **傍に立ち続けても揺れ続けない。**
   *
   * 揺れっぱなしだと「そこに誰か居る」が漏れ続ける。通ったことは伝わるが、
   * 留まっていることまでは伝えない。
   */
  test('傍に立ち続けても、続けて揺れない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a9', 'dec-b9'])
    await placed(a)
    const at = (a.last.get('decoyPlaced') as { at: [number, number, number] }).at

    b.moveTo(at[0], at[1], at[2])
    for (let i = 0; i < 8; i++) {
      b.sendState('walk')
      await Bun.sleep(100)
    }
    expect(a.got('decoyBumped')).toBe(1)
  }, 30000)

  /**
   * **膨らみ切る前は揺れない。** まだ人の形をしていない。
   */
  test('膨らむ前は触れても揺れない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'decoy', ['dec-a10', 'dec-b10'])
    a.holdDecoy(true)
    a.sendState()
    await Bun.sleep(120)
    a.send({ type: 'decoy' })
    await Bun.sleep(200)
    const at = (a.last.get('decoyPlaced') as { at: [number, number, number] }).at

    b.moveTo(at[0], at[1], at[2])
    b.sendState('walk')
    await Bun.sleep(300)
    expect(a.got('decoyBumped')).toBe(0)
  }, 30000)
})

describe('置けるかどうか', () => {
  /**
   * **手にしていなければ置けない。**
   *
   * 装備の選択ではなく手にある物で決める (クレイモアと同じ)。申告は別に
   * 送れるので、こちらでも見る。
   */
  test('手にしていなければ置けない', async () => {
    server = await startServer()
    const { a } = await twoPlayers(server, 'decoy', ['dec-a7', 'dec-b7'])
    // holdDecoy を呼ばないまま置こうとする
    a.send({ type: 'decoy' })
    await Bun.sleep(300)
    expect(a.got('decoyPlaced')).toBe(0)
  }, 30000)

  /**
   * **数は有限。** 持っている数 (3) を超えては置けない。
   */
  test('持っている数より多くは置けない', async () => {
    server = await startServer()
    const client = await new Client(server, 'dec-solo', spot(0, 0)).ready()
    client.live()
    client.send({ type: 'loadout', primary: 'rifle', support: 'decoy' })
    await Bun.sleep(400)
    client.send({ type: 'ready', ready: true })
    await Bun.sleep(3400)
    client.send({ type: 'spawn' })
    await Bun.sleep(3600)

    client.holdDecoy(true)
    client.sendState()
    await Bun.sleep(120)
    for (let i = 0; i < 4; i++) {
      client.send({ type: 'decoy' })
      await Bun.sleep(150)
    }
    await Bun.sleep(400)
    expect(client.got('decoyPlaced')).toBe(SUPPORT_SPECS.decoy.count)
    client.close()
  }, 30000)

})
