/**
 * スキル。**4 コストの予算で買う。**
 *
 * --- 枠ではなく予算 ---
 * 「いくつ取れるか」ではなく「合計いくらまで」。安いスキルを複数取るか、高い
 * スキルを 1 つ取るかを選ぶ形にしておくと、**強いスキルを重くする**ことで
 * 釣り合いが取れる (docs/design.md の 3)。枠だと強さの差を値段で表せない。
 *
 * レベルも同じ予算から買う。**段がそのまま値段** — Lv3 は 3 コスト。
 *
 * --- 習熟度はまだ無い ---
 * MGO2 では戦闘中の行動で段が上がる。いまは**全部の段が最初から買える**
 * (maxLevelOf が素通し)。門だけ先に置いてあるので、進行を入れるときに
 * 呼び出し側を探し回らずに済む。
 *
 * 進行を入れるときも、**DB に持つのは生の数だけ**にする — 走った距離、光らせた
 * 回数。段はここで導く。SQL にも式を書くと画面ごとに違う段が出る
 * (match/scoring.ts の Lv と同じ判断)。
 *
 * --- 効果はすべて既存の値の倍率 ---
 * 新しい仕組みを持ち込まない。散布も装填もダンボールの速さも、既に摘みがある。
 * **スキルはその摘みを回すだけ**にしておくと、スキルを外したときの挙動が
 * 「素の値」で自明になる。
 */

import type { Phase } from '../match/match'
import type { ModeSpec } from '../match/room'
import type { WeaponId } from '../item/weapons'

export type SkillId =
  | 'runner'
  | 'boxMove'
  | 'smgMastery'
  | 'rifleMastery'
  | 'sniperMastery'
  | 'shotgunMastery'
  | 'pistolMastery'
  | 'throwing'
  | 'exposure'

/** 取れるレベル。0 は「取っていない」 */
type SkillLevel = 1 | 2 | 3

/** 1 人が持てる合計 (docs/design.md の 3) */
export const SKILL_BUDGET = 4

interface SkillSpec {
  id: SkillId
  label: string
  hint: string
}

/**
 * スキルの表。**値段は持たない** — 段がそのまま値段だから (costOf)。
 */
export const SKILLS: Record<SkillId, SkillSpec> = {
  runner: {
    id: 'runner',
    label: 'FAST MOVE',
    hint: '走るのが速くなる。**持っている物の重さと掛け合わさる**',
  },
  boxMove: {
    id: 'boxMove',
    label: 'CBOX MOVE',
    hint: 'ダンボールを被ったまま動ける。**頭の高さは下がったまま**',
  },
  smgMastery: {
    id: 'smgMastery',
    label: 'SMG MASTERY',
    hint: 'P90 の散布が締まり、装填が速い',
  },
  rifleMastery: {
    id: 'rifleMastery',
    label: 'AR MASTERY',
    hint: 'AK47 の散布が締まり、装填が速い',
  },
  sniperMastery: {
    id: 'sniperMastery',
    label: 'SNIPER MASTERY',
    hint: 'XM2010 の散布が締まり、装填が速い',
  },
  shotgunMastery: {
    id: 'shotgunMastery',
    label: 'SG MASTERY',
    hint: 'M870 の**ポンプと装填が速い**。粒の散りは変わらない',
  },
  pistolMastery: {
    id: 'pistolMastery',
    label: 'HANDGUN MASTERY',
    hint: 'M9 の散布が締まり、装填が速い。**拳銃は全員が持っている**',
  },
  throwing: {
    id: 'throwing',
    label: 'THROWING MASTERY',
    hint: '遠くへ投げられる',
  },
  exposure: {
    id: 'exposure',
    label: 'ENEMY EXPOSURE',
    hint: '当てた相手が数秒光る。**倒さなくても情報になる**',
  },
}

