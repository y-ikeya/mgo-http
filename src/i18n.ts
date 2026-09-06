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
 * `LOADOUT` `PRIMARY` `OK` `Leave` `Login` `VICTORY` などのラベルは**どちらの言語でも
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
  'lobby.ready': '支度中',
  'lobby.countdown': 'まもなく開始',
  'lobby.playing': '対戦中',
  'lobby.over': '結果表示',
  'lobby.unreachable': 'サーバーに繋がらない',
  'lobby.loading': '読み込み中…',

  // --- 試合中 ---
  'hud.waitingForOpponent': '対戦相手を待っています',
  'hud.scopeHint': 'Z / ホイールで覗く',
  'hud.standUpHint': '移動で起き上がる',
  // --- 装備 ---
  'loadout.note': '装備を選んでください',
  'loadout.deployIn': '出撃まで {n}',

  // --- 描けない機械 ---
  'gpu.title': 'GPU が使われていません',
  'gpu.lede':
    'この機械はいま、画面をすべて CPU で描いています。この状態では数 FPS しか出ず、' +
    '遊べないうえに、相手の画面でもあなたがカクついて見えます。' +
    '下のどれかで直ります。',
  'gpu.remote': 'リモートデスクトップ越しに開いていませんか。その PC の前で直接開いてください。',
  'gpu.accel':
    'Chrome の 設定 → システム →「ハードウェア アクセラレーションが使用可能な場合は使用する」' +
    'をオンにして、ブラウザを再起動してください。',
  'gpu.driver':
    'デバイスマネージャーの「ディスプレイ アダプター」が「Microsoft 基本ディスプレイ アダプター」' +
    'になっていたら、GPU のドライバを入れてください。',
  'gpu.recheck': '直したらこのページを開き直してください。',

  // --- 試合が始まった瞬間の指令 ---
  'orders.tdm.red': 'レッドチームを倒せ!',
  'orders.tdm.blue': 'ブルーチームを倒せ!',
  'orders.dm': '全員が敵だ。生き残れ!',

  // --- 遅れが直らない人 ---
  'lag.title': '通信の遅れが大きすぎます',
  'lag.lede':
    'サーバーとの往復に 1 秒以上かかる状態が続いたため、接続を切りました。' +
    'この状態では、あなたの姿が相手の画面で飛び、撃っても当たらなくなります。' +
    '下のどれかで直ることがあります。',
  'lag.wifi': '無線なら有線に繋ぎ替えるか、ルーターの近くへ移ってください。',
  'lag.other':
    '同じ回線で大きな通信をしていませんか (動画・更新・バックアップ)。' +
    '止めてから入り直してください。',
  'lag.vpn': 'VPN やプロキシを通していたら、外して試してください。',
  'lag.recheck': 'このページを開き直すと入り直せます。',

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
  'lobby.ready': 'Getting ready',
  'lobby.countdown': 'Starting soon',
  'lobby.playing': 'In progress',
  'lobby.over': 'Results',
  'lobby.unreachable': 'Cannot reach the server',
  'lobby.loading': 'Loading…',

  'hud.waitingForOpponent': 'Waiting for an opponent',
  'hud.scopeHint': 'Z / wheel to scope',
  'hud.standUpHint': 'MOVE TO GET UP',
  'loadout.note': 'Choose your loadout',
  'loadout.deployIn': 'Deploy in {n}',

  'gpu.title': 'GPU IS NOT BEING USED',
  'gpu.lede':
    'This machine is currently drawing everything on the CPU. That gives only a few frames ' +
    'per second — the game is unplayable, and you also stutter on everyone else\'s screen. ' +
    'One of the steps below will fix it.',
  'gpu.remote': 'Are you connected over Remote Desktop? Open the page on the machine itself.',
  'gpu.accel':
    'In Chrome, go to Settings → System and turn on "Use graphics acceleration when available", ' +
    'then restart the browser.',
  'gpu.driver':
    'If Device Manager shows "Microsoft Basic Display Adapter" under Display adapters, ' +
    'install your GPU driver.',
  'gpu.recheck': 'Reload this page once it is fixed.',

  'orders.tdm.red': 'ELIMINATE THE RED TEAM!',
  'orders.tdm.blue': 'ELIMINATE THE BLUE TEAM!',
  'orders.dm': 'EVERYONE IS HOSTILE. SURVIVE!',

  'lag.title': 'YOUR CONNECTION IS TOO SLOW',
  'lag.lede':
    'The round trip to the server stayed above one second, so you were disconnected. ' +
    'At that latency you jump around on everyone else\'s screen and your shots stop landing. ' +
    'One of the steps below may fix it.',
  'lag.wifi': 'On Wi-Fi? Switch to a wired connection, or move closer to the router.',
  'lag.other':
    'Is something else on the same line using bandwidth (video, updates, backups)? ' +
    'Stop it and rejoin.',
  'lag.vpn': 'If you are behind a VPN or proxy, try without it.',
  'lag.recheck': 'Reload this page to rejoin.',

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
