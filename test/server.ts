/**
 * 対戦サーバーを立てて、届くメッセージを見るための道具。
 *
 * --- なぜ要るか ---
 * 「サーバーが配ったか」だけを見ていて、1 日に 3 回すり抜けた。届いてはいたが
 * **受け取る側が捨てていた**、という形が多い。だから見るのは
 * 「**クライアントが期待するものが、期待する順で届くか**」にする。
 *
 * 例:
 *   - 名簿は全員の状態 (life) を運ぶか
 *   - 切れた瞬間に leave を配っていないか
 *   - resume は名簿のあとに来るか
 */
import { encodeSnapshot, isSnapshot, LOCOMOTIONS } from '../src/net/snapshot'
import type { ClientMessage, PlayerSnapshot, ServerMessage } from '../src/net/types'

/** 起動を待つ上限 (ms) */
const BOOT_TIMEOUT = 10_000

export interface Server {
  port: number
  /** 部屋の様子 (/health の本文) */
  health(): Promise<string>
  stop(): void
  /** 配置と同じ止め方 (SIGTERM)。落ち切るまで待つ */
  terminate(): Promise<void>
}

let nextPort = 9100

/**
 * 試験用のサーバーを 1 つ立てる。ポートは自動で選ぶ。
 *
 * env を渡すと環境変数を足せる (戦績の書き込み先を差し替えるのに使う)
 */
export async function startServer(env: Record<string, string> = {}): Promise<Server> {
  const port = nextPort++
  const proc = Bun.spawn(['bun', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), MGO2_TEST_AUTH: '1', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const until = Date.now() + BOOT_TIMEOUT
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${port}/health`)
      if (res.ok) break
    } catch {
      // まだ起きていない
    }
    if (Date.now() > until) throw new Error(`サーバーが起きない (port ${port})`)
    await Bun.sleep(50)
  }

  return {
    port,
    health: async () => (await fetch(`http://localhost:${port}/health`)).text(),
    stop: () => proc.kill(),
    // 配置で止めるときと同じ合図。書き出してから落ちるかを見るのに使う
    terminate: async () => {
      proc.kill('SIGTERM')
      await proc.exited
    },
  }
}

/**
 * 1 人ぶんのクライアント。
 *
 * 描画はしない。**届いたものを控えるだけ**で、クライアントが判断に使う材料が
 * 揃っているかを見る。
 */
export class Client {
  readonly id: string
  /** 届いた順。どれが先に来るかを見るのに要る */
  readonly order: string[] = []
  /** 種類ごとの最後の 1 通 */
  readonly last = new Map<string, ServerMessage>()
  /** 種類ごとの通数 */
  readonly count = new Map<string, number>()
  /** 位置の通数と、最後の姿勢 */
  states = 0
  locomotion = ''
  /** 自分の状態 (life で届いたもの) */
  life = ''

  private readonly socket: WebSocket
  private timer: ReturnType<typeof setInterval> | null = null
  private position: [number, number, number]

  constructor(server: Server, id: string, at: [number, number, number] = [0, 0, 0]) {
    this.id = id
    this.position = at
    this.socket = new WebSocket(`ws://localhost:${server.port}/?room=alpha&id=${id}`)
    this.socket.binaryType = 'arraybuffer'
    this.socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data)
        if (!isSnapshot(view)) return
        this.states++
        this.locomotion = LOCOMOTIONS[view.getUint8(31)] ?? '?'
        return
      }
      const message = JSON.parse(event.data) as ServerMessage
      this.order.push(message.type)
      this.last.set(message.type, message)
      this.count.set(message.type, (this.count.get(message.type) ?? 0) + 1)
      if (message.type === 'life' && message.id === id) this.life = message.state
    }
  }

  /** 繋がって名乗り終わるまで待つ */
  async ready(): Promise<this> {
    await new Promise<void>((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) return resolve()
      this.socket.onopen = () => resolve()
      this.socket.onerror = () => reject(new Error(`繋がらない (${this.id})`))
    })
    this.send({ type: 'join', id: this.id, name: this.id })
    return this
  }

  /** 位置を送り続ける。実際のクライアントと同じ 64Hz */
  live(hz = 64): this {
    this.timer = setInterval(() => this.sendState(), 1000 / hz)
    return this
  }

  moveTo(x: number, y: number, z: number): void {
    this.position = [x, y, z]
  }

  sendState(locomotion = 'idle'): void {
    if (this.socket.readyState !== WebSocket.OPEN) return
    const [x, y, z] = this.position
    this.socket.send(encodeSnapshot(snapshotOf(this.id, x, y, z, locomotion)))
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** 数えているものを 0 に戻す。「この区間で何通来たか」を測るのに使う */
  reset(): void {
    this.states = 0
    this.order.length = 0
    this.count.clear()
  }

  got(type: string): number {
    return this.count.get(type) ?? 0
  }

  /** ブラウザを閉じる。席は残る */
  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.socket.close()
  }
}

function snapshotOf(
  id: string,
  x: number,
  y: number,
  z: number,
  locomotion: string,
): PlayerSnapshot {
  return {
    id,
    time: Date.now(),
    x,
    y,
    z,
    yaw: 0,
    pitch: 0,
    cameraYaw: 0,
    aiming: false,
    crouching: false,
    boxed: false,
    locomotion,
    concentrating: false,
    saluteHeld: false,
    reloading: false,
    weapon: 'rifle',
    holdingGrenade: false,
    protectedNow: false,
    slot: 0,
  } as PlayerSnapshot
}

/**
 * 2 人で試合を始めるところまで進める。
 *
 * 位置は開けた場所に向かい合わせで置く。**遮蔽の裏かどうかを問わない試験**は
 * これで足りる (問う試験はステージから座標を探す必要があるので、別に書く)。
 */
export async function twoPlayers(
  server: Server,
): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server, 'alice', [0, 0, -6]).ready()
  const b = await new Client(server, 'bob', [0, 0, 6]).ready()
  a.live()
  b.live()
  // 支度が済むまで待って、二人とも出撃する (床は 3 秒)
  await Bun.sleep(3400)
  a.send({ type: 'spawn' })
  b.send({ type: 'spawn' })
  // 無敵 (3 秒) が切れて alive になるまで
  await Bun.sleep(3600)
  return { a, b }
}
