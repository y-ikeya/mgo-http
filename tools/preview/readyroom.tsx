/**
 * 待合室 (試合前の支度) を描く。
 *
 *     bunx vite  →  http://localhost:5173/tools/preview/readyroom.html
 *     ?skill=knifeMastery   詳しく出す技 (パッドで指している扱い)
 *     ?ready                自分が READY 済み
 *     ?hold=0.5             長押しの途中
 */
import { render } from 'solid-js/web'
import ReadyRoom from '../../src/presentation/ui/ReadyRoom'

const query = new URLSearchParams(location.search)
const ready = query.has('ready')

render(
  () => (
    <ReadyRoom
      skin={query.get('skin') ?? 'soldier'}
      gun="rifle"
      left={42}
      skills={{ runner: 2, knifeMastery: 3, rifleMastery: 1 }}
      skillsOpen={!ready}
      onSkill={() => {}}
      players={
        [
          { id: 'me', name: 'YUMA', team: 'red', ready, kills: 0, deaths: 0 },
          { id: 'b', name: 'pepa', team: 'blue', ready: true, kills: 0, deaths: 0 },
          { id: 'c', name: 'nanashi', team: 'blue', ready: false, kills: 0, deaths: 0, away: true },
        ] as never
      }
      selfId="me"
      onReady={() => {}}
      hold={Number(query.get('hold') ?? '0')}
      focus={(query.get('skill') ?? 'runner') as never}
    />
  ),
  document.getElementById('root')!,
)
