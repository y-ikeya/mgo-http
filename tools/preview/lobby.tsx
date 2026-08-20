/**
 * 部屋の一覧を**本物のまま**描く。fetch だけ作り物に差し替える。
 *
 *     bunx vite  →  http://localhost:5173/tools/preview/lobby.html
 */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import Lobby from '../../src/screens/Lobby'
import type { RoomSummary } from '../../src/net/types'

const ROOMS: RoomSummary[] = [
  { name: 'alpha', mode: 'DM', label: '個人戦', active: true, players: 3, capacity: 8, phase: 'playing', roster: [], blue: 14, red: 9, remaining: 212 },
  { name: 'bravo', mode: 'TDM', label: 'チーム戦', active: true, players: 8, capacity: 8, phase: 'playing', roster: [], blue: 20, red: 18, remaining: 44 },
  { name: 'charlie', mode: 'TSNE', label: '潜入 / 防御', active: false, players: 0, capacity: 8, phase: 'waiting', roster: [], blue: 0, red: 0, remaining: 0 },
  { name: 'delta', mode: 'INT', label: '休憩', active: true, players: 1, capacity: 8, phase: 'playing', roster: [], blue: 0, red: 0, remaining: 0 },
  { name: 'echo', mode: 'PRACTICE', label: '練習', active: true, players: 0, capacity: 8, phase: 'playing', roster: [], blue: 0, red: 0, remaining: 0 },
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
