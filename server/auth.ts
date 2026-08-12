/**
 * 誰なのかを確かめる。
 *
 * クライアントが名乗った ID を信じるのをやめて、**署名を検証して ID を導く**。
 * いままでは `?id=` をそのまま使っていたので、誰でも他人になりすませた。
 *
 * 検証に秘密は要らない。発行元 (Supabase) が非対称鍵で署名しているので、
 * 公開鍵を取ってくれば確かめられる。サーバーに鍵を置かなくてよい。
 *
 * --- 差し替えについて ---
 * ゲーム側へ渡すのは subject と表示名の 2 つだけ。発行元を変えても
 * ここより先は変わらない。
 */

/** 確かめた結果。ゲーム側が知ってよいのはこれで全部 */
export interface Identity {
  /** 発行元が保証する一意な ID */
  subject: string
  /** 表示名。無ければ呼ぶ側が既定を当てる */
  name?: string
}

/**
 * 公開鍵の置き場。
 *
 * 起動時ではなく最初の検証で取りに行く。認証を設定していない環境でも
 * サーバーが立ち上がるようにするため。
 */
const JWKS_PATH = '/auth/v1/.well-known/jwks.json'

/** 公開鍵を取り直す間隔 (ms)。鍵の入れ替えに追随する */
const JWKS_TTL = 60 * 60 * 1000

interface Jwk {
  kid: string
  kty: string
  crv?: string
  alg?: string
  x?: string
  y?: string
  n?: string
  e?: string
}

const keys = new Map<string, CryptoKey>()
let fetchedAt = 0
let pending: Promise<void> | null = null

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)))
  } catch {
    return null
  }
}

/** 公開鍵を取り込む。ES256 と RS256 のどちらでも受ける */
async function importKey(jwk: Jwk): Promise<CryptoKey | null> {
  const algorithm =
    jwk.kty === 'EC'
      ? { name: 'ECDSA', namedCurve: jwk.crv ?? 'P-256' }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
  try {
    return await crypto.subtle.importKey('jwk', jwk as JsonWebKey, algorithm, false, ['verify'])
  } catch (error) {
    console.warn(`[認証] 公開鍵を読めない (kid ${jwk.kid})`, error)
    return null
  }
}

async function refreshKeys(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}${JWKS_PATH}`)
  if (!response.ok) throw new Error(`JWKS ${response.status}`)
  const { keys: jwks } = (await response.json()) as { keys: Jwk[] }

  keys.clear()
  for (const jwk of jwks) {
    const key = await importKey(jwk)
    if (key) keys.set(jwk.kid, key)
  }
  fetchedAt = Date.now()
}

/**
 * 公開鍵を用意する。
 *
 * 同時に何本も来ても取りに行くのは 1 回。試合が始まる瞬間は接続が固まるので、
 * そこで人数分の外部通信が走ると遅い。
 */
async function ensureKeys(baseUrl: string, kid: string): Promise<CryptoKey | null> {
  const fresh = Date.now() - fetchedAt < JWKS_TTL
  if (fresh && keys.has(kid)) return keys.get(kid) ?? null

  if (!pending) {
    pending = refreshKeys(baseUrl).finally(() => {
      pending = null
    })
  }
  try {
    await pending
  } catch (error) {
    console.warn('[認証] 公開鍵を取れない', error)
    return null
  }
  return keys.get(kid) ?? null
}

/**
 * token を確かめて、誰なのかを返す。確かめられなければ null。
 *
 * 期限も見る。期限切れを通すと、一度発行された token が永久に使える。
 */
export async function verifyToken(token: string, baseUrl: string): Promise<Identity | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const header = decodeJson(parts[0])
  const payload = decodeJson(parts[1])
  if (!header || !payload) return null

  const kid = typeof header.kid === 'string' ? header.kid : ''
  const alg = typeof header.alg === 'string' ? header.alg : ''
  if (!kid) return null

  const key = await ensureKeys(baseUrl, kid)
  if (!key) return null

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const signature = base64UrlToBytes(parts[2])
  const algorithm =
    alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: 'SHA-256' }

  const ok = await crypto.subtle.verify(algorithm, key, signature, signed).catch(() => false)
  if (!ok) return null

  const expires = typeof payload.exp === 'number' ? payload.exp : 0
  if (expires > 0 && Date.now() / 1000 > expires) return null

  const subject = typeof payload.sub === 'string' ? payload.sub : ''
  if (!subject) return null

  // 匿名は入れない。
  //
  // 発行元の設定でオン/オフできてしまうので、ここでも見る。ダッシュボードを
  // 触った誰かが意図せず穴を開けるのを防ぐ。「誰が誰か」は味方との繋がりにも
  // 戦績にも効くので、名前を決めてから入ってもらう。
  if (payload.is_anonymous === true) {
    console.warn('[認証] 匿名では入れない')
    return null
  }

  // 表示名は本人が決めた値なので、そのまま信じてよい種類の情報。
  // ただし他人の名前は名乗れない (subject が別なので)
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>
  const name =
    typeof meta.display_name === 'string'
      ? meta.display_name
      : typeof meta.name === 'string'
        ? meta.name
        : undefined

  return { subject, name }
}
