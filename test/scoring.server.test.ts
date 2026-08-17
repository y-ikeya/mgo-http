import { afterEach, describe, expect, test } from 'bun:test'
import { startServer, twoPlayers, type Client, type Server } from './server'
import { pointsOf } from '../src/sim/scoring'

/**
 * TDM の勝敗 (残機) と、個人の点の試験。
 *
 * **陣営の勝敗と個人の成績は別のもの。** 陣営は残機の削り合いで決まり、
 * 個人の点 (Lv のもと) はそれとは無関係に積む。混ぜると、点を稼ぐ動きと
 * 勝ちに行く動きが食い違ったときに説明が付かなくなる。
 *
 * 残機は死因を問わず 1 減るので、自死しても敵に何も渡さない代わりに自陣の損は
 * 同じ。「殺されるくらいなら自死する」がここで潰れている。
 */

let server: Server

afterEach(() => {
  server?.stop()
})

/** その人が alive になるまで待つ。倒れる尺と支度の床があるので数秒かかる */
async function waitAlive(server: Server, client: Client, limit = 25_000): Promise<void> {
  const until = Date.now() + limit
  for (;;) {
    const line = ((await server.health()).match(new RegExp(`${client.id}[^\n]*`)) ?? [''])[0]
    if (line.includes('[alive]')) return
    if (line.includes('[choosing]')) client.send({ type: 'spawn' })
    if (Date.now() > until) throw new Error(`${client.id} が alive にならない`)
    await Bun.sleep(400)
  }
}

/** /health から陣営の残機を読む */
async function teams(server: Server): Promise<{ blue: number; red: number }> {
  const text = await server.health()
  const found = text.match(/青 (-?\d+) - 赤 (-?\d+)/)
  if (!found) throw new Error(`残機が読めない:\n${text}`)
  return { blue: Number(found[1]), red: Number(found[2]) }
}

/** /health からその人の体力を読む */
async function hurt(server: Server, name: string): Promise<number> {
  const text = await server.health()
  const line = text.match(new RegExp(`${name} \\((\\d+)\\)`))
  return line ? Number(line[1]) : -1
}

/** その人の陣営 (match で配られたもの) */
function teamOf(client: Client): 'blue' | 'red' {
  const match = client.last.get('match')
  if (match?.type !== 'match') throw new Error('match が来ていない')
  const found = match.players.find((p) => p.id === client.id)
  if (!found) throw new Error(`${client.id} が名簿に居ない`)
  return found.team
}

describe('残機', () => {
  test('死ぬと自陣が 1 減る。倒した側には何も入らない', async () => {
    server = await startServer({ MGO2_TICKETS: '3' })
    const { a, b } = await twoPlayers(server)
    const before = await teams(server)
    const attacker = teamOf(a)
    const victim = teamOf(b)

    await waitAlive(server, b)
    a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'HEAD', distance: 12 })
    await Bun.sleep(900)

    const after = await teams(server)
    expect(after[victim]).toBe(before[victim] - 1)
    // **倒した側は増えない。** 増やすと相打ちで差が付かなくなる
    expect(after[attacker]).toBe(before[attacker])

    a.close()
    b.close()
  }, 40_000)

  test('削り切ったらその場で終わる。時間切れを待たない', async () => {
    server = await startServer({ MGO2_TICKETS: '2' })
    const { a, b } = await twoPlayers(server)
    const winner = teamOf(a)

    for (let i = 0; i < 2; i++) {
      await waitAlive(server, b)
      a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'HEAD', distance: 12 })
      await Bun.sleep(900)
    }

    const after = await teams(server)
    expect(after[teamOf(b)]).toBe(0)
    const match = a.last.get('match')
    if (match?.type !== 'match') throw new Error('match が来ていない')
    // 試合は 5 分だが、削り切った時点で終わっている
    expect(match.phase).toBe('over')
    expect(match.winner).toBe(winner)

    a.close()
    b.close()
  }, 60_000)

  test('自死でも自陣の残機が減る。敵は増えない', async () => {
    // 残機は死因を問わない。だから「殺されるくらいなら自死」が成り立たない
    server = await startServer({ MGO2_TICKETS: '5' })
    const { a, b } = await twoPlayers(server)

    for (let i = 0; i < 8 && (await hurt(server, a.id)) > 70; i++) {
      b.send({ type: 'damage', id: b.id, target: a.id, kind: 'bullet', zone: 'BODY', distance: 12 })
      await Bun.sleep(300)
    }
    const before = await teams(server)
    const mine = teamOf(a)
    const theirs = teamOf(b)

    // 真下へ投げる。相手は 12m 先なので巻き込まれない
    a.send({ type: 'grenade', dir: [0, -1, 0] })
    await Bun.sleep(4500)

    const after = await teams(server)
    expect(after[mine]).toBe(before[mine] - 1)
    expect(after[theirs]).toBe(before[theirs])

    a.close()
    b.close()
  }, 60_000)
})

describe('個人の点', () => {
  test('陣営の残機とは無関係に積む', async () => {
    // 点は Lv のもと。勝敗を決めるものではないので、残機と一致する必要はない
    server = await startServer({ MGO2_TICKETS: '5' })
    const { a, b } = await twoPlayers(server)
    await waitAlive(server, b)
    a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'HEAD', distance: 12 })
    await Bun.sleep(1200)

    const match = a.last.get('match')
    if (match?.type !== 'match') throw new Error('match が来ていない')
    const killer = match.players.find((p) => p.id === a.id)
    const killed = match.players.find((p) => p.id === b.id)
    if (!killer || !killed) throw new Error('名簿に居ない')

    expect(pointsOf(killer)).toBeGreaterThan(0)
    expect(pointsOf(killed)).toBeLessThan(0)
    // 残機は 5 から 4 へ減っただけ。点とは桁も向きも違う
    expect((await teams(server))[teamOf(b)]).toBe(4)

    a.close()
    b.close()
  }, 40_000)
})
