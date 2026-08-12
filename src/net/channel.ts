import type { NetMessage, NetTransport } from './types'

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
  private readonly listeners = new Set<(message: NetMessage) => void>()

  constructor(id: string, name: string, room = 'mgohttp') {
    this.id = id
    this.channel = new BroadcastChannel(room)
    this.channel.onmessage = (event: MessageEvent<NetMessage>) => {
      // 自分の送信は戻ってこない仕様だが、念のため弾く
      if ('id' in event.data && event.data.id === this.id) return
      for (const listener of this.listeners) listener(event.data)
    }

    this.send({ type: 'join', id: this.id, name })
    // タブを閉じた側は leave を送れないこともあるので、受信側は無音の時間でも切る
    window.addEventListener('beforeunload', this.sendLeave)
  }

  send(message: NetMessage): void {
    this.channel.postMessage(message)
  }

  onMessage(listener: (message: NetMessage) => void): void {
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
