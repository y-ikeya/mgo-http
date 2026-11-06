/**
 * 部屋の一覧を**本物のまま**描く。fetch だけ作り物に差し替える。
 *
 *     bunx vite  →  http://localhost:5173/tools/preview/lobby.html
 */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import Lobby from '../../src/presentation/screens/Lobby'
import type { RoomSummary } from '../../src/application/protocol/types'

const who = (name: string, team: 'blue' | 'red') => ({ id: name.toLowerCase(), name, team })
const ROOMS: RoomSummary[] = [
  { name: 'alpha', mode: 'DM', label: '個人戦', active: true, players: 5, capacity: 16, phase: 'playing', roster: ['YUMA', 'NoPlaceForHIDE0', 'gappori1', 'Seer', 'relaxant'].map((n) => who(n, 'blue')), blue: 14, red: 9, remaining: 212, stage: 'city', stages: ['city'], order: 'fixed' },
  { name: 'bravo', mode: 'TDM', label: 'チーム戦', active: true, players: 6, capacity: 16, phase: 'playing', roster: [who('ONI-Goroshi', 'red'), who('Liliya', 'red'), who('39MUSIC', 'red'), who('PomPomSarin', 'blue'), who('aliceLOVEMGS777', 'blue'), who('KICONA39', 'blue')], blue: 20, red: 18, remaining: 444, stage: 'uu', stages: ['city', 'uu', 'bb'], order: 'cycle' },
  { name: 'charlie', mode: 'TSNE', label: '潜入 / 防御', active: true, players: 2, capacity: 16, phase: 'waiting', roster: [who('TheTerrorism', 'red'), who('wddccc', 'blue')], blue: 0, red: 0, remaining: 0, stage: 'city', stages: ['city', 'uu', 'bb'], order: 'cycle' },
  { name: 'delta', mode: 'TDM', label: 'チーム戦', note: '砂部屋', active: true, players: 0, capacity: 16, phase: 'waiting', roster: [], blue: 0, red: 0, remaining: 0, stage: 'uu', stages: ['uu'], order: 'fixed' },
  { name: 'echo', mode: 'CAP', label: 'キャプチャー', active: true, players: 3, capacity: 16, phase: 'over', roster: [who('NuSoiCaca', 'red'), who('Irons', 'blue'), who('Calculus', 'blue')], blue: 31, red: 12, remaining: 8, stage: 'bb', stages: ['bb'], order: 'fixed' },
]

window.fetch = (async () => new Response(JSON.stringify(ROOMS), {
  headers: { 'content-type': 'application/json' },
})) as typeof fetch

render(
  () => (
    <Router>
      <Route
        path="*"
        component={() => (
          <Lobby identity={{ subject: 'me', displayName: 'YUMA', token: '' } as never} />
        )}
      />
    </Router>
  ),
  document.getElementById('root')!,
)
