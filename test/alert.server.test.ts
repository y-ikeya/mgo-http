import { afterEach, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, type Server } from './server'
import type { Skills } from '../src/domain/player/skill'

/**
 * TARGET ALERT。**自分を攻撃してきた相手が光る。**
 *
 * 段で「攻撃」の読み方が緩む (Lv1 当てられた / Lv2 撃たれた / Lv3 狙われた)。
 * ここで押さえるのは、**段の外の攻撃では出ないこと**と、気配が出るのが
 * **攻撃した側であって、された側ではないこと** (EE と向きが逆)。
 * 届くのは輪郭 (exposed) ではなく気配 (sensed)。
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

/**
 * 2 人で試合を始める。**スキルは湧く前に選ぶ** (canChooseSkills)。
 * twoPlayers はスキルを渡せないので、同じ手順をここで踏む。
 */
async function twoWithSkills(
  names: [string, string],
  skills: { a?: Skills; b?: Skills },
): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server!, names[0], spot(0, -6)).ready()
  const b = await new Client(server!, names[1], spot(0, 6)).ready()
  a.live()
  b.live()
  if (skills.a) a.send({ type: 'skills', skills: skills.a })
  if (skills.b) b.send({ type: 'skills', skills: skills.b })
  await Bun.sleep(400)
  a.send({ type: 'ready', ready: true })
  b.send({ type: 'ready', ready: true })
  await Bun.sleep(3400)
  a.send({ type: 'spawn' })
  b.send({ type: 'spawn' })
  // 無敵 (3 秒) が切れて alive になるまで
  await Bun.sleep(3600)
  a.reset()
  b.reset()
  return { a, b }
}

/** a が b に当てた、と申告する */
function hit(a: Client, b: Client): void {
  a.send({ type: 'damage', id: a.id, target: b.id, kind: 'bullet', zone: 'BODY', distance: 12 })
}

/** a が b のそばへ撃つ (外す)。b は (0, 0, 6) に立っている */
function missNear(a: Client, aside: number): void {
  a.send({ type: 'shot', id: a.id, from: [0, 1.4, -6], to: [aside, 1.4, 6] })
}

describe('Lv1: 当てられた', () => {
  test('当てた側の気配が、当てられた側に届く', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a1', 'ta-b1'], { b: { targetAlert: 1 } })
    hit(a, b)
    await Bun.sleep(300)

    expect(b.got('sensed')).toBe(1)
    expect((b.last.get('sensed') as { key: string }).key).toBe(`player:${a.id}`)
    // 輪郭は出さない
    expect(b.got('exposed')).toBe(0)
    // **気配を出している本人には届かない。** 分かると逃げる一択になる
    expect(a.got('sensed')).toBe(0)
  }, 30000)

  test('外した弾では出ない (Lv2 の条件)', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a2', 'ta-b2'], { b: { targetAlert: 1 } })
    missNear(a, 0.8)
    await Bun.sleep(300)

    expect(b.got('sensed')).toBe(0)
  }, 30000)

  test('取っていなければ、当てられても出ない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a3', 'ta-b3'], {})
    hit(a, b)
    await Bun.sleep(300)

    expect(b.got('sensed')).toBe(0)
  }, 30000)
})

describe('Lv2: 撃たれた', () => {
  test('体のそばを抜けた弾で出る。遠くを通った弾では出ない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a4', 'ta-b4'], { b: { targetAlert: 2 } })
    // 3m 横を通る。**撃たれたとは読まない**
    missNear(a, 3)
    await Bun.sleep(300)
    expect(b.got('sensed')).toBe(0)

    // 肩の横をかすめる
    missNear(a, 0.8)
    await Bun.sleep(300)
    expect(b.got('sensed')).toBe(1)
    expect((b.last.get('sensed') as { key: string }).key).toBe(`player:${a.id}`)
    expect(a.got('sensed')).toBe(0)
  }, 30000)
})

describe('Lv3: 狙われた', () => {
  test('構えて照準を重ねられている間、気配が続く。知らせは秒に 1 度', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a5', 'ta-b5'], { b: { targetAlert: 3 } })
    // a は -6 から +6 を見る。yaw π で +Z を向く。
    // 構えのカメラは 1.53m の高さから見るので、12m 先の胸 (0.94m) へ少し見下ろす
    a.aiming = true
    a.cameraYaw = Math.PI
    a.pitch = -Math.atan2(1.53 - 0.94, 13.3)
    await Bun.sleep(2600)

    const got = b.got('sensed')
    expect(got).toBeGreaterThanOrEqual(1)
    // 刻みごと (64Hz) に飛んでいれば 100 通を超える。秒に 1 度なら 3 通ほど
    expect(got).toBeLessThanOrEqual(4)
    expect((b.last.get('sensed') as { key: string }).key).toBe(`player:${a.id}`)
    expect(a.got('sensed')).toBe(0)
  }, 30000)

  test('腰だめ (構えていない) では出ない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a6', 'ta-b6'], { b: { targetAlert: 3 } })
    a.aiming = false
    a.cameraYaw = Math.PI
    await Bun.sleep(1200)

    expect(b.got('sensed')).toBe(0)
  }, 30000)

  test('構えていても、よそを向いていれば出ない', async () => {
    server = await startServer()
    const { a, b } = await twoWithSkills(['ta-a7', 'ta-b7'], { b: { targetAlert: 3 } })
    a.aiming = true
    a.cameraYaw = 0
    await Bun.sleep(1200)

    expect(b.got('sensed')).toBe(0)
  }, 30000)
})
