import type { KillEvent, MatchMessage, Team } from '../../application/protocol/types'
import type { HeldId } from '../../domain/item/held'
import { weaponOf, type SupportId, type WeaponId } from '../../domain/item/weapons'
import type { Briefing } from '../../domain/match/briefing'
import { STEALTH_BREAK_MS } from '../../domain/match/sides'
import { CHOOSE_FLOOR, CHOOSE_TIMEOUT, isDowned, type Life } from '../../domain/player/lifecycle'
import type { SkillId, Skills } from '../../domain/player/skill'
import type { Stance } from '../../domain/player/stance'
import { VOICE_CATEGORIES, spokenLine } from '../../domain/player/voice'

/**
 * **HUD へ渡す状態** (GameStats) と、それを組む判断。
 *
 * Game.ts の publishStats が three・入力・持ち物・レプリカから値を集めて、ここの形にして Solid へ流す。
 * 型は Game.ts の頭に 260 行あったのをここへ出した (2026-11-03 本人「2 もやっていいよ」)。
 * 集めた値から「何を出すか」を決める所 (支度の間はこれから湧く銃を映す、残り秒、倒れたままの
 * 残り…) は下の純粋関数にして、描画器なしで試せるようにしてある (stats.test.ts)
 */

/** HUD へ渡す状態。Three.js 側からこれだけを Solid の signal に流す */
/**
 * 支度の画面で指せる枠。
 *
 * 装備を選ぶ間は 3 つ、支度の段階ではスキルの並び (SkillId がそのまま入る)。
 * **窓によって並ぶ物が違う**ので、1 つの union にまとめてある。
 */
export type LoadoutFocus = 'primary' | 'secondary' | 'support' | SkillId

/** キルログの欄に出す 1 行。倒した / 眠らせた、または誰かのボイス */
export type HudFeedItem =
  | (KillEvent & { stun?: boolean; at: number })
  | { type: 'voice'; id: string; name: string; team: Team; text: string; at: number }
  /** 抜けた / 戻りを待っている (application/replica/match.ts の PresenceEntry) */
  | { type: 'presence'; id: string; name: string; team: Team; state: 'away' | 'left'; at: number }

