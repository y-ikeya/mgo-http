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
import { encodeSnapshot, isSnapshot, LOCOMOTIONS } from '../src/infra/codec/snapshot'
import type { ClientMessage, PlayerSnapshot, ServerMessage } from '../src/application/protocol/types'
import type { WeaponId } from '../src/domain/item/weapons'

/** 起動を待つ上限 (ms) */
const BOOT_TIMEOUT = 10_000

export interface Server {
  port: number
  /** 部屋の様子 (/health の本文) */
  health(): Promise<string>
  /**
   * サーバーが吐いた例外。**握り潰した分も含む。**
   *
   * 刻みと 1 通ごとの処理は try で包んであるので、例外が出てもサーバーは
   * 落ちない。落ちないぶん**試験からは正常に見える**ので、ログを見に行く。
   */
  errors(): string
  stop(): void
  /** 配置と同じ止め方 (SIGTERM)。落ち切るまで待つ */
  terminate(): Promise<void>
}

/**
 * 空いているポートを 1 つ借りる。
 *
 * **連番で決め打ちしていたら、まとめて回したときだけ落ちた。** 9100 から順に
 * 使うので、試験を 2 つ並行で走らせると (別の窓の make check、別の作業者)
 * 同じ番号を掴み合って ConnectionRefused になる。落ち方が「サーバーが死んで
 * いる」に見えるので、原因を探すのに時間が要る。
 *
 * OS に選ばせて、すぐ返す。掴み直すまでの隙間に他が取る余地は残るが、
 * 番号を決め打ちするよりはるかに当たらない。
 */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
  const port = probe.port ?? 0
  await probe.stop(true)
  if (port === 0) throw new Error('空いているポートが分からない')
  return port
}

/**
 * 試験用のサーバーを 1 つ立てる。ポートは自動で選ぶ。
 *
 * env を渡すと環境変数を足せる (戦績の書き込み先を差し替えるのに使う)
 */
