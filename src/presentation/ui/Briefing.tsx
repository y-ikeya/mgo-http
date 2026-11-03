import { For, Show } from 'solid-js'
import type { BriefingPage } from '../../domain/match/briefing'
import './Loadout.css'
import './Briefing.css'

/**
 * **試合の前のルールの説明。** 待合室 (ReadyRoom) の上に重ねて出す。OK で次の枚、最後の枚で閉じる
 * (2026-11-03 本人「ゲーム自体の説明 (1,2 枚) → OK で飛ばしたら → standby」)。
 *
 * 中身は domain/match/briefing.ts。開け閉めとめくるのは Game (Enter / × / 左右でも)
 */
export default function Briefing(props: {
  pages: BriefingPage[]
  at: number
  /** 開始まで (秒)。説明を読んでいる間も支度の時間は減る */
  left: number
  onNext: () => void
}) {
  const page = () => props.pages[props.at]
  const last = () => props.at + 1 >= props.pages.length
  return (
    <div class="briefing">
      <div class="briefing-card">
        <header class="loadout-head">
          <span class="loadout-title">RULES</span>
          <span class="loadout-note">開始まで 残り {props.left} 秒</span>
        </header>
        <div class="briefing-title">{page()?.title}</div>
        <ul class="briefing-lines">
          <For each={page()?.lines ?? []}>{(line) => <li>{line}</li>}</For>
        </ul>
        <footer class="briefing-foot">
          <Show when={props.pages.length > 1}>
            <span class="briefing-count">
              {props.at + 1} / {props.pages.length}
            </span>
          </Show>
          <button class="loadout-ok briefing-ok" onClick={() => props.onNext()}>
            {last() ? 'OK' : '次へ'}
            <span class="loadout-key loadout-key-wide">Enter / ×</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
