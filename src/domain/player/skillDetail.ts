import { WEAPONS, type WeaponId } from '../item/weapons'
import { TSNE_SLEEP_SECONDS } from '../match/room'
import { SLEEP_SECONDS } from './stamina'
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
  patSeconds,
  masteryRecoilScale,
  masteryRecoveryScale,
  masteryReloadScale,
  masterySpreadScale,
  masterySwayScale,
  runnerScale,
  setupSpeedScale,
  sleepScale,
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

/** 説明の言語。画面の側が src/i18n.ts の lang を渡す (domain は画面の言語を知らない) */
export type DetailLang = 'ja' | 'en'

/** 倍率を「+10%」「-22%」に */
const percent = (scale: number): string => {
  const p = Math.round((scale - 1) * 100)
  return p === 0 ? '±0%' : `${p > 0 ? '+' : ''}${p}%`
}

/** そのマスタリーが効く銃の名前 (AK47 / M9 …) */
function weaponsOf(id: SkillId): string {
  const names = (Object.keys(MASTERY_OF) as WeaponId[])
    .filter((weapon) => MASTERY_OF[weapon] === id)
    .map((weapon) => WEAPONS[weapon].kill)
  return [...new Set(names)].join(' / ')
}

/**
 * 効き目を言う。**文言は日本語と英語を並べて持つ** — 数字はどちらも同じ関数から出す。
 * 片方だけ直して食い違わないよう、同じ行に並べてある
 */
