import { afterEach, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'

/**
 * **揃ったら、まず告げる。** 人が揃った瞬間に支度へ入らず、「対戦者が揃いました」を
 * 数秒見せてから支度 (ready) へ移る (domain/match/match.ts の assembled)。
 *
 * 試験の既定は告知 0 秒 (test/server.ts) なので、ここだけ長さを戻して段階を見る。
 */
let server: Server | null = null
afterEach(() => {
  server?.stop()
  server = null
})

/** 届いた match の段階を、来た順に (続きの重なりは畳む) */
function phases(client: Client): string[] {
  const out: string[] = []
  for (const m of client.messages) {
    if (m.type !== 'match') continue
    if (out[out.length - 1] !== m.phase) out.push(m.phase)
  }
  return out
}

describe('揃った告知', () => {
  test('2 人揃うと assembled を挟んでから ready になる', async () => {
    server = await startServer({ MGO2_ASSEMBLE_MS: '1500' })
    const a = await new Client(server, 'as-a', spot(0, -6)).ready()
    a.live()
    await Bun.sleep(300)
    const b = await new Client(server, 'as-b', spot(0, 6)).ready()
    b.live()
    // 揃った直後は告知
    await Bun.sleep(700)
    expect(phases(a)).toContain('assembled')
    expect(phases(a)).not.toContain('ready')
    // 告知の後に支度
    await Bun.sleep(1800)
    const seen = phases(a)
    expect(seen.indexOf('assembled')).toBeGreaterThanOrEqual(0)
    expect(seen.indexOf('ready')).toBeGreaterThan(seen.indexOf('assembled'))
    a.close()
    b.close()
  }, 30000)

  test('告知の間に抜けたら待ちへ戻る', async () => {
    server = await startServer({ MGO2_ASSEMBLE_MS: '3000' })
    const a = await new Client(server, 'as-c', spot(0, -6)).ready()
    a.live()
    await Bun.sleep(300)
    const b = await new Client(server, 'as-d', spot(0, 6)).ready()
    b.live()
    await Bun.sleep(700)
    expect(phases(a)).toContain('assembled')
    b.send({ type: 'leave', id: b.id })
    b.close()
    await Bun.sleep(1500)
    expect(phases(a).at(-1)).toBe('waiting')
    a.close()
  }, 30000)
})
