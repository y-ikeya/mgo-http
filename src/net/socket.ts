import { decodeSnapshot, encodeSnapshot, isSnapshot, readSlot } from './snapshot'
import type { ClientMessage, NetTransport, ServerMessage } from './types'

/**
 * WebSocket の通信路。別のマシンにいる相手と繋ぐ。
 *
 * サーバーは中継しかしない (server/index.ts)。判定は今のところ撃った側が出して
 * 結果を配る形のままで、サーバー権威ではない。ここを権威に変えるのが Rust 版の仕事で、
 * そのときもゲーム側から見た口 (NetTransport) は変わらない。
 */

/** 繋ぎ直しまでの待ち時間 (ms)。短すぎるとサーバー再起動中に叩き続ける */
const RECONNECT_DELAY = 1500

export class NetSocket implements NetTransport {
  readonly id: string

  private readonly url: string
  private readonly listeners = new Set<(message: ServerMessage) => void>()
  private readonly name: string
  private socket: WebSocket | null = null
  /**
   * 席番号 → ID。
   *
   * 位置だけは 2 進で流れてくるので、36 文字の ID ではなく 2 バイトの番号が乗る。
   * 対応は roster / join で届くので、通信層がここで持って元の形に戻す。
   * ゲーム側からは今までどおり ID の付いた state に見える。
   */
  private readonly slots = new Map<number, string>()
  private reconnectTimer = 0
  private disposed = false

  /**
   * @param url ws:// または wss:// のサーバー URL
   * @param room 部屋の名前。同じ部屋の相手とだけ繋がる
   */
  /**
   * @param token 発行元が署名したもの。渡すとサーバーが署名から ID を導く。
   *   省略すると名乗った ID がそのまま使われる (認証を設定していない環境用)。
   */
  constructor(id: string, name: string, url: string, room = 'default', token?: string) {
    this.id = id
    this.name = name
    // 部屋はクエリで渡す。サーバーは最初のメッセージを待たずに
    // 誰がどこに居るか分かるので、切断時に leave を代わりに配れる。
    //
    // token をクエリに載せるのは、ブラウザが WebSocket にヘッダを付けられないため。
    // ログに残る場所なので、寿命の短いものを使う (1 時間で失効し、自動で取り直す)。
    const who = token
      ? `token=${encodeURIComponent(token)}`
      : `id=${encodeURIComponent(id)}`
    this.url = `${url}?${who}&room=${encodeURIComponent(room)}`
    this.connect()
  }

  send(message: ClientMessage): void {
    // 繋がっていなければ捨てる。溜めて後から流すと、既に古くなった位置が
    // 現在の状態として届く。状態は送り直されるので、落とすのが正しい。
    if (this.socket?.readyState !== WebSocket.OPEN) return

    // 位置だけ 2 進。ここだけ数が桁違いに多い。
    // 席番号は書かない — サーバーが接続から知っているので、名乗る必要が無い。
    if (message.type === 'state') {
      this.socket.send(encodeSnapshot(message.snapshot))
      return
    }
    this.socket.send(JSON.stringify(message))
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listeners.add(listener)
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.reconnectTimer)
    this.listeners.clear()
    // 明示的に閉じる。サーバー側の close で他の参加者へ leave が配られる。
    this.socket?.close()
    this.socket = null
  }

  /**
   * 2 進の位置を元の形に戻して配る。
   *
   * 知らない席番号は捨てる。名簿より先に位置が届くことは無いはず (同じ接続の
   * 順序は保たれる) だが、届いたとしても誰のものか分からないものは足せない。
   */
  private receiveSnapshot(buffer: ArrayBuffer): void {
    const view = new DataView(buffer)
    if (!isSnapshot(view)) return
    const id = this.slots.get(readSlot(view))
    if (!id) return

    const message: ServerMessage = { type: 'state', snapshot: decodeSnapshot(view, id) }
    for (const listener of this.listeners) listener(message)
  }

  private connect(): void {
    if (this.disposed) return

    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      // 名前はここで 1 回だけ名乗る。サーバーが名簿に持ち、
      // 後から入ってきた相手には名簿としてまとめて渡される。
      this.send({ type: 'join', id: this.id, name: this.name })
    }

    socket.binaryType = 'arraybuffer'

    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        this.receiveSnapshot(event.data)
        return
      }

      let message: ServerMessage
      try {
        message = JSON.parse(event.data)
      } catch {
        // 壊れたメッセージ 1 通で対戦が止まる理由はない
        return
      }

      // 席番号の対応を控える。位置を元の形に戻すのに要る
      if (message.type === 'roster') {
        for (const p of message.players) {
          if (p.slot !== undefined) this.slots.set(p.slot, p.id)
        }
      } else if (message.type === 'join' && message.slot !== undefined) {
        this.slots.set(message.slot, message.id)
      } else if (message.type === 'leave') {
        for (const [slot, id] of this.slots) if (id === message.id) this.slots.delete(slot)
      }
      // ここで id による自己フィルタは掛けない。
      //
      // サーバーは送り主へ返さないので不要であるうえ、有害でもある。
      // health / respawn の id は「送り主」ではなく「その状態の持ち主」なので、
      // 自分宛ての体力と復帰を、自分の送信と誤認して捨ててしまう。
      for (const listener of this.listeners) listener(message)
    }

    socket.onclose = () => {
      if (this.disposed || this.socket !== socket) return
      this.socket = null
      // 繋ぎ直すと席番号は割り当て直される。古い対応を残すと他人の位置になる
      this.slots.clear()
      // 落ちたら繋ぎ直す。サーバーを再起動しても対戦が終わらないように。
      this.reconnectTimer = window.setTimeout(() => this.connect(), RECONNECT_DELAY)
    }

    socket.onerror = () => {
      // onclose が続けて呼ばれるので、ここでは繋ぎ直しを始めない
      socket.close()
    }
  }
}
