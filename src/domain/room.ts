import type { Player } from './player'

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

/** 部屋の割り当て。**変えるならここ 1 か所** */
export const ROOM_MODE: Record<RoomName, Mode> = {
  alpha: 'DM',
  bravo: 'TDM',
  charlie: 'TSNE',
  delta: 'INT',
  echo: 'PRACTICE',
}

export function isRoomName(name: string): name is RoomName {
  return (ROOM_NAMES as readonly string[]).includes(name)
}

export function modeOf(room: RoomName): ModeSpec {
  return MODES[ROOM_MODE[room]]
}

/**
 * 撃てる相手か。
 *
 * **陣営とは別の問い。** DM では同じ色でも敵で、休憩部屋では誰も敵ではない。
 * 弾も爆風もクレイモアもここを通す (docs/design.md の 3)。
 */
export function isHostile(mode: ModeSpec, from: Player, to: Player): boolean {
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
export function isFriendly(mode: ModeSpec, a: Player, b: Player): boolean {
  if (a.id === b.id) return true
  if (mode.hostility === 'all') return false
  return a.team === b.team
}
