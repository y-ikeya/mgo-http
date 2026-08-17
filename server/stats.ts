/**
 * 戦績を残す。
 *
 * --- なぜサーバーが書くか ---
 * kills / deaths の権威はサーバーにある。クライアントに書かせると 999 キルと
 * 名乗れる。読むほうは各自が anon key で直接読む (RLS が守る) ので、
 * ここは書き込み専用。
 *
 * --- 渡す権限 ---
 * サーバーが秘密鍵を持つのはここが初めて。表に直接書かせず、
 * `record_match_player` / `close_match` の 2 本だけを呼べるようにしてある
 * (deploy/schema.sql)。鍵が漏れても、書き換えられるのは戦績の行だけ。
 *
 * --- 鍵が無くても動く ---
 * **遊ぶのに外部サービスが要る状態にはしない。** 鍵が設定されていなければ
 * 黙って何もしない。手元で立ち上げて対戦するのに Supabase は要らない。
 */

const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** 記録するかどうか。起動時に 1 回だけ判定して、以後は分岐しない */
export const recording = url !== '' && key !== ''

if (!recording) {
  console.log('[戦績] 鍵が無いので記録しない (対戦はできる)')
}

/**
 * 送り直す回数。
 *
 * 関数は冪等 (同じ試合の同じ人を二度書いても増えない) なので、
 * 迷わず送り直してよい。一瞬の切断で 1 試合まるごと消えるほうが惜しい。
 */
const ATTEMPTS = 3

/** 送り直すまでの待ち (ms)。回を追うごとに倍にする */
const BACKOFF = 500

/**
 * まだ返ってきていない送信。
 *
 * 終わるときに待つためだけに持つ。**止める合図が来てから捨てる**と、
 * 配置のたびに走っている試合が丸ごと消える。
 */
const inFlight = new Set<Promise<void>>()

/**
 * 送りかけを送り終えるまで待つ。
 *
 * 上限を置く。送り先が黙っていると、そのぶん停止が遅れて systemd に
 * 強制終了される (待った意味が無くなる)
 */
export async function flush(limit = 3000): Promise<void> {
  if (inFlight.size === 0) return
  await Promise.race([Promise.all([...inFlight]), Bun.sleep(limit)])
}

/**
 * 関数を 1 本呼ぶ。
 *
 * **待たない。** 呼ぶ側は試合の刻みの中に居るので、外部通信の往復を
 * 待たせると全員の位置が止まる。失敗は警告だけ出して捨てる。
 */
function call(fn: string, params: Record<string, unknown>): void {
  if (!recording) return
  const sending = (async () => {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
        })
        if (response.ok) return
        // 4xx は送り直しても同じ。引数か権限が間違っている
        if (response.status < 500) {
          console.warn(`[戦績] ${fn} が ${response.status}`, await response.text())
          return
        }
      } catch (error) {
        if (attempt === ATTEMPTS) console.warn(`[戦績] ${fn} を送れない`, error)
      }
      if (attempt < ATTEMPTS) await Bun.sleep(BACKOFF * 2 ** (attempt - 1))
    }
  })()
  inFlight.add(sending)
  void sending.finally(() => inFlight.delete(sending))
}

/** 書き込む中身。server/index.ts の Player に依存しないよう、必要な分だけ受ける */
export interface MatchRecord {
  matchId: string
  room: string
  /** 試合が始まった時刻 (Date.now) */
  startedAt: number
  /** 発行元での識別子。players.auth_subject になる */
  subject: string
  name: string
  team: string
  kills: number
  deaths: number
  headshots: number
  headDeaths: number
  suicides: number
  killsByWeapon: Record<string, number>
  /**
   * 決着を待たずに抜けたか。
   *
   * リロード (30 秒以内の復帰) は含めない。**席を畳んだ時点**で数える。
   */
  leftEarly: boolean
}

/**
 * 1 人分を書く。
 *
 * 試合の終わりにまとめてではなく、**その人が居なくなった時点で**書く。
 * 抜けた人は試合が終わる頃にはもう部屋に居ないので、まとめてでは拾えない。
 */
export function recordPlayer(record: MatchRecord): void {
  call('record_match_player', {
    p_match_id: record.matchId,
    p_room: record.room,
    p_started_at: new Date(record.startedAt).toISOString(),
    p_auth_subject: record.subject,
    p_name: record.name,
    p_team: record.team,
    p_kills: record.kills,
    p_deaths: record.deaths,
    p_headshots: record.headshots,
    p_head_deaths: record.headDeaths,
    p_suicides: record.suicides,
    p_by_weapon: record.killsByWeapon,
    p_left_early: record.leftEarly,
  })
}

/**
 * 試合の締め。決着したときに 1 回。
 *
 * 部屋と開始時刻も渡す。**記録より先に着くことがある**ので、試合の行が
 * まだ無ければ向こうで作ってもらう (deploy/schema.sql)
 */
export function closeMatch(
  matchId: string,
  room: string,
  startedAt: number,
  winner: string,
): void {
  call('close_match', {
    p_match_id: matchId,
    p_room: room,
    p_started_at: new Date(startedAt).toISOString(),
    p_winner: winner,
  })
}
