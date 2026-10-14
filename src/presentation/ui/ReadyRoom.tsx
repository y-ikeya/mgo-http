import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { LoadoutFocus } from '../scene/Game'
import { READY_HOLD } from '../scene/Game'
import { Portrait } from '../scene/portrait'
import type { WeaponKind } from '../scene/arms/weapon'
import { SKILLS, SKILL_BUDGET, costOf, type SkillId, type Skills } from '../../domain/player/skill'
import { skillDetail } from '../../domain/player/skillDetail'
import type { MatchMessage } from '../../application/protocol/types'
import { t } from '../../i18n'
import { SkillList } from './SkillPanel'
import './Loadout.css'
import './ReadyRoom.css'

/**
 * 待合室。試合前の支度 (ready) の間だけ出る (URL は /rooms/:room/standby)。
 *
 *   左   自分の兵士 (scene/portrait.ts)
 *   右   スキル。指した物の効き目を**数字で**出す (domain/player/skillDetail.ts)
 *   下   参加者と READY
 *
 * 装備画面 (Loadout) の支度の段から分けた (2026-10-09 本人)。あちらは
 * 倒れて次に湧くまでの短い支度と同じ板で、スキルを選ぶ場所としては狭く、
 * 「どれだけ速くなるのか」が読めなかった。将来は見た目や無線もここで決める。
 *
 * **READY は長押し** (READY_HOLD 秒)。1 押しで入っていた頃、スキルを選んで
 * いる途中の × で READY になって流れた。取り消しは 1 押し。
 */
export default function ReadyRoom(props: {
  /** 着ているモデル (actor/skin.ts の selfSkin) */
  skin: string
  /** 手に持たせる銃。部屋が銃を外していれば null */
  gun: WeaponKind | null
  left: number
  skills: Skills
  skillsOpen: boolean
  onSkill: (id: SkillId, level: number) => void
  players: MatchMessage['players']
  selfId: string
  onReady: (ready: boolean) => void
  /** 鍵盤・パッドで押している分 (0〜1)。Game が数える */
  hold: number
  focus: LoadoutFocus
}) {
  let stage!: HTMLDivElement
  onMount(() => {
    const portrait = new Portrait(stage, props.skin, props.gun)
    onCleanup(() => portrait.dispose())
  })

  const mine = () => props.players.find((p) => p.id === props.selfId)
  const ready = () => mine()?.ready === true

  /*
   * 詳しく出す技。**マウスを乗せた物、無ければパッドで指している物。**
   * どちらも無ければ最初の技 — 空の板を出すと、何が出る場所か分からない
   */
  const [hovered, setHovered] = createSignal<SkillId | null>(null)
  const shown = createMemo<SkillId>(() => {
    const focus = props.focus as string
    if (focus in SKILLS) return focus as SkillId
    return hovered() ?? (Object.keys(SKILLS)[0] as SkillId)
  })
  const detail = createMemo(() => skillDetail(shown()))
  const level = () => props.skills[shown()] ?? 0

  /*
   * マウスでの長押し。**押している間だけ満ちる。** 鍵盤とパッドは Game が
   * 数えて hold で渡してくる — 両方のうち進んでいる方を描く
   */
  const [pressedAt, setPressedAt] = createSignal(0)
  /** 押し下げた時に READY だったか */
  let readyAtDown = false
  const [now, setNow] = createSignal(0)
  let raf = 0
  const tick = () => {
    setNow(performance.now())
    if (pressedAt() !== 0 && !ready() && now() - pressedAt() >= READY_HOLD * 1000) {
      setPressedAt(0)
      props.onReady(true)
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  onCleanup(() => cancelAnimationFrame(raf))
  const mouseHold = () => (pressedAt() === 0 ? 0 : Math.min(1, (now() - pressedAt()) / (READY_HOLD * 1000)))
  const fill = () => (ready() ? 1 : Math.max(mouseHold(), props.hold))

  return (
    <div class="readyroom">
      <div class="readyroom-stage" ref={stage} />

      <div class="readyroom-side">
        <header class="loadout-head">
          <span class="loadout-title">STAND BY</span>
          <span class="loadout-note">開始まで 残り {props.left} 秒</span>
        </header>

        <div class="readyroom-skills">
          <div class="readyroom-list">
            <div class="readyroom-budget" classList={{ 'loadout-budget-full': costOf(props.skills) >= SKILL_BUDGET }}>
              SKILL {costOf(props.skills)} / {SKILL_BUDGET}
              <Show when={!props.skillsOpen}>
                <span class="readyroom-locked">READY 中は変えられない (取り消すと直せる)</span>
              </Show>
            </div>
            <SkillList
              skills={props.skills}
              open={props.skillsOpen}
              onSkill={props.onSkill}
              focus={props.focus}
              onHover={setHovered}
            />
          </div>

          {/* 指した技の効き目。**段ごとの数字を並べ、今の段を光らせる** */}
          <div class="readyroom-detail">
            <div class="readyroom-detail-name">{SKILLS[shown()].label}</div>
            <div class="readyroom-detail-summary">{detail().summary}</div>
            <table class="readyroom-table">
              <thead>
                <tr>
                  <th />
                  <For each={detail().effects[0]?.values ?? []}>
                    {(_, i) => (
                      <th classList={{ 'readyroom-on': level() === i() + 1 }}>
                        {(detail().effects[0]?.values.length ?? 0) === 1 ? '' : `Lv${i() + 1}`}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={detail().effects}>
                  {(effect) => (
                    <tr>
                      <td class="readyroom-label">{effect.label}</td>
                      <For each={effect.values}>
                        {(value, i) => <td classList={{ 'readyroom-on': level() === i() + 1 }}>{value}</td>}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <For each={detail().notes}>{(note) => <div class="readyroom-note">・{note}</div>}</For>
            <div class="readyroom-cost">1 段ごとに {SKILL_BUDGET} のうち 1 を使う</div>
          </div>
        </div>

        <footer class="readyroom-foot">
          <div class="loadout-roster">
            <For each={props.players}>
              {(player) => (
                <div
                  class="loadout-member"
                  classList={{
                    'loadout-member-ready': player.ready,
                    'loadout-member-mine': player.id === props.selfId,
                    'loadout-member-away': player.away === true,
                  }}
                >
                  <span class={`loadout-member-team loadout-member-${player.team}`} />
                  <span class="loadout-member-name">{player.name}</span>
                  <span class="loadout-member-mark">{player.ready ? 'READY' : '…'}</span>
                </div>
              )}
            </For>
          </div>
          <button
            class="loadout-ok readyroom-ready"
            classList={{ 'loadout-ok-ready': ready() }}
            style={{ '--fill': fill() }}
            onPointerDown={() => {
              readyAtDown = ready()
              if (!readyAtDown) setPressedAt(performance.now())
            }}
            onPointerUp={() => setPressedAt(0)}
            onPointerLeave={() => setPressedAt(0)}
            onClick={() => {
              // 押した時に既に READY だった時だけ取り消す。長押しで READY にした
              // その押下を離した時の click で外さない
              if (readyAtDown && ready()) props.onReady(false)
            }}
          >
            {ready() ? 'READY を取り消す' : 'READY (長押し)'}
            <span class="loadout-key loadout-key-wide">Enter / ×</span>
          </button>
        </footer>
        <div class="readyroom-guide">{t('loadout.readyGuide')}</div>
      </div>
    </div>
  )
}