export interface GameStats {
  /**
   * 戦場を見せてよいか。**地形と自分の模型が揃うまで false。**
   *
   * 揃う前の画面は「まだ何も起きていない」ことを伝えられない。地形は
   * ブロックアウトの箱だけ、模型は素の姿勢 (T ポーズ) で立っているので、
   * **読み込み中ではなく壊れているように見える**。揃うまでは覆いを出す。
   */
  ready: boolean
  stage: string
  /**
   * いま描いている裏側。'WebGPU' か 'WebGL2'。
   *
   * WebGPU が無い環境では three が黙って WebGL2 に落ちる。黙って落ちるのは
   * 動かし続けるには正しいが、どちらで走っているのか分からないままだと、
   * 速い / 遅いの原因を取り違える。
   */
  backend: string
  fps: number
  x: number
  z: number
  speed: number
  /** ポインタロック中か。false ならクロスヘアを隠して操作説明を出す */
  locked: boolean
  shots: number
  ammo: number
  magazine: number
  /** 弾倉の外に残っている弾 */
  reserve: number
  reloading: boolean
  /** 転んでいて、まだ起き上がれるか */
  downed: boolean
  /** 構えているか。クロスヘアはこのときだけ出す */
  aiming: boolean
  /** 構えようとしているが、銃口の先が塞がっていて構えられない */
  aimBlocked: boolean
  /** 現在の散布界 (度)。クロスヘアの開き具合に使う */
  spread: number
  /** その部屋で選べる主武器。**部屋が絞ることがある** */
  primaries: readonly WeaponId[]
  /** 選べる副武器。**持たせない部屋は空、TSNE は側の 1 挺** */
  secondaries: readonly WeaponId[]
  /** 選べる support。**TSNE は側ごとに違う** */
  supports: readonly SupportId[]
  /**
   * 次に湧いたときの主武器。**選ばれている物。**
   *
   * 画面側で信号に持たせていた頃、初期値が 'rifle' で固定されていた。狙撃銃
   * だけの部屋では**どれも選ばれていない**状態で開く (一覧に rifle が無いので
   * どの札にも印が付かない)。選んでいる物を知っているのはこちら。
   */
  primary: WeaponId | null
  /** 副武器。**部屋が外していれば null** */
  secondary: WeaponId | null
  /**
   * 粒が散る角度 (度)。散弾でなければ 0。
   *
   * **0 でなければクロスヘアが輪になる。** 十字は「その一点へ 1 発飛ぶ」の形で、
   * 8 粒に分かれる銃に出すと狙った点へ集まるように読めてしまう。
   *
   * 輪の大きさは**狙いの散布に粒の散りを足した幅**。粒がどこまで飛び散るかを
   * そのまま出すので、間合いの外では輪が画面を覆うほど大きくなる。
   */
  pelletSpread: number
  /** しゃがんでいるか */
  crouching: boolean
  /**
   * いまの構え。**旗ではなく構えそのもの。**
   *
   * 伏せは屈みの旗も立てている (低い姿勢としての扱いが要る) ので、旗を
   * 読むと CROUCH に見える。頭の高さも当たり判定も構えのほうで決まって
   * いるので、見せる値もそちらから引く。
   */
  stance: Stance
  /** 直近に当てた部位。空文字なら表示しない */
  hitZone: string
  /** その命中が麻酔だったか。**青で出す** */
  hitTranq: boolean
  /** 敬礼で繋がったばかりの味方 */
  links: string[]
  /** 成績表を開いているか */
  menuOpen: boolean
  /** 装備の画面を開いているか */
  loadoutOpen: boolean
  /** READY の長押しの進み (0〜1)。鍵盤とパッドで押している分 */
  readyHold: number
  /** 試合の前のルールの説明。開いていなければ null (domain/match/briefing.ts) */
  briefing: Briefing | null
  /** 装備の画面が自動で閉じるまで (秒) */
  loadoutLeft: number
  /** OK が効くようになるまで (秒)。0 なら押せる */
  loadoutWait: number
  /**
   * いま効いているスキル。**サーバーが決める。**
   *
   * 選んだ物をそのまま出さないのは、途中参加した人が自分で選んでいないため —
   * 前回の選択を DB から持ってくるので、返ってきた物だけが正しい。
   */
  skills: Skills
  /** スキルを選び直せるか。**試合が始まったら閉じる** */
  skillsOpen: boolean
  /**
   * 支度の画面でいま指している枠。**パッドと矢印キー用。**
   *
   * 番号ではなく枠の名前を渡す。番号だと**並び順を画面と scene の 2 か所が
   * 握る**ことになり、副武器の無い部屋で片方だけ詰め忘れると 1 つずれる。
   * 名前なら画面は自分の枠と見比べるだけで済む。
   */
  loadoutFocus: LoadoutFocus
  /** スコープを覗いているか。覗いている間は専用の表示にする */
  scoped: boolean
  /**
   * 覗いているのが銃の照準器か (突撃銃の主観)。眼鏡ではないのでスコープの絵を重ねない。
   * holo はホロサイトの輪と点を画面の真ん中に出す。null なら眼鏡か、覗いていない
   */
  sight: 'iron' | 'holo' | null
  /** いま持っている銃。調整パネルが追従する */
  equipped: WeaponId
  /** 覗いている倍率。空なら覗いていない */
  zoom: string
  /** ホイールで覗ける状態か。案内を出すのに使う */
  canZoom: boolean
  /** 目の前に梯子があるか。**掴めることを知らせる**のに使う */
  canClimb: boolean
  /**
   * 検証用の読み出し (URL に ?debug を付けたときだけ)。今の型・立っている旗・
   * 主な動作が何に阻まれているか・位置。「押したのに動かない」を追うため
   */
  debug: { locomotion: string; flags: string; blocked: string; where: string } | null
  /** 自分の基地の上に居る。G / △ で補給できる */
  canResupply: boolean
  /** 眠っている人の傍でしゃがんでいる。G / △ で叩いて起こせる (味方でも敵でも) */
  canPat: boolean
  /** 「{名前}がターゲットを取得した / 手放した」(TSNE、全員)。出している間だけ。leaving は退き始めた */
  targetNotice: { text: string; team: Team; leaving: boolean } | null
  /** ターゲットを一覧で指している。G / △ で落とせる */
  canDropTarget: boolean
  /** 部屋に居る全員の戦績。サーバーが 1 秒ごとに配る */
  scores: MatchMessage['players']
  /**
   * 直近の点の増減。**自分の分だけ。**
   *
   * 倒した / 倒された瞬間に右下へ出す。誰が誰を倒したかの一覧 (kills) とは別で、
   * こちらは自分に何が起きたかだけを短く見せる。
   */
  points: { label: string; delta: number; at: number }[]
  /** 近くに落ちている武器がある。**押せば拾える**という案内を出す */
  canPickUp: boolean
  /** 自分が光っている (個人戦の 1 位)。位置が全員に漏れている */
  leaking: boolean
  /**
   * 直近のキル表示。新しいものが先頭。
   *
   * **眠らせたかどうかも運ぶ。** 倒したのと眠らせたのは同じ行で出すが、
   * 残機が減っていないので**同じ色で出してはいけない** (出す側が三角の色を
   * 分ける)。レプリカは KillEntry として別に持っているので、ここで畳んで渡す。
   */
  kills: HudFeedItem[]
  /** ボイスの番号の一覧を出しているか (T を押した直後)。見出しと並べる文字列 */
  voiceMenu: { title: string; items: readonly string[]; pad: boolean } | null
  /** 残っている投げ物 */
  throwables: number
  /** 手榴弾の残り */
  grenades: number
  /** 投擲の枠に何を入れているか */
  support: SupportId
  /** 開いている持ち替えの一覧。閉じていれば null */
  browsing: {
    /** n = 持っている総数 (銃は装填 + 予備)。loaded/mag は銃だけ */
    items: { id: HeldId; n: number | null; loaded: number | null; mag: number | null }[]
    at: number
  } | null
  /** いま手にある物 */
  held: HeldId
  /** 武器系で選んでいる物。道具を手にしていても変わらない */
  weaponHeld: HeldId
  /** スタンナイフの充電 (0〜1)。ナイフのカードの弾の目盛りの所に出す */
  stunCharge: number
  /** 道具系で選んでいる物。使っていなければ 'none' */
  tool: HeldId
  /** その道具をいま手にしているか */
  toolInHand: boolean
  /** STEALTH を着ているか (TSNE の攻める側)。手には持たない */
  wearingStealth: boolean
  /** CAUTION の残り (秒)。0 なら出さない。部屋で 1 つ、全員が同じ秒数 */
  caution: number
  /** 落ちたターゲット (TSNE) が置き場所へ戻るまでの残り (秒)。落ちていなければ 0 */
  targetReturn: number
  /**
   * 倒れたまま、復活の支度に移るまでの残り (秒)。**倒されるたびに延びる部屋 (CAP) でだけ** 0 より大きい。
   * downFor はその満タン (今回の倒れたままの秒数)
   */
  downLeft: number
  downFor: number
  /** どちらの系統の一覧を開いているか。閉じていれば null */
  browsingFamily: 'weapon' | 'tool' | null
  /** 持ち替えの最中か。HUD を薄くするのに使う */
  switching: boolean
  /** 自分の所属 */
  team: Team
  /** 試合の状態。まだ届いていなければ null */
  match: MatchMessage | null
  /** 自分の体力 */
  health: number
  /**
   * 視界の曇り (0..1)。**スタミナが減るほど濃い。**
   *
   * 残りの数字ではなく効き目を渡す。画面は棒を出さずに曇るだけなので、
   * 数字を持たせても使い道が無い (domain/player/stamina.ts の staminaBlur)。
   */
  stamina: number
  /**
   * 直近の爆風。**近くで爆ぜるたび、別物に差し替わる。**
   *
   * 続いている効き目 (stamina) と違って、これは起きた一瞬を知らせる合図。
   * 0.1 秒ごとの stats に乗せるので、いつ届くかは揃わない — **濃さと長さは
   * 受けた側 (Hud.css) が時間で決める。** ここが持つのは近さだけ。
   *
   * seq は毎回増える番号。**同じ場所で続けて爆ぜても新しい 1 発と分かる。**
   */
  shock: { seq: number; power: number } | null
  /** 眠っているか。眠っている間は操作を受け付けない */
  asleep: boolean
  /** 眠りの深さ。**1 が眠った瞬間、0 が起きた瞬間。** 画面の暗さがこれに従う */
  sleepDepth: number
  /** パッドで遊んでいるか。眠っている間の「もがいて起きる」案内の出し分け */
  padActive: boolean
  maxHealth: number
  /** 倒れているか */
  dead: boolean
  /** 接続している他プレイヤーの数 */
  players: number
  /**
   * 自分が実際に位置を送れている回数 (通/秒)。
   *
   * 名目は 64。**下回っていたら、描画が重くて setInterval が発火できていない。**
   * 相手の画面ではその分だけ自分がカクつく
   */
  /**
   * 往復の時間 (ms)。**サーバーが測ってくれた値。**
   *
   * 0 ならまだ測れていない。回数 (FPS / TX / RX) とは別物で、あちらは
   * 「何回」、こちらは「どれだけ待つか」。
   */
  /**
   * いま流している型と銃の持ち方の段。**?stats=on にだけ出す。**
   *
   * 試写と本番で銃の位置が違ったときに、どちらの型を使っているかを目で
   * 突き合わせるため。
   */
  pose: string
  latency: number
  /**
   * 断られた理由。**入っていればもう戻らない。**
   *
   * 落ちただけなら勝手に繋ぎ直すので、ここには入らない。
   */
  rejected: string | null
  /** 認証が切れて断られた。画面は部屋の一覧へ戻す */
  expired: boolean
  sendRate: number
  /** 相手ごとに、位置が届いている回数 (通/秒) */
  peerRates: { name: string; rate: number }[]
}

