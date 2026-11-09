import { afterEach, expect, test } from 'bun:test'
import { Client, phaseOf, spot, startServer, waitFor, type Server } from './server'

/**
 * **支度の間に、押していない人が抜けたら、残りが揃っていれば始まる** (2026-11-09 本人
 * 「3 人で 2 人が ready、3 人目が ready せずに room を抜けると、そのまま試合開始して欲しいのに始まらない」)
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

async function readyRoom(prefix: string): Promise<Client[]> {
  const a = await new Client(server!, `${prefix}-a`, spot(0, -6)).ready()
  const b = await new Client(server!, `${prefix}-b`, spot(0, 6)).ready()
  const c = await new Client(server!, `${prefix}-c`, spot(6, 0)).ready()
  for (const x of [a, b, c]) x.live()
  await waitFor(() => [a, b, c].every((x) => phaseOf(x) === 'ready'), '支度に入る')
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  await Bun.sleep(300)
  expect(phaseOf(a)).toBe('ready')
  return [a, b, c]
}

test('押していない人が「出る」で抜けたら始まる', async () => {
  server = await startServer()
  const [a, b, c] = await readyRoom('rl1')
  c.send({ type: 'leave', id: c.id })
  c.close()
  await waitFor(() => phaseOf(a) !== 'ready', '支度が明ける', 5000)
  a.close()
  b.close()
}, 30000)

test('押していない人が何も言わずに切れても (タブを閉じた)、待たずに始まる', async () => {
  server = await startServer()
  const [a, b, c] = await readyRoom('rl2')
  c.close()
  await waitFor(() => phaseOf(a) !== 'ready', '支度が明ける', 5000)
  a.close()
  b.close()
}, 30000)
