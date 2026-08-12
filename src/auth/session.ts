/**
 * 誰なのかを扱う層。
 *
 * ゲーム側へ出すのは `subject` と `displayName` と `token` の 3 つだけ。
 * 発行元 (いまは Supabase) の都合はここから外へ出さないので、
 * 後で別のところへ移しても、このファイル以外は書き換えずに済む。
 *
 * SDK を入れずに REST を直接叩いている。使うのは 4 つの口だけで、
 * そのために 40KB のライブラリを積む理由が無い。
 *
 * --- なぜ要るか ---
 * これまで ID はブラウザが自分で作って名乗っていた。誰でも他人の ID を
 * 名乗れるうえ、タブごとに別人になるので、タブを開くだけでキャラが増えた。
 * 発行元が署名した token を使えば、ID はサーバーが導けるようになる。
 */

const URL_BASE = import.meta.env.VITE_SUPABASE_URL ?? ''
const API_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * 設定が揃っているか。
 *
 * 揃っていなければ入り口を出さずに、その旨を出す。素通しで遊ばせると
 * 「なぜかログインが出ない」まま進んで、繋いだ先で弾かれることになる。
 */
export const AUTH_READY = Boolean(URL_BASE && API_KEY)

/**
 * token を預ける先。
 *
 * sessionStorage ではなく localStorage。タブごとに別人になるのをやめるのが
 * そもそもの目的なので、ブラウザに 1 つあればよい。
 */
const STORE_KEY = 'mgohttp:session'

/** 期限の何秒前に取り直すか。切れてから慌てないよう余裕を持つ */
const REFRESH_MARGIN = 60

/** ゲーム側が知ってよいこと */
export interface Identity {
  subject: string
  displayName: string
  /** サーバーへ渡す。署名を検証して ID を導いてもらう */
  token: string
}

interface StoredSession {
  access_token: string
  refresh_token: string
  /** 期限 (秒、epoch) */
  expires_at: number
  user: { id: string; user_metadata?: Record<string, unknown> }
}

let session: StoredSession | null = load()
let refreshTimer = 0

function load(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function store(next: StoredSession | null): void {
  session = next
  try {
    if (next) localStorage.setItem(STORE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORE_KEY)
  } catch {
    // プライベートモードでは保存できない。その場合はタブを閉じるまでの命
  }
  scheduleRefresh()
}

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${URL_BASE}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(translate(data))
  }
  return data
}

/**
 * 発行元の文言を日本語にする。
 *
 * 出るのは 4 つくらいで、そのどれもが「何を直せばいいか」を伝える必要がある。
 * 英語のまま出すと、登録に失敗した理由が読めない。
 */
function translate(data: Record<string, unknown>): string {
  const code = typeof data.error_code === 'string' ? data.error_code : ''
  const message = typeof data.msg === 'string' ? data.msg : '通信に失敗した'
  switch (code) {
    case 'invalid_credentials':
      return '名前かパスワードが違う'
    case 'email_not_confirmed':
      return 'メールの確認がまだ。届いたリンクを開いてから入り直す'
    case 'user_already_exists':
      return 'その名前はもう使われている'
    case 'weak_password':
      return 'パスワードが短い (6 文字以上)'
    case 'over_email_send_rate_limit':
      return '確認メールの送りすぎ。少し待つ'
    default:
      return message
  }
}

function adopt(data: Record<string, unknown>): StoredSession | null {
  const access = data.access_token
  const refresh = data.refresh_token
  const user = data.user as StoredSession['user'] | undefined
  if (typeof access !== 'string' || typeof refresh !== 'string' || !user) return null

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const next: StoredSession = {
    access_token: access,
    refresh_token: refresh,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user,
  }
  store(next)
  return next
}

/**
 * 期限が来る前に取り直す。
 *
 * 対戦中に切れると、繋ぎ直したときに入れなくなる。使う瞬間ではなく
 * あらかじめ更新しておく。
 */
function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer)
  if (!session) return
  const wait = (session.expires_at - REFRESH_MARGIN) * 1000 - Date.now()
  refreshTimer = window.setTimeout(() => void refresh(), Math.max(wait, 5_000))
}

async function refresh(): Promise<void> {
  if (!session) return
  try {
    adopt(await call('token?grant_type=refresh_token', { refresh_token: session.refresh_token }))
  } catch (error) {
    console.warn('[認証] token を取り直せない。入り直しが要る', error)
    store(null)
  }
}

/**
 * 名前をメールアドレスの形にする。
 *
 * 発行元はメールアドレスを要求するが、このゲームに要るのは表示名だけ。
 * メールを本当に使う (確認・再発行) 段になったら、ここをやめて
 * 本物のアドレスを聞くことになる。
 */
function emailFor(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@players.mgohttp.local`
}

export function currentIdentity(): Identity | null {
  if (!session) return null
  const meta = session.user.user_metadata ?? {}
  const name = typeof meta.display_name === 'string' ? meta.display_name : ''
  return {
    subject: session.user.id,
    displayName: name || session.user.id.slice(0, 4).toUpperCase(),
    token: session.access_token,
  }
}

export async function signIn(name: string, password: string): Promise<Identity> {
  adopt(await call('token?grant_type=password', { email: emailFor(name), password }))
  const identity = currentIdentity()
  if (!identity) throw new Error('返ってきた内容が読めない')
  return identity
}

/**
 * 登録する。
 *
 * メールの確認が要る設定だと、ここでは token が返らない。その場合は
 * 「確認してから入り直す」と伝えるために null を返す。
 */
export async function signUp(name: string, password: string): Promise<Identity | null> {
  const data = await call('signup', {
    email: emailFor(name),
    password,
    data: { display_name: name },
  })
  adopt(data)
  return currentIdentity()
}

export function signOut(): void {
  store(null)
}

/** 起動時に呼ぶ。期限が近ければ先に取り直しておく */
export async function restore(): Promise<Identity | null> {
  if (!session) return null
  if (session.expires_at - REFRESH_MARGIN <= Math.floor(Date.now() / 1000)) {
    await refresh()
  } else {
    scheduleRefresh()
  }
  return currentIdentity()
}
