import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'
import { STAGES } from '../src/domain/match/stage'
import { ROOM_STAGES } from '../src/domain/match/room'

/**
 * 練習部屋 (echo)。
 *
 * 見たいのは 3 つ: **1 人で入れること**、的が並んでいること、倒すと戻ること。
 * どれもサーバーだけで決まる話なので、画面を出さずに確かめられる。
 */
let server: Server

beforeAll(async () => {
  server = await startServer()
})

afterAll(() => server.stop())

/**
 * 撃つ人が立つ場所。**1 体目の的の 3m 手前。**
 *
 * ここは座標を写して書いていて、的を東棟へ移したときに置き去りになった
 * (的まで 45m になり、当たりの申告が届かなくなる)。写さずに元から採る。
 *
 * **echo が乗るステージから引く。** 部屋とステージの結び付きが変わっても、
 * ここは黙って追随する。
 */
const TARGET = STAGES[ROOM_STAGES.echo.stages[0]].targets[0]

async function enterPractice(id: string): Promise<Client> {
  const client = new Client(server, id, [TARGET.x, 0, TARGET.z + 3], 'echo')
  await client.ready()
  client.live()
  return client
}

describe('練習部屋', () => {
  test('1 人で入っても試合が始まっている', async () => {
    const solo = await enterPractice('solo')
    await Bun.sleep(600)
    const match = solo.last.get('match') as Extract<ServerMessage, { type: 'match' }>
    expect(match?.phase).toBe('playing')
    solo.close()
  })

  test('的が 5 体、赤で並んでいる', async () => {
    const solo = await enterPractice('watcher')
    await Bun.sleep(400)
    const roster = solo.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const targets = roster.players.filter((p) => p.id.startsWith('target-'))
    expect(targets.length).toBe(5)
    expect(targets.every((t) => t.team === 'red')).toBe(true)
    solo.close()
  })

  test('倒すと数秒で戻ってくる', async () => {
    const shooter = await enterPractice('shooter')
    // 支度に入ってから 3 秒 (CHOOSE_FLOOR) 待たないと湧けない。
    // **選ぶのが速いことは腕前ではない**、という規則がここにも効く
    await Bun.sleep(3400)
    shooter.send({ type: 'spawn' })
    await Bun.sleep(400)

    // **頭に当てたと申告する。** 位置は的のすぐ手前なので、遮蔽も距離も通る
    shooter.send({
      type: 'damage',
      id: 'shooter',
      target: 'target-0',
      kind: 'bullet',
      zone: 'HEAD',
      distance: 3,
    })
    await Bun.sleep(300)

    // **的の id で見る。** 種類だけで数えると、撃った本人の湧きを数えてしまう
    const downed = shooter.messages.some(
      (m) => m.type === 'life' && m.id === 'target-0' && m.state === 'downed',
    )
    expect(downed).toBe(true)

    // 戻るまで待つ (3 秒 + 余白)
    await Bun.sleep(3600)
    const revived = shooter.messages.some(
      (m) => m.type === 'life' && m.id === 'target-0' && m.state === 'alive',
    )
    expect(revived).toBe(true)
    const healed = shooter.messages.some(
      (m) => m.type === 'health' && m.id === 'target-0' && m.health === 100,
    )
    expect(healed).toBe(true)
    shooter.close()
  }, 20000)
})

describe('練習部屋で爆風', () => {
  test('手榴弾で倒しても的は戻ってくる', async () => {
    const shooter = await enterPractice('bomber')
    await Bun.sleep(3400)
    shooter.send({ type: 'spawn' })
    await Bun.sleep(400)
    shooter.reset()

    // 的の足元へ投げる。**すぐ下へ**投げれば爆風が両方に入る
    shooter.send({ type: 'grenade', dir: [0, -1, 0] })
    // 信管 (3 秒) + 余白
    await Bun.sleep(4000)

    const hurt = shooter.messages.filter(
      (m) => m.type === 'health' && m.id === 'target-0',
    )
    expect(hurt.length).toBeGreaterThan(0)

    /*
     * **サーバーが生きていること。**
     *
     * 爆風で的を転ばせる所で、的の接続を引こうとして例外が出ていた。プロセスが
     * 落ちるので**全部屋の全員が切れる** — 画面からは「敵が消えた」に見える。
     * 位置が流れ続けているかで生死を見る。
     */
    shooter.reset()
    await Bun.sleep(500)
    expect(shooter.states).toBeGreaterThan(0)
    // **握り潰した例外も見る。** 落ちなくなったぶん、静かに壊れる余地が増えた
    expect(server.errors()).not.toContain('接続が無い')
    expect(server.errors()).not.toContain('例外')

    // 倒れたなら、3 秒で戻る
    const downed = shooter.messages.some(
      (m) => m.type === 'life' && m.id === 'target-0' && m.state === 'downed',
    )
    if (downed) {
      await Bun.sleep(3600)
      const back = shooter.messages.some(
        (m) => m.type === 'life' && m.id === 'target-0' && m.state === 'alive',
      )
      expect(back).toBe(true)
    }
    shooter.close()
  }, 30000)
})

