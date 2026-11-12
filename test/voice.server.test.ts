import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client, startServer, waitFor, type Server } from './server'
import type { ServerMessage } from '../src/application/protocol/types'

/**
 * 選んだ声の配線。**申告は装備の便に相乗りし、サーバーが丸めて名簿で配る。**
 *
 * 声は全員の画面で一致させる物 — 本人の画面だけで変わると、倒れた叫びが
 * 人によって違う声になる。丸め (fitVoice) がサーバーで効くことも確かめる
 */
let server: Server

beforeAll(async () => {
  server = await startServer({ MGO2_LOCAL_ROOMS: '1' })
})

afterAll(() => server.stop())

type Roster = Extract<ServerMessage, { type: 'roster' }>

const voiceOf = (client: Client, id: string) => {
  const r = client.last.get('roster') as Roster | undefined
  return r?.players.find((p) => p.id === id)?.voice
}

test('選んだ声が丸められて名簿で相手に届く', async () => {
  const a = new Client(server, 'voice-a', [-10, 0.1, 0], 'foxtrot')
  await a.ready()
  const b = new Client(server, 'voice-b', [-9, 0.1, 0], 'foxtrot')
  await b.ready()

  // 申告前は未選択 (null = 体が決める)
  await waitFor(() => voiceOf(b, 'voice-a') === null, '申告前の名簿')
  expect(voiceOf(b, 'voice-a')).toBeNull()

  // 範囲外の高さはサーバーで端に丸められる
  a.send({
    type: 'loadout',
    primary: 'rifle',
    secondary: 'm9',
    support: 'grenade',
    voice: { style: 'woman1', pitch: 9 },
  })
  await waitFor(() => voiceOf(b, 'voice-a')?.pitch === 1.25, '丸めた声が届く')
  expect(voiceOf(b, 'voice-a')).toEqual({ style: 'woman1', pitch: 1.25 })

  // 知らない style と数でない高さは既定に落ちる
  a.send({
    type: 'loadout',
    primary: 'rifle',
    secondary: 'm9',
    support: 'grenade',
    voice: { style: 'robot', pitch: 'high' },
  })
  await waitFor(() => voiceOf(b, 'voice-a')?.style === 'man1', '既定に落ちた声が届く')
  expect(voiceOf(b, 'voice-a')).toEqual({ style: 'man1', pitch: 1 })

  // 声を付けない装備の申告では、今の声が残る (後から入った人の名簿で確かめる)
  a.send({ type: 'loadout', primary: 'rifle', secondary: 'm9', support: 'grenade' })
  const c = new Client(server, 'voice-c', [-8, 0.1, 0], 'foxtrot')
  await c.ready()
  await waitFor(() => voiceOf(c, 'voice-a') !== undefined, '後入りの名簿')
  expect(voiceOf(c, 'voice-a')).toEqual({ style: 'man1', pitch: 1 })

  a.close()
  b.close()
  c.close()
}, 30000)
