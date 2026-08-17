import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { startServer, twoPlayers, type Client, type Server } from './server'
import { DEATH_POINTS, KILL_POINTS, pointsOf, SUICIDE_POINTS } from '../src/sim/scoring'

/**
 * 点の付き方の試験。
 *
 * キル数で決めていた頃は、**死ぬ側にコストが無かった**。突っ込んで 1 人
 * 道連れにすれば差し引きゼロなので、隠れる意味が薄い。倒された側から引くと
 * 死なないこと自体に価値が出る。
 *
 * 陣営の点はサーバーが持ち、個人の点は手元で同じ式から出す。**その 2 つが
 * 食い違わないこと**が要るので、両方を見る。
 */

let server: Server

beforeEach(async () => {
  server = await startServer()
}, 30_000)

afterEach(() => {
  server.stop()
})

/** /health から陣営の点を読む */
async function teams(server: Server): Promise<{ blue: number; red: number }> {
  const text = await server.health()
  const found = text.match(/青 (-?\d+) - 赤 (-?\d+)/)
  if (!found) throw new Error(`点が読めない:\n${text}`)
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

describe('点', () => {
  test('倒した側に入り、倒された側から引く', async () => {
    const { a, b } = await twoPlayers(server)
    const before = await teams(server)
    const attacker = teamOf(a)
    const victim = teamOf(b)

    a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'HEAD', distance: 12 })
    await Bun.sleep(800)

    const after = await teams(server)
    expect(after[attacker] - before[attacker]).toBe(KILL_POINTS)
    // **引く側が要。** 入れるだけだと、突っ込んで相打ちを続けるのが成り立つ
    expect(after[victim] - before[victim]).toBe(DEATH_POINTS)

    a.close()
    b.close()
  }, 40_000)

  test('自死は自陣から引くだけ。敵には入らない', async () => {
    // 引かないと、倒されそうなときに自分で死ぬのが点を渋る手になる
    const { a, b } = await twoPlayers(server)

    // 爆風は単体では死なない (最大 75)。削っておく
    for (let i = 0; i < 8 && (await hurt(server, a.id)) > 70; i++) {
      b.send({ type: 'damage', id: b.id, target: a.id, kind: 'bullet', zone: 'BODY', distance: 12 })
      await Bun.sleep(300)
    }
    expect(await hurt(server, a.id)).toBeLessThanOrEqual(70)

    const before = await teams(server)
    const mine = teamOf(a)
    const theirs = teamOf(b)

    // 真下へ投げる。throwVelocity は真下のときだけ下駄を履かせないので、
    // これだけが足元に落ちる (少しでも傾けると 28 度の下駄で 10m 先へ飛ぶ)。
    // 相手は 12m 先に居るので巻き込まれない
    a.send({ type: 'grenade', dir: [0, -1, 0] })
    await Bun.sleep(4500)

    const after = await teams(server)
    expect(after[mine] - before[mine]).toBe(SUICIDE_POINTS)
    // 手柄は誰にも付かない
    expect(after[theirs]).toBe(before[theirs])

    a.close()
    b.close()
  }, 60_000)

  test('個人の点を足すと陣営の点になる', async () => {
    // 陣営の点はサーバーが持ち、個人の点は手元で出す。同じ式を通していないと
    // 成績表の合計と上の点差が食い違う
    const { a, b } = await twoPlayers(server)
    a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'HEAD', distance: 12 })
    await Bun.sleep(1200)

    const match = a.last.get('match')
    if (match?.type !== 'match') throw new Error('match が来ていない')
    for (const team of ['blue', 'red'] as const) {
      const sum = match.players
        .filter((p) => p.team === team)
        .reduce((total, p) => total + pointsOf(p), 0)
      expect(sum).toBe(match[team])
    }

    a.close()
    b.close()
  }, 40_000)
})
