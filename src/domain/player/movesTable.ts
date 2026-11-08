// 書き出した物。手で直さない。**正はスプレッドシートの軸のタブ** — 直したら `bun tools/moves_sheet.ts import`
// 軸ごとに「その値ならできる」並び。軸の中は どれか、軸どうしは 全部。書いていない軸は関係ない
import type { Move, Rule } from './moves'

export const MOVE_RULES: Record<Move, Rule> = {
  /** 転がる。構えている間は転がらない (構えて後ろなら一歩下がる) */
  roll: { posture: ['stand', 'crouch'], action: ['none'], down: ['none'], hand: ['relaxed'] },
  /** 跳び越える / 乗る */
  vault: { posture: ['stand', 'crouch'], action: ['none'], down: ['none'], hand: ['relaxed'] },
  /** 縁に掴まる。歩いて縁から出た時。構えながらでも掴まる */
  hang: { posture: ['stand', 'crouch'], action: ['none'], down: ['none'] },
  /** 伏せる (伏せ始める)。押すと「伏せへの出入り」を通って伏せになる */
  prone: { posture: ['stand', 'crouch'], action: ['none'], down: ['none'], hand: ['relaxed'] },
  /** 起き上がる (伏せから)。Space 短押し。頭上の余裕は地形に聞く (表の外) 這いながらでも起き上がれる (2026-11-08 本人「移動ボタンと立ち上がりを両方押すと立ち上がりがキャンセルされる」) */
  rise: { posture: ['prone'], action: ['none', 'crawl'], down: ['none'] },
  /** しゃがむ (立ち⇄しゃがみ)。Space 短押し。刺しながらしゃがめる */
  crouch: { posture: ['stand', 'crouch'], action: ['none', 'stab'], down: ['none'] },
  /** 立ち直る (倒れから)。Space 短押し */
  standUp: { action: ['none'], down: ['downed'] },
  /** 箱を被る */
  box: { posture: ['stand', 'crouch'], action: ['none', 'stab'], down: ['none'] },
  /** 箱を脱ぐ。Space 短押し / 持ち替え */
  unbox: { posture: ['box'], action: ['none'], down: ['none'] },
  /** 梯子を掴む */
  ladder: { posture: ['stand', 'crouch', 'air', 'water'], action: ['none'], down: ['none'] },
  /** 構える。倒れている間も構えられる (伏せ撃ち) 刺している間も構えたまま (下を刺すのに見下ろした向きを保つ。2026-11-08) */
  aim: { posture: ['stand', 'crouch', 'prone', 'air', 'water'], action: ['none', 'proneShift', 'crawl', 'stab', 'landing'], down: ['none', 'downed'] },
  /** 撃つ。弾・引き金・装填中・ボルトは持ち物の側 (表の外) */
  fire: { posture: ['stand', 'crouch', 'prone', 'air', 'water'], action: ['none', 'proneShift'], down: ['none', 'downed'], hand: ['aiming'] },
  /** リロードする。始めた後にできない状態になったらやめる。弾数・ボルトは表の外 */
  reload: { posture: ['stand', 'crouch', 'prone', 'air'], action: ['none'], down: ['none'] },
  /** ナイフで刺す。伏せたままでも刺せる (prone_stab) */
  stab: { posture: ['stand', 'crouch', 'prone', 'air', 'water'], action: ['none', 'crawl'], down: ['none'] },
  /** 投げる。箱・梯子は両手が塞がっている */
  throw: { posture: ['stand', 'crouch', 'prone', 'air', 'water'], action: ['none', 'crawl', 'landing'], down: ['none'] },
  /** 置く (クレイモア)。投げると同じ */
  place: { posture: ['stand', 'crouch', 'prone', 'air', 'water'], action: ['none', 'crawl', 'landing'], down: ['none'] },
  /** CQC を掛ける。長物では掛けられない (持ち物の側) */
  cqc: { posture: ['stand'], action: ['none'], down: ['none'], hand: ['relaxed'] },
  /** 持ち替える。CQC の間に長物へ替えて、倒した相手へすぐ構えるのを塞ぐ */
  swap: { action: ['none', 'roll', 'vault', 'proneShift', 'crawl', 'stab', 'step', 'landing', 'salute', 'bump'], down: ['none', 'downed', 'standingUp', 'sleep'] },
  /** 一歩下がる。構えて後ろ + 転がりの指。しゃがみならしゃがみの型 */
  step: { posture: ['stand', 'crouch'], action: ['none'], down: ['none'], hand: ['aiming'] },
  /** 敬礼。しゃがみならしゃがんだ合図 */
  salute: { posture: ['stand', 'crouch'], action: ['none'], down: ['none'], hand: ['relaxed'] },
  /** 叩いて起こす */
  pat: { posture: ['crouch'], action: ['none'], down: ['none'], hand: ['relaxed'] },
  /** もがく。眠っている間だけ */
  struggle: { down: ['sleep'] },
}
