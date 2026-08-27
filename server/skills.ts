/**
 * スキルの読み書き。
 *
 * --- 読み手をサーバーにした理由 ---
 * これまでの分担はこうだった。
 *
 *     書く    対戦サーバー    権威が要る (kills を名乗らせない)
 *     読む    各クライアント  待たせたくない (api/levels.ts の Lv, api/profile.ts)
 *
 * **Lv は既に DB から出ている** — ただし引いているのはクライアント。それで
 * 足りるのは、Lv が**表示にしか効かない**から。嘘をつかれても自分の画面の
 * 数字が変わるだけで、誰の判定も動かない。
 *
 * スキルは違う。速さにも散布にも発光にも効く。そして**試合が始まる前にしか
 * 選べない** (domain/player/skill.ts の canChooseSkills) ので、走っている試合に
 * 入ってきた人は選ぶ窓の外に居る。そこで申告を受け付けると、**劣勢の側を見てから
 * 強い組み合わせで入り直す**ができてしまう。前回の選択を持ってこられるのは
 * サーバーだけ。
 *
 * 決めごとは弱めるが、性質は保つ:
 *
 *     読むのは**入室のたびに 1 回**だけ。刻みの中では読まない
 *     待たせない。届く前に入室は済ませて、届いたら席へ載せる
 *     **鍵が無くても動く。** 空のスキルで遊べる (手元で立ち上げるのに要らない)
 *     落ちても入室は通す。スキルが空になるだけ
 */

import { isAffordable, type Skills } from '../src/domain/player/skill'

const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** 鍵が無ければ何もしない。起動時に 1 回だけ判定する (stats.ts と同じ形) */
const enabled = url !== '' && key !== ''

/** 1 回の読みを諦めるまで (ms)。**入室を待たせない** */
const READ_TIMEOUT = 2000

async function rpc(fn: string, params: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(READ_TIMEOUT),
  })
  if (!response.ok) throw new Error(`${fn} が ${response.status}: ${await response.text()}`)
  return response.json()
}

/**
 * 前回どのスキルを取っていたか。
 *
 * **読めなければ空を返す。** 鍵が無い / 落ちている / 遅い、のどれでも同じ扱いで、
 * 入室そのものは通す。スキルが付かないだけで遊べる状態を壊さない。
 *
 * 返ってきた形も信じない。DB に古い名前や段が残っていることはあるので、
 * **選ぶときと同じドメインルール** (isAffordable) に通してから返す。
 */
export async function loadSkills(subject: string): Promise<Skills> {
  if (!enabled) return {}
  try {
    const raw = await rpc('get_player_skills', { p_auth_subject: subject })
    const skills = raw as Skills
    if (!skills || typeof skills !== 'object') return {}
    // 予算を超えている / 知らない名前が混ざっているなら、丸ごと捨てる。
    // **一部だけ通すと、外した理由が本人に説明できない**
    return isAffordable(skills) ? skills : {}
  } catch (error) {
    console.warn(`[スキル] ${subject} を読めない`, error)
    return {}
  }
}

/**
 * 選択を残す。**差分ではなく総取っ替え** (外したことも記録に残す必要がある)。
 *
 * 待たない。書けなくても試合は続く — 次に入ったときに前回の選択が戻らないだけ。
 */
export function saveSkills(subject: string, skills: Skills): void {
  if (!enabled) return
  void rpc('set_player_skills', { p_auth_subject: subject, p_skills: skills }).catch((error) => {
    console.warn(`[スキル] ${subject} を書けない`, error)
  })
}
