/**
 * 断りの画面を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/blocked.html
 *     ?lag        遅れで席を空けてもらった人に出るほう
 *
 * 本物は「描けない機械で開く」「1 秒以上遅れ続ける」でしか出ないので、
 * 直すたびに再現するのが難しい。**出方が同じかを見るための頁。**
 */
import { render } from 'solid-js/web'
import { t } from '../../src/i18n'
import Blocked from '../../src/presentation/ui/Blocked'

const lag = new URLSearchParams(location.search).has('lag')
render(
  () =>
    lag ? (
      <Blocked
        title={t('lag.title')}
        lede={t('lag.lede')}
        steps={[t('lag.wifi'), t('lag.other'), t('lag.vpn')]}
        note={t('lag.recheck')}
      />
    ) : (
      <Blocked
        title={t('gpu.title')}
        lede={t('gpu.lede')}
        steps={[t('gpu.remote'), t('gpu.accel'), t('gpu.driver')]}
        detail={{ key: 'RENDERER', value: 'SwiftShader Device (Subzero)' }}
        note={t('gpu.recheck')}
      />
    ),
  document.getElementById('root')!,
)
