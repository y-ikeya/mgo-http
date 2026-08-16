import { onCleanup, onMount, Show } from 'solid-js'
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

  /**
   * 断りの音。
   *
   * **ブラウザは操作なしの自動再生を止める。** この画面は読み込んだ瞬間に
   * 出るので、素直に鳴らすと大抵は弾かれる。弾かれたら諦めるのではなく、
   * 最初に触った瞬間に鳴るよう仕掛け直す — 読んでいる人は必ずどこかを
   * クリックするかキーを押すので、そこで鳴る。
   *
   * 鳴らなくても画面は成立するので、失敗は握り潰してよい。
   */
  let audio: HTMLAudioElement | null = null
  const armed: (() => void)[] = []

  onMount(() => {
    audio = new Audio(`${import.meta.env.BASE_URL}audio/error1.mp3`)
    audio.volume = 0.7

    void audio.play().catch(() => {
      // 自動再生を断られた。**最初の操作**で 1 回だけ鳴らす。
      // 両方に仕掛けるので、片方が発火したらもう片方も外す (二重に鳴らさない)
      const fire = () => {
        for (const disarm of armed) disarm()
        armed.length = 0
        void audio?.play().catch(() => {})
      }
      for (const kind of ['pointerdown', 'keydown'] as const) {
        window.addEventListener(kind, fire)
        armed.push(() => window.removeEventListener(kind, fire))
      }
    })
  })

  onCleanup(() => {
    for (const disarm of armed) disarm()
    audio?.pause()
    audio = null
  })

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
