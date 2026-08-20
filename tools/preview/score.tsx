/**
 * 成績表を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/score.html?case=dm
 */
import { render } from 'solid-js/web'
import Scoreboard from '../../src/ui/Scoreboard'
import type { GameStats } from '../../src/game/Game'

const players = [
  { id: 'me', name: 'pepa1404', team: 'blue', kills: 7, deaths: 3, suicides: 0, away: false, rate: 64 },
  { id: 'b', name: 'kometh27', team: 'blue', kills: 5, deaths: 4, suicides: 1, away: false, rate: 61 },
  { id: 'c', name: 'snake', team: 'red', kills: 4, deaths: 6, suicides: 0, away: false, rate: 58 },
  { id: 'd', name: 'otacon', team: 'red', kills: 1, deaths: 7, suicides: 0, away: true, rate: 0 },
]

const dm = {
  scores: players.map((p) => ({ ...p, team: 'blue' })),
  match: { type: 'match', mode: 'DM', phase: 'playing', blue: 9, red: 0, endsAt: Date.now() + 90000, present: 4, required: 2, players: [] },
  team: 'blue',
} as unknown as GameStats

const tdm = {
  scores: players,
  match: { type: 'match', mode: 'TDM', phase: 'playing', blue: 14, red: 11, endsAt: Date.now() + 90000, present: 4, required: 2, players: [] },
  team: 'blue',
} as unknown as GameStats

const which = new URLSearchParams(location.search).get('case') ?? 'dm'
render(
  () => <Scoreboard stats={which === 'tdm' ? tdm : dm} selfId="me" identity={{ subject: 'me' } as never} />,
  document.getElementById('root')!,
)
