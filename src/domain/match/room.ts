import type { MatchPlayer } from '../player/player'
import { only, type Rotation } from '../stage'
import { CHOICES, SUPPORTS, isTranquilizer, type SupportId, type WeaponId } from '../item/weapons'
import { SLEEP_SECONDS } from '../player/stamina'

/**
 * 部屋とルール。
 *
 * **部屋ごとにルールを固定する。** 部屋を立てるときに選ばせる形にはしない —
 * 人が少ないうちは「空の部屋が並ぶ一覧」になるだけで、入った先に誰も居ない。
 * 数を絞って固定すれば、入った先に必ず誰かが居る確率が上がる。
 *
 * 名前と割り当ては docs/design.md の 2。
 */
export const ROOM_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'] as const

export type RoomName = (typeof ROOM_NAMES)[number]

/**
 * ルール。MGO2 の略称をそのまま使う (PRACTICE だけはこちらで足したもの)。
 *
 *     DM        全員が敵の個人戦
 *     TDM       2 陣営。倒すと相手の残機が減る
 *     TSNE      潜入 / 防御。攻める側 (非殺傷 + ナイフ + ステルス) と守る側 (殺傷) に分かれる
 *     INT       休憩。戦績に残らない
 *     PRACTICE  練習。棒立ちの的を撃つ
 */
export type Mode = 'DM' | 'TDM' | 'TSNE' | 'INT' | 'PRACTICE'

export interface ModeSpec {
  id: Mode
  label: string
  /**
   * 誰が敵か。
   *
   *     all   自分以外の全員 (DM)
   *     team  別の陣営 (TDM / TSNE / PRACTICE)
   *     none  誰も敵ではない (INT)
   */
  hostility: 'all' | 'team' | 'none'
  /** 残機を削り合って勝敗を決めるか。false なら試合が終わらない */
  tickets: boolean
  /** 戦績に残すか */
  records: boolean
  /** 入れるか。false なら一覧に出るが繋げない */
  active: boolean
  /** 1 人でも遊べるか。練習と休憩は相手を待たない */
  solo: boolean
  /**
   * 陣営で分かれるか。
   *
   * false なら**全員が同じ色**で、味方の発光もリンクも無い。個人戦で色が
   * 分かれていると「味方が居る」と読めてしまう。
   */
  teams: boolean
  /**
   * 1 位が光るか (位置が公になる)。
   *
   * **追われる側になることが、勝っていることの代償。** 情報の設計と同じ語彙で、
   * 遮蔽を無視して配る + 体を光らせる、を同じ道で通す。
   */
  leaderGlows: boolean
  /**
   * **攻める側と守る側に分かれるか** (TSNE)。
   *
   * 分かれる部屋では、持ち込める物 (RoomSpec の armory) が側ごとに違い、攻める側には
   * ステルスが付く。どちらの色が攻めるかは試合ごとに入れ替わる (match.ts の attack)。
   */
  sides: boolean
  /**
   * 眠らされてから起きるまで (秒)。普段は SLEEP_SECONDS (domain/player/stamina.ts)。
   *
   * **TSNE は長い** (本人 2026-10-19「stun からの復活はめっちゃ時間かかる。早く起きられたら
   * 先攻不利になっちゃうから」)。復活の無い部屋で、眠らせるのが攻める側の倒し方。すぐ起きると
   * 眠らせた手間が無駄になり、殺せる守る側だけが得をする。
   */
  sleepSeconds: number
}

/** 攻める側か守る側か。**色 (Team) とは別の問い** — 試合ごとに入れ替わる */
export type Side = 'attack' | 'defence'

/**
 * 持ち込める物。**側ごとの縛り** (TSNE)。
 *
 * 部屋の primaries / secondary と同じ意味で、support の枠も絞る。
 */
export interface Armory {
  primaries: readonly WeaponId[]
  secondary: WeaponId | null
  supports: readonly SupportId[]
}

/**
 * TSNE の眠りの長さ (秒)。**何もしなかったら 450 秒、めっちゃ頑張って 150 秒** (本人 2026-10-19)。
 * 1 ラウンドは 5 分なので、何もしなければそのラウンドは起きない
 */
export const TSNE_SLEEP_SECONDS = 450

