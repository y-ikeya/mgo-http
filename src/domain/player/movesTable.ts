// 書き出した物。手で直さない。**正はスプレッドシート** — 直したら `bun tools/moves_sheet.ts import`
import type { Move, Rule } from './moves'

export const MOVE_RULES: Record<Move, Rule> = {
  /** 転がる。伏せからは起き上がる一手を挟ませる。箱を落とされた直後は棒立ち。構えている間は転がらない (構えて後ろなら一歩下がる) */
  roll: { needs: ['onGround'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'boxed', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'aiming', 'cqc', 'stepping'] },
  /** 跳び越える / 乗る。転がりと同じ縛り */
  vault: { needs: ['onGround'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'boxed', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'cqc', 'stepping'] },
  /** 縁に掴まる。歩いて縁から出たときに掴まる。転がり・跳び越え・梯子・水・伏せからは落ちる */
  hang: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'inWater', 'cqc', 'stepping'] },
  /** 伏せる。刺突は全身の型なので、伏せに入る型と同時には流せない */
  prone: { needs: ['onGround'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'stabbing', 'vaulting', 'hanging', 'onLadder', 'prone', 'cqc', 'stepping'] },
  /** しゃがむ (切り替え)。倒れ・箱・伏せは呼ぶ側で別の動作 (起きる・脱ぐ・起き上がる) に振る */
  crouch: { needs: ['onGround'], not: ['dead', 'standingUp', 'trapped', 'saluting', 'vaulting', 'hanging', 'cqc', 'stepping'] },
  /** ナイフで刺す。伏せたままでも刺せる (prone_stab) */
  stab: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'boxed', 'bumping', 'saluting', 'rolling', 'vaulting', 'hanging', 'onLadder', 'cqc', 'stepping'] },
  /** 敬礼。構えている間はしない */
  salute: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'bumping', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'aiming', 'cqc'] },
  /** 梯子を掴む。受け身の最中は掴めない */
  ladder: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'bumping', 'saluting', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'landing', 'cqc'] },
  /** ダンボールを被る。箱はしゃがんだ体に被せてあるので伏せたままは被れない */
  box: { needs: ['onGround'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'cqc', 'stepping'] },
  /** 構える。全身の型の最中は構えの上半身を乗せられない */
  aim: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'saluting', 'rolling', 'vaulting', 'hanging', 'cqc', 'stepping'] },
  /** 投げる。梯子と箱は両手が塞がっている。転がりは全身の型 */
  throw: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'rolling', 'vaulting', 'hanging', 'onLadder', 'cqc'] },
  /** 置く (クレイモア)。投げると同じ */
  place: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'rolling', 'vaulting', 'hanging', 'onLadder', 'cqc'] },
  /** 眠らされる。倒れている体には効かせない (もう倒れている) */
  sleep: { needs: [], not: ['dead', 'downed'] },
  /** もがく。眠っている間だけ */
  struggle: { needs: ['sleeping'], not: ['dead', 'downed'] },
  /** 叩いて起こす。しゃがんで、構えずに */
  pat: { needs: ['onGround', 'crouching'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'boxed', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'landing', 'inWater', 'aiming', 'cqc', 'stepping'] },
  /** CQC を掛ける。立って、構えずに。手に何を持っているか (長物では掛けられない) は持ち物の側 */
  cqc: { needs: ['onGround'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'boxed', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'crouching', 'landing', 'inWater', 'aiming', 'cqc', 'stepping'] },
  /** 持ち替える。CQC の最中はできない (投げている間に長物へ替えると倒した相手へすぐ構えられる) */
  swap: { needs: [], not: ['dead', 'trapped', 'cqc'] },
  /** 撃つ。体の側の条件だけ。弾・引き金・装填中・ナイフを振っている間は持ち物の側。爆風で倒れている間は撃てる (伏せ撃ち) */
  fire: { needs: ['aiming'], not: ['dead', 'trapped', 'stabbing', 'rolling', 'vaulting', 'hanging', 'crawling', 'landing', 'cqc'] },
  /** 弾倉を替える。体の側の条件だけ。弾数・ボルト操作中・ナイフを振っている間は Game の側。始めた後にこれらになったらやめる */
  reload: { needs: [], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'boxed', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'proneShifting', 'crawling', 'landing', 'inWater', 'cqc', 'stepping'] },
  /** 一歩下がる。構えて後ろを押しながら転がりの指。しゃがんでいればしゃがみの型。伏せ・箱からは出ない */
  step: { needs: ['onGround', 'aiming'], not: ['dead', 'downed', 'standingUp', 'sleeping', 'trapped', 'flinching', 'boxed', 'bumping', 'saluting', 'stabbing', 'rolling', 'vaulting', 'hanging', 'onLadder', 'prone', 'landing', 'inWater', 'cqc', 'stepping'] },
}
