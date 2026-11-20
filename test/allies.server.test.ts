import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, spawnAlive, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * 検証場 (foxtrot) の**青の味方** (2026-10-30 本人「blue の味方も置いてくれない？敬礼してるやつとか」)。
 * 練習の人はいつも青なので、青の的は味方として立つ。撃っても削れない
 */
let server: Server

beforeAll(async () => {
  server = await startServer({ MGO2_LOCAL_ROOMS: '1' })
})

afterAll(() => server.stop())

test('**青の味方が 3 人立ち、1 人は敬礼したまま。** 撃っても削れない', async () => {
  const me = new Client(server, 'ally-me', [-10, 0.1, 0], 'foxtrot')
  await me.ready()
  me.live()
  me.send({ type: 'loadout', primary: 'rifle', secondary: 'm9', support: 'grenade' })
  me.claimedWeapon = 'rifle'
  // 支度の床が明けて湧き、味方の的が名簿と姿で揃うまで (固定の眠りの代わり)
  await spawnAlive(me)
  await waitFor(() => {
    const r = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }> | undefined
    if (!r) return false
    const standing = r.players.filter((p) => p.id.startsWith('target-') && p.name.startsWith('ALLY'))
    return standing.length === 3 && standing.every((p) => me.poses.has(p.slot!))
  }, '味方の的が立つ')
  const roster = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }>
  const allies = roster.players.filter((p) => p.id.startsWith('target-') && p.name.startsWith('ALLY'))
  expect(allies.length).toBe(3)
  for (const ally of allies) expect(ally.team).toBe('blue')
  expect(roster.players.find((p) => p.id === 'ally-me')?.team).toBe('blue')

  const saluting = allies.map((a) => me.poses.get(a.slot!)?.locomotion)
  expect(saluting).toContain('salute')

  // 比べるために、赤の的は同じ撃ち方で削れること
  const enemy = roster.players.find((p) => p.id.startsWith('target-') && p.name.startsWith('TARGET'))!
  me.send({ type: 'damage', id: 'ally-me', target: enemy.id, kind: 'bullet', zone: 'BODY', distance: 7 })
  const target = allies[0]
  me.send({ type: 'damage', id: 'ally-me', target: target.id, kind: 'bullet', zone: 'HEAD', distance: 7 })
  await Bun.sleep(400)
  const hurt = me.messages.filter(
    (m): m is Extract<ServerMessage, { type: 'health' }> => m.type === 'health' && m.id === target.id && m.damage > 0,
  )
  expect(hurt.length).toBe(0)
  expect(me.messages.some((m) => m.type === 'health' && m.id === enemy.id && m.damage > 0)).toBe(true)
  me.close()
}, 30000)

test('**敬礼している味方の的と、寄って敬礼すれば繋がる** (2026-11-20 本人「ally13 と link できなくなってる」)', async () => {
  const me = new Client(server, 'ally-link', [-10, 0.1, 0], 'foxtrot')
  await me.ready()
  me.live()
  await spawnAlive(me)
  let salutingId = ''
  await waitFor(() => {
    const r = me.last.get('roster') as Extract<ServerMessage, { type: 'roster' }> | undefined
    const found = r?.players.find((p) => p.name.startsWith('ALLY') && me.poses.get(p.slot!)?.locomotion === 'salute')
    salutingId = found?.id ?? ''
    return !!found
  }, '敬礼している味方の的')
  // 敬礼している的 (-13, -7) の 2m 脇で敬礼する
  me.moveTo(-11, 0.1, -7)
  await Bun.sleep(200)
  me.pose = 'salute'
  await waitFor(() => {
    const links = me.last.get('links') as Extract<ServerMessage, { type: 'links' }> | undefined
    return links?.ids.includes(salutingId) ?? false
  }, '的と繋がる', 5000)
  me.close()
}, 30000)
