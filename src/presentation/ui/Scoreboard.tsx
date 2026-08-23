import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { t } from '../../i18n'
import { MODES } from '../../domain/match/room'
import { pointsOf } from '../../domain/match/scoring'
import { useLevels } from '../../net/levels'
import type { Identity } from '../../auth/session'
import type { GameStats } from '../scene/Game'
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
  identity: Identity
  selfId: string
  onClose: () => void
  onLeave: () => void
}) {
  /** 決着したあとか。そのときは成績表がそのままリザルト画面になる */
  // 名前の横に出す Lv。通算から出るのでサーバーは知らない
  const levelFor = useLevels(
    () => (props.stats?.scores ?? []).map((p) => p.id),
    props.identity,
  )
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

  /**
   * 陣営ごとに分けて、**点の多い順**。同点ならデスの少ない順。
   *
   * キルの多い順にすると、並びと勝敗の決まり方が食い違う。突っ込んで
   * 相打ちを重ねる人が上に来るのに、その人が居るせいで負けている、が起きる。
   */
  const side = (team: 'blue' | 'red') =>
    (props.stats?.scores ?? [])
      .filter((p) => p.team === team)
      .sort((a, b) => pointsOf(b) - pointsOf(a) || a.deaths - b.deaths)

  /** その部屋のルール。陣営で分けるかどうかがこれで決まる */
  const mode = () => props.stats?.match?.mode ?? 'TDM'
  const teams = () => MODES[mode()].teams

  /**
   * 個人戦の並び。**陣営で分けず、1 本の順位表にする。**
   *
   * 分けて出すと「味方が居る」に読める。全員が敵なので、上から順に強い、が
   * そのまま読めるほうがいい。
   */
  const ranking = () =>
    [...(props.stats?.scores ?? [])].sort(
      (a, b) => pointsOf(b) - pointsOf(a) || a.deaths - b.deaths,
    )

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

        {/* 上の数字は**残機**。0 にされた側が負け (個人戦は部屋で 1 つ) */}
        <header class="score-head">
          <Show
            when={teams()}
            fallback={
              <span class="score-solo-head">
                {mode()} <span class="score-solo-left">{props.stats?.match?.blue ?? 0}</span>
              </span>
            }
          >
            <span class="score-blue">
              {t('score.blue')} {props.stats?.match?.blue ?? 0}
            </span>
            <span class="score-dash">–</span>
            <span class="score-red">
              {props.stats?.match?.red ?? 0} {t('score.red')}
            </span>
          </Show>
        </header>

        {/*
          個人戦。**1 本の順位表。** 陣営で分けると「味方が居る」に読める。
          順位を左に振って、上から強い順であることを見せる。
        */}
        <Show when={!teams()}>
          <div class="score-solo">
            <div class="score-team-head">
              順位
              <span class="score-cols">
                <span class="score-col-points">P</span>
                <span>K</span>
                <span>D</span>
                <span class="score-col-rate">/s</span>
              </span>
            </div>
            <For each={ranking()}>
              {(player, index) => (
                <div
                  class="score-row"
                  classList={{
                    'score-mine': player.id === props.selfId,
                    'score-away': player.away === true,
                  }}
                >
                  <span class="score-name">
                    <span class="score-rank">{index() + 1}</span>
                    <span class="score-lv">{levelFor(player.id)}</span>
                    {player.name}
                    {player.away === true && <span class="score-tag">{t('score.away')}</span>}
                  </span>
                  <span class="score-num score-points">{pointsOf(player)}</span>
                  <span class="score-num">{player.kills}</span>
                  <span class="score-num score-deaths">{player.deaths}</span>
                  <span
                    class="score-num score-rate"
                    classList={{ 'score-rate-low': (player.rate ?? 0) > 0 && (player.rate ?? 0) < 40 }}
                  >
                    {player.away === true ? '—' : (player.rate ?? 0) || '—'}
                  </span>
                </div>
              )}
            </For>
            <Show when={ranking().length === 0}>
              <div class="score-none">{t('score.empty')}</div>
            </Show>
          </div>
        </Show>

        <Show when={teams()}>
        <div class="score-teams">
          <For each={['blue', 'red'] as const}>
            {(team) => (
              <div class="score-team">
                <div class={`score-team-head score-${team}`}>
                  {team === 'blue' ? t('score.blue') : t('score.red')}
                  <span class="score-cols">
                    {/* 点。kill +3 / death -2 の合算 */}
                    <span class="score-col-points">P</span>
                    <span>K</span>
                    <span>D</span>
                    {/* 通信。名目 64 通/秒 */}
                    <span class="score-col-rate">/s</span>
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
                        <span class="score-lv">{levelFor(player.id)}</span>
                        {player.name}
                        {player.away === true && <span class="score-tag">{t('score.away')}</span>}
                      </span>
                      {/*
                        点。勝敗を決めているのはこれなので、K/D より先に置く。
                        **負にもなる。**
                      */}
                      <span class="score-num score-points">{pointsOf(player)}</span>
                      <span class="score-num">{player.kills}</span>
                      <span class="score-num score-deaths">{player.deaths}</span>
                      {/*
                        位置が届いている回数。低い人は自分の機械が送れていない。
                        相手の画面ではその人がカクつくので、**誰のせいかが
                        全員に見える**ようにしておく。
                      */}
                      <span
                        class="score-num score-rate"
                        classList={{ 'score-rate-low': (player.rate ?? 0) > 0 && (player.rate ?? 0) < 40 }}
                      >
                        {player.away === true ? '—' : (player.rate ?? 0) || '—'}
                      </span>
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
        </Show>

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