/**
 * 散弾で的が吹っ飛ぶか、そして**どちらへ倒れるか**。
 *
 * 弾は普通は体を動かさない (撃たれるたびに位置がずれると「動かない側が有利」で
 * なくなる) ので、突き飛ばすのは爆風だけにしてある。散弾だけ別で、粒がまとまって
 * 当たる間合い (SHOTGUN_KNOCK_RANGE) なら転ばせる。
 *
 * 的で見るのは**接続を持たない相手はサーバーが自分で動かす**から。人には向きだけ
 * 渡して動かすのはクライアント、という分担なので、ここが繋がっていないと
 * 「人は飛ぶが的は飛ばない」になる (実際そうなっていた)。
 */
describe('散弾で的を突き飛ばす', () => {
  /*
   * **前の試験が触っていない的を使う。** 同じサーバーを 1 本で使い回すので、
   * 倒したり吹き飛ばしたりした的をもう一度使うと、始まりの位置が違う。
   */
  const MINE = STAGES[ROOM_STAGES.echo.stages[0]].targets[2]
  const MINE_ID = 'target-2'

  /** 的の 3m 手前に立って、散弾銃を持って湧く */
  async function shooter(): Promise<Client> {
    const client = new Client(server, 'sg', [MINE.x, 0, MINE.z + 3], 'echo')
    await client.ready()
    client.live()
    // **湧く前に選ぶ。** 走っている試合では持ち替えられない (domain/player/equip.ts)
    client.send({ type: 'loadout', primary: 'shotgun', support: 'grenade' })
    await Bun.sleep(3400)
    client.claimedWeapon = 'shotgun'
    client.send({ type: 'spawn' })
    await Bun.sleep(600)
    return client
  }

  function firstTarget(client: Client): { id: string; slot: number } {
    const roster = client.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
    const found = roster.players.find((p) => p.id === MINE_ID)
    if (!found || found.slot === undefined) throw new Error('的が名簿に居ない')
    return { id: found.id, slot: found.slot }
  }

  test('近くで撃てば滑って転ぶ', async () => {
    const me = await shooter()
    const target = firstTarget(me)
    const before = { ...me.poses.get(target.slot)! }

    me.send({ type: 'damage', id: me.id, target: target.id, kind: 'bullet', zone: 'BODY', distance: 3 })
    await Bun.sleep(500)

    const after = me.poses.get(target.slot)!
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1)
    // 滑るだけでなく転ぶ。**時間で立ち上がる** (server/match.ts)
    expect(after.locomotion).toBe('sweep')
    me.close()
  })

  test('**離れていれば飛ばない。** 掠っただけで転ぶことにはしない', async () => {
    const me = await shooter()
    const target = firstTarget(me)
    const before = { ...me.poses.get(target.slot)! }

    // 吹き飛ぶ帯 (8m) の外
    me.send({ type: 'damage', id: me.id, target: target.id, kind: 'bullet', zone: 'BODY', distance: 12 })
    await Bun.sleep(500)

    const after = me.poses.get(target.slot)!
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.1)
    me.close()
  })

  /**
   * **正面から撃たれたら後ろへ倒れる。** 倒れ方そのものが「どこから撃たれたか」の
   * 情報になる。的は自分の前に居る人を向いているので、後ろ倒れになる。
   */
  test('倒れる向きが撃たれた向きに合う', async () => {
    const me = await shooter()
    const target = firstTarget(me)
    // 的の体力は 100。8m 以内は 1 発 50 なので 2 発で倒れる
    for (let i = 0; i < 2; i++) {
      me.send({ type: 'damage', id: me.id, target: target.id, kind: 'bullet', zone: 'BODY', distance: 3 })
      await Bun.sleep(900)
    }
    await Bun.sleep(400)
    expect(me.poses.get(target.slot)!.locomotion).toBe('death_back')
    me.close()
    // 湧くのを待って撃つので、既定の 5 秒では足りない
  }, 15000)
})
