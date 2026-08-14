import { NetChannel } from './channel'
import { NetSocket } from './socket'
import type { NetTransport } from './types'
import type { Identity } from '../auth/session'

/**
 * 通信路を選ぶ。
 *
 * 既定はサーバー (WebSocket)。アカウントが 1 つのブラウザに 1 つになったので、
 * タブを 2 つ開いて動きを見る、という使い方はもう成立しない。
 *
 *   (既定)                    → 同じホストの 8787 番へ
 *   ?server=192.168.1.5:8787  → そのホストへ
 *   ?server=wss://example.com → そのまま使う
 *   ?local=1                  → 同じブラウザのタブ同士 (サーバー無しで見るとき)
 *
 * 部屋は一覧から選ぶ。誰として繋ぐかは URL では指定できない。
 */

/** サーバーの既定ポート。server/index.ts と揃えること */
const DEFAULT_PORT = 8787

/**
 * 既定の接続先。ビルド時に決まる。
 *
 * 本番はここに `wss://mgohttp.pepaga.me` が入る。手元では空のままなので、
 * 「このページと同じホストの 8787」に落ちる。
 *
 * `?server=` を付ければどちらの場合でも上書きできる。手元の画面から
 * 本番のサーバーへ繋いで試す、ができる。
 */
const BUILT_IN_SERVER = import.meta.env.VITE_SERVER_URL ?? ''

/**
 * @param identity ログイン済みの本人。ID も名前もここから取る。
 *   サーバーは token の署名から ID を導くので、名乗った値は使われない。
 */
export function createTransport(identity: Identity, room: string): NetTransport {
  const params = new URLSearchParams(location.search)
  const { subject: id, displayName: name } = identity

  if (params.get('local') === '1') return new NetChannel(id, name, `mgohttp:${room}`)

  const url = resolveServerUrl(params.get('server') ?? BUILT_IN_SERVER ?? '1')
  console.info(`[Net] WebSocket で接続: ${url} (room: ${room}, name: ${name})`)
  return new NetSocket(id, name, url, room, identity.token)
}

/** 短い書き方を URL に展開する */
function resolveServerUrl(server: string): string {
  if (server.startsWith('ws://') || server.startsWith('wss://')) return server

  // ページが https なら ws:// は混在コンテンツとして遮断されるので合わせる
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  // "1" や "true" は「このページと同じホスト」の意味
  const host =
    server === '1' || server === 'true' || server === ''
      ? `${location.hostname}:${DEFAULT_PORT}`
      : server
  return `${scheme}://${host}`
}

/**
 * 部屋の一覧を取りに行く先。
 *
 * WebSocket と同じホスト。ws:// と http:// を書き分けずに済むよう、
 * 一箇所で組み立てる。
 */
export function serverHttpUrl(): string {
  const params = new URLSearchParams(location.search)
  return resolveServerUrl(params.get('server') ?? BUILT_IN_SERVER ?? '1')
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
}
