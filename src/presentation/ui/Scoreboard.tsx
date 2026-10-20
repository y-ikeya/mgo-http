import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { t } from '../../i18n'
import { MODES } from '../../domain/match/room'
import { SKILL_BUDGET, costOf, type SkillId, type Skills } from '../../domain/player/skill'
import { dmOrder, dmVerdict, pointsOf } from '../../domain/match/scoring'
import { useLevels } from '../../infra/api/levels'
import type { Identity } from '../../infra/auth/session'
import type { GameStats } from '../scene/Game'
import { SkillList } from './SkillPanel'
import { DEFAULT_LOOK_SCALE, LOOK_SCALE_MAX, LOOK_SCALE_MIN, type LookScale } from '../../infra/prefs/look'
import { RENDER_SCALE_MAX, RENDER_SCALE_MIN } from '../../infra/prefs/quality'
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

/** 設定のタブに並べる感度。左の名前と、持っている値の名前 */
const LOOK_ROWS: { label: string; key: 'mouseHip' | 'mouseAim' | 'padHip' | 'padAim' }[] = [
  { label: 'マウス', key: 'mouseHip' },
  { label: 'マウス (構え)', key: 'mouseAim' },
  { label: 'パッド', key: 'padHip' },
  { label: 'パッド (構え)', key: 'padAim' },
]

