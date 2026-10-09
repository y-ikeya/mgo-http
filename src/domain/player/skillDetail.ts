import { WEAPONS, type WeaponId } from '../item/weapons'
import {
  ALERT_AIM_RANGE,
  ALERT_AIM_WIDTH,
  ALERT_SECONDS,
  ALERT_SHOT_RADIUS,
  AWARENESS_RADIUS,
  MASTERY_OF,
  SKILLS,
  boxMoveScale,
  exposeSeconds,
  masteryJitterScale,
  masteryRecoilScale,
  masteryRecoveryScale,
  masteryReloadScale,
  masterySpreadScale,
  masterySwayScale,
  runnerScale,
  setupSpeedScale,
  stabSpeedScale,
  stunChargeSeconds,
  throwScale,
  type SkillId,
  type Skills,
} from './skill'

/**
 * スキルの効き目を**数字で**言う。支度の部屋 (ReadyRoom) が出す。
 *
 * 数字は**効き目の関数そのものを段ごとに呼んで**出す。説明を手で書くと、表を
 * 直した時に説明だけ古くなる (「速くなる」と書いてあるのに何 % かは分からない、
 * も同じ問題の裏返し)。ここは表を読むだけで、値は持たない。
 */
export interface SkillEffect {
  /** 何が変わるか (例: 走る速さ) */
  label: string
  /** 段ごとの値 (Lv1, Lv2, Lv3)。1 段のスキルは 1 つ */
  values: string[]
}

export interface SkillDetail {
  /** 一言で何をするスキルか */
  summary: string
  /** 段ごとの数字の行 */
  effects: SkillEffect[]
  /** 数字にならない効き目 (相手の AWARENESS に映らない、など) */
  notes: string[]
}

/** その段だけ取った時の Skills */
const at = (id: SkillId, level: number): Skills => ({ [id]: level }) as Skills
/** 段ごとに関数を呼ぶ */
const perLevel = (id: SkillId, fn: (skills: Skills) => number): number[] =>
  Array.from({ length: SKILLS[id].levels }, (_, i) => fn(at(id, i + 1)))

/** 倍率を「+10%」「-22%」に */
const percent = (scale: number): string => {
  const p = Math.round((scale - 1) * 100)
  return p === 0 ? '±0%' : `${p > 0 ? '+' : ''}${p}%`
}
/** 時間の倍率 (小さいほど速い) を「-22%」に。リロードは時間が縮むので負で出す */
const seconds = (value: number): string => `${Number.isInteger(value) ? value : value.toFixed(1)} 秒`

/** そのマスタリーが効く銃の名前 (AK47 / M9 …) */
function weaponsOf(id: SkillId): string {
  const names = (Object.keys(MASTERY_OF) as WeaponId[])
    .filter((weapon) => MASTERY_OF[weapon] === id)
    .map((weapon) => WEAPONS[weapon].kill)
  return [...new Set(names)].join(' / ')
}

/** 銃のマスタリーに共通の行。どの銃でも同じ表を引くので、代表の 1 挺で数字を出す */
function masteryEffects(id: SkillId): SkillEffect[] {
  const weapon = (Object.keys(MASTERY_OF) as WeaponId[]).find((w) => MASTERY_OF[w] === id)!
  const row = (label: string, fn: (skills: Skills, w: WeaponId) => number) => ({
    label,
    values: perLevel(id, (skills) => fn(skills, weapon)).map(percent),
  })
  return [
    row('弾の散らばり', masterySpreadScale),
    row('構えた時の照準の揺れ', masterySwayScale),
    row('撃った時の照準の震え', masteryJitterScale),
    row('反動の跳ね上がり', masteryRecoilScale),
    row('反動が戻る速さ', masteryRecoveryScale),
    row('装填・ボルト・ポンプの時間', masteryReloadScale),
  ]
}

export function skillDetail(id: SkillId): SkillDetail {
  switch (id) {
    case 'runner':
      return {
        summary: '走る速さが上がる。構えている間は効かない',
        effects: [{ label: '走る速さ', values: perLevel(id, runnerScale).map(percent) }],
        notes: [],
      }
    case 'boxMove':
      return {
        summary: 'ダンボールを被ったまま速く動ける',
        effects: [{ label: '箱で動く速さ', values: perLevel(id, boxMoveScale).map(percent) }],
        notes: ['FAST MOVE と重なる (掛け算)'],
      }
    case 'smgMastery':
    case 'rifleMastery':
    case 'sniperMastery':
    case 'shotgunMastery':
    case 'pistolMastery':
      return {
        summary: `${weaponsOf(id)} の扱いが上手くなる。拾った他の銃には効かない`,
        effects: masteryEffects(id),
        notes: [],
      }
    case 'throwing':
      return {
        summary: '手榴弾などを遠くへ投げられる',
        effects: [{ label: '投げる勢い', values: perLevel(id, throwScale).map(percent) }],
        notes: ['投げた手榴弾が相手の AWARENESS に映らない'],
      }
    case 'exposure':
      return {
        summary: '当てた相手が光り、壁越しに位置が分かる',
        effects: [{ label: '光っている長さ', values: perLevel(id, exposeSeconds).map(seconds) }],
        notes: ['倒さなくても、当てただけで光る'],
      }
    case 'targetAlert':
      return {
        summary: '自分を攻撃してきた相手の気配が分かる',
        effects: [
          {
            label: '気付く時',
            values: [
              '当てられた時',
              `近く (${ALERT_SHOT_RADIUS}m 以内) を撃たれた時`,
              `${ALERT_AIM_RANGE}m 以内で狙われた時`,
            ],
          },
          { label: '気配が出ている長さ', values: perLevel(id, () => ALERT_SECONDS).map(seconds) },
        ],
        notes: [`狙われた判定は照準の線の幅 ${ALERT_AIM_WIDTH}m。段が上がるほど早い段階で分かる`],
      }
    case 'awareness':
      return {
        summary: '近くに置かれた敵の物の気配が壁越しに分かる',
        effects: [{ label: '届く距離', values: [`${AWARENESS_RADIUS}m`] }],
        notes: ['クレイモア・DECOY・E LOCATOR・手榴弾が対象', '相手の TRAP MASTERY / THROWING MASTERY で隠される'],
      }
    case 'trapMastery':
      return {
        summary: '罠を置くのが速い',
        effects: [{ label: '置く速さ', values: perLevel(id, setupSpeedScale).map(percent) }],
        notes: ['置いた物 (クレイモア・DECOY・E LOCATOR) が相手の AWARENESS に映らない'],
      }
    case 'knifeMastery':
      return {
        summary: '刺すのが速く、スタンナイフの充電が早い',
        effects: [
          { label: '刺す速さ', values: perLevel(id, stabSpeedScale).map(percent) },
          {
            label: `スタンの充電 (無しで ${seconds(stunChargeSeconds({}))})`,
            values: perLevel(id, stunChargeSeconds).map(seconds),
          },
        ],
        notes: ['構えて R2 / X で眠らせる刺突。充電が満ちている時だけ'],
      }
  }
}
