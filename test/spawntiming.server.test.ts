import { afterEach, expect, test } from 'bun:test'
import { Client, phaseOf, spot, startServer, waitFor, type Server } from './server'

/**
 * **支度の床と湧き無敵が、実際に効くこと。**
 *
 * 試験の既定ではどちらも 0 (test/server.ts が MGO2_CHOOSE_FLOOR_MS /
 * MGO2_SPAWN_PROTECT_MS を 0 で立てる) — 開始手順が 1 件ごとに 7 秒を
 * 使わないため。ここは readygrace / assembled と同じ形で、**ここだけ
 * 長さを本物へ戻して**、短くしたことで規則が消えていないことを見る。
 *
 * 数字そのもの (床 3 秒・無敵 3 秒) は domain の試験が持つ。ここで見るのは
 * サーバーの門 — 床が明ける前の spawn を通さないことと、無敵の間は
 * canBeHurt が閉じていて削れないこと
 */
let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

test('床が明ける前の spawn は通らず、無敵の間は削れない', async () => {
  server = await startServer({ MGO2_CHOOSE_FLOOR_MS: '3000', MGO2_SPAWN_PROTECT_MS: '3000' })
  const a = await new Client(server, 'st-a', spot(0, -6)).ready()
  const b = await new Client(server, 'st-b', spot(0, 6)).ready()
  a.live()
  b.live()
  await waitFor(() => phaseOf(a) === 'ready' && phaseOf(b) === 'ready', '支度の段階に入る')
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  // 秒読みは試験の既定で 0。始まってすぐは、まだ床 (3 秒) の中
  await waitFor(() => phaseOf(a) === 'playing', '試合が始まる')

  // 床が明ける前に出ようとしても、湧けない
  a.send({ type: 'spawn' })
  await Bun.sleep(400)
  expect(a.life).toBe('choosing')
  expect(a.messages.some((m) => m.type === 'respawn' && m.id === 'st-a')).toBe(false)

  // 床が明ければ湧ける (2 人とも)。明けるまで送り続ける
  const until = Date.now() + 10_000
  for (;;) {
    if (a.life === 'choosing') a.send({ type: 'spawn' })
    if (b.life === 'choosing') b.send({ type: 'spawn' })
    if (a.life === 'spawning' && b.life === 'spawning') break
    if (Date.now() > until) throw new Error(`湧けない: a=${a.life}, b=${b.life}`)
    await Bun.sleep(50)
  }

  // 無敵の間は、当たったと申告しても削れない
  b.reset()
  b.send({ type: 'damage', id: 'st-b', target: 'st-a', kind: 'bullet', zone: 'HEAD', distance: 12 })
  await Bun.sleep(400)
  expect(a.life).toBe('spawning')
  expect(b.messages.some((m) => m.type === 'health' && m.id === 'st-a')).toBe(false)

  // 無敵が明ければ、同じ申告で削れる
  await waitFor(() => a.life === 'alive' && b.life === 'alive', '無敵が明ける')
  b.send({ type: 'damage', id: 'st-b', target: 'st-a', kind: 'bullet', zone: 'HEAD', distance: 12 })
  await waitFor(
    () => b.messages.some((m) => m.type === 'health' && m.id === 'st-a'),
    '明けたあとは削れる',
  )

  a.close()
  b.close()
}, 30_000)
