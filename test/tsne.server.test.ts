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

/** 条件が立つまで待つ (最大 ms)。位置の便が数通届くのを待つ所で使う */
async function until(check: () => boolean, ms = 3000): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    if (check()) return true
    await Bun.sleep(100)
  }
  return check()
}

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
  test('**1 試合 = 先攻と後攻。間に支度を挟まず攻守を入れ替え、勝ったラウンドで決まる**', async () => {
    const { a, b } = await twoInTsne()
    const id = match(a)?.matchId
    // 先攻: alice (青) が攻める。復活なしなので 1 度倒れたらラウンドが終わる
    for (let i = 0; i < 6 && match(a)?.round === 1; i++) {
      b.send({ type: 'damage', id: 'bob', target: 'alice', kind: 'bullet', zone: 'HEAD', distance: 12 })
      await Bun.sleep(300)
    }
    await Bun.sleep(300)
    // まず合間 (ROUND 1 OVER)。このラウンドは守る側 (赤) の勝ち
    expect(match(a)?.phase).toBe('break')
    expect(match(a)?.winner).toBe('red')
    await Bun.sleep(4200)
    // 支度 (ready) を通らずに秒読みへ。攻守が入れ替わり、試合の札は同じ
    expect(match(a)?.phase).toBe('countdown')
    expect(match(a)?.round).toBe(2)
    expect(match(a)?.attack).toBe('red')
    expect(match(a)?.roundWins).toEqual({ blue: 0, red: 1 })
    expect(match(a)?.matchId).toBe(id)
    // 後攻: alice は守る側。殺傷の銃を選んで出る
    a.send({ type: 'loadout', primary: 'rifle', support: 'grenade' })
    await Bun.sleep(5200)
    a.send({ type: 'spawn' })
    b.send({ type: 'spawn' })
    await Bun.sleep(3600)
    expect(match(a)?.phase).toBe('playing')
    for (let i = 0; i < 6 && match(a)?.phase === 'playing'; i++) {
      a.send({ type: 'damage', id: 'alice', target: 'bob', kind: 'bullet', zone: 'HEAD', distance: 12 })
      await Bun.sleep(300)
    }
    await Bun.sleep(300)
    // 1 対 1 で引き分け
    expect(match(a)?.phase).toBe('over')
    expect(match(a)?.roundWins).toEqual({ blue: 1, red: 1 })
    expect(match(a)?.winner).toBe('draw')
    a.close()
    b.close()
  }, 50000)

  // **前の試験が試合を終わらせた後に置く。** 結果の画面 (14.5 秒) が明けるのを待ってから入る
  test('**ターゲット: 守る側の陣地の近くに置かれ、攻める側が触れると取り、自陣まで運べば攻める側の勝ち**', async () => {
    await Bun.sleep(15500)
    const { a, b } = await twoInTsne()
    const home = match(a)?.target
    expect(home?.carrier).toBeNull()
    // 守る側 (赤) の基地に近い置き場所 (city の target2)
    expect(home?.x).toBeCloseTo(-30.39, 1)
    expect(home?.z).toBeCloseTo(-50.89, 1)
    // 守る側が触れても何も起きない
    await b.walkTo(home!.x + 0.3, home!.y, home!.z)
    await Bun.sleep(300)
    expect(match(a)?.target?.carrier).toBeNull()
    // 攻める側が触れると取る。守る側に「取った」が届く
    b.reset()
    await a.walkTo(home!.x - 0.3, home!.y, home!.z)
    expect(await until(() => match(a)?.target?.carrier === 'alice')).toBe(true)
    expect(b.got('targetTaken')).toBe(1)
    // 落とすとその場に落ちる。落とした本人は 2 秒拾い直せない
    a.send({ type: 'dropTarget' })
    await Bun.sleep(300)
    expect(match(a)?.target?.carrier).toBeNull()
    // 手放したことも全員に届く (取った方も、守る側だけでなく攻める側にも)
    expect(b.got('targetDropped')).toBe(1)
    expect(a.got('targetTaken')).toBeGreaterThanOrEqual(1)
    expect(await until(() => match(a)?.target?.carrier === 'alice', 3500)).toBe(true)
    // 自陣 (青の基地) まで運ぶと、攻める側 (青) の勝ち
    await a.walkTo(-18.41, 10.01, 49.09)
    expect(await until(() => match(a)?.phase === 'break')).toBe(true)
    expect(match(a)?.winner).toBe('blue')
    a.close()
    b.close()
  }, 60000)

})
