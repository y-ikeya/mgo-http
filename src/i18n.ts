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
  'lobby.assembled': 'まもなく開始',
  'lobby.ready': '支度中',
  'lobby.countdown': 'まもなく開始',
  'lobby.playing': '対戦中',
  'lobby.over': '結果表示',
  'lobby.unreachable': 'サーバーに繋がらない',
  'lobby.expired': '長時間操作がなかったため部屋から退出しました',
  'lobby.loading': '読み込み中…',
  'home.versus': '対戦',
  'home.versusHint': '部屋を選んで、他のプレイヤーと戦う',
  'home.training': '練習',
  'home.trainingHint': 'ひとりで動きと撃ち方を試す。的が立っている',


  // --- 試合中 ---
  'hud.loading': '戦場を読み込んでいます',
  'hud.waitingForOpponent': '対戦相手を待っています',
  'hud.assembledTitle': '対戦者が揃いました',
  'hud.gameSet': '試合終了',
  'hud.assembledSub': 'マッチを開始します',
  'loadout.readyGuide': 'スキルを選んで READY を押してください',
  'hud.matchGone': 'その試合はすでに終了しています',
  'hud.scopeHint': 'Z / ホイールで覗く',
  'hud.climbHint': 'G / △ で梯子を登る',
  'hud.resupplyHint': 'G / △ で補給',
  'hud.patHint': 'G / △ で叩いて起こす',
  'hud.dropTargetHint': 'G / △ でターゲットを落とす',
  'hud.standUpHint': '移動で匍匐 · Space で起き上がる',
  // --- 装備 ---
  'loadout.note': '装備を選んでください',
  'loadout.deployIn': '出撃まで {n}',
  'loadout.none': '持たない',

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
  'orders.tsne.attack': 'ターゲットを基地へ持ち帰れ!',
  'orders.cap': 'ターゲットを奪い、設置ポイントで守り抜け!',
  'orders.tsne.defence': 'ターゲットを守り抜け!',

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

  // --- 試合中に離れようとした ---
  'leave.title': '部屋を出ますか',
  'leave.lede':
    '試合の最中です。出ると、残った人は数の合わない試合を続けることになります。' +
    '席が畳まれるまでの間、あなたは「居るのに動かない人」として映ります。',

  // --- 成績表 ---
  'score.blue': '青',
  'score.red': '赤',
  'score.away': '再接続中',
  'score.empty': 'まだ誰も居ない',
  'score.back': '戻る',
  // --- 試合の前のルールの説明 (ui/Briefing.tsx)。見出しはどちらも英語 (domain/match/briefing.ts) ---
  'briefing.startsIn': '開始まで 残り {n} 秒',
  'rules.dm.hostile': '自分以外は全員敵。',
  'rules.dm.tickets': '残機は部屋で {tickets} を共有。誰が倒されても 1 減り、0 で試合終了。',
  'rules.dm.time': '制限時間 {minutes} 分。終わった時に一番多く倒した人の勝ち。',
  'rules.dm.leader': '1 位の人は体が光り、居場所が全員に知られる。',
  'rules.tdm.tickets': 'チケット制。各陣営 {tickets}。味方が倒されるたびに 1 減る (死因は問わない)。',
  'rules.tdm.win': '相手のチケットを 0 にしたら勝ち。',
  'rules.tdm.time': '制限時間 {minutes} 分。時間切れはチケットを多く残している方の勝ち。',
  'rules.tsne.sides': '攻める側と守る側に分かれる。1 試合は先攻と後攻の 2 ラウンドで、ラウンドごとに入れ替わる。',
  'rules.tsne.attack': '攻める側: 守る側の陣地にあるターゲットを自陣の基地まで運ぶか、守る側を全員倒す・眠らせたら勝ち。',
  'rules.tsne.defence': '守る側: 時間切れ (1 ラウンド {minutes} 分) まで守るか、攻める側を全員倒す・眠らせたら勝ち。',
  'rules.lives.any': '復活は何度でも。',
  'rules.lives.none': '復活なし。',
  'rules.lives.n': '復活は 1 人 {lives} 回まで。',
  'rules.cap.target': 'ターゲット 1 つを両陣営で取り合う。',
  'rules.cap.count': '持ったまま自陣の設置ポイント (相手の陣地の近く) に居る間だけ、自陣のカウント {count} 秒が減る。',
  'rules.cap.win': '先に 0 にした方の勝ち。制限時間 {minutes} 分、時間切れは多く減らした方、並んだらサドンデス。',
  'rules.cap.down': '復活は何度でも。ただし倒されるたびに倒れたままの時間が延びる。',
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
  'lobby.assembled': 'Starting soon',
  'lobby.ready': 'Getting ready',
  'lobby.countdown': 'Starting soon',
  'lobby.playing': 'In progress',
  'lobby.over': 'Results',
  'lobby.unreachable': 'Cannot reach the server',
  'lobby.expired': 'You were removed from the room after a long period of inactivity',
  'lobby.loading': 'Loading…',
  'home.versus': 'VERSUS',
  'home.versusHint': 'Pick a room and fight other players',
  'home.training': 'TRAINING',
  'home.trainingHint': 'Try movement and shooting on your own. Targets are set up',


  'hud.loading': 'Loading the battlefield',
  'hud.waitingForOpponent': 'Waiting for an opponent',
  'hud.assembledTitle': 'Opponents assembled',
  'hud.gameSet': 'The match is over',
  'hud.assembledSub': 'The match is about to begin',
  'loadout.readyGuide': 'Choose your skills, then press READY',
  'hud.matchGone': 'That match is already over',
  'hud.scopeHint': 'Z / wheel to scope',
  'hud.climbHint': 'G / △ to climb',
  'hud.resupplyHint': 'G / △ to resupply',
  'hud.patHint': 'G / △ to wake them',
  'hud.dropTargetHint': 'G / △ to drop the target',
  'hud.standUpHint': 'MOVE TO CRAWL · SPACE TO GET UP',
  'loadout.note': 'Choose your loadout',
  'loadout.deployIn': 'Deploy in {n}',
  'loadout.none': 'None',

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
  'orders.tsne.attack': 'BRING THE TARGET BACK TO BASE!',
  'orders.cap': 'SEIZE THE TARGET AND HOLD YOUR GOAL!',
  'orders.tsne.defence': 'GUARD THE TARGET!',

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

  'leave.title': 'LEAVE THE ROOM?',
  'leave.lede':
    'A match is in progress. If you leave, everyone else keeps playing a match that no ' +
    'longer has even sides — and until your seat is folded away you show up as someone ' +
    'who is there but never moves.',

  'score.blue': 'BLUE',
  'score.red': 'RED',
  'score.away': 'Reconnecting',
  'score.empty': 'Nobody yet',
  'score.back': 'Back',
  'briefing.startsIn': 'Starts in {n}s',
  'rules.dm.hostile': 'Everyone else is hostile.',
  'rules.dm.tickets': 'The room shares {tickets} tickets. Every death costs one; the match ends at 0.',
  'rules.dm.time': 'Time limit {minutes} min. Whoever has the most kills at the end wins.',
  'rules.dm.leader': 'The player in first place glows, revealing their position to everyone.',
  'rules.tdm.tickets': 'Each team has {tickets} tickets. Every time a teammate goes down, your team loses one (whatever the cause).',
  'rules.tdm.win': 'Bring the enemy team to 0 tickets to win.',
  'rules.tdm.time': 'Time limit {minutes} min. If time runs out, the team with more tickets left wins.',
  'rules.tsne.sides': 'Teams split into attackers and defenders. A match is two rounds; sides swap after each round.',
  'rules.tsne.attack': 'Attackers win by carrying the target from the defenders\' base to their own, or by taking down or sleeping every defender.',
  'rules.tsne.defence': 'Defenders win by holding out until time runs out ({minutes} min per round), or by taking down or sleeping every attacker.',
  'rules.lives.any': 'Unlimited respawns.',
  'rules.lives.none': 'No respawns.',
  'rules.lives.n': 'Each player can respawn {lives} times.',
  'rules.cap.target': 'Both teams fight over a single target.',
  'rules.cap.count': 'While you hold it inside your goal (near the enemy base), your team\'s {count}-second count ticks down.',
  'rules.cap.win': 'First team to 0 wins. Time limit {minutes} min; on time-out the team that counted down more wins, ties go to sudden death.',
  'rules.cap.down': 'Unlimited respawns, but each time you go down you stay down longer.',
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
