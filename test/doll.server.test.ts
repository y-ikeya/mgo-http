import { afterEach, describe, expect, test } from 'bun:test'
import { Client, startServer, twoPlayers, type Server } from './server'
import { IMMUNE_SECONDS, LURE_RADIUS, TRAP_SECONDS } from '../src/domain/item/doll'

/**
 * DOLL (猫の置物)。**円に入った敵を釘付けにして、時間が来たら消える。**
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
  client.holdDoll(true)
  // 手にある物は位置に乗って届く。置く前に 1 通は行き渡らせる
  client.sendState()
  await Bun.sleep(120)
  client.send({ type: 'doll' })
  await Bun.sleep(200)
  const message = client.last.get('dollPlaced') as { at: At } | undefined
  expect(message).toBeDefined()
  return message!.at
}

/** 猫の円の中 (縁の少し内側) へ歩いて入る */
async function walkInto(client: Client, at: At): Promise<void> {
  await client.walkTo(at[0], at[1], at[2] + LURE_RADIUS - 0.3)
  await Bun.sleep(200)
}

describe('DOLL', () => {
  test('置くと敵にも配られる', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a1', 'doll-b1'])
    await placed(a)
    expect(a.got('dollPlaced')).toBe(1)
    expect(b.got('dollPlaced')).toBe(1)
  }, 30000)

  test('円に入った敵が釘付けになり、時間が来たら猫が消えて解ける', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a2', 'doll-b2'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('dollSprung')).toBe(1)
    expect((b.last.get('dollSprung') as { victims: string[] }).victims).toEqual([b.id])
    await Bun.sleep(TRAP_SECONDS * 1000 + 300)
    const gone = b.last.get('dollGone') as { broken: boolean; freed: string[] }
    expect(gone.broken).toBe(false)
    expect(gone.freed).toEqual([b.id])
  }, 30000)

  test('置いた本人は掛からない', async () => {
    server = await startServer()
    const { a } = await twoPlayers(server, 'doll', ['doll-a3', 'doll-b3'])
    const at = await placed(a)
    await walkInto(a, at)
    expect(a.got('dollSprung')).toBe(0)
  }, 30000)

  test('ダンボールを被った敵には効かない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a4', 'doll-b4'])
    const at = await placed(a)
    b.boxed = true
    await walkInto(b, at)
    expect(b.got('dollSprung')).toBe(0)
  }, 30000)

  test('撃ち抜くと猫が消え、釘付けの人も解ける', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a5', 'doll-b5'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('dollSprung')).toBe(1)
    // 銃へ持ち替えてから撃つ (猫を手にしたままでは撃てない)
    a.holdDoll(false)
    a.sendState()
    await Bun.sleep(120)
    a.send({ type: 'shot', id: a.id, from: [at[0] + 3, at[1] + 0.2, at[2]], to: [at[0], at[1] + 0.2, at[2]] })
    await Bun.sleep(300)
    const gone = b.last.get('dollGone') as { broken: boolean; freed: string[] }
    expect(gone.broken).toBe(true)
    expect(gone.freed).toEqual([b.id])
  }, 30000)

  test('釘付けの間に撃たれたら解ける (猫は残る)', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a6', 'doll-b6'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('dollSprung')).toBe(1)
    a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'BODY', distance: 12 })
    await Bun.sleep(300)
    expect(b.got('trapReleased')).toBe(1)
    expect(b.got('dollGone')).toBe(0)
  }, 30000)

  /**
   * **解けたばかりは隣の猫に掛からない** (立ち上がる間 + 1 秒)。無いと、並べて置かれた所で
   * 解けたそばから掛かり続けて動けない
   */
  test('解けてからしばらくは、隣の猫にも掛からない', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a7', 'doll-b7'])
    const first = await placed(a)
    // 1m 横へずれて 2 匹目。円はほとんど重なる
    a.moveTo(first[0] + 1, first[1], first[2] + 0.9)
    await Bun.sleep(200)
    a.send({ type: 'doll' })
    await Bun.sleep(200)
    expect(a.got('dollPlaced')).toBe(2)
    // 両方の円の中 (1 匹目から 0.9m、2 匹目から 1.35m)
    await b.walkTo(first[0], first[1], first[2] + 0.9)
    await Bun.sleep(200)
    expect(b.got('dollSprung')).toBe(1)
    // 1 匹目が消えて解ける
    await Bun.sleep(TRAP_SECONDS * 1000 + 200)
    expect(b.got('dollGone')).toBe(1)
    // 2 匹目の円の中に居るが、すぐには掛からない
    await Bun.sleep(IMMUNE_SECONDS * 1000 - 600)
    expect(b.got('dollSprung')).toBe(1)
    // 間が過ぎたら掛かる
    await Bun.sleep(900)
    expect(b.got('dollSprung')).toBe(2)
  }, 40000)

  /**
   * **爆風でも壊れる。** 梯子を登り切った所に置かれた人形は、登りながらでは箱を被れず撃ちにくい —
   * 上へ手榴弾を投げ込むのが対抗の手 (本人 2026-10-20)
   */
  test('手榴弾の爆風で壊れる', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a8', 'doll-b8'], 'grenade')
    const at = await placed(a)
    // 円の外 (2.5m) に立って、足元へ落とす。爆風 (7m) は人形に届く
    await b.walkTo(at[0], at[1], at[2] + 2.5)
    await Bun.sleep(200)
    b.send({ type: 'grenade', dir: [0, -1, 0] })
    // 信管 (3 秒) + 余白
    await Bun.sleep(4000)
    expect(b.got('dollSprung')).toBe(0)
    const gone = b.last.get('dollGone') as { broken: boolean } | undefined
    expect(gone?.broken).toBe(true)
  }, 30000)

  /** **読み直しで抜け出せない。** 入り直した時に釘付けの途中であることを返す (本人 2026-10-20) */
  test('釘付けの途中で入り直すと、続きから釘付けのまま', async () => {
    server = await startServer()
    const { a, b } = await twoPlayers(server, 'doll', ['doll-a9', 'doll-b9'])
    const at = await placed(a)
    await walkInto(b, at)
    expect(b.got('dollSprung')).toBe(1)
    b.close()
    await Bun.sleep(800)
    // 円の中の、掛かった所から入り直す (walkInto と同じ所)
    const back = await new Client(server, 'doll-b9', [at[0], at[1], at[2] + LURE_RADIUS - 0.3]).ready()
    back.live()
    await Bun.sleep(1200)
    const resume = back.last.get('resume') as { trapped: boolean } | undefined
    expect(resume?.trapped).toBe(true)
  }, 30000)
})
