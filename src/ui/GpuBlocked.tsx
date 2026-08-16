import { Show } from 'solid-js'
import { t } from '../i18n'
import type { GpuVerdict } from '../game/gpu'
import './GpuBlocked.css'

/**
 * 描けない機械に出す画面。ここから先へは進ませない。
 *
 * --- なぜ止めるか ---
 * ソフトウェア描画では数 FPS しか出ず、本人が遊べないだけでなく、
 * 位置を送る間隔まで巻き添えになって**相手の画面でもカクつく**。
 * 「入れるけど遊べない」より「入れない理由が分かる」ほうがましだと判断した。
 *
 * --- 何を出すか ---
 * 断るだけにしない。**直し方まで出す。** 原因はほぼ環境の設定で、
 * 直せば普通に遊べる (実際そうだった)。何が悪いか分からないまま
 * 締め出されるのが一番たちが悪い。
 */
export default function GpuBlocked(props: { verdict: GpuVerdict }) {
  const renderer = () => (props.verdict.ok ? '' : props.verdict.renderer)

  return (
    <div class="gpublock">
      <div class="gpublock-panel">
        <div class="gpublock-title">{t('gpu.title')}</div>
        <p class="gpublock-lede">{t('gpu.lede')}</p>

        <ol class="gpublock-steps">
          <li>{t('gpu.remote')}</li>
          <li>{t('gpu.accel')}</li>
          <li>{t('gpu.driver')}</li>
        </ol>

        {/* 実名を出す。問い合わせや検索の手がかりになる */}
        <Show when={renderer()}>
          <div class="gpublock-detail">
            <span class="gpublock-key">RENDERER</span>
            <code>{renderer()}</code>
          </div>
        </Show>

        <p class="gpublock-note">{t('gpu.recheck')}</p>
      </div>
    </div>
  )
}