/**
 * その銃の mastery。
 *
 * **主武器を決めることが、スキルの 1 枠を決めることになる。** 予算 4 では
 * 2 挺を極められないので、落ちている銃を拾っても**その銃は素のまま**。
 * 武器の棲み分け (間合い) に、人の側の得意が重なる。
 */
export const MASTERY_OF: Record<WeaponId, SkillId> = {
  smg: 'smgMastery',
  rifle: 'rifleMastery',
  sniper: 'sniperMastery',
  shotgun: 'shotgunMastery',
  m9: 'pistolMastery',
  m1911: 'pistolMastery',
}

/** 取ったスキルと、その段 */
export type Skills = Partial<Record<SkillId, SkillLevel>>

/**
 * 合計いくら使っているか。**段がそのまま値段。**
 *
 * Lv1 が 1、Lv3 が 3。表で持たずにドメインルールとして書いてあるのは、**そう決めたから**
 * であって、たまたま全部同じ値だからではない。段の重さが値段になっていれば、
 * 「Lv3 を 1 つ」と「Lv1 を 3 つ」が同じ買い物になる。
 *
 *     予算 4 で買えるもの
 *       Lv3 + Lv1        極める + 1 つ齧る
 *       Lv2 + Lv2        2 つを半端に
 *       Lv2 + Lv1 + Lv1
 *       Lv1 × 4          浅く広く
 *
 * 特定のスキルだけ重くしたくなったら、ここが破る場所。
 */
export function costOf(skills: Skills): number {
  let total = 0
  for (const id of Object.keys(SKILLS) as SkillId[]) total += skills[id] ?? 0
  return total
}

/**
 * その人が使える上限。
 *
 * **いまは全部解放。** 習熟度 (戦闘中の行動で上がる) を入れるまでの素通し。
 * ここを通しておくと、締めるときに書き換えるのがこの 1 か所で済む。
 */
function maxLevelOf(_id: SkillId): SkillLevel {
  return 3
}

/**
 * いま選び直せるか。**試合が始まる前だけ。**
 *
 * --- 装備とは粒度が違う ---
 *
 *     装備 (主武器・支援)  1 つの命ごとに選び直せる
 *     スキル                **1 試合に 1 度**。始まったら固定
 *
 * 倒されるたびに組み替えられると、**相手に合わせて後出しする**ゲームになる。
 * 狙撃銃で待っている相手を見てから SNIPER MASTERY を外す、が成立してしまうと、
 * 予算 4 で何を諦めたかという選択が意味を失う。**試合の間ずっとその選択を
 * 背負う**から、役割になる。
 *
 * 決着 (over) と次の支度 (waiting / countdown) の間は開く。**試合をまたげば
 * 組み替えてよい** — 縛るのは 1 試合の中だけ。
 *
 * --- 途中参加した人 ---
 * 窓が閉じた後に入ってくるので選べない。**そのまま前の選択で戦う** — スキルは
 * 席に残っていて、試合の仕切り直し (resetPlayers) でも消さないため。
 *
 * 選ばせると「劣勢の側を見てから強い組み合わせで入り直す」ができてしまう。
 * 逆に空にすると、抜けて入り直しただけの人が丸腰になる。**持ち越すのが、
 * どちらにも寄らない形。**
 */
export function canChooseSkills(phase: Phase, mode?: ModeSpec, ready = false): boolean {
  // **練習部屋はいつでも組み替えられる。** 相手が棒立ちの的なので、後出しに
  // なる相手が居ない。ここは効き目を試す場所で、試すたびに試合の切れ目を
  // 待たせると**確かめられない**
  if (mode?.id === 'PRACTICE') return true
  /*
   * **READY を押している間は固まる。**
   *
   * 押すのは「自分はもう待たせていない」という表明で、**全員が押した瞬間に
   * 始まる**。押した後も触れると、最後の 1 人が押した瞬間に自分が段を触って
   * いた場合、どちらで始まったのかが誰にも分からない。
   *
   * 直せなくはしない。**取り消してから直す** — 取り消せば他の人を待たせる
   * ことになるので、押した重みと釣り合う。
   *
   * ready を見るのは支度の段階だけ。他の段階では押しようが無いので、
   * 席に残った古い値で固めてしまわないようにする。
   */
  if (phase === 'ready' && ready) return false
  return phase !== 'playing'
}