export function skillDetail(id: SkillId, lang: DetailLang = 'ja'): SkillDetail {
  const tr = (ja: string, en: string): string => (lang === 'en' ? en : ja)
  const seconds = (value: number): string => {
    const n = Number.isInteger(value) ? String(value) : value.toFixed(1)
    return tr(`${n} 秒`, `${n} s`)
  }
  /** 銃のマスタリーに共通の行。どの銃でも同じ表を引くので、代表の 1 挺で数字を出す */
  const masteryEffects = (): SkillEffect[] => {
    const weapon = (Object.keys(MASTERY_OF) as WeaponId[]).find((w) => MASTERY_OF[w] === id)!
    const row = (label: string, fn: (skills: Skills, w: WeaponId) => number) => ({
      label,
      values: perLevel(id, (skills) => fn(skills, weapon)).map(percent),
    })
    return [
      row(tr('弾の散らばり', 'Bullet spread'), masterySpreadScale),
      row(tr('構えた時の照準の揺れ', 'Aim sway'), masterySwayScale),
      row(tr('撃った時の照準の震え', 'Aim shake when firing'), masteryJitterScale),
      row(tr('反動の跳ね上がり', 'Recoil kick'), masteryRecoilScale),
      row(tr('反動が戻る速さ', 'Recoil recovery'), masteryRecoveryScale),
      row(tr('装填・ボルト・ポンプの時間', 'Reload / bolt / pump time'), masteryReloadScale),
    ]
  }
  switch (id) {
    case 'runner':
      return {
        summary: tr('走る速さが上がる。構えている間は効かない', 'Run faster. No effect while aiming'),
        effects: [{ label: tr('走る速さ', 'Run speed'), values: perLevel(id, runnerScale).map(percent) }],
        notes: [],
      }
    case 'boxMove':
      return {
        summary: tr('ダンボールを被ったまま速く動ける', 'Move faster while wearing the cardboard box'),
        effects: [{ label: tr('箱で動く速さ', 'Box move speed'), values: perLevel(id, boxMoveScale).map(percent) }],
        notes: [],
      }
    case 'smgMastery':
    case 'rifleMastery':
    case 'sniperMastery':
    case 'shotgunMastery':
    case 'pistolMastery':
      return {
        summary: tr(
          `${weaponsOf(id)} の扱いが上手くなる。拾った他の銃には効かない`,
          `Better handling of the ${weaponsOf(id)}. No effect on other guns you pick up`,
        ),
        effects: masteryEffects(),
        notes: [],
      }
    case 'throwing':
      return {
        summary: tr('手榴弾などを遠くへ投げられる', 'Throw grenades and other items farther'),
        effects: [{ label: tr('投げる勢い', 'Throw power'), values: perLevel(id, throwScale).map(percent) }],
        notes: [tr('投げた手榴弾が相手の AWARENESS に映らない', "Your grenades don't show on enemy AWARENESS")],
      }
    case 'exposure':
      return {
        summary: tr('当てた相手が光り、壁越しに位置が分かる', 'Enemies you hit glow, revealing them through walls'),
        effects: [{ label: tr('光っている長さ', 'Glow time'), values: perLevel(id, exposeSeconds).map(seconds) }],
        notes: [tr('倒さなくても、当てただけで光る', 'A hit is enough — no kill needed')],
      }
    case 'targetAlert':
      return {
        summary: tr('自分を攻撃してきた相手の気配が分かる', 'Sense enemies attacking you'),
        effects: [
          {
            label: tr('気付く時', 'Triggered when'),
            values: [
              tr('当てられた時', "You're hit"),
              tr(`近く (${ALERT_SHOT_RADIUS}m 以内) を撃たれた時`, `Shots land near you (within ${ALERT_SHOT_RADIUS}m)`),
              tr(`${ALERT_AIM_RANGE}m 以内で狙われた時`, `You're aimed at within ${ALERT_AIM_RANGE}m`),
            ],
          },
          { label: tr('気配が出ている長さ', 'Alert time'), values: perLevel(id, () => ALERT_SECONDS).map(seconds) },
        ],
        notes: [
          tr(
            `狙われた判定は照準の線の幅 ${ALERT_AIM_WIDTH}m。段が上がるほど早い段階で分かる`,
            `"Aimed at" uses a ${ALERT_AIM_WIDTH}m-wide line of sight. Higher levels warn you earlier`,
          ),
        ],
      }
    case 'awareness':
      return {
        summary: tr('近くに置かれた敵の物の気配が壁越しに分かる', 'Sense nearby enemy devices through walls'),
        effects: [{ label: tr('届く距離', 'Range'), values: [`${AWARENESS_RADIUS}m`] }],
        notes: [
          tr('クレイモア・DECOY・E LOCATOR・手榴弾が対象', 'Detects claymores, DECOYs, E LOCATORs and grenades'),
          tr('相手の TRAP MASTERY / THROWING MASTERY で隠される', 'Hidden by enemy TRAP MASTERY / THROWING MASTERY'),
        ],
      }
    case 'trapMastery':
      return {
        summary: tr('罠を置くのが速い', 'Place traps faster'),
        effects: [{ label: tr('置く速さ', 'Placing speed'), values: perLevel(id, setupSpeedScale).map(percent) }],
        notes: [
          tr(
            '置いた物 (クレイモア・DECOY・E LOCATOR) が相手の AWARENESS に映らない',
            "Your devices (claymore, DECOY, E LOCATOR) don't show on enemy AWARENESS",
          ),
        ],
      }
    case 'knifeMastery':
      return {
        summary: tr('刺すのが速く、スタンナイフの充電が早い', 'Stab faster, and the stun knife charges faster'),
        effects: [
          { label: tr('刺す速さ', 'Stab speed'), values: perLevel(id, stabSpeedScale).map(percent) },
          {
            label: tr(
              `スタンの充電 (無しで ${seconds(stunChargeSeconds({}))})`,
              `Stun charge (${seconds(stunChargeSeconds({}))} without)`,
            ),
            values: perLevel(id, stunChargeSeconds).map(seconds),
          },
        ],
        notes: [
          tr(
            '構えて R2 / 右クリック (構えは Shift) で眠らせる刺突。充電が満ちている時だけ',
            'Aim and press R2 / right-click (aim with Shift) for a sleep stab. Only when fully charged',
          ),
        ],
      }
    case 'quickRecovery':
      return {
        summary: tr(
          '眠らされても早く起き、眠っている人を叩いて起こすのが強い',
          'Wake up sooner when put to sleep, and wake sleepers faster by patting them',
        ),
        effects: [
          {
            label: tr(
              `自分の眠り (無しで ${SLEEP_SECONDS} 秒、TSNE は ${TSNE_SLEEP_SECONDS} 秒)`,
              `Your sleep (${SLEEP_SECONDS} s without, ${TSNE_SLEEP_SECONDS} s in TSNE)`,
            ),
            values: perLevel(id, sleepScale).map(
              (v) => `${seconds(Math.round(v * SLEEP_SECONDS))} / ${seconds(Math.round(v * TSNE_SLEEP_SECONDS))}`,
            ),
          },
          {
            label: tr(`叩いて縮める (無しで ${patSeconds({})} 秒)`, `Pat to wake (${patSeconds({})} s without)`),
            values: perLevel(id, patSeconds).map((v) => (Number.isFinite(v) ? seconds(v) : tr('1 回で起こす', 'One pat wakes'))),
          },
        ],
        notes: [
          tr(
            'しゃがんで、眠っている人の傍で G / △。味方でも敵でも起こせる',
            'Crouch next to a sleeper and press G / △. Works on allies and enemies',
          ),
        ],
      }
  }
}