export async function startServer(env: Record<string, string> = {}): Promise<Server> {
  const port = await freePort()
  const proc = Bun.spawn(['bun', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      MGO2_TEST_AUTH: '1',
      // **地形を読ませない。** ここで見るのは規則であって地図ではない。
      //
      // 以前は「建物の外の開けた場所」に人を置いて遮蔽を避けていたが、
      // 避け方がステージの形に依存するので、**地図を描き替えると
      // 地形と関係ない試験がまとめて落ちた** (当たりの申告が全部弾かれる形で)。
      MGO2_NO_STAGE: '1',
      // 揃った告知 (5 秒) を飛ばす。試験は揃ってすぐ READY を押す
      MGO2_ASSEMBLE_MS: '0',
      // 全員の READY が揃ってからの待ちも飛ばす
      MGO2_READY_GRACE_MS: '0',
      // 試合が始まるまでの数え (5 秒) も飛ばす。長さそのものを見る試験
      // (test/matchstart) は env で戻す
      MGO2_COUNTDOWN_MS: '0',
      // 支度の床 (3 秒) と湧き無敵 (3 秒) も飛ばす。開始手順が 1 件ごとに
      // 7 秒超えていた主因。長さが効くことは test/spawntiming が戻して見る
      MGO2_CHOOSE_FLOOR_MS: '0',
      MGO2_SPAWN_PROTECT_MS: '0',
      // **試験は本番の表に書かない。**
      //
      // bun は .env を勝手に読むので、何もしないと手元の秘密鍵をそのまま継いで
      // 本物の Supabase に書き込む。実際に alice / bob / late の戦績が
      // 33 試合ぶん積まれた。手元で試験を回しただけで本番が汚れる。
      //
      // 戦績を見る試験だけが、下の ...env で行き先を差し替える
      SUPABASE_SERVICE_ROLE_KEY: '',
      ...env,
    },
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

  /** 立ち上げてからの stderr。例外はここに出る */
  let stderr = ''
  void (async () => {
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderr += new TextDecoder().decode(chunk)
    }
  })()

  return {
    port,
    health: async () => (await fetch(`http://localhost:${port}/health`)).text(),
    errors: () => stderr,
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
  /** 席ごとの最後の姿。位置と動きだけ */
  readonly poses = new Map<number, { x: number; z: number; locomotion: string }>()
  /** 種類ごとの通数 */
  readonly count = new Map<string, number>()
  /** 位置の通数と、最後の姿勢 */
  states = 0
  locomotion = ''
  /** 自分の状態 (life で届いたもの) */
  life = ''
  /**
   * 届いた通をそのまま控える。
   *
   * **種類だけでは足りない場面がある。** 「的が戻ってきたか」を respawn の数で
   * 見ていたら、撃った本人の respawn を数えていて的が戻らないのを見逃した。
   * id まで見られるようにする。
   */
  readonly messages: ServerMessage[] = []

  /**
   * 閉じられたときの符号。**誰が閉じたかではなく、なぜ閉じたか。**
   *
   * 遅れで切られたのか (4001)、こちらが閉じたのかを見分けるのに要る。
   */
  closedWith: number | null = null

  private readonly socket: WebSocket
  private timer: ReturnType<typeof setInterval> | null = null
  private position: [number, number, number]
  /**
   * ping を打ち返すまで待つ時間 (ms)。**遅い回線を作るのに使う。**
   *
   * 0 なら本物のクライアントと同じで、届いた瞬間に打ち返す。
   */
  private readonly pongDelay: number

  constructor(
    server: Server,
    id: string,
    at: [number, number, number] = [0, 0, 0],
    /** 入る部屋。既定はチーム戦 (bravo) — 陣営の規則を見る試験が多いので */
    room = 'bravo',
    options: { pongDelay?: number; privateRoom?: boolean } = {},
  ) {
    this.id = id
    this.position = at
    this.pongDelay = options.pongDelay ?? 0
    // privateRoom: 自分だけの練習部屋 (/training と同じ ?private=1)
    this.socket = new WebSocket(`ws://localhost:${server.port}/?room=${room}&id=${id}${options.privateRoom ? '&private=1' : ''}`)
    this.socket.binaryType = 'arraybuffer'
    this.socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data)
        if (!isSnapshot(view)) return
        this.states++
        this.locomotion = LOCOMOTIONS[view.getUint8(31)] ?? '?'
        // **席ごとに控える。** 誰が動いたかを見るのに要る (的が吹っ飛ぶか、など)。
        // 上の locomotion は「最後に届いた 1 通」なので、相手を名指しで見られない
        this.poses.set(view.getUint16(1), {
          x: view.getFloat32(11),
          z: view.getFloat32(19),
          locomotion: LOCOMOTIONS[view.getUint8(31)] ?? '?',
        })
        return
      }
      const message = JSON.parse(event.data) as ServerMessage
      this.messages.push(message)
      this.order.push(message.type)
      this.last.set(message.type, message)
      this.count.set(message.type, (this.count.get(message.type) ?? 0) + 1)
      if (message.type === 'life' && message.id === id) this.life = message.state
      /*
       * 往復の時間を測られている。**本物と同じように打ち返す。**
       *
       * 打ち返さないと、サーバーは次の便を投げない (未処理を溜めない作り)
       * ので、測られないまま試験が終わる。
       */
      if (message.type === 'ping') {
        const at = message.at
        if (this.pongDelay > 0) setTimeout(() => this.send({ type: 'pong', at }), this.pongDelay)
        else this.send({ type: 'pong', at })
      }
    }
    this.socket.onclose = (event: CloseEvent) => {
      this.closedWith = event.code
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
  /** live() が送り続ける姿勢 (locomotion)。しゃがませるなら 'crouch_idle' */
  pose = 'idle'

  live(hz = 64): this {
    this.timer = setInterval(() => this.sendState(this.pose), 1000 / hz)
    return this
  }

  moveTo(x: number, y: number, z: number): void {
    this.position = [x, y, z]
  }

  /**
   * 歩いて行く。**1 通で跳べる距離 (motioncheck.ts の MAX_STEP 15m) より小さく刻む。**
   *
   * moveTo は 1 通で跳ぶので、湧いた直後の見逃し (relay.ts の WARP_GRACE) を
   * 過ぎてから遠くへ置くと「跳んだ」で弾かれる。live() で送り続けている前提
   */
  async walkTo(x: number, y: number, z: number, step = 10): Promise<void> {
    for (;;) {
      const [px, py, pz] = this.position
      const dx = x - px
      const dy = y - py
      const dz = z - pz
      const distance = Math.hypot(dx, dy, dz)
      if (distance <= step) {
        this.position = [x, y, z]
        return
      }
      const k = step / distance
      this.position = [px + dx * k, py + dy * k, pz + dz * k]
      // 1 通は届けてから次の刻みへ (64Hz で 16ms)
      await Bun.sleep(40)
    }
  }

  sendState(locomotion = 'idle'): void {
    if (this.socket.readyState !== WebSocket.OPEN) return
    const [x, y, z] = this.position
    this.socket.send(
      encodeSnapshot(
        snapshotOf(
          this.id,
          x,
          y,
          z,
          locomotion,
          this.holdingGrenade,
          this.holdingClaymore,
          this.claimedWeapon,
          this.holdingDecoy,
          this.aiming,
          this.cameraYaw,
          this.pitch,
          this.holdingLocator,
          this.holdingDoll,
          this.boxed,
          this.crouching,
        ),
      ),
    )
  }

  /** 構えているか。位置に乗せて送る (TARGET ALERT Lv3 を試すのに使う) */
  aiming = false
  /** 視点の向き (rad)。yaw 0 で -Z を向く。π で +Z */
  cameraYaw = 0
  /** 視点の上下 (rad)。負で見下ろす */
  pitch = 0

  /** 振りかぶって持っているか。位置に乗せて送る */
  /** 位置と一緒に名乗る銃。**選んでいない物を名乗れるか**を試すのに使う */
  claimedWeapon: WeaponId = 'rifle'
  private holdingGrenade = false
  /** クレイモアを手にしているか */
  private holdingClaymore = false
  /** decoy を手にしているか */
  private holdingDecoy = false

  holdGrenade(holding: boolean): void {
    this.holdingGrenade = holding
  }

  /**
   * クレイモアを手にする。
   *
   * **支度で選んでいなければ持てない** (domain/player/equip.ts の canHold)。
   * 湧いたあとに枠を変えることはできないので、twoPlayers(server, 'claymore')
   * で入った人だけが呼べる。本物のクライアントと同じ順序。
   */
  holdClaymore(holding: boolean): void {
    this.holdingClaymore = holding
  }

  /** decoy を手にする。**支度で選んでいなければ持てない** (クレイモアと同じ) */
  holdDecoy(holding: boolean): void {
    this.holdingDecoy = holding
  }

  /** E LOCATOR を手にする。**支度で選んでいなければ持てない** */
  holdLocator(holding: boolean): void {
    this.holdingLocator = holding
  }
  private holdingLocator = false

  /** DOLL を手にする。**支度で選んでいなければ持てない** */
  holdDoll(holding: boolean): void {
    this.holdingDoll = holding
  }
  private holdingDoll = false
  /** ダンボールを被っているか。手にある物 (box) として送る (猫が効かない) */
  boxed = false
  /** しゃがんでいるか。位置に乗せて送る (ローリングで倒れる) */
  crouching = false

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** 数えているものを 0 に戻す。「この区間で何通来たか」を測るのに使う */
  reset(): void {
    this.states = 0
    this.messages.length = 0
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
  holdingGrenade = false,
  holdingClaymore = false,
  /** 名乗る銃。**選んでいない物を名乗る試験**に使う */
  claimed: WeaponId = 'rifle',
  holdingDecoy = false,
  aiming = false,
  cameraYaw = 0,
  pitch = 0,
  holdingLocator = false,
  holdingDoll = false,
  boxed = false,
  crouching = false,
): PlayerSnapshot {
  return {
    id,
    time: Date.now(),
    x,
    y,
    z,
    yaw: cameraYaw,
    pitch,
    cameraYaw,
    aiming,
    crouching,
    boxed,
    // 振りかぶっているなら手にあるのも手榴弾。**両方そろって初めて落ちる**
    // 箱を被っているかは手にある物で届く (snapshot.ts の held === 'box')
    held: boxed
      ? ('box' as const)
      : holdingGrenade
      ? ('grenade' as const)
      : holdingClaymore
        ? ('claymore' as const)
        : holdingDecoy
          ? ('decoy' as const)
          : holdingLocator
            ? ('locator' as const)
            : holdingDoll
              ? ('doll' as const)
              : ('rifle' as const),
    locomotion,
    locomotionAge: 0,
    concentrating: false,
    saluteHeld: false,
    reloading: false,
    weapon: claimed,
    // 振りかぶっている間だけ立つ (FLAG2_WINDUP)
    holdingGrenade,
    protectedNow: false,
    stealthed: false,
    slot: 0,
  } as PlayerSnapshot
}

/** 向かい合わせに立たせる座標。**地形が無いので原点でよい** */
export function spot(dx: number, dz: number): [number, number, number] {
  return [dx, 0, dz]
}

/** そのクライアントが最後に見た試合の段階 (match の phase) */
export function phaseOf(client: Client): string | undefined {
  return (client.last.get('match') as { phase?: string } | undefined)?.phase
}

/**
 * 条件が成り立つまで、届いた物を見ながら待つ。
 *
 * **固定の眠りの代わり。** 眠りは「その間に届くだろう」という見積もりで、
 * 機械が遅ければ足りず、速ければ余る。見るべき物 (段階・状態) はもう
 * クライアントが控えているので、それが揃うまで待てば見積もりが要らない。
 * 上限を超えたら、どの条件で止まったかを持って落ちる
 */
export async function waitFor(check: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms
  for (;;) {
    if (check()) return
    if (Date.now() > until) throw new Error(`待っても成り立たない: ${what}`)
    await Bun.sleep(20)
  }
}

/**
 * 全員が湧いて alive になるまで進める。
 *
 * spawn は**支度 (choosing) の間しか通らない**ので、通る状態の人にだけ
 * 繰り返し送る。床 (CHOOSE_FLOOR) が残っているサーバーでは、明けるまで
 * 送り続ける形になる — 待つ長さをここに書かずに済む
 */
export async function spawnAlive(...clients: Client[]): Promise<void> {
  const until = Date.now() + 15_000
  for (;;) {
    for (const client of clients) {
      if (client.life === 'choosing') client.send({ type: 'spawn' })
    }
    if (clients.every((client) => client.life === 'alive')) return
    if (Date.now() > until) {
      throw new Error(`湧いて alive にならない: ${clients.map((c) => `${c.id}=${c.life}`).join(', ')}`)
    }
    await Bun.sleep(25)
  }
}

/**
 * 支度から試合の開始まで進める。**twoPlayers の後半。**
 *
 * 手順を写している試験が各所にあるので、そこからも呼べるよう切り出した。
 *
 * - ready は**支度の段階に入ってから**押す。入る前に届いた分はサーバーが
 *   黙って捨てる (server/index.ts の case 'ready')
 * - 湧きは床が明け次第 (spawnAlive)。数え (countdown) の最中でも湧ける
 * - 最後に段階が playing になるまで待つ。撃ち合いを見る試験は、段階が
 *   playing でないと damage が捨てられるため
 */
export async function beginMatch(...clients: Client[]): Promise<void> {
  /*
   * 支度に入るまで待つ。**既に始まっている部屋へ入り直したとき**は支度が
   * 無い (席が残っていて、そのまま alive で戻る) ので、playing も到達点に
   * 入れておく — 支度を待って止まる形にしない
   */
  await waitFor(
    () =>
      clients.every((client) => {
        const phase = phaseOf(client)
        return phase === 'ready' || phase === 'playing'
      }),
    '支度の段階に入る',
  )
  if (clients.some((client) => phaseOf(client) === 'ready')) {
    for (const client of clients) client.send({ type: 'ready', ready: true })
  }
  await spawnAlive(...clients)
  await waitFor(
    () => clients.every((client) => phaseOf(client) === 'playing'),
    '試合が始まる',
  )
}

/**
 * 2 人で試合を始めるところまで進める。位置は向かい合わせ。
 */
export async function twoPlayers(
  server: Server,
  /** 支度で選ぶ支援。**湧く前にしか選べない** (domain/player/equip.ts) */
  support: 'grenade' | 'claymore' | 'decoy' | 'doll' = 'grenade',
  /**
   * 名乗る id。
   *
   * **同じ id で入り直すと席が残っている** (30 秒は待つ) ので、前の試験の
   * 続きから始まる — 装備を選び直しても、生きている最中の選択は次の湧きまで
   * 効かない。装備を変える試験は別の id で入る。
   */
  names: [string, string] = ['alice', 'bob'],
  /** b だけ別の支援を選ぶとき (a が置いた物を b が手榴弾で壊す、など) */
  supportB: 'grenade' | 'claymore' | 'decoy' | 'doll' = support,
): Promise<{ a: Client; b: Client }> {
  const a = await new Client(server, names[0], spot(0, -6)).ready()
  const b = await new Client(server, names[1], spot(0, 6)).ready()
  a.live()
  b.live()
  if (support !== 'grenade') a.send({ type: 'loadout', primary: 'rifle', support })
  if (supportB !== 'grenade') b.send({ type: 'loadout', primary: 'rifle', support: supportB })
  /*
   * 支度の段階を抜ける。**押さないと 60 秒待たされる。**
   *
   * 二人揃うと部屋は ready へ入り、全員が押すか 60 秒経つまで playing に
   * ならない (server/match.ts の allReady)。押さないまま撃つと
   * **damage が phase !== 'playing' で捨てられる**。
   *
   * 以前はここが固定の眠り (0.4 + 3.4 + 3.6 秒) で、開始手順だけで
   * 1 件 7 秒超えていた。段階と状態を見て進める形 (beginMatch) に変えた
   * ので、長さはサーバー側の数字 (試験では 0) にだけ依存する
   */
  await beginMatch(a, b)
  return { a, b }
}
