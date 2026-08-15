import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { t } from '../i18n'
import type { GameStats } from '../game/Game'
import './Scoreboard.css'

/**
 * 成績表。Tab で開く。
 *
 * 数えているのはサーバー。キル表示から各自が数え上げる形にすると、
 * 途中から入った人はそれまでの分を知らないし、1 通取りこぼせばずっとずれる。
 *
 * 開いている間はポインタが離れるので、そのまま部屋を出る操作もここに置く。
 * 対戦中に押せる場所へ「戻る」を置くと、撃ち合いの最中に誤爆する。
 *
 * 全画面もここに置く。ブラウザは**ユーザーの操作からしか**全画面にさせて
 * くれないので、押す物が要る。カーソルが出ているのはこの画面だけ。
 */
export default function Scoreboard(props: {
  stats: GameStats | null
  selfId: string
  onClose: () => void
  onLeave: () => void
}) {
  /** 決着したあとか。そのときは成績表がそのままリザルト画面になる */
  const over = () => props.stats?.match?.phase === 'over'
  const winner = () => props.stats?.match?.winner
  /** 自分の陣営。勝ったかどうかの言い方を変えるのに使う */
  const mine = () => props.stats?.scores?.find((p) => p.id === props.selfId)?.team
  const verdict = () =>
    winner() === 'draw' ? 'DRAW' : winner() === mine() ? 'VICTORY' : 'DEFEAT'
  /**
   * いま全画面か。
   *
   * ブラウザ自前の全画面 (F11 / ⌃⌘F) とは別物で、そちらは JS から見えない。
   * ここが見ているのは Fullscreen API のほうだけ。
   */
  const [full, setFull] = createSignal(document.fullscreenElement !== null)
  const onChange = () => setFull(document.fullscreenElement !== null)
  onMount(() => document.addEventListener('fullscreenchange', onChange))
  onCleanup(() => document.removeEventListener('fullscreenchange', onChange))

  const toggleFullscreen = () => {
    // 失敗しても対戦は続く。握り潰して構わない
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen().catch(() => {})
  }

  /** 次の試合まで (秒) */
  const nextIn = () =>
    Math.max(0, Math.ceil(((props.stats?.match?.endsAt ?? 0) - Date.now()) / 1000))

  // 陣営ごとに分けて、キルの多い順。同数ならデスの少ない順
  const side = (team: 'blue' | 'red') =>
    (props.stats?.scores ?? [])
      .filter((p) => p.team === team)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)

  return (
    <div class="score">
      <div class="score-panel">
        <Show when={over()}>
          <div
            class="score-verdict"
            classList={{
              'score-verdict-win': verdict() === 'VICTORY',
              'score-verdict-lose': verdict() === 'DEFEAT',
            }}
          >
            {verdict()}
          </div>
        </Show>

        <header class="score-head">
          <span class="score-blue">
            {t('score.blue')} {props.stats?.match?.blue ?? 0}
          </span>
          <span class="score-dash">–</span>
          <span class="score-red">
            {props.stats?.match?.red ?? 0} {t('score.red')}
          </span>
        </header>

        <div class="score-teams">
          <For each={['blue', 'red'] as const}>
            {(team) => (
              <div class="score-team">
                <div class={`score-team-head score-${team}`}>
                  {team === 'blue' ? t('score.blue') : t('score.red')}
                  <span class="score-cols">
                    <span>K</span>
                    <span>D</span>
                  </span>
                </div>

                <For each={side(team)}>
                  {(player) => (
                    <div
                      class="score-row"
                      classList={{
                        'score-mine': player.id === props.selfId,
                        // 離脱中。行は残す (消すと試合が壊れたように見える) が、
                        // 今そこに居ないことは分かるようにする
                        'score-away': player.away === true,
                      }}
                    >
                      <span class={`score-name score-${team}`}>
                        {player.name}
                        {player.away === true && <span class="score-tag">{t('score.away')}</span>}
                      </span>
                      <span class="score-num">{player.kills}</span>
                      <span class="score-num score-deaths">{player.deaths}</span>
                    </div>
                  )}
                </For>

                <Show when={side(team).length === 0}>
                  <div class="score-none">{t('score.empty')}</div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <footer class="score-foot">
          <div class="score-aside">
            <button class="score-leave" onClick={props.onLeave}>
              Leave
            </button>
            <button class="score-leave" onClick={toggleFullscreen}>
              {full() ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
          <Show when={over()}>
            <span class="score-next">NEXT MATCH IN {nextIn()}</span>
          </Show>
          <button class="score-close" onClick={props.onClose}>
            {t('score.back')} <span class="score-key">Tab</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
