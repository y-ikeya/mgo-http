/**
 * 名前の横に出す Lv。
 *
 * --- なぜここに置くか ---
 * Lv は**通算**から出るので、対戦サーバーは知らない (サーバーは DB を読まない)。
 * 成績表も部屋一覧も同じものが要るので、引き方を 1 か所にまとめる。
 *
 * 引けなかった人は 1 として扱う。まだ 1 試合も終えていない人と、DB へ届かなかった
 * ときの区別は付けない — **Lv が出ないより、1 と出るほうが画面が壊れない**。
 */
import { createResource, type Accessor } from 'solid-js'
import { fetchRecords } from './profile'
import { levelOf, pointsOf } from '../sim/scoring'
import type { Identity } from '../auth/session'

/**
 * 何人ぶんかの Lv を引く。
 *
 * subjects が変わったときだけ引き直す。**中身が同じなら引き直さない** —
 * 部屋一覧は 2 秒ごとに一覧を取り直すので、そのたびに叩くと止まらなくなる。
 */
export function useLevels(
  subjects: Accessor<string[]>,
  identity: Identity,
): (subject: string) => number {
  const [records] = createResource(
    () => [...subjects()].sort().join(','),
    async (key) => (key ? await fetchRecords(key.split(','), identity) : new Map()),
  )
  return (subject: string) => {
    const found = records()?.get(subject)
    return found ? levelOf(pointsOf(found)) : 1
  }
}