/** CAUTION の長さ (秒)。バーの満タン。STEALTH が解けている長さ (domain/match/sides.ts の STEALTH_BREAK_MS) */
export const CAUTION_SECONDS = STEALTH_BREAK_MS / 1000

/** 「ターゲットを取得した / 手放した」を出しておく長さ (ms) */
export const TARGET_NOTICE_MS = 4000
/** 最後のこれだけで、始まりの指令と同じく割れて退く (Orders.css の animation と揃える) */
export const TARGET_NOTICE_LEAVE_MS = 600

/**
 * 武器のカードに出す銃と弾。
 *
 * **支度の間はこれから湧く銃を映す。** 手には何も無い (戦場に居ない) ので、前の命の銃を出すと
 * 「P90 を選んだのに AK47 と出る」になる。装備画面で選んでいる物と食い違うのはここだけで、
 * 直前まで持っていた物に用は無い。戦場ではカードが名指している武器の弾 — ダンボールを
 * 被っている間も銃の残弾はそのまま出す
 */
export function weaponCard(
  choosing: boolean,
  chosen: WeaponId | null,
  inHand: { weapon: HeldId; ammoOf(id: HeldId): number; reserveOf(id: HeldId): number; magazine: number },
): { shown: HeldId; ammo: number; magazine: number; reserve: number } {
  if (choosing) {
    const spec = weaponOf(chosen)
    return { shown: chosen ?? 'knife', ammo: spec.magazine, magazine: spec.magazine, reserve: spec.reserve }
  }
  return {
    shown: inHand.weapon,
    ammo: inHand.ammoOf(inHand.weapon),
    magazine: inHand.magazine,
    reserve: inHand.reserveOf(inHand.weapon),
  }
}

