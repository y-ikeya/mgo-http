/**
 * 試合が始まった瞬間の指令を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/orders.html
 *     ?team=blue   青の側
 *     ?mode=DM     個人戦 (陣営が無い)
 *     ?hide=0.5    消える途中 (0..1) で止める
 *
 * 本物は試合が始まる瞬間にしか出ないうえ 3 秒で消えるので、直すたびに
 * 再現するのが難しい。**下地に縞を敷いてある** — 帯が割れて景色が戻る
 * のを見るため。
 */
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import Orders from '../../src/presentation/ui/Orders'
import type { Mode } from '../../src/domain/match/room'

const q = new URLSearchParams(location.search)
const team = (q.get('team') ?? 'red') as 'red' | 'blue'
const mode = (q.get('mode') ?? 'TDM') as Mode

// 消える途中で止める。0 が割れ始め、1 が消え切る直前
const hide = q.get('hide')
if (hide !== null) {
  document.body.dataset.hide = hide
  document.body.style.setProperty('animation-delay', '')
  const at = Number(hide) || 0
  const style = document.createElement('style')
  style.textContent = `body[data-hide] .orders-band{animation-delay:${(-0.6 * at).toFixed(2)}s}`
  document.head.appendChild(style)
}

function Harness() {
  // 段階が playing へ移った瞬間に出るので、移り変わりを作る
  const [phase, setPhase] = createSignal('countdown')
  setTimeout(() => setPhase('playing'), 100)
  // 繰り返し見られるように、消えたらまた始める
  setInterval(() => {
    setPhase('countdown')
    setTimeout(() => setPhase('playing'), 100)
  }, 6000)
  return <Orders mode={mode} team={mode === 'DM' ? undefined : team} phase={phase()} />
}

render(() => <Harness />, document.getElementById('root')!)
