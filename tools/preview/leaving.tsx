/**
 * 部屋を出るか尋ねる板を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/leaving.html
 *     ?lang=en    英語の文面
 *
 * 本物は「試合中に戻るを押す」でしか出ない。対戦部屋へ入って、試合が
 * 始まるのを待って、戻るを押す、を直すたびに繰り返すことになる。
 *
 * 下地に**戦場の代わりの絵**を敷いてある。この板は Blocked と違って
 * 塗り潰さない (試合は続いている) ので、透けた先が見えないと濃さを決められない。
 */
import { render } from 'solid-js/web'
import Leaving from '../../src/presentation/ui/Leaving'

render(
  () => <Leaving onStay={() => console.log('stay')} onLeave={() => console.log('leave')} />,
  document.getElementById('root')!,
)
