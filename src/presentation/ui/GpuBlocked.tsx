import { t } from '../../i18n'
import type { GpuVerdict } from '../scene/util/gpu'
import Blocked from './Blocked'

/**
 * 描けない機械に出す画面。ここから先へは進ませない。
 *
 * --- なぜ止めるか ---
 * ソフトウェア描画では数 FPS しか出ず、本人が遊べないだけでなく、
 * 位置を送る間隔まで巻き添えになって**相手の画面でもカクつく**。
 * 「入れるけど遊べない」より「入れない理由が分かる」ほうがましだと判断した。
 *
 * 板と音は Blocked が持つ。**遅れで断るときと同じ出方**にしてある。
 */
export default function GpuBlocked(props: { verdict: GpuVerdict }) {
  const renderer = () => (props.verdict.ok ? '' : props.verdict.renderer)

  return (
    <Blocked
      title={t('gpu.title')}
      lede={t('gpu.lede')}
      steps={[t('gpu.remote'), t('gpu.accel'), t('gpu.driver')]}
      detail={renderer() ? { key: 'RENDERER', value: renderer() } : undefined}
      note={t('gpu.recheck')}
    />
  )
}
