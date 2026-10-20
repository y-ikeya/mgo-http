import { afterEach, describe, expect, test } from 'bun:test'
import { startServer, twoPlayers, type Server } from './server'
import { ROLL_STAMINA } from '../src/domain/rule/damage'
import { MAX_STAMINA } from '../src/domain/player/stamina'

/**
 * ローリングの体当たり。**相手の姿勢で効き方が変わる** (本人 2026-10-20)。
 *
 *     立っている     押しのけてよろける + スタミナ 1/8
 *     しゃがんでいる 後ろへ倒れる + スタミナ 1/8
 *     伏せている     何もしない
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

describe('ローリングの体当たり', () => {
  /** a が b のすぐ傍 (0.8m) まで寄って、当たったと申告する */
  async function rollInto(name: string, pose: { crouching?: boolean; locomotion?: string }) {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'grenade', [`roll-a-${name}`, `roll-b-${name}`])
    b.crouching = pose.crouching ?? false
    if (pose.locomotion) b.pose = pose.locomotion
    await a.walkTo(0, 0, 6 - 0.8)
    await Bun.sleep(300)
    b.reset()
    a.send({ type: 'knock', id: a.id, hit: b.id, x: 0, z: 0.8 })
    await Bun.sleep(300)
    return b
  }

  test('立っている相手は押しのけられ、スタミナが 1/8 減る', async () => {
    const b = await rollInto('stand', {})
    expect(b.got('knock')).toBe(1)
    expect(b.got('knockdown')).toBe(0)
    expect((b.last.get('stamina') as { stamina: number }).stamina).toBe(MAX_STAMINA - ROLL_STAMINA)
  }, 30000)

  test('しゃがんでいる相手は後ろへ倒れ、スタミナが 1/8 減る', async () => {
    const b = await rollInto('crouch', { crouching: true, locomotion: 'crouch_idle' })
    expect(b.got('knockdown')).toBe(1)
    expect(b.got('knock')).toBe(0)
    // 転がってきた側 (-Z) から押されて、+Z へ倒れる
    expect((b.last.get('knockdown') as { dirZ: number }).dirZ).toBeGreaterThan(0.9)
    expect((b.last.get('stamina') as { stamina: number }).stamina).toBe(MAX_STAMINA - ROLL_STAMINA)
  }, 30000)

  test('伏せている相手には何も起きない', async () => {
    const b = await rollInto('prone', { crouching: true, locomotion: 'prone_idle' })
    expect(b.got('knock')).toBe(0)
    expect(b.got('knockdown')).toBe(0)
    expect(b.got('stamina')).toBe(0)
  }, 30000)
})
