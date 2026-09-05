/**
 * 装備の画面を**本物のまま**描く。
 *
 *     bunx vite → http://localhost:5173/tools/preview/loadout.html?case=open
 *
 * 見たいのは主にスキルの枠。8 つ並ぶので、**予算の残りが読めるか**と
 * **押せない段が押せないと分かるか**を目で確かめる。
 *
 *     case=open     まだ何も取っていない (全部押せる)
 *     case=spent    使い切っている (足せる所が無い)
 *     case=locked   試合が始まっている (窓が閉じている)
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { CHOICES, type WeaponId } from '../../src/domain/item/weapons'
import Loadout from '../../src/presentation/ui/Loadout'
import type { SkillId, Skills } from '../../src/domain/player/skill'

const CASES: Record<string, { skills: Skills; open: boolean; note: string }> = {
  open: { skills: {}, open: true, note: '始まる前' },
  spent: { skills: { runner: 2, smgMastery: 1, exposure: 1 }, open: true, note: '始まる前' },
  locked: { skills: { sniperMastery: 3, runner: 1 }, open: false, note: '試合中 (選び直せない)' },
}

const which = new URLSearchParams(location.search).get('case') ?? 'open'
const chosen = CASES[which] ?? CASES.open
/** ?room=delta で「砂部屋」(狙撃銃だけ) の姿を見る */
const sandbox = new URLSearchParams(location.search).get('room') === 'delta'

/** ?phase=ready で支度の画面を見る */
const ready = new URLSearchParams(location.search).get('phase') === 'ready'

/**
 * ?focus=support でパッドが指している枠を見る。
 *
 * 本物は上下で動くが、ここは**指されている姿が読めるか**を見るための頁なので
 * 動かさない。渡せるのは枠の名前 (primary / secondary / support / スキルの id)。
 */
const focus = new URLSearchParams(location.search).get('focus') ?? 'primary'

const ROSTER = [
  { id: 'me', name: 'pepa1404', team: 'blue' as const, kills: 0, deaths: 0, suicides: 0, stuns: 0, ready: false },
  { id: 'b', name: 'kometh27', team: 'blue' as const, kills: 0, deaths: 0, suicides: 0, stuns: 0, ready: true },
  { id: 'c', name: 'snake', team: 'red' as const, kills: 0, deaths: 0, suicides: 0, stuns: 0, ready: true },
  { id: 'd', name: 'otacon', team: 'red' as const, kills: 0, deaths: 0, suicides: 0, stuns: 0, ready: false, away: true },
]

function Harness() {
  const [roster, setRoster] = createSignal(ROSTER)
  // 押した結果はサーバーが返す物なので、ここでは本物の代わりに素直に書き換える
  const [skills, setSkills] = createSignal<Skills>(chosen.skills)
  const [pick, setPick] = createSignal<WeaponId>(sandbox ? 'sniper' : 'rifle')
  const [side, setSide] = createSignal<WeaponId>('m9')
  return (
    <Loadout
      primary={pick()}
      support="grenade"
      onPrimary={(id) => setPick(id)}
      onSecondary={(id) => setSide(id)}
      onSupport={() => {}}
      note={chosen.note}
      left={22}
      wait={0}
      onSpawn={() => {}}
      skills={skills()}
      primaries={sandbox ? ['sniper'] : CHOICES.primary}
      secondary={sandbox ? null : side()}
      /* ?phase=ready で支度の画面 (参加者と READY が出る) */
      phase={ready ? 'ready' : 'countdown'}
      players={roster()}
      selfId="me"
      skillsOpen={ready}
      focus={focus as never}
      onSkill={(id, level) => setSkills((s) => ({ ...s, [id]: level }))}
      onReady={(next) =>
        setRoster((rows) => rows.map((r) => (r.id === 'me' ? { ...r, ready: next } : r)))
      }
    />
  )
}

render(() => <Harness />, document.getElementById('root')!)