/**
 * 装備の画面の残り秒 (left) と、OK が効くまで (wait)。
 *
 * **支度の段階では試合が始まるまでを出す。** 装備の打ち切り (30 秒) を出していると、まだ始まらない
 * のに「残り 0 秒」になって、何を待っているのか分からなくなる。始まる時刻はサーバーが持っている
 *
 * @param endsAt 試合の段階が終わる時刻 (手元の時計、ms)
 * @param chosen 支度に入ってから経った時間 (秒)
 */
export function loadoutClock(
  phase: MatchMessage['phase'] | undefined,
  endsAt: number,
  chosen: number,
  now: number,
): { left: number; wait: number } {
  const left =
    phase === 'ready' || phase === 'countdown'
      ? Math.max(0, Math.ceil((endsAt - now) / 1000))
      : Math.max(0, Math.ceil(CHOOSE_TIMEOUT - chosen))
  return { left, wait: Math.max(0, Math.ceil(CHOOSE_FLOOR - chosen)) }
}

/**
 * 倒れたままでいる残り (秒)。**倒されるたびに延びる部屋 (CAP) だけ** — 他の部屋は尺が決まっているので出さない
 *
 * @param lifeAt 倒れた時刻 (ms)
 */
export function downLeftOf(downGrows: boolean, life: Life, downFor: number, lifeAt: number, now: number): number {
  return downGrows && isDowned(life) ? Math.max(0, downFor - (now - lifeAt) / 1000) : 0
}

/** その時刻までの残り (秒)。過ぎていれば 0 (CAUTION・落ちたターゲットが戻るまで) */
export function secondsUntil(at: number | undefined, now: number): number {
  return Math.max(0, (at ?? 0) - now) / 1000
}

/** 「{名前}がターゲットを取得した」の帯。出しておく間だけ。**最後の少しで退き始める** */
export function targetNoticeOf(
  notice: { text: string; team: Team; at: number } | null,
  now: number,
): GameStats['targetNotice'] {
  if (!notice || now - notice.at >= TARGET_NOTICE_MS) return null
  return { text: notice.text, team: notice.team, leaving: now - notice.at >= TARGET_NOTICE_MS - TARGET_NOTICE_LEAVE_MS }
}

/**
 * ボイスの一覧。開いている間だけ。**分類を選ぶ前は分類の並び、選んだ後はその中の台詞**
 *
 * @param until 開いておく締め切り (ms)
 * @param category 選んだ分類 (VOICE_CATEGORIES の番号)。まだなら null
 */
export function voiceMenuOf(until: number, category: number | null, pad: boolean, now: number, voice = 'man1'): GameStats['voiceMenu'] {
  if (until <= now) return null
  if (category === null) return { title: 'VOICE', items: VOICE_CATEGORIES.map((c) => c.label), pad }
  const chosen = VOICE_CATEGORIES[category]
  // 自分の声の版の文言で出す (名無しなら「幸運を」)
  return { title: chosen.label, items: chosen.lines.map((id) => spokenLine(id, voice)?.label ?? id), pad }
}