/**
 * 買える組み合わせか。**申告を鵜呑みにしない。**
 *
 * 予算はクライアントの画面でも見せるが、決めるのはこちら。表に無い名前も
 * 段の外れた値も弾く — 通すと、知らないスキルが**只で**効く欄に入る。
 */
export function isAffordable(skills: Skills): boolean {
  for (const [id, level] of Object.entries(skills)) {
    if (!(id in SKILLS)) return false
    if (level !== 1 && level !== 2 && level !== 3) return false
    if (level > maxLevelOf(id as SkillId)) return false
  }
  return costOf(skills) <= SKILL_BUDGET
}

/** その段。取っていなければ 0 */
export function levelOf(skills: Skills, id: SkillId): number {
  return skills[id] ?? 0
}

/**
 * 走る速さの倍率。
 *
 * **重さの倍率 (item/weapons.ts の carrySpeedScale) と掛け合わせる。** 足すのでは
 * なく掛けるので、重い銃の不利は割合として残る — 狙撃銃を提げた FAST MOVE Lv3 が
 * 拳銃の素の人に追いつくことはない。**武器の棲み分けを潰さないための形。**
 */
export function runnerScale(skills: Skills): number {
  return RUNNER_SCALE[levelOf(skills, 'runner')]
}

/**
 * ダンボールを被っている間の速さの倍率。素の 0.5 に掛ける。
 *
 * **箱が隠れ場所から移動手段に変わる。** 被ると頭の高さが 0.94m まで下がるので、
 * 遮蔽越しの視線を切ったまま動けるようになる — 情報の設計と直接噛み合う枠。
 */
export function boxMoveScale(skills: Skills): number {
  return BOX_MOVE_SCALE[levelOf(skills, 'boxMove')]
}

/**
 * その銃の散布の倍率。小さいほど締まる。
 *
 * **手ブレにも連射の広がりにも同じだけ効く** (Spread.degrees が両方を足した
 * 合計を返すため)。動きながらの乱れも、撃ち続けたときの開きも、極めた人は小さい。
 */
export function masterySpreadScale(skills: Skills, weapon: WeaponId): number {
  return MASTERY_SPREAD[levelOf(skills, MASTERY_OF[weapon])]
}

/**
 * 手ブレの倍率。**Lv3 で 0 になる。**
 *
 * --- 散布とは別の表で持つ ---
 * masterySpreadScale をそのまま 0 まで下げると、連射で開く分も姿勢で開く分も
 * 一緒に消える。走りながら撃っても散らない銃ができてしまい、**動かない側が
 * 有利**という土台が崩れる。動かすのは狙点の泳ぎだけにする。
 *
 * --- なぜ 0 まで下げるのか ---
 * 極めた銃は**構えれば止まる**。「その銃を極めた」ことが手触りで分かる形が
 * ここにしか無い — 散布も装填も、数字は動くが撃った結果でしか分からない。
 * 照準が止まることは構えた瞬間に見える。
 *
 * 止まっても必中にはならない。**動けば散り、連射すれば開く** — 消えるのは
 * 「止まって構えている間の泳ぎ」だけで、撃ち方の巧拙はそのまま残る。
 */
export function masterySwayScale(skills: Skills, weapon: WeaponId): number {
  return MASTERY_SWAY[levelOf(skills, MASTERY_OF[weapon])]
}

/**
 * 反動の乱れの倍率。小さいほど**押さえ戻しやすい**。
 *
 * 動かすのは**乱れ**のほうで、表を覚えた人がその通りに押さえ戻せる度合いが
 * 上がる。極めた人ほど連射が素直になる、という形。
 */