export const MODES: Record<Mode, ModeSpec> = {
  DM: { id: 'DM', label: '個人戦', hostility: 'all', tickets: true, records: true, active: true, solo: false, teams: false, leaderGlows: true, sides: false, sleepSeconds: SLEEP_SECONDS },
  TDM: { id: 'TDM', label: 'チーム戦', hostility: 'team', tickets: true, records: true, active: true, solo: false, teams: true, leaderGlows: false, sides: false, sleepSeconds: SLEEP_SECONDS },
  /**
   * 潜入 / 防御 (2026-10-17 本人)。
   *
   *     攻める側  非殺傷の銃 + ナイフ + ステルス。support はデコイとロケーター
   *     守る側    殺傷の銃だけ。support は手榴弾とクレイモア
   *
   * **復活の回数は部屋で決める** (RoomSpec の lives、0 なら復活なし)。
   * 相手の側が全員倒れるか眠ったら勝ち。時間切れは守る側の勝ち。
   * 試合ごとに攻守が入れ替わる。
   */
  TSNE: { id: 'TSNE', label: '潜入 / 防御', hostility: 'team', tickets: true, records: true, active: true, solo: false, teams: true, leaderGlows: false, sides: true, sleepSeconds: TSNE_SLEEP_SECONDS },
  INT: { id: 'INT', label: '休憩', hostility: 'none', tickets: false, records: false, active: true, solo: true, teams: false, leaderGlows: false, sides: false, sleepSeconds: SLEEP_SECONDS },
  /**
   * 練習。**入る人は全員青**で、赤には棒立ちの的が並ぶ。
   *
   * 戦績に残さないのは、動かない相手を撃った数が記録に混ざると記録の意味が
   * 消えるため。ここで武器の距離感と当て方を確かめる。
   */
  PRACTICE: { id: 'PRACTICE', label: '練習', hostility: 'team', tickets: false, records: false, active: true, solo: true, teams: true, leaderGlows: false, sides: false, sleepSeconds: SLEEP_SECONDS },
}

/**
 * 部屋の設定。**部屋について決まっていることは全部ここ。**
 *
 * --- なぜ 1 つの表にしたか ---
 * ルール・ステージ・覚え書き・持ち込める銃を、部屋名を鍵にした表で別々に
 * 持っていた。部屋を 1 つ足すたびに直す場所が増えるし、**片方だけ直した部屋**
 * が作れてしまう。読む側も「その部屋の全部」を 1 回で引ける。
 *
 * 行き先は**部屋を作った人がこれを決める**こと (stage/index.ts の Rotation)。
 * そうなったら、この表は「作るときの既定値」に変わるだけで読む側は動かない。
 */
interface RoomSpec {
  mode: Mode
  /**
   * **手元でだけ開く部屋。** 公開しているサーバーでは入らせない。
   * 開けるのはサーバーが MGO2_LOCAL_ROOMS=1 で起きた時だけ (package.json の server)
   */
  local?: true
  /**
   * **一覧に出さない。** 練習 (/training) が自分だけの部屋として開くので、
   * 共有の部屋として並べる意味が無い (2026-10-08 本人)
   */
  unlisted?: true
  /** 回すステージ。**いまは全部 1 枚だけの fixed** */
  stages: Rotation
  /**
   * 部屋の覚え書き。一覧に出る。
   *
   * **ルールの名前だけでは伝わらないこと**を書く場所。同じ TDM でも、持ち込める
   * 銃を絞ってあれば別の遊びになる。
   */
  note?: string
  /**
   * 持ち込める主武器。**省けば全部。**
   *
   * 絞ると、その部屋は同じルールでも別の撃ち合いになる — 狙撃銃だけの部屋は
   * 「見つける前に見つけられたら負け」に寄る。
   *
   * 受け取った申告もこれで弾く (domain/player/equip.ts)。画面に出さないだけでは、
   * 送ってくる側を止められない。
   */
  /**
   * 持ち込める主武器。**省けば全部、空なら 1 挺も持たせない。**
   *
   * 空にするとナイフだけの部屋になる。副武器 (secondary) を null にするのと
   * 同じ形で、両方外せば手にあるのはナイフと箱だけ。
   */
  primaries?: readonly WeaponId[]
  /**
   * 副武器。**省けば拳銃、null なら持たない。**
   *
   * 外すと、詰められた時に残るのがナイフだけになる。狙撃銃の部屋で「間合いへ
   * 入られたら終わり」を成立させるのはこれ — 拳銃が残っていると、詰めた側が
   * 近距離の撃ち合いに勝てるとは限らなくなる。
   */
  secondary?: WeaponId | null
  /**
   * **側ごとに持ち込める物** (攻める側と守る側に分かれる部屋だけ)。
   *
   * あれば primaries / secondary より優先する。側の分からない時 (試合の外) は
   * primaries / secondary を見る。
   */
  armory?: Record<Side, Armory>
  /**
   * **1 人が復活できる回数。** 省けば何度でも、0 なら復活なし。
   *
   * 倒れた回数がこれを超えた人は、試合が終わるまでその場から動けない
   * (カメラだけ回せる)。様子を見て 1・2・3 と変える (2026-10-17 本人)。
   */
  lives?: number
}

/**
 * TSNE の持ち込み。**殺すか眠らせるかで側が分かれる。**
 *
 * 攻める側は非殺傷の銃とナイフだけ。眠らせてから近づいてナイフで仕留める。
 * 守る側は殺傷の銃だけで、麻酔は持てない。
 */
