import { onCleanup, onMount } from 'solid-js'
import { t } from '../../i18n'
import './Leaving.css'

/**
 * 部屋を出るか尋ねる板。
 *
 * --- なぜ要るか ---
 * **戻るボタンは 1 回で試合を抜ける。** 押した本人は間違いに気づけるが、
 * 残った人は数の合わない試合を続けることになる。しかも席が畳まれるまでの
 * 間は「居るのに動かない人」として映るので、待たされているのか抜けたのかも
 * 分からない。
 *
 * ブラウザ自前の確認 (beforeunload) は**同じ頁の中の移動では出ない。**
 * 戻るで /rooms へ移るのは同じ頁の中の移動なので、こちらで尋ねる。
 *
 * --- 断りではない ---
 * 出るのは自由。**押し間違いと、出る意思を分ける**ためだけの板なので、
 * Blocked と違って必ず両方の道が在る。
 */
export default function Leaving(props: { onStay: () => void; onLeave: () => void }) {
  /*
   * Esc で取り消せる。**尋ねている間はポインタを離している**ので、
   * 掴み直す Esc の役目が空いている。押し間違いを取り消すのに、
   * わざわざマウスを運ばせない。
   */
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return
    e.preventDefault()
    props.onStay()
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  return (
    <div class="leaving">
      <div class="leaving-panel">
        <div class="leaving-title">{t('leave.title')}</div>
        <p class="leaving-lede">{t('leave.lede')}</p>
        <div class="leaving-buttons">
          <button class="leaving-go" onClick={props.onLeave}>
            Leave
          </button>
          {/* 既定はこちら。**押し間違いのほうが多い** */}
          <button class="leaving-stay" onClick={props.onStay} autofocus>
            {t('score.back')} <span class="leaving-key">Esc</span>
          </button>
        </div>
      </div>
    </div>
  )
}
