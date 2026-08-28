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
import Loadout from '../../src/presentation/ui/Loadout'
import type { SkillId, Skills } from '../../src/domain/player/skill'

const CASES: Record<string, { skills: Skills; open: boolean; note: string }> = {
  open: { skills: {}, open: true, note: '始まる前' },
  spent: { skills: { runner: 2, smgMastery: 1, exposure: 1 }, open: true, note: '始まる前' },
  locked: { skills: { sniperMastery: 3, runner: 1 }, open: false, note: '試合中 (選び直せない)' },
}

const which = new URLSearchParams(location.search).get('case') ?? 'open'
const chosen = CASES[which] ?? CASES.open

function Harness() {
  // 押した結果はサーバーが返す物なので、ここでは本物の代わりに素直に書き換える
  const [skills, setSkills] = createSignal<Skills>(chosen.skills)
  return (
    <Loadout
      primary="rifle"
      support="grenade"
      onPrimary={() => {}}
      onSupport={() => {}}
      note={chosen.note}
      left={22}
      wait={0}
      onSpawn={() => {}}
      skills={skills()}
    />
  )
}

render(() => <Harness />, document.getElementById('root')!)
