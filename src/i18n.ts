/**
 * 画面に出す文言。
 *
 * --- なぜライブラリを入れないか ---
 * 文言は 30 個ほどしかなく、複数形も語形変化も要らない (日本語に複数形が無く、
 * 英語側も名詞の羅列で足りている)。i18next を入れると、辞書 1 つのために
 * 読み込み・初期化・非同期の待ちが増える。増やした分に見合う仕事が無い。
 *
 * --- 判定は 1 回だけ ---
 * 読み込んだ時点で決めて、以後変わらない。試合中に切り替える物ではないし、
 * 変わり得るものにすると、文言を読むところ全部を signal にする必要が出る。
 * 確かめたいときは `?lang=en` を付ける。
 *
 * --- 英語のまま残しているもの ---
 * `LOADOUT` `PRIMARY` `OK` `Leave` `Login` `VICTORY` などの札は**どちらの言語でも
 * 英語**。訳し漏れではなく、元のゲームがそう表示していた物を踏襲している。
 * 訳すのは説明文のほうだけ。
 */

export type Lang = 'ja' | 'en'

function detect(): Lang {
  // 確かめる用の抜け道。日本語環境から英語を見るのに要る
  const forced = new URLSearchParams(location.search).get('lang')
  if (forced === 'ja' || forced === 'en') return forced
  // ja / ja-JP / ja-jp のどれでも拾う。それ以外は英語
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export const lang: Lang = detect()

// 読み上げと翻訳ツールのために宣言する。index.html は決め打ちなので上書きする
document.documentElement.lang = lang

const JA = {
  // --- 入り口 ---
  'login.name': '名前',
  'login.password': 'パスワード',
  'login.nameTooShort': '名前は 2 文字以上にしてください',
  'login.passwordTooShort': 'パスワードは 6 文字以上にしてください',
  'login.confirmSent': '登録しました。確認メールのリンクを開いてから Login してください',
  'login.failed': 'Login できませんでした',
  'login.toSignIn': 'アカウントを持っている場合は Login',
  'login.toSignUp': 'アカウントを作る (Sign up)',

  // --- 部屋の一覧 ---
  'lobby.waiting': '待機中',
  'lobby.countdown': 'まもなく開始',
  'lobby.playing': '対戦中',
  'lobby.over': '結果表示',
  'lobby.unreachable': 'サーバーに繋がらない',
  'lobby.loading': '読み込み中…',

  // --- 試合中 ---
  'hud.waitingForOpponent': '対戦相手を待っています',
  'hud.startingSoon': 'まもなく開始',
  'hud.scopeHint': 'Z / ホイールで覗く',
  'hud.standUpHint': '移動で起き上がる',
  'hud.help':
    'WASD 移動 · Space 短押し しゃがみ / 長押し ローリング · マウス 視点 · 右クリック / Shift 構え' +
    ' · 左クリック 射撃 · R リロード · F ナイフ · C ダンボール · G 長押しで弾倉を投げる' +
    ' · E 長押しで手榴弾 · V 敬礼 (長押しで保つ) · Q 持ち替え · Z 倍率 · Tab 成績表',

  // --- 装備 ---
  'loadout.note': '装備を選んでください',
  'loadout.deployIn': '出撃まで {n}',

  // --- 成績表 ---
  'score.blue': '青',
  'score.red': '赤',
  'score.away': '再接続中',
  'score.empty': 'まだ誰も居ない',
  'score.back': '戻る',
} as const

type Key = keyof typeof JA

const EN: Record<Key, string> = {
  'login.name': 'Name',
  'login.password': 'Password',
  'login.nameTooShort': 'Name must be at least 2 characters',
  'login.passwordTooShort': 'Password must be at least 6 characters',
  'login.confirmSent': 'Account created. Open the link in the confirmation email, then Login.',
  'login.failed': 'Could not sign in',
  'login.toSignIn': 'Already have an account? Login',
  'login.toSignUp': 'Create an account (Sign up)',

  'lobby.waiting': 'Waiting',
  'lobby.countdown': 'Starting soon',
  'lobby.playing': 'In progress',
  'lobby.over': 'Results',
  'lobby.unreachable': 'Cannot reach the server',
  'lobby.loading': 'Loading…',

  'hud.waitingForOpponent': 'Waiting for an opponent',
  'hud.startingSoon': 'Starting soon',
  'hud.scopeHint': 'Z / wheel to scope',
  'hud.standUpHint': 'MOVE TO GET UP',
  'hud.help':
    'WASD move · Space tap to crouch / hold to roll · Mouse look · Right click / Shift aim' +
    ' · Left click fire · R reload · F knife · C cardboard box · G hold to throw a magazine' +
    ' · E hold for a grenade · V salute (hold to keep) · Q swap weapon · Z zoom · Tab scoreboard',

  'loadout.note': 'Choose your loadout',
  'loadout.deployIn': 'Deploy in {n}',

  'score.blue': 'BLUE',
  'score.red': 'RED',
  'score.away': 'Reconnecting',
  'score.empty': 'Nobody yet',
  'score.back': 'Back',
}

const TABLE: Record<Lang, Record<Key, string>> = { ja: JA, en: EN }

/**
 * 文言を引く。
 *
 * @param params `{n}` の形の差し込み。数字を文の中へ入れる所だけで使う
 */
export function t(key: Key, params?: Record<string, string | number>): string {
  const text = TABLE[lang][key]
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}
