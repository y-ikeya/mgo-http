/**
 * 成績表を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/score.html?case=dm
 */
import { createSignal, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import Scoreboard from '../../src/presentation/ui/Scoreboard'
import type { GameStats } from '../../src/presentation/scene/Game'
import type { Skills } from '../../src/domain/player/skill'

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
/** 練習部屋なら組み替えられる。?open=1 でその姿を見る */
const open = new URLSearchParams(location.search).get('open') === '1'

function Preview() {
  const [skills, setSkills] = createSignal<Skills>({ rifleMastery: 2, runner: 1 })
  // ?tab=skills でスキルの板を開いた姿を写す (無頭では押せないので代わりに押す)
  onMount(() => {
    if (new URLSearchParams(location.search).get('tab') !== 'skills') return
    const tabs = document.querySelectorAll<HTMLButtonElement>('.score-tab')
    tabs[1]?.click()
  })
  return (
    <Scoreboard
      stats={which === 'tdm' ? tdm : dm}
      selfId="me"
      identity={{ subject: 'me' } as never}
      skills={skills()}
      skillsOpen={open}
      onSkill={(id, level) => setSkills({ ...skills(), [id]: level || undefined })}
      onClose={() => {}}
      onLeave={() => {}}
    />
  )
}

render(() => <Preview />, document.getElementById('root')!)