export function masteryJitterScale(skills: Skills, weapon: WeaponId): number {
  return MASTERY_JITTER[levelOf(skills, MASTERY_OF[weapon])]
}

/**
 * 反動そのものの倍率 (RECOIL_PATTERN に掛かる)。小さいほど跳ねない。
 *
 * --- なぜ控えめなのか ---
 * ここを大きく削ると**押さえ戻せない人が一番得をする**。跳ね上がりは
 * 覚えて押さえ戻す対象なので、消してしまうと上手さの効く余地がそのまま減る。
 * Lv3 で 12% だけ削るのは、**極めた実感を出しつつ、押しっぱなしを強くしない**
 * 幅として選んである (10 発撃った累積で 6.25 度 → 5.50 度)。
 *
 * 主に効かせているのは戻る速さのほう (masteryRecoveryScale)。あちらは
 * **指を離せる人**が得をするので、区切って撃つという判断を太らせる。
 */
export function masteryRecoilScale(skills: Skills, weapon: WeaponId): number {
  return MASTERY_RECOIL[levelOf(skills, MASTERY_OF[weapon])]
}

/**
 * 反動が戻る速さの倍率。大きいほど早く狙点へ帰る。
 *
 * **押しっぱなしの間は効かない。** 戻り始めるまでに猶予があり (camera.ts の
 * RECOIL_RECOVERY_DELAY = 0.1 秒)、AK の発射間隔 0.09 秒はそれより短い —
 * 撃ち続けている限り一度も戻らないので、ここを上げても連射は変わらない。
 *
 * 得をするのは**指を離した人**だけ。散布の締まり方 (MASTERY_SPREAD) と同じ
 * 向きで、極めた効き目が「長く押せる」ではなく「短く区切ったときに得」に出る。
 */
export function masteryRecoveryScale(skills: Skills, weapon: WeaponId): number {
  return MASTERY_RECOVERY[levelOf(skills, MASTERY_OF[weapon])]
}

/** その銃の装填時間の倍率。小さいほど速い */
export function masteryReloadScale(skills: Skills, weapon: WeaponId): number {
  return MASTERY_RELOAD[levelOf(skills, MASTERY_OF[weapon])]
}

/** 投げる強さの倍率。遠くへ届く */
export function throwScale(skills: Skills): number {
  return THROW_SCALE[levelOf(skills, 'throwing')]
}

/**
 * 当てた相手が光っている長さ (秒)。取っていなければ 0。
 *
 * **短くしてある。** 長いと「当てさえすれば追える」になって、撃ち合いを迂回する
 * 手のほうが安くなる。あくまで**次の一手を選ぶ材料**で、追跡の道具にはしない。
 */
export function exposeSeconds(skills: Skills): number {
  return EXPOSE_SECONDS[levelOf(skills, 'exposure')]
}

// --- 段ごとの値。添字が Lv で、0 は「取っていない」 ---

const RUNNER_SCALE = [1, 1.05, 1.1, 1.16] as const
const BOX_MOVE_SCALE = [1, 1.25, 1.5, 1.8] as const
const MASTERY_SPREAD = [1, 0.92, 0.85, 0.78] as const
// **Lv3 で 0。** 極めた銃は構えれば止まる
const MASTERY_SWAY = [1, 0.66, 0.33, 0] as const
const MASTERY_RELOAD = [1, 0.92, 0.85, 0.78] as const
const MASTERY_JITTER = [1, 0.8, 0.6, 0.4] as const
// **控えめ。** 大きく削ると押さえ戻せない人が一番得をする
const MASTERY_RECOIL = [1, 0.96, 0.92, 0.88] as const
// 戻る速さ。**指を離した人だけが得をする**ので、こちらは強めでよい
const MASTERY_RECOVERY = [1, 1.1, 1.2, 1.35] as const
const THROW_SCALE = [1, 1.1, 1.2, 1.35] as const
const EXPOSE_SECONDS = [0, 3, 5, 8] as const
