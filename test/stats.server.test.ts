import { afterEach, describe, expect, test } from 'bun:test'
import { Client, startServer, twoPlayers, type Server } from './server'

/**
 * 戦績が残るかの試験。
 *
 * --- なぜ本物の Supabase を使わないか ---
 * 秘密鍵が要るし、試験のたびに本番の表が汚れる。**送っている中身**さえ見られれば
 * 十分なので、同じ形の口を持つ箱を立ててそちらへ向ける。
 *
 * --- 何を見るか ---
 * 数え上げそのものは /health で見える。ここで見るのは**書かれる機会**のほう:
 *
 *   - 抜けた人は、試合が終わるのを待たずにその場で書かれるか
 *     (終わる頃にはもう部屋に居ないので、まとめてでは拾えない)
 *   - 決着したときに、残っている全員 + 締めが書かれるか
 *   - 全部が同じ試合 (match_id) に紐づくか
 */

let server: Server | null = null
let stub: Recorder | null = null

afterEach(() => {
  server?.stop()
  stub?.stop()
  server = null
  stub = null
})

interface Recorder {
  port: number
  calls: { fn: string; body: Record<string, unknown> }[]
  stop(): void
}

/** Supabase の代わりに RPC を受け止める箱 */
function recorder(): Recorder {
  const calls: { fn: string; body: Record<string, unknown> }[] = []
  const listening = Bun.serve({
    port: 0,
    async fetch(request) {
      const fn = new URL(request.url).pathname.split('/').pop() ?? ''
      calls.push({ fn, body: (await request.json()) as Record<string, unknown> })
      return new Response('null')
    },
  })
  return { port: listening.port ?? 0, calls, stop: () => listening.stop(true) }
}

/** その人の記録。無ければ落ちる */
function record(stub: Recorder, subject: string): Record<string, unknown> {
  const found = stub.calls.find(
    (c) => c.fn === 'record_match_player' && c.body.p_auth_subject === subject,
  )
  if (!found) throw new Error(`${subject} の記録が送られていない`)
  return found.body
}

async function withRecording(): Promise<{ server: Server; stub: Recorder }> {
  stub = recorder()
  server = await startServer({
    SUPABASE_URL: `http://localhost:${stub.port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test',
  })
  return { server, stub }
}

describe('戦績', () => {
  test('抜けた人はその場で、残った人は決着で書かれる', async () => {
    const { server, stub } = await withRecording()
    const { a, b } = await twoPlayers(server)

    a.send({
      type: 'damage',
      id: a.id,
      target: b.id,
      kind: 'bullet',
      zone: 'HEAD',
      distance: 12,
    })
    await Bun.sleep(1500)

    // bob が tab から明示的に抜ける。相手が居なくなるので alice の不戦勝
    b.send({ type: 'leave', id: b.id })
    await Bun.sleep(3000)

    const bob = record(stub, b.id)
    // **抜けたことごと残す。** 残さないと、劣勢になったら抜ければ
    // 負けが付かないことになる
    expect(bob.p_left_early).toBe(true)
    expect(bob.p_deaths).toBe(1)
    expect(bob.p_head_deaths).toBe(1)

    const alice = record(stub, a.id)
    expect(alice.p_left_early).toBe(false)
    expect(alice.p_kills).toBe(1)
    expect(alice.p_headshots).toBe(1)
    // 武器は表示名ではなく id で。銃の名前を変えても過去の記録が壊れないように
    expect(alice.p_by_weapon).toEqual({ rifle: 1 })

    const closed = stub.calls.find((c) => c.fn === 'close_match')
    expect(closed?.body.p_winner).toBe(alice.p_team)
    // 締めは記録より先に着くことがあるので、試合を作れるだけの材料を持たせる
    expect(closed?.body.p_room).toBe(bob.p_room)
    expect(closed?.body.p_started_at).toBe(bob.p_started_at)

    // 全部が同じ試合の話
    expect(alice.p_match_id).toBe(bob.p_match_id as string)
    expect(closed?.body.p_match_id).toBe(bob.p_match_id as string)

    a.close()
  }, 40_000)

  test('リロードでは抜けたことにしない', async () => {
    // 30 秒待つ席は「まだ抜けていない」。ここで書くと、電波が一瞬切れただけで
    // 離脱が付く
    const { server, stub } = await withRecording()
    const { a, b } = await twoPlayers(server)

    b.close()
    await Bun.sleep(2000)
    const back = await new Client(server, b.id, [0, 0, 6]).ready()
    back.live()
    await Bun.sleep(1000)

    expect(stub.calls).toHaveLength(0)

    back.close()
    a.close()
  }, 40_000)

  test('鍵が無ければ何も送らない', async () => {
    // **遊ぶのに外部サービスが要る状態にはしない。** 手元で立ち上げて
    // 対戦するのに Supabase の設定は要らない
    stub = recorder()
    server = await startServer({
      SUPABASE_URL: `http://localhost:${stub.port}`,
      SUPABASE_SERVICE_ROLE_KEY: '',
    })
    const { a, b } = await twoPlayers(server)
    b.send({ type: 'leave', id: b.id })
    await Bun.sleep(3000)

    expect(stub.calls).toHaveLength(0)
    a.close()
  }, 40_000)

  test('配置で止めても、走っていた試合は書き出される', async () => {
    // 部屋はメモリにしか無い。そのまま落とすとその回の戦績が丸ごと消える
    const { server, stub } = await withRecording()
    const { a, b } = await twoPlayers(server)
    a.send({
      type: 'damage',
      id: a.id,
      target: b.id,
      kind: 'bullet',
      zone: 'HEAD',
      distance: 12,
    })
    await Bun.sleep(1000)

    await server.terminate()

    expect(record(stub, a.id).p_kills).toBe(1)
    // **離脱にはしない。** 抜けさせたのはこちらの都合であって、本人ではない
    expect(record(stub, b.id).p_left_early).toBe(false)
    // 決着はしていないので締めない (ended_at は null のまま)
    expect(stub.calls.some((c) => c.fn === 'close_match')).toBe(false)

    a.close()
    b.close()
  }, 40_000)

  test('鍵を渡さずに立てたサーバーは、何処へも書かない', async () => {
    // **手元の .env を継がないことの試験。** bun は .env を勝手に読むので、
    // startServer が既定で鍵を空にしていないと、試験を回すだけで本番の表に
    // alice / bob の戦績が積まれる (実際に 33 試合ぶん積まれた)。
    //
    // 行き先だけ箱に向けて、鍵は渡さない。既定が壊れたらここに通信が来る
    stub = recorder()
    server = await startServer({ SUPABASE_URL: `http://localhost:${stub.port}` })
    const { a, b } = await twoPlayers(server)
    b.send({ type: 'leave', id: b.id })
    await Bun.sleep(3000)

    expect(stub.calls).toHaveLength(0)
    a.close()
  }, 40_000)
})
