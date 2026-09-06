import type { MatchPlayer } from '../player/player'
import { only, type Rotation } from '../stage'
import { CHOICES, type WeaponId } from '../item/weapons'

/**
 * 部屋とルール。
 *
 * **部屋ごとにルールを固定する。** 部屋を立てるときに選ばせる形にはしない —
 * 人が少ないうちは「空の部屋が並ぶ一覧」になるだけで、入った先に誰も居ない。
 * 数を絞って固定すれば、入った先に必ず誰かが居る確率が上がる。
 *
 * 名前と割り当ては docs/design.md の 2。
 */
export const ROOM_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo'] as const

export type RoomName = (typeof ROOM_NAMES)[number]

/**
 * ルール。MGO2 の略称をそのまま使う (PRACTICE だけはこちらで足したもの)。
 *
 *     DM        全員が敵の個人戦
 *     TDM       2 陣営。倒すと相手の残機が減る
 *     TSNE      潜入 / 防御。**非殺傷武器が要る**ので、まだ開けていない
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
}

export const MODES: Record<Mode, ModeSpec> = {
  DM: { id: 'DM', label: '個人戦', hostility: 'all', tickets: true, records: true, active: true, solo: false, teams: false, leaderGlows: true },
  TDM: { id: 'TDM', label: 'チーム戦', hostility: 'team', tickets: true, records: true, active: true, solo: false, teams: true, leaderGlows: false },
  /**
   * 潜入側はナイフ以外の殺傷武器を持てず、防御側は非殺傷武器を持てない。
   * **その縛りがルールの核**なので、麻酔銃とスタングレネードが無いと成立しない。
   * 枠は残す — 何を作れば開くかが分かる形にしておきたい。
   */
  TSNE: { id: 'TSNE', label: '潜入 / 防御', hostility: 'team', tickets: true, records: true, active: false, solo: false, teams: true, leaderGlows: false },
  INT: { id: 'INT', label: '休憩', hostility: 'none', tickets: false, records: false, active: true, solo: true, teams: false, leaderGlows: false },
  /**
   * 練習。**入る人は全員青**で、赤には棒立ちの的が並ぶ。
   *
   * 戦績に残さないのは、動かない相手を撃った数が記録に混ざると記録の意味が
   * 消えるため。ここで武器の距離感と当て方を確かめる。
   */
  PRACTICE: { id: 'PRACTICE', label: '練習', hostility: 'team', tickets: false, records: false, active: true, solo: true, teams: true, leaderGlows: false },
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
}

export const ROOMS: Record<RoomName, RoomSpec> = {
  alpha: { mode: 'DM', stages: only('mall') },
  bravo: { mode: 'TDM', stages: only('mall') },
  charlie: { mode: 'TSNE', stages: only('mall') },
  delta: {
    mode: 'TDM',
    stages: only('raft'),
    note: '砂部屋',
    // **狙撃銃だけ。** 副武器も外すので、詰められたらナイフしか残らない
    primaries: ['sniper'],
    secondary: null,
  },
  // 練習は更地。**遮蔽が無いので、外したのが腕なのか地形なのかが分かれる**
  echo: { mode: 'PRACTICE', stages: only('training') },
}

/** その部屋で持ち込める主武器。**省いてあれば全部** */
export function primariesOf(room: RoomName): readonly WeaponId[] {
  return ROOMS[room].primaries ?? CHOICES.primary
}

/** その部屋の副武器。**省いてあれば拳銃、null なら持たない** */
export function secondaryOf(room: RoomName): WeaponId | null {
  const spec = ROOMS[room]
  return spec.secondary === undefined ? 'm9' : spec.secondary
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
