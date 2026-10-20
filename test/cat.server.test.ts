import { afterEach, describe, expect, test } from 'bun:test'
import { Client, startServer, twoPlayers, type Server } from './server'
import { LURE_RADIUS, TRAP_SECONDS } from '../src/domain/item/cat'

/**
 * CAT (猫の置物)。**円に入った敵を釘付けにして、時間が来たら消える。**
 *
 * 押さえるのは、掛かる人 (敵だけ・箱を被っていない人) と、解ける時 (時間切れ・猫を撃ち抜いた・
 * 掛かった人が撃たれた)。
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

type At = [number, number, number]

/** 猫を置いて、置けた位置を返す */
async function placed(client: Client): Promise<At> {
  client.holdCat(true)
  // 手にある物は位置に乗って届く。置く前に 1 通は行き渡らせる
  client.sendState()
  await Bun.sleep(120)
  client.send({ type: 'cat' })
  await Bun.sleep(200)
  const message = client.last.get('catPlaced') as { at: At } | undefined
  expect(message).toBeDefined()
  return message!.at
}

/** 猫の円の中 (縁の少し内側) へ歩いて入る */
async function walkInto(client: Client, at: At): Promise<void> {
  await client.walkTo(at[0], at[1], at[2] + LURE_RADIUS - 0.3)
  await Bun.sleep(200)
}

describe('CAT', () => {
  test('置くと敵にも配られる', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'cat', ['cat-a1', 'cat-b1'])
    await placed(a)
    expect(a.got('catPlaced')).toBe(1)
    expect(b.got('catPlaced')).toBe(1)
  }, 30000)

  test('円に入った敵が釘付けになり、時間が来たら猫が消えて解ける', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'cat', ['cat-a2', 'cat-b2'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('catSprung')).toBe(1)
    expect((b.last.get('catSprung') as { victims: string[] }).victims).toEqual([b.id])
    await Bun.sleep(TRAP_SECONDS * 1000 + 300)
    const gone = b.last.get('catGone') as { broken: boolean; freed: string[] }
    expect(gone.broken).toBe(false)
    expect(gone.freed).toEqual([b.id])
  }, 30000)

  test('置いた本人は掛からない', async () => {
    server = await startServer()
    const { a } = await twoPlayers(server, 'cat', ['cat-a3', 'cat-b3'])
    const at = await placed(a)
    await walkInto(a, at)
    expect(a.got('catSprung')).toBe(0)
  }, 30000)

  test('ダンボールを被った敵には効かない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'cat', ['cat-a4', 'cat-b4'])
    const at = await placed(a)
    b.boxed = true
    await walkInto(b, at)
    expect(b.got('catSprung')).toBe(0)
  }, 30000)

  test('撃ち抜くと猫が消え、釘付けの人も解ける', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'cat', ['cat-a5', 'cat-b5'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('catSprung')).toBe(1)
    // 銃へ持ち替えてから撃つ (猫を手にしたままでは撃てない)
    a.holdCat(false)
    a.sendState()
    await Bun.sleep(120)
    a.send({ type: 'shot', id: a.id, from: [at[0] + 3, at[1] + 0.2, at[2]], to: [at[0], at[1] + 0.2, at[2]] })
    await Bun.sleep(300)
    const gone = b.last.get('catGone') as { broken: boolean; freed: string[] }
    expect(gone.broken).toBe(true)
    expect(gone.freed).toEqual([b.id])
  }, 30000)

  test('釘付けの間に撃たれたら解ける (猫は残る)', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'cat', ['cat-a6', 'cat-b6'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('catSprung')).toBe(1)
    a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'BODY', distance: 12 })
    await Bun.sleep(300)
    expect(b.got('trapReleased')).toBe(1)
    expect(b.got('catGone')).toBe(0)
  }, 30000)
})
