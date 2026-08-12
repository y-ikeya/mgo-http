import { For, Show } from 'solid-js'
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
 */
export default function Scoreboard(props: {
  stats: GameStats | null
  selfId: string
  onClose: () => void
  onLeave: () => void
}) {
  // 陣営ごとに分けて、キルの多い順。同数ならデスの少ない順
  const side = (team: 'blue' | 'red') =>
    (props.stats?.scores ?? [])
      .filter((p) => p.team === team)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)

  return (
    <div class="score">
      <div class="score-panel">
        <header class="score-head">
          <span class="score-blue">青 {props.stats?.match?.blue ?? 0}</span>
          <span class="score-dash">–</span>
          <span class="score-red">{props.stats?.match?.red ?? 0} 赤</span>
        </header>

        <div class="score-teams">
          <For each={['blue', 'red'] as const}>
            {(team) => (
              <div class="score-team">
                <div class={`score-team-head score-${team}`}>
                  {team === 'blue' ? '青' : '赤'}
                  <span class="score-cols">
                    <span>K</span>
                    <span>D</span>
                  </span>
                </div>

                <For each={side(team)}>
                  {(player) => (
                    <div class="score-row" classList={{ 'score-mine': player.id === props.selfId }}>
                      <span class={`score-name score-${team}`}>{player.name}</span>
                      <span class="score-num">{player.kills}</span>
                      <span class="score-num score-deaths">{player.deaths}</span>
                    </div>
                  )}
                </For>

                <Show when={side(team).length === 0}>
                  <div class="score-none">まだ誰も居ない</div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <footer class="score-foot">
          <button class="score-leave" onClick={props.onLeave}>
            部屋を出る
          </button>
          <button class="score-close" onClick={props.onClose}>
            戻る <span class="score-key">Tab</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
