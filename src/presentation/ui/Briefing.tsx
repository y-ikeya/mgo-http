import { For } from 'solid-js'
import type { Briefing as Brief } from '../../domain/match/briefing'
import { t } from '../../i18n'
import './Loadout.css'
import './Briefing.css'

/**
 * **試合の前のルールの説明。** 待合室 (ReadyRoom) の上に重ねて出す。OK で閉じる
 * (2026-11-03 本人「ゲーム自体の説明 (1,2 枚) → OK で飛ばしたら → standby」)。
 *
 * 数字は domain/match/briefing.ts、文は i18n.ts の rules.*。開け閉めは Game (Enter / × でも)
 */
export default function Briefing(props: {
  briefing: Brief
  /** 開始まで (秒)。説明を読んでいる間も支度の時間は減る */
  left: number
  onClose: () => void
}) {
  return (
    <div class="briefing">
      <div class="briefing-card">
        <header class="loadout-head">
          <span class="loadout-title">RULES</span>
          <span class="loadout-note">{t('briefing.startsIn', { n: props.left })}</span>
        </header>
        <div class="briefing-title">{props.briefing.title}</div>
        <ul class="briefing-lines">
          <For each={linesOf(props.briefing)}>{(line) => <li>{line}</li>}</For>
        </ul>
        <footer class="briefing-foot">
          <button class="loadout-ok briefing-ok" onClick={() => props.onClose()}>
            OK
            <span class="loadout-key loadout-key-wide">Enter / ×</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 説明の文。数字を差し込む */
function linesOf(b: Brief): string[] {
  const n = { tickets: b.tickets, minutes: b.minutes, lives: b.lives ?? 0, count: b.capSeconds }
  switch (b.mode) {
    case 'DM':
      return [t('rules.dm.hostile'), t('rules.dm.tickets', n), t('rules.dm.time', n), t('rules.dm.leader')]
    case 'TDM':
      return [t('rules.tdm.tickets', n), t('rules.tdm.win'), t('rules.tdm.time', n)]
    case 'TSNE':
      return [
        t('rules.tsne.sides'),
        t('rules.tsne.attack'),
        t('rules.tsne.defence', n),
        b.lives === null ? t('rules.lives.any') : b.lives === 0 ? t('rules.lives.none') : t('rules.lives.n', n),
      ]
    case 'CAP':
      return [t('rules.cap.target'), t('rules.cap.count', n), t('rules.cap.win', n), t('rules.cap.down')]
  }
}
