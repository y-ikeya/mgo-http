import type { ClientMessage, NetTransport, ServerMessage } from './types'

/**
 * サーバーの居ない通信路で通してよい種類。
 *
 * 両向きに現れる物 = 権威が要らない物、と一致する。体力も得点も決める人が
 * 居ないので、相手のタブが「倒した」と言ってきても通す先が無い。
 *
 * 型で縛ってある (両方の union に無い名前を書くと落ちる) ので、
 * メッセージを増やしたときにここだけ古い、が起きない。
 */
const RELAYED: ReadonlySet<ClientMessage['type'] & ServerMessage['type']> = new Set([
  'state',
  'join',
  'leave',
  'shot',
  'knock',
  'throw',
])

/**
 * タブ間の通信路。
 *
 * BroadcastChannel は同一ブラウザの別タブ同士を繋ぐ仕組みで、サーバーを立てずに
 * 2 人で対戦できる。本番は WebTransport になるが、**その上を流れるメッセージは同じ**。
 *
 * ここを最初に作るのは、予測・補間・遠隔プレイヤーの描画といった
 * 「対戦にすると必ず要る処理」を、通信の不確実さ抜きで先に検証したいから。
 * 遅延やパケットロスは後から注入して試せる (send を細工するだけ)。
 *
 * 現時点では各タブが自分のキャラを自分で動かす。サーバー権威ではないので
 * このままでは不正に無防備だが、状態の形と描画の仕組みは権威を移しても変わらない。
 *
 * 別のマシンと繋ぐときは NetSocket (WebSocket) に差し替わる。どちらも
 * NetTransport なので、ゲーム側は違いを知らない。
 */
export class NetChannel implements NetTransport {
  readonly id: string

  private readonly channel: BroadcastChannel
  private readonly listeners = new Set<(message: ServerMessage) => void>()

  constructor(id: string, name: string, room = 'mgohttp') {
    this.id = id
    this.channel = new BroadcastChannel(room)
    this.channel.onmessage = (event: MessageEvent<ClientMessage>) => {
      // 自分の送信は戻ってこない仕様だが、念のため弾く
      if ('id' in event.data && event.data.id === this.id) return
      // 相手のタブは**クライアント**なので、権威の要る物は名乗れない。
      // 通すのは両向きに現れる物だけ (RELAYED で型ごと縛ってある)
      const message = event.data
      if (!RELAYED.has(message.type as never)) return
      for (const listener of this.listeners) listener(message as ServerMessage)
    }

    this.send({ type: 'join', id: this.id, name })
    // タブを閉じた側は leave を送れないこともあるので、受信側は無音の時間でも切る
    window.addEventListener('beforeunload', this.sendLeave)
  }

  send(message: ClientMessage): void {
    this.channel.postMessage(message)
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listeners.add(listener)
  }

  dispose(): void {
    this.sendLeave()
    window.removeEventListener('beforeunload', this.sendLeave)
    this.listeners.clear()
    this.channel.close()
  }

  private readonly sendLeave = () => {
    this.send({ type: 'leave', id: this.id })
  }
}
