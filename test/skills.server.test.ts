import { afterEach, describe, expect, test } from 'bun:test'
import { Client, startServer, type Server } from './server'

/**
 * スキルの選択が残るか。
 *
 * --- なぜここを見るか ---
 * 長らく**試合が始まった瞬間に 1 回だけ**書いていた。選べる窓が閉じるのが
 * そこなので 1 か所で足りる、という理屈だった。
 *
 * **練習の部屋は試合が終わらない** (room.ts の tickets: false)。始まりが一度
 * しか来ないので、そこで選び直した分は永久に書かれない。繋ぎ直すたびに
 * 未選択へ戻る、という形で出た。
 *
 * 見たいのは「選んだ物が書かれる機会があるか」だけなので、本物の Supabase は
 * 要らない。同じ形の口を持つ箱を立てて、そこへ来た通を数える (stats と同じ形)。
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

function recorder(): Recorder {
  const calls: { fn: string; body: Record<string, unknown> }[] = []
  const listening = Bun.serve({
    port: 0,
    async fetch(request) {
      const fn = new URL(request.url).pathname.split('/').pop() ?? ''
      calls.push({ fn, body: (await request.json()) as Record<string, unknown> })
      // 読み出しは「何も書いていない」を返す。前回の選択に引きずられない
      return new Response('null')
    },
  })
  return { port: listening.port ?? 0, calls, stop: () => listening.stop(true) }
}

/** 書き込みだけ。入室のたびに飛ぶ読み出し (get_player_skills) は数えない */
function saved(stub: Recorder): Record<string, unknown>[] {
  return stub.calls.filter((c) => c.fn === 'set_player_skills').map((c) => c.body)
}

async function withRecording(): Promise<{ server: Server; stub: Recorder }> {
  stub = recorder()
  server = await startServer({
    SUPABASE_URL: `http://localhost:${stub.port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test',
  })
  return { server, stub }
}

describe('スキルの保存', () => {
  test('**練習部屋で選び直した分が書かれる。** 試合が終わらなくても', async () => {
    const { server, stub } = await withRecording()
    const solo = new Client(server, 'ike', [0, 0, 0], 'echo')
    await solo.ready()
    solo.live()
    // 試合が始まるのを待つ。ここで書かれていた頃は、まだ何も選んでいない
    await Bun.sleep(600)
    expect(saved(stub)).toHaveLength(0)

    solo.send({ type: 'skills', skills: { rifleMastery: 3 } })
    await Bun.sleep(300)

    const written = saved(stub)
    expect(written).toHaveLength(1)
    expect(written[0].p_auth_subject).toBe('ike')
    expect(written[0].p_skills).toEqual({ rifleMastery: 3 })
    solo.close()
  })

  test('効いている物が本人へ返る', async () => {
    const { server } = await withRecording()
    const solo = new Client(server, 'ike', [0, 0, 0], 'echo')
    await solo.ready()
    solo.live()
    await Bun.sleep(600)

    solo.send({ type: 'skills', skills: { rifleMastery: 2 } })
    await Bun.sleep(300)
    const reply = solo.last.get('skills') as { skills: Record<string, number> } | undefined
    expect(reply?.skills).toEqual({ rifleMastery: 2 })
    solo.close()
  })

  test('**同じ物を送り直しても書き直さない。** 段を触るたびに往復が増える', async () => {
    const { server, stub } = await withRecording()
    const solo = new Client(server, 'ike', [0, 0, 0], 'echo')
    await solo.ready()
    solo.live()
    await Bun.sleep(600)

    solo.send({ type: 'skills', skills: { rifleMastery: 3 } })
    await Bun.sleep(200)
    solo.send({ type: 'skills', skills: { rifleMastery: 3 } })
    await Bun.sleep(300)

    expect(saved(stub)).toHaveLength(1)
    solo.close()
  })

  test('予算を超えた選択は書かれない。**弾いた物を残さない**', async () => {
    const { server, stub } = await withRecording()
    const solo = new Client(server, 'ike', [0, 0, 0], 'echo')
    await solo.ready()
    solo.live()
    await Bun.sleep(600)

    // 予算は 4。3 + 3 で 6 なので丸ごと弾かれる
    solo.send({ type: 'skills', skills: { rifleMastery: 3, runner: 3 } })
    await Bun.sleep(300)

    expect(saved(stub)).toHaveLength(0)
    solo.close()
  })
})
