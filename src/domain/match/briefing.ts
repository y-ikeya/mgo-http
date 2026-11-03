import { CAP_COUNT_MS } from './capture'
import { MODES, livesOf, matchMsOf, type Mode, type RoomName } from './room'

/**
 * **試合の前に出すルールの説明** (2026-11-03 本人「ゲーム自体の説明 (1,2 枚) → OK で飛ばしたら → standby」)。
 *
 * --- 部屋ではなく試合の持ち物 ---
 * 部屋によってはルールを試合ごとにランダムに回す (本人「room によってはランダム rule で match を
 * ローテする」)。なので**その試合のモード** (match の報せの mode) から引く。部屋から引くのは
 * 時間・復活のような、いまは部屋が決めている数字だけ。
 *
 * --- 数字は書かない ---
 * 文に「20」「5 分」と書くと、値を変えた時に説明だけ古くなる。実際の値を差し込む
 */
export interface BriefingPage {
  title: string
  lines: string[]
}

export interface BriefingFacts {
  room: RoomName
  /** 始まる時の残機 (支度の間の match の blue)。個人戦は部屋で 1 つ */
  tickets: number
}

export function briefingOf(mode: Mode, facts: BriefingFacts): BriefingPage[] {
  const minutes = Math.round(matchMsOf(facts.room) / 60_000)
  const label = MODES[mode].label
  const rule = ((): string[] | null => {
    switch (mode) {
      case 'DM':
        return [
          '自分以外は全員敵。',
          `残機は部屋で ${facts.tickets} を共有。誰が倒されても 1 減り、0 で試合終了。`,
          `制限時間 ${minutes} 分。終わった時に一番多く倒した人の勝ち。`,
          '1 位の人は体が光り、居場所が全員に知られる。',
        ]
      case 'TDM':
        return [
          `チケット制。各陣営 ${facts.tickets}。味方が倒されるたびに 1 減る (死因は問わない)。`,
          '相手のチケットを 0 にしたら勝ち。',
          `制限時間 ${minutes} 分。時間切れはチケットを多く残している方の勝ち。`,
        ]
      case 'TSNE': {
        const lives = livesOf(facts.room)
        return [
          '攻める側と守る側に分かれる。1 試合は先攻と後攻の 2 ラウンドで、ラウンドごとに入れ替わる。',
          '攻める側: 守る側の陣地にあるターゲットを自陣の基地まで運ぶか、守る側を全員倒す・眠らせたら勝ち。',
          `守る側: 時間切れ (1 ラウンド ${minutes} 分) まで守るか、攻める側を全員倒す・眠らせたら勝ち。`,
          lives === null ? '復活は何度でも。' : lives === 0 ? '復活なし。' : `復活は 1 人 ${lives} 回まで。`,
        ]
      }
      case 'CAP':
        return [
          'ターゲット 1 つを両陣営で取り合う。',
          `持ったまま自陣の設置ポイント (相手の陣地の近く) に居る間だけ、自陣のカウント ${CAP_COUNT_MS / 1000} 秒が減る。`,
          `先に 0 にした方の勝ち。制限時間 ${minutes} 分、時間切れは多く減らした方、並んだらサドンデス。`,
          '復活は何度でも。ただし倒されるたびに倒れたままの時間が延びる。',
        ]
      default:
        // 練習・休憩は説明を出さない
        return null
    }
  })()
  if (!rule) return []
  // **1 枚だけ。** 2 枚目 (そのモードならではの手・部屋の持ち込み) は出さない
  // (2026-11-03 本人「全部の rule で 2 枚目はいらないわ」)
  return [{ title: label, lines: rule }]
}