export default function Scoreboard(props: {
  stats: GameStats | null
  identity: Identity
  selfId: string
  onClose: () => void
  onLeave: () => void
  /** いま付けているスキル */
  skills: Skills
  /** 組み替えてよいか。練習部屋はいつでも開いている (domain/player/skill.ts) */
  skillsOpen: boolean
  onSkill: (id: SkillId, level: number) => void
  /** 視点の感度 (設定のタブ)。マウスとパッド、構えていない時と構えている時 */
  lookScale: LookScale
  onLookScale: (next: LookScale) => void
  /** 画質 (設定のタブ)。描く細かさの倍率 (画面の 1 画素に何画素描くか) */
  renderScale: number
  onRenderScale: (next: number) => void
}) {
  /**
   * どの板を見ているか。**成績表とスキルを 1 枚に重ねる。**
   *
   * どちらも「Tab を押して、撃ち合いを止めて見る物」なので、開き方を別に
   * するとキーが 2 つ要る。指を離している間に見る物はここに集める。
   */
  const [tab, setTab] = createSignal<'board' | 'skills' | 'settings'>('board')
  /** 決着したあとか。そのときは成績表がそのままリザルト画面になる */
  // 名前の横に出す Lv。通算から出るのでサーバーは知らない
  const levelFor = useLevels(
    () => (props.stats?.scores ?? []).map((p) => p.id),
    props.identity,
  )
  /**
   * 通信の具合を**乾電池**で出す。
   *
   * 名目は 64 通/秒。数字そのものは読む人にとって意味が薄く (64 が満点だと
   * 知らないと 40 の良し悪しが分からない)、列に並ぶと桁が目立つだけだった。
   * 目盛りなら**満か欠けか**が一目で分かる。
   *
   * 4 目盛り。3 分の 2 を切ったら減らし始め、4 分の 1 で最後の 1 つになる。
   * 途切れている人 (away) と、まだ届いていない人は空で出す。
   *
   * **置き場所は名前の左。** 数字の列に混ぜると「点・倒した数・通信」が同じ
   * 並びに見えるが、通信は成績ではない。人に付く印なので名前側へ寄せる。
   *
   * 低い人は自分の機械が送れていない。相手の画面ではその人がカクつくので、
   * **誰のせいかが全員に見える**ようにしておく。
   */
  const bars = (rate: number) =>
    rate >= 55 ? 4 : rate >= 40 ? 3 : rate >= 24 ? 2 : rate > 0 ? 1 : 0

  const Battery = (cell: { rate: number; away?: boolean }) => {
    const level = () => (cell.away === true ? 0 : bars(cell.rate ?? 0))
    return (
      <span
        class="score-signal"
        classList={{
          'score-rate-mid': level() === 2,
          'score-rate-low': level() === 1,
          'score-rate-out': level() === 0,
        }}
        title={`${cell.away === true ? 0 : (cell.rate ?? 0)} 通/秒`}
      >
        <svg class="score-battery" viewBox="0 0 22 12" aria-hidden="true">
          {/* 胴と端子。線だけで描いて、中の目盛りで具合を出す */}
          <rect x="0.5" y="0.5" width="18" height="11" rx="1.5" />
          <rect class="score-battery-nub" x="19.5" y="3.5" width="2.5" height="5" rx="0.8" />
          <For each={[0, 1, 2, 3]}>
            {(i) => (
              <Show when={i < level()}>
                <rect class="score-battery-bar" x={2 + i * 4} y={2.5} width="3" height="7" />
              </Show>
            )}
          </For>
        </svg>
      </span>
    )
  }

  const over = () => props.stats?.match?.phase === 'over'
  /**
   * 陣営の合計点。**決着の画面にだけ出す。**
   *
   * 勝敗は残機で決まる (上の数字) が、どちらがよく働いたかは点の合計に出る。
   * 元の MGO2 も結果画面では残機と TOTAL SCORE を並べていた。
   */
  const teamPoints = (team: string) =>
    (props.stats?.scores ?? [])
      .filter((player) => player.team === team)
      .reduce((sum, player) => sum + pointsOf(player), 0)
  const winner = () => props.stats?.match?.winner
  /** 自分の陣営。勝ったかどうかの言い方を変えるのに使う */
  const mine = () => props.stats?.scores?.find((p) => p.id === props.selfId)?.team
  const verdict = () =>
    // 個人戦は陣営が無いので、倒した数の順位から出す (domain/match/scoring.ts の dmVerdict)
    !teams()
      ? dmVerdict(props.stats?.scores ?? [], props.selfId)
      : winner() === 'draw'
        ? 'DRAW'
        : winner() === mine()
          ? 'VICTORY'
          : 'DEFEAT'
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
   * 個人戦の並び。**陣営で分けず、1 本の順位表にする。倒した数の多い順** (dmOrder)。
   *
   * 分けて出すと「味方が居る」に読める。全員が敵なので、上から順に強い、が
   * そのまま読めるほうがいい。
   */
  const ranking = () => [...(props.stats?.scores ?? [])].sort(dmOrder)

  return (
    // 決着したら画面いっぱいに開く。**同じ板が結果画面を兼ねる**
    <div class="score" classList={{ 'score-over': over() }}>
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
          板を選ぶ。**アイコンだけ。** 名前を書くほどの数ではないし、
          Tab で開いた直後に読ませたいのは中身のほう。
        */}
        <nav class="score-tabs" classList={{ 'score-tabs-hidden': over() }}>
          <button
            class="score-tab"
            classList={{ 'score-tab-on': tab() === 'board' }}
            title="対戦表"
            onClick={() => setTab('board')}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="1.5" width="11" height="13" rx="1" />
              <path d="M5 5h6M5 8h6M5 11h4" />
            </svg>
          </button>
          <button
            class="score-tab"
            classList={{ 'score-tab-on': tab() === 'skills' }}
            title="スキル"
            onClick={() => setTab('skills')}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 6h9v2.5H2z" />
              <path d="M11 7h3.5M5 8.5l-1 3h2.2l.8-3M8.6 8.5l-.7 2.7" />
            </svg>
          </button>
          <button
            class="score-tab"
            classList={{ 'score-tab-on': tab() === 'settings' }}
            title="設定"
            onClick={() => setTab('settings')}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" />
              <circle cx="5" cy="4" r="1.6" />
              <circle cx="10.5" cy="8" r="1.6" />
              <circle cx="7" cy="12" r="1.6" />
            </svg>
          </button>
        </nav>


        <Show when={tab() === 'board'}>
        {/*
          個人戦。**1 本の順位表。** 陣営で分けると「味方が居る」に読める。
          順位を左に振って、上から強い順であることを見せる。
        */}
        <Show when={!teams()}>
          <div class="score-solo">
            <div class="score-team-head">
              順位
              <span class="score-cols">
                {/* 通算の Lv。**その試合の成績ではない**ので、点の手前に置く */}
                <span>Lv</span>
                <span>K</span>
                {/* 眠らせた数。**倒した数には入らない** — 残機が減っていない */}
                <span class="score-col-stun">S</span>
                <span>D</span>
                {/* 合計点。**読ませたい数なので最後** */}
                <span class="score-col-points">P</span>
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
                    <Battery rate={player.rate ?? 0} away={player.away} />
                    {player.name}
                    {player.away === true && <span class="score-tag">{t('score.away')}</span>}
                  </span>
                  <span class="score-num score-level">{levelFor(player.id)}</span>
                  <span class="score-num">{player.kills}</span>
                  <span class="score-num score-stuns">{player.stuns || ''}</span>
                  <span class="score-num score-deaths">{player.deaths}</span>
                  <span class="score-num score-points">{pointsOf(player)}</span>
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
                  <span>
                    {team === 'blue' ? t('score.blue') : t('score.red')}
                    {/* 合計点。決着したときだけ。試合中は残機を読ませたい */}
                    <Show when={over()}>
                      <span class="score-team-points">{teamPoints(team)}</span>
                    </Show>
                  </span>
                  <span class="score-cols">
                    {/* 通算の Lv。**その試合の成績ではない**ので、点の手前に置く */}
                    <span>Lv</span>
                    <span>K</span>
                    {/* 眠らせた数。**倒した数には入らない** */}
                    <span class="score-col-stun">S</span>
                    <span>D</span>
                    {/* 点。kill +3 / stun +3 / death -2 / 自死 -5 の合算 */}
                    <span class="score-col-points">P</span>
                    {/* 通信。名目 64 通/秒 */}
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
                        <Battery rate={player.rate ?? 0} away={player.away} />
                        {player.name}
                        {player.away === true && <span class="score-tag">{t('score.away')}</span>}
                      </span>
                      <span class="score-num score-level">{levelFor(player.id)}</span>
                      <span class="score-num">{player.kills}</span>
                      <span class="score-num score-stuns">{player.stuns || ''}</span>
                      <span class="score-num score-deaths">{player.deaths}</span>
                      {/* 合計点。**負にもなる**ので 1 桁ぶん広い */}
                      <span class="score-num score-points">{pointsOf(player)}</span>
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
        </Show>

        {/*
          スキル。**練習部屋は組み替えられる、それ以外は見るだけ。**

          効き目を確かめる場所で試合の切れ目を待たせると確かめられないので、
          練習部屋だけ窓を開けてある (domain/player/skill.ts の canChooseSkills)。
          閉じている部屋でも並べるのは、**いま自分が何を付けているか**が
          撃ち合いの最中に思い出せないから。
        */}
        <Show when={tab() === 'skills'}>
          <div class="score-skills">
            <div class="score-skills-head">
              <span class="score-skills-budget" classList={{ 'score-skills-full': costOf(props.skills) >= SKILL_BUDGET }}>
                {costOf(props.skills)} / {SKILL_BUDGET}
              </span>
              <Show when={!props.skillsOpen}>
                <span class="score-skills-locked">試合中は変更不可</span>
              </Show>
            </div>
            <div class="score-skills-list">
              <SkillList skills={props.skills} open={props.skillsOpen} onSkill={props.onSkill} />
            </div>
          </div>
        </Show>

        {/*
          設定。**視点の感度を 4 本** (本人 2026-10-15)。マウスとパッドはちょうどよい速さが
          大きく違うので分け、それぞれ構えていない時と構えている時を持つ。動かした瞬間から効く
        */}
        <Show when={tab() === 'settings'}>
          <div class="score-settings">
            <div class="score-settings-head">視点の感度</div>
            <For each={LOOK_ROWS}>
              {(row) => (
                <label class="score-setting">
                  <span class="score-setting-label">{row.label}</span>
                  <input
                    class="score-setting-range"
                    type="range"
                    min={LOOK_SCALE_MIN}
                    max={LOOK_SCALE_MAX}
                    step={0.05}
                    value={props.lookScale[row.key]}
                    onInput={(e) => props.onLookScale({ ...props.lookScale, [row.key]: Number(e.currentTarget.value) })}
                  />
                  <span class="score-setting-value">× {props.lookScale[row.key].toFixed(2)}</span>
                </label>
              )}
            </For>
            <div class="score-settings-head">武器の一覧</div>
            <label class="score-setting score-setting-check">
              <span class="score-setting-label">スティックの上下を逆に</span>
              <input
                type="checkbox"
                checked={props.lookScale.listInvert}
                onChange={(e) => props.onLookScale({ ...props.lookScale, listInvert: e.currentTarget.checked })}
              />
            </label>
            <button class="score-leave score-settings-reset" onClick={() => props.onLookScale({ ...DEFAULT_LOOK_SCALE })}>
              既定に戻す
            </button>
            {/*
              画質。描く細かさの倍率。**右が細かい** (本人 2026-10-19)。重い機械 (内蔵 GPU、
              高解像度の画面) で詰まって切られる人が左へ寄せる
            */}
            <div class="score-settings-head">画質</div>
            <label class="score-setting">
              <span class="score-setting-label">描く細かさ</span>
              <input
                class="score-setting-range"
                type="range"
                min={RENDER_SCALE_MIN}
                max={RENDER_SCALE_MAX}
                step={0.05}
                value={props.renderScale}
                onInput={(e) => props.onRenderScale(Number(e.currentTarget.value))}
              />
              <span class="score-setting-value">× {props.renderScale.toFixed(2)}</span>
            </label>
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
