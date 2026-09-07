import { For, Show } from 'solid-js'
import { HIT_LIMIT_MS } from '../../domain/rule/lag'
import type { GameStats } from '../scene/Game'
import './Stats.css'

/**
 * 診断の表示。`?stats=on` を付けたときだけ出る。
 *
 * --- なぜ Calibrator と別に作るか ---
 * 調整パネル (Calibrator) は武器の取り付け位置を詰めるための物で、値を書き換える。
 * 本番に出す物ではないので `import.meta.env.DEV` で丸ごと落としてある。
 *
 * こちらは**読むだけ**。誰が見ても害が無いので本番でも出す。
 *
 * --- なぜ要るか ---
 * 「相手がカクつく / 見えない」の原因は、**送れていないのか、描けていないのか、
 * 配られていないのか**のどれか。切り分けるのに毎回 DevTools を開いてもらうのは重い。
 *
 * TX が 64 を大きく下回っていれば、その機械は描画で手一杯でタイマーが発火できて
 * いない (相手の画面では自分がカクつく)。RX が低ければ**相手側**が同じ状態にある。
 * どちらもこちらからは直せないが、どちらが悪いかが分かるだけで話が早い。
 */
export default function Stats(props: { stats: GameStats | null }) {
  const round = (n: number | undefined) => Math.round(n ?? 0)

  return (
    <div class="stats">
      <div class="stats-row">
        <span class="stats-key">FPS</span>
        <span class="stats-val" classList={{ 'stats-warn': round(props.stats?.fps) < 30 }}>
          {round(props.stats?.fps)}
        </span>
      </div>
      <div class="stats-row">
        <span class="stats-key">GPU</span>
        {/* WebGL2 に落ちていると描画が重くなり、そのぶん送信も細る */}
        <span class="stats-val" classList={{ 'stats-warn': props.stats?.backend === 'WebGL2' }}>
          {props.stats?.backend ?? '—'}
        </span>
      </div>
      {/*
        いま流している型。**試写と本番の突き合わせ用。**

        下半身 / 上半身 / 銃の持ち方の段 (0 立ち · 1 しゃがみ · 2 伏せ)。
      */}
      <div class="stats-row">
        <span class="stats-key">POSE</span>
        <span class="stats-val stats-pose">{props.stats?.pose ?? '—'}</span>
      </div>

      {/*
        往復の時間。**回数 (FPS / TX / RX) とは別物。**

        あちらは「何回」、こちらは「どれだけ待つか」。64 通/秒 届いていても
        全部が 300ms 遅れていることはあるので、回数だけでは分からない。

        **弾が通らなくなる境目で赤くする** (domain/rule/lag.ts の HIT_LIMIT_MS)。
        切られる境目ではない — 切られるずっと手前から、当てても通らなくなって
        いる。赤くなった人は当たらない側に居る。
      */}
      <div class="stats-row">
        <span class="stats-key">PING</span>
        <span
          class="stats-val"
          classList={{ 'stats-warn': round(props.stats?.latency) >= HIT_LIMIT_MS }}
        >
          {round(props.stats?.latency) > 0 ? `${round(props.stats?.latency)}ms` : '—'}
        </span>
      </div>
      <div class="stats-row">
        <span class="stats-key">TX</span>
        <span class="stats-val" classList={{ 'stats-warn': round(props.stats?.sendRate) < 40 }}>
          {round(props.stats?.sendRate)}/s
        </span>
      </div>

      {/* 相手ごとの受信。遅い順に並ぶので、詰まっている人が上に来る */}
      <For each={props.stats?.peerRates ?? []}>
        {(peer) => (
          <div class="stats-row">
            <span class="stats-key stats-peer">RX {peer.name}</span>
            <span class="stats-val" classList={{ 'stats-warn': peer.rate < 40 }}>
              {round(peer.rate)}/s
            </span>
          </div>
        )}
      </For>

      <Show when={(props.stats?.peerRates?.length ?? 0) === 0}>
        <div class="stats-row">
          <span class="stats-key stats-peer">RX</span>
          <span class="stats-val stats-idle">—</span>
        </div>
      </Show>
    </div>
  )
}
