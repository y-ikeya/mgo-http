import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client, startServer, twoPlayers, type Server, openSpot } from './server'

/**
 * 「クライアントが期待するものが、期待する順で届くか」の試験。
 *
 * --- なぜこの見方をするか ---
 * サーバー側の試験を「配ったか」だけで書いていて、1 日に 3 回すり抜けた。
 * どれも**届いてはいたが、受け取る側が捨てていた / 判断できなかった**という形:
 *
 *   - 名簿に状態 (life) が乗っていなかった → 相手が既定値のまま描かれない
 *   - 切れた瞬間に leave を配っていた → 実体ごと捨てられ、体が残らない
 *   - resume を名簿より先に送っていた → 名簿を受けた側が湧き地点へ上書き
 *
 * 通数だけでなく**中身と順序**を見る。
 *
 * ステージの形には依存しない (遮蔽の裏を要求する試験は座標をステージから
 * 探す必要があるので、ここには置かない)。
 *
 * --- 1 試験に 1 サーバー ---
 * 部屋の状態はサーバーが持っていて、席は切れても 30 秒残る。使い回すと
 * **前の試験の残りが次に効く** (実際、閉じたはずの人の体が次の試験に混ざった)。
 * 起動は 1 秒ほどなので、毎回立て直すほうが安い。
 */

let server: Server

// 起動を待つので、既定の 5 秒では足りないことがある (CI の機械は遅い)
beforeEach(async () => {
  server = await startServer()
}, 30_000)

afterEach(() => {
  server.stop()
})

describe('名簿', () => {
  test('全員の状態を運ぶ', async () => {
    // life は「変わった時」にしか配られない。後から繋いだ人は、名簿で
    // 受け取らないと相手の状態を一度も知らないまま = 描かれない
    const { a } = await twoPlayers(server)

    const late = await new Client(server, 'late', openSpot(5, 0)).ready()
    late.live()
    await Bun.sleep(500)

    const roster = late.last.get('roster')
    expect(roster?.type).toBe('roster')
    if (roster?.type !== 'roster') throw new Error('名簿が来ていない')

    const alice = roster.players.find((p) => p.id === a.id)
    expect(alice).toBeDefined()
    expect(alice?.life).toBe('alive')

    late.close()
    a.close()
  }, 20_000)
})

describe('ブラウザを閉じたとき', () => {
  test('leave を配らない。体はその場に残る', async () => {
    // 配ると受け取った側が実体を捨てる。そのあと届く体を新品として作り直し、
    // 状態を見失って一度も描かれない
    const { a, b } = await twoPlayers(server)

    a.reset()
    b.close()
    await Bun.sleep(2000)

    expect(a.got('leave')).toBe(0)
    // 体が配られ続けている
    expect(a.states).toBeGreaterThan(0)
    // 姿勢は差し替わる。そのまま配ると走っていた人がその場で走り続ける
    expect(a.locomotion).toBe('away')
    // 状態も知らされる
    const life = a.last.get('life')
    expect(life?.type === 'life' && life.state).toBe('dropped')

    a.close()
  }, 20_000)
})

describe('繋ぎ直し', () => {
  test('resume は名簿のあとに来る', async () => {
    // 先に送ると、名簿を受けたクライアントが placeAtSpawn で自分を湧き地点へ
    // 置いてしまい、せっかく戻した位置が上書きされる (ワープになる)
    const { a, b } = await twoPlayers(server)
    b.moveTo(3, 0, 8)
    await Bun.sleep(400)
    b.close()
    await Bun.sleep(600)

    const back = await new Client(server, 'bob', openSpot(3, 8)).ready()
    back.live()
    await Bun.sleep(800)

    const roster = back.order.indexOf('roster')
    const resume = back.order.indexOf('resume')
    expect(roster).toBeGreaterThanOrEqual(0)
    expect(resume).toBeGreaterThan(roster)

    back.close()
    a.close()
  }, 20_000)

  test('その命の続きから始まる (装備画面に戻らない)', async () => {
    // 支度からやり直させていた頃は、瀕死でリロードすれば全快して装備も
    // 選び直せた。撃ち合いで不利になったらリロードするのが最適解になる
    const { a, b } = await twoPlayers(server)
    // 削って弾も減らす
    for (let i = 0; i < 3; i++) {
      a.send({
        type: 'damage',
        id: a.id,
        target: b.id,
        kind: 'bullet',
        zone: 'LEGS',
        distance: 12,
      })
      await Bun.sleep(350)
    }
    for (let i = 0; i < 8; i++) {
      b.send({ type: 'shot', id: b.id, from: [0, 1.5, 6], to: [0, 1.5, 20] })
      await Bun.sleep(100)
    }
    expect(await hurt(server, b.id)).toBeLessThan(100)

    b.close()
    await Bun.sleep(800)
    const back = await new Client(server, 'bob', openSpot(0, 6)).ready()
    back.live()
    await Bun.sleep(1200)

    // 支度ではなく、その命の続き
    expect(back.life).toBe('alive')
    const resume = back.last.get('resume')
    if (resume?.type !== 'resume') throw new Error('resume が来ていない')
    expect(resume.health).toBeLessThan(100)
    expect(resume.magazine.rifle).toBeLessThan(30)

    back.close()
    a.close()
  }, 30_000)

  test('何度繋ぎ直しても続きから', async () => {
    // dropped → alive が遷移の表に無く、setLife に弾かれて dropped のまま
    // 残ったことがある。そのとき 2 回目のリロードで装備画面が出た
    const { a, b } = await twoPlayers(server)
    let bob = b
    for (let round = 0; round < 3; round++) {
      bob.close()
      await Bun.sleep(700)
      bob = await new Client(server, 'bob', openSpot(0, 6)).ready()
      bob.live()
      await Bun.sleep(1000)
      expect(bob.life).toBe('alive')
    }
    bob.close()
    a.close()
  }, 30_000)
})

/** /health からその人の体力を読む */
async function hurt(server: Server, name: string): Promise<number> {
  const text = await server.health()
  const line = text.match(new RegExp(`${name} \\((\\d+)\\)`))
  return line ? Number(line[1]) : -1
}