const TSNE_ARMORY: Record<Side, Armory> = {
  attack: {
    primaries: CHOICES.primary.filter(isTranquilizer),
    secondary: 'm9',
    supports: SUPPORTS.filter((id) => id !== 'grenade' && id !== 'claymore'),
  },
  defence: {
    primaries: CHOICES.primary.filter((id) => !isTranquilizer(id)),
    secondary: 'm1911',
    supports: ['grenade', 'claymore'],
  },
}

export const ROOMS: Record<RoomName, RoomSpec> = {
  alpha: { mode: 'DM', stages: only('city') },
  bravo: { mode: 'TDM', stages: only('city') },
  charlie: { mode: 'TSNE', stages: only('city'), armory: TSNE_ARMORY, lives: 0 },
  delta: {
    mode: 'TDM',
    stages: only('raft'),
    note: '砂部屋',
    /*
     * **狙撃銃だけ。** 副武器も外すので、詰められたらナイフしか残らない。
     *
     * 麻酔の狙撃銃も選べる。**殺すか眠らせるか**を同じ間合いの中で選べる
     * ようにすると、撃ち合いの外に手が 1 つ増える — 眠らせた相手は起こされ
     * るまで戻らないので、数の差は同じだけ作れる。
     */
    primaries: ['sniper', 'mosin'],
    secondary: null,
  },
  // 練習は更地。**遮蔽が無いので、外したのが腕なのか地形なのかが分かれる**
  echo: { mode: 'PRACTICE', stages: only('training') },
  // 検証場。段・窓・通路・階段・堀で動作を試す部屋。的も 2 つ置いてある。
  // 作る側の道具なので公開しない (2026-10-07 本人)
  foxtrot: { mode: 'PRACTICE', stages: only('lab'), local: true, unlisted: true },
}

/**
 * その部屋で持ち込める主武器。**省いてあれば全部。**
 *
 * 側に分かれる部屋は側ごとの縛り (armory) を見る。側が分からない時 (null) は部屋の値
 */
export function primariesOf(room: RoomName, side: Side | null = null): readonly WeaponId[] {
  const armory = side ? ROOMS[room].armory?.[side] : undefined
  return armory?.primaries ?? ROOMS[room].primaries ?? CHOICES.primary
}

/** その部屋の副武器。**省いてあれば拳銃、null なら持たない** */
export function secondaryOf(room: RoomName, side: Side | null = null): WeaponId | null {
  const armory = side ? ROOMS[room].armory?.[side] : undefined
  if (armory) return armory.secondary
  const spec = ROOMS[room]
  return spec.secondary === undefined ? 'm9' : spec.secondary
}

/**
 * その部屋で選べる副武器の一覧。**副武器を持たせない部屋は空。**
 *
 * 側に分かれる部屋は側の 1 挺だけ (攻める側に殺傷の拳銃を持たせない)。それ以外は全部から選べる
 */
export function secondariesOf(room: RoomName, side: Side | null = null): readonly WeaponId[] {
  const armory = side ? ROOMS[room].armory?.[side] : undefined
  if (armory) return armory.secondary === null ? [] : [armory.secondary]
  return secondaryOf(room) === null ? [] : CHOICES.secondary
}

/** その部屋で選べる support。**側に分かれない部屋は全部** */
export function supportsOf(room: RoomName, side: Side | null = null): readonly SupportId[] {
  const armory = side ? ROOMS[room].armory?.[side] : undefined
  return armory?.supports ?? SUPPORTS
}

/** 1 人が復活できる回数。**null は何度でも** */
export function livesOf(room: RoomName): number | null {
  return ROOMS[room].lives ?? null
}

/** その部屋を開いてよいか。手元だけの部屋 (local) は、手元で起きたサーバーでだけ開く */
export function isRoomOpen(room: RoomName, localRooms: boolean): boolean {
  return !ROOMS[room].local || localRooms
}

export function isRoomName(name: string): name is RoomName {
  return (ROOM_NAMES as readonly string[]).includes(name)
}

export function modeOf(room: RoomName): ModeSpec {
  return MODES[ROOMS[room].mode]
}

/**
 * 撃てる相手か。
 *
 * **陣営とは別の問い。** DM では同じ色でも敵で、休憩部屋では誰も敵ではない。
 * 弾も爆風もクレイモアもここを通す (docs/design.md の 3)。
 */
export function isHostile(mode: ModeSpec, from: MatchPlayer, to: MatchPlayer): boolean {
  if (from.id === to.id) return false
  if (mode.hostility === 'none') return false
  if (mode.hostility === 'all') return true
  return from.team !== to.team
}

/**
 * 味方か。**「敵ではない」とは限らない** — 休憩部屋では敵も味方も居ない。
 *
 * 足音や声が届く相手、クレイモアが見える相手がこれ。
 */
export function isFriendly(mode: ModeSpec, a: MatchPlayer, b: MatchPlayer): boolean {
  if (a.id === b.id) return true
  if (mode.hostility === 'all') return false
  return a.team === b.team
}
