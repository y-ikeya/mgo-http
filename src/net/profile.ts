/**
 * 積み上がった戦績を読む。
 *
 * --- なぜサーバーを経由しないか ---
 * 書くほうはサーバーだけ (kills の権威はサーバーにあるので)。**読むほうは
 * 各自が直接読む。** 対戦サーバーに読み出しを足すと、試合の刻みを回している
 * プロセスが DB の応答を待つことになる。守っているのは RLS で、
 * 「認証済みの誰でも読める / 書き込みの policy は無い」と決めてある。
 *
 * --- token が要る ---
 * policy が `to authenticated` なので、anon key だけでは 1 行も返らない
 * (403 ではなく**空が返る** — RLS は行を隠すのであって拒否はしない)。
 * 本人の access token を Authorization に載せて初めて読める。
 *
 * --- 2 回叩く理由 ---
 * 部屋一覧が持っている id は発行元の識別子 (auth_subject) で、
 * player_totals が持っているのは players.id。表に auth_subject を足せば
 * 1 回で済むが、そのために既に流した SQL を流し直してもらうほうが高くつく。
 */
import type { Identity } from '../auth/session'

const URL_ = import.meta.env.VITE_SUPABASE_URL ?? ''
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/** 設定が無ければ戦績の機能ごと出さない。遊ぶのに外部サービスが要る状態にはしない */
export const profilesAvailable = URL_ !== '' && ANON !== ''

/** 通算。player_totals の 1 行 */
export interface Totals {
  name: string
  /** キャラを作った日 (最初に試合を終えた日) */
  createdAt: string
  matches: number
  abandons: number
  kills: number
  deaths: number
  headshots: number
  headDeaths: number
  suicides: number
}

async function read(path: string, identity: Identity): Promise<unknown[]> {
  const response = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: {
      apikey: ANON,
      // **本人の token。** anon key だけだと RLS が行を返さない
      Authorization: `Bearer ${identity.token}`,
    },
  })
  if (!response.ok) throw new Error(`profile ${response.status}`)
  return (await response.json()) as unknown[]
}

/**
 * その人の通算を引く。まだ 1 試合も終えていない人は null。
 *
 * @param subject 発行元での識別子。部屋一覧や名簿が配っている id
 */
export async function fetchTotals(
  subject: string,
  identity: Identity,
): Promise<Totals | null> {
  if (!profilesAvailable) return null

  const players = (await read(
    `players?auth_subject=eq.${encodeURIComponent(subject)}&select=id`,
    identity,
  )) as { id: string }[]
  // 行が無い = まだ試合を終えていない。サーバーは試合の終わりに初めて作る
  if (players.length === 0) return null

  const rows = (await read(
    `player_totals?player_id=eq.${players[0].id}&select=*`,
    identity,
  )) as Record<string, unknown>[]
  const row = rows[0]
  if (!row) return null

  const num = (key: string) => Number(row[key] ?? 0)
  return {
    name: String(row.name ?? ''),
    createdAt: String(row.created_at ?? ''),
    matches: num('matches'),
    abandons: num('abandons'),
    kills: num('kills'),
    deaths: num('deaths'),
    headshots: num('headshots'),
    headDeaths: num('head_deaths'),
    suicides: num('suicides'),
  }
}
