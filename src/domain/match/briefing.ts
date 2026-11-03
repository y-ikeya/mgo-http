import { CAP_COUNT_MS } from './capture'
import { livesOf, matchMsOf, type Mode, type RoomName } from './room'

/**
 * **試合の前に出すルールの説明** (2026-11-03 本人「ゲーム自体の説明 (1,2 枚) → OK で飛ばしたら → standby」)。
 * 1 枚だけ (本人「全部の rule で 2 枚目はいらないわ」)。
 *
 * --- 部屋ではなく試合の持ち物 ---
 * 部屋によってはルールを試合ごとにランダムに回す (本人「room によってはランダム rule で match を
 * ローテする」)。なので**その試合のモード** (match の報せの mode) から引く。部屋から引くのは
 * 時間・復活のような、いまは部屋が決めている数字だけ。
 *
 * --- ここは中身の数字だけ ---
 * 文は言語ごとに i18n.ts (rules.*)、組むのは ui/Briefing.tsx。文に「20」「5 分」と書くと、
 * 値を変えた時に説明だけ古くなるので、実際の値をここで集めて差し込む
 */
export type BriefedMode = 'DM' | 'TDM' | 'TSNE' | 'CAP'

export interface Briefing {
  mode: BriefedMode
  /** 見出し。MGO2 の正式名で、どの言語でも英語 (2026-11-03 本人) */
  title: string
  /** 始まる時の残機。個人戦は部屋で 1 つ */
  tickets: number
  /** 制限時間 (分)。TSNE は 1 ラウンドの長さ */
  minutes: number
  /** 1 人が復活できる回数。null は何度でも */
  lives: number | null
  /** CAP のカウント (秒) */
  capSeconds: number
}

const TITLES: Record<BriefedMode, string> = {
  DM: 'Death Match',
  TDM: 'Team Death Match',
  TSNE: 'Team Sneaking',
  CAP: 'Capture',
}

function isBriefed(mode: Mode): mode is BriefedMode {
  return mode in TITLES
}

export interface BriefingFacts {
  room: RoomName
  /** 始まる時の残機 (支度の間の match の blue) */
  tickets: number
}

/** その試合の説明。練習・休憩は出さない (null) */
export function briefingOf(mode: Mode, facts: BriefingFacts): Briefing | null {
  if (!isBriefed(mode)) return null
  return {
    mode,
    title: TITLES[mode],
    tickets: facts.tickets,
    minutes: Math.round(matchMsOf(facts.room) / 60_000),
    lives: livesOf(facts.room),
    capSeconds: CAP_COUNT_MS / 1000,
  }
}
