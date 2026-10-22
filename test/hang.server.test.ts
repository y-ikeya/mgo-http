import { afterEach, describe, expect, test } from 'bun:test'
import { Client, spot, startServer, twoPlayers, type Server } from './server'

/**
 * 縁にぶら下がったまま画面を読み直す。**入り直しの知らせにぶら下がっていたことを載せる** —
 * 載せないと、手元は普段の姿で始まって宙から落ちた (本人 2026-10-21)
 */

let server: Server | null = null

afterEach(() => {
  server?.stop()
  server = null
})

describe('ぶら下がりの読み直し', () => {
  test('ぶら下がったまま入り直すと、ぶら下がっていたことと向きが返る', async () => {
    server = await startServer()
    const { b } = await twoPlayers(server, 'grenade', ['hang-a1', 'hang-b1'])
    b.pose = 'hang'
    b.cameraYaw = 1.2
    await Bun.sleep(300)
    b.close()
    await Bun.sleep(800)
    const back = await new Client(server, 'hang-b1', spot(0, 6)).ready()
    back.live()
    await Bun.sleep(1200)
    const resume = back.last.get('resume') as { hanging: boolean; yaw: number } | undefined
    expect(resume?.hanging).toBe(true)
    expect(resume?.yaw).toBeCloseTo(1.2, 2)
  }, 30000)
})
