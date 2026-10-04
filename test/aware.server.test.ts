import { afterEach, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'
import { DEPLOY_SECONDS } from '../src/domain/item/decoy'
import type { Skills } from '../src/domain/player/skill'

/**
 * AWARENESS。**近くの敵の置き物の気配が届く。**
 *
 * 押さえるのは 3 つ。持つ人にだけ届くこと、半径の外には届かないこと、
 * 自分の物では届かないこと。決めているのはサーバーなので、ここで見る。
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

/** 2 人で試合を始める。スキルは湧く前に選ぶ。支援は既定で decoy (置ける物) */
async function twoWithSkills(
  names: [string, string],
  skills: { a?: Skills; b?: Skills },
  bAt: [number, number, number] = spot(0, 6),
  support: 'decoy' | 'locator' = 'decoy',
): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server!, names[0], spot(0, -6)).ready()
  const b = await new Client(server!, names[1], bAt).ready()
  a.live()
  b.live()
  a.send({ type: 'loadout', primary: 'rifle', support })
  b.send({ type: 'loadout', primary: 'rifle', support })
  if (skills.a) a.send({ type: 'skills', skills: skills.a })
  if (skills.b) b.send({ type: 'skills', skills: skills.b })
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  await Bun.sleep(3400)
  a.send({ type: 'spawn' })
  b.send({ type: 'spawn' })
  await Bun.sleep(3600)
  a.reset()
  b.reset()
  return { a, b }
}

/** 人形を置いて、膨らみ切るまで待つ */
async function placed(client: Client): Promise<void> {
  client.holdDecoy(true)
  client.sendState()
  await Bun.sleep(120)
  client.send({ type: 'decoy' })
  await Bun.sleep(DEPLOY_SECONDS * 1000 + 300)
}

describe('AWARENESS', () => {
  test('持つ人にだけ、近くの敵の置き物の気配が届く', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['aw-a1', 'aw-b1'], { b: { awareness: 1 } })
    // a が置く。b は 12m 先 (半径 15m の内)
    await placed(a)

    expect(b.got('sensed')).toBeGreaterThanOrEqual(1)
    const sensed = b.last.get('sensed') as { key: string; at: number[] }
    expect(sensed.key.startsWith('decoy:')).toBe(true)
    // **種類と位置だけ。** 向きも持ち主も入っていない
    expect('yaw' in sensed).toBe(false)
    expect('owner' in sensed).toBe(false)
    // 持っていない a には何も来ない (自分の物でもある)
    expect(a.got('sensed')).toBe(0)
  }, 30000)

  test('半径の外には届かない', async () => {
    server = await startServer()
    // b は 30m 先
    const { a, b } = await twoWithSkills(['aw-a2', 'aw-b2'], { b: { awareness: 1 } }, spot(0, 24))
    await placed(a)

    expect(b.got('sensed')).toBe(0)
  }, 30000)

  test('自分の物では気配にならない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['aw-a3', 'aw-b3'], { a: { awareness: 1 } })
    await placed(a)

    expect(a.got('sensed')).toBe(0)
    expect(b.got('sensed')).toBe(0)
  }, 30000)

  test('消えたら sensedGone が届く', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['aw-a4', 'aw-b4'], { b: { awareness: 1 } })
    await placed(a)
    expect(b.got('sensed')).toBeGreaterThanOrEqual(1)
    const sensed = b.last.get('sensed') as { key: string; at: [number, number, number] }
    const placedAt = a.last.get('decoyPlaced') as { at: [number, number, number] }

    // b が人形を撃って割る
    b.send({
      type: 'shot',
      id: b.id,
      from: [placedAt.at[0], placedAt.at[1] + 1.4, placedAt.at[2] + 4],
      to: [placedAt.at[0], placedAt.at[1] + 1, placedAt.at[2]],
    })
    await Bun.sleep(300)

    expect(b.got('sensedGone')).toBe(1)
    expect((b.last.get('sensedGone') as { key: string }).key).toBe(sensed.key)
  }, 30000)
})

describe('TRAP MASTERY', () => {
  test('持つ人の置き物は、相手が AWARENESS を持っていても気配にならない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['tm-a1', 'tm-b1'], { a: { trapMastery: 1 }, b: { awareness: 1 } })
    // a が 12m 先で置く。TRAP MASTERY が無ければ b に届く距離 (上の AWARENESS の試験と同じ)
    await placed(a)

    expect(b.got('sensed')).toBe(0)
    // 置けていること自体は変わらない
    expect(a.got('decoyPlaced')).toBe(1)
  }, 30000)
})

describe('THROWING MASTERY', () => {
  /** 投げ物は THROWING MASTERY の側で隠れる。TRAP MASTERY では隠れない */
  test('持つ人の手榴弾は気配にならない。無ければ映る', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['th-a1', 'th-b1'], { a: { throwing: 1 }, b: { awareness: 1 } })
    // a が足元へ落とす (b は 12m 先)。導火線 3 秒の間に気配の走査が何度も回る
    a.send({ type: 'grenade', dir: [0, -1, 0] })
    await Bun.sleep(1200)
    expect(b.got('sensed')).toBe(0)
  }, 30000)

  test('TRAP MASTERY では手榴弾は隠れない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['th-a2', 'th-b2'], { a: { trapMastery: 1 }, b: { awareness: 1 } })
    a.send({ type: 'grenade', dir: [0, -1, 0] })
    await Bun.sleep(1200)
    expect(b.got('sensed')).toBeGreaterThanOrEqual(1)
    expect((b.last.get('sensed') as { key: string }).key.startsWith('grenade:')).toBe(true)
  }, 30000)
})

describe('E LOCATOR は気配で暴く', () => {
  /**
   * **輪郭ではなく霧。** 暴かれた相手は exposed (壁越しの輪郭) ではなく
   * sensed (位置だけの気配) で届く。投げた本人にだけ、暴かれた本人には届かない。
   */
  test('半径の中の敵が、投げた人に気配として届く', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['aw-a5', 'aw-b5'], {}, spot(0, 6), 'locator')
    a.holdLocator(true)
    a.sendState()
    await Bun.sleep(120)
    // b の方 (+Z) へ投げる。12m 先なので半径 15m の内に落ちる
    a.send({ type: 'locator', dir: [0, 0.3, 1] })
    // 飛んで、止まって、1 回目の走査まで
    await Bun.sleep(3500)

    expect(a.got('sensed')).toBeGreaterThanOrEqual(1)
    expect((a.last.get('sensed') as { key: string }).key).toBe(`player:${b.id}`)
    // 輪郭は出さない
    expect(a.got('exposed')).toBe(0)
    // 暴かれた本人には届かない
    expect(b.got('sensed')).toBe(0)
  }, 30000)
})
