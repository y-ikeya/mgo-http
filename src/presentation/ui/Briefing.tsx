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
        {/* 本家の帯: 左にルール、右にステージ */}
        <div class="briefing-band">
          <div>
            <div class="briefing-band-label">RULE</div>
            <div class="briefing-title">{props.briefing.title}</div>
          </div>
          <div class="briefing-band-map">
            <div class="briefing-band-label">MAP</div>
            <div class="briefing-title">{props.briefing.map}</div>
          </div>
        </div>
        <p class="briefing-text">{textOf(props.briefing)}</p>
        <footer class="briefing-foot">
          <span class="loadout-note">{t('briefing.startsIn', { n: props.left })}</span>
          <button class="loadout-ok briefing-ok" onClick={() => props.onClose()}>
            OK
            <span class="loadout-key loadout-key-wide">Enter / ×</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 説明の文。数字を差し込む。本家に倣って文で書く (です・ます、勝ち方だけ) */
function textOf(b: Brief): string {
  const n = { tickets: b.tickets, minutes: b.minutes, count: b.capSeconds }
  switch (b.mode) {
    case 'DM':
      return t('rules.dm', n)
    case 'TDM':
      return t('rules.tdm', n)
    case 'TSNE': {
      const lives =
        b.lives === null ? t('rules.lives.any') : b.lives === 0 ? t('rules.lives.none') : t('rules.lives.n', { lives: b.lives })
      return t('rules.tsne', { ...n, lives })
    }
    case 'CAP':
      return t('rules.cap', n)
  }
}
