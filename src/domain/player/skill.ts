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
  | 'targetAlert'
  | 'awareness'

/** 取れるレベル。0 は「取っていない」 */
type SkillLevel = 1 | 2 | 3

/** 1 人が持てる合計 (docs/design.md の 3) */
export const SKILL_BUDGET = 4

interface SkillSpec {
  id: SkillId
  label: string
  hint: string
  /**
   * 取れる段の数。**段がそのまま値段なので、これがそのまま上限の値段**。
   *
   * 段が意味を持つのは、**段に値段が付いているとき**だけ。本家で Lv3 でも
   * 1 枠しか使わなかったスキル (ENEMY EXPOSURE) は、値段を 1 に固定した
   * 途端に Lv1 と Lv2 を選ぶ理由が消える — 段が飾りになる。そういう物は
   * 最初から 1 段で持つ。
   */
  levels: 1 | 3
}

/**
 * スキルの表。**値段は持たない** — 段がそのまま値段だから (costOf)。
 */
export const SKILLS: Record<SkillId, SkillSpec> = {
  runner: {
    id: 'runner',
    label: 'FAST MOVE',
    hint: '走るのが速くなる。**持っている物の重さと掛け合わさる**',
    levels: 3,
  },
  boxMove: {
    id: 'boxMove',
    label: 'CBOX MOVE',
    hint: 'ダンボールを被ったまま動ける。**頭の高さは下がったまま**',
    levels: 3,
  },
  smgMastery: {
    id: 'smgMastery',
    label: 'SMG MASTERY',
    hint: 'P90 の散布が締まり、装填が速い',
    levels: 3,
  },
  rifleMastery: {
    id: 'rifleMastery',
    label: 'AR MASTERY',
    hint: 'AK47 の散布が締まり、装填が速い',
    levels: 3,
  },
  sniperMastery: {
    id: 'sniperMastery',
    label: 'SNIPER MASTERY',
    hint: 'XM2010 の散布が締まり、装填が速い',
    levels: 3,
  },
  shotgunMastery: {
    id: 'shotgunMastery',
    label: 'SG MASTERY',
    hint: 'M870 の**ポンプと装填が速い**。粒の散りは変わらない',
    levels: 3,
  },
  pistolMastery: {
    id: 'pistolMastery',
    label: 'HANDGUN MASTERY',
    hint: 'M9 の散布が締まり、装填が速い。**拳銃は全員が持っている**',
    levels: 3,
  },
  throwing: {
    id: 'throwing',
    label: 'THROWING MASTERY',
    hint: '遠くへ投げられる',
    /*
     * **段が無い。取るか取らないかだけ** (ENEMY EXPOSURE と同じ扱い)。
     *
     * 本家は Lv3 でも 1 枠だった。値段が段で変わらないなら上の段しか選ばれない
     * ので、段を持つ意味が無い — 段がそのまま値段、という決め事の裏返し。
     */
    levels: 1,
  },
  exposure: {
    id: 'exposure',
    label: 'ENEMY EXPOSURE',
    hint: '当てた相手が 5 秒光る。**倒さなくても情報になる**',
    /*
     * **段が無い。取るか取らないかだけ。**
     *
     * 本家は Lv3 でも 1 枠だった。値段が段で変わらないなら上の段しか
     * 選ばれないので、段を持つ意味が無い。
     */
    levels: 1,
  },
  targetAlert: {
    id: 'targetAlert',
    label: 'TARGET ALERT',
    hint: '自分を攻撃してきた相手の気配が分かる。**段が上がるほど、早い段階で分かる**',
    /*
     * **段に意味がある。** 値段が変わるだけでなく、気配が出る**条件**が段で緩む
     * (alertTriggeredBy)。Lv1 は当てられてから、Lv3 は狙われた時点で分かる。
     */
    levels: 3,
  },
  awareness: {
    id: 'awareness',
    label: 'AWARENESS',
    hint: '近くに置かれた敵の物 (クレイモア / DECOY / E LOCATOR / 手榴弾) の気配が壁越しに分かる',
    /*
     * **段が無い。** 本家は段で届く距離が伸びた (8 / 15 / 20.5m) が、
     * 値段が 1 のままなら上の段しか選ばれない (EE と同じ理由)。距離を 1 つに決める。
     */
    levels: 1,
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
  // 麻酔の狙撃銃も狙撃銃の腕前で扱う。**同じ構えの銃を 2 つに割らない** —
  // 予算 4 では 2 挺を極められないので、割ると片方が死に札になる
  mosin: 'sniperMastery',
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
function maxLevelOf(id: SkillId): SkillLevel {
  return SKILLS[id].levels
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

/**
 * 投げる強さの倍率。遠くへ届く。
 *
 * **段を越えた値は上限へ丸める。** 段を 3 つから 1 つへ畳んだので、古い保存に
 * `throwing: 3` が残っていることがある。素直に引くと表の外 (undefined) を
 * 掴んで、投げる速さが NaN になって**手榴弾が飛ばなくなる**。
 */
export function throwScale(skills: Skills): number {
  const level = Math.min(levelOf(skills, 'throwing'), THROW_SCALE.length - 1)
  return THROW_SCALE[level]!
}

/**
 * 当てた相手が光っている長さ (秒)。取っていなければ 0。
 *
 * **短くしてある。** 長いと「当てさえすれば追える」になって、撃ち合いを迂回する
 * 手のほうが安くなる。あくまで**次の一手を選ぶ材料**で、追跡の道具にはしない。
 *
 * 値段が 1 で固定になったぶん、ここは短いほうへ寄せている。予算 4 のうち 1 で
 * 付くので、**取らない理由がほぼ無い**常備品になる。
 */
export function exposeSeconds(skills: Skills): number {
  return EXPOSE_SECONDS[levelOf(skills, 'exposure')]
}

/**
 * TARGET ALERT。**ENEMY EXPOSURE の鏡。** EE が当てた相手を光らせるなら、
 * こちらは**自分を攻撃してきた相手**の気配を出す。
 *
 * --- 輪郭ではなく気配 ---
 * 輪郭 (壁越しの発光) が残るのは EE と個人戦の 1 位だけ。自分で見つけて
 * 撃ち抜いた実りだから輪郭でよい。撃たれた側 (TA) や罠に掛けた側 (decoy) が
 * 得るのは「どの辺に居るか」の霧まで — 輪郭は分かりやすい分だけ強く、
 * 守る側に渡すと撃った側の位置取りの意味が消える。
 *
 * --- 段は「攻撃」の読み方 ---
 * 本家は Lv1 が「ロックされて当てられた」、Lv2 が「ロックされた」、Lv3 が
 * 「銃口を向けられた」。この遊びにはロックオンが無いので、読み替える:
 *
 *     Lv1  hit   当てられた。EE の鏡そのもの
 *     Lv2  shot  撃たれた。外れても、弾道が体のすぐ近くを通ったら
 *     Lv3  aim   構えて狙われた。照準が自分を捉えている間。**撃たれる前に分かる**
 *
 * 上の段は下の段を含む。Lv3 なら撃たれても当てられても気配が出る。
 *
 * 気配の長さは段で変えない。段で買うのは**早さ**であって長さではない —
 * 長さまで伸ばすと Lv3 が追跡の道具になる (EE を短くしたのと同じ理由)。
 */
export type AlertTrigger = 'hit' | 'shot' | 'aim'

const ALERT_TRIGGER_LEVEL: Record<AlertTrigger, number> = { hit: 1, shot: 2, aim: 3 }

/** その段で、その攻撃は気配を出すか */
export function alertTriggeredBy(skills: Skills, trigger: AlertTrigger): boolean {
  const level = levelOf(skills, 'targetAlert')
  return level > 0 && level >= ALERT_TRIGGER_LEVEL[trigger]
}

/** 攻撃してきた相手の気配が残る長さ (秒)。EE (exposeSeconds) と同じ */
export const ALERT_SECONDS = 5

/**
 * 「撃たれた」と読む距離 (m)。弾道と体の中心線がこれより近ければ、
 * 外れていても撃たれたことになる。
 *
 * 肩幅の外側に少し余裕を持たせた程度。広げるほど「向こうを撃った弾」でも
 * 光るようになり、撃った側から見て理屈が通らなくなる。
 */
export const ALERT_SHOT_RADIUS = 1.2

/**
 * 「狙われた」と読む幅 (m) と距離 (m)。
 *
 * 照準の中心が胸から**この幅の中**に在れば、狙われたと読む。**距離に依らない幅**
 * にしてある — 角度 (3 度) で持っていた頃は、80m 先だと幅が 4.2m になって、
 * 自分から 2m ずれた所を構えただけで光った。「照準を重ねられた」ではなく
 * 「こっちを見た」になっていた。幅で持てば、どの距離でも「体に照準が重なった」
 * と同じ意味になる (10m で 5.7 度、80m で 0.7 度)。
 *
 * 1m は肩幅 (0.44) と頭の球に余裕を足した程度。腰だめでは構えていないので数えない。
 * 距離は狙撃銃の頭 1 発の間合いを少し超える所で切る。
 */
export const ALERT_AIM_WIDTH = 1
export const ALERT_AIM_RANGE = 80

/**
 * AWARENESS。**近くの敵の置き物・投げ物の気配が分かる。**
 *
 * --- 見えるのは「何かある」まで ---
 * 物そのものを壁越しに描くのではなく、**その辺に何かある**と読める霧を出す。
 * くっきり光らせると、隠して置く道具 (クレイモア) の仕事が丸ごと消える。
 * 気配だけなら「そこを避ける / 探しに行く」の判断は残り、置いた側にも
 * 「霧を読める人が居る」前提で置き場所を選ぶ余地が残る。
 *
 * --- 距離 ---
 * 本家の Lv2 の値 (15m)。E LOCATOR の半径と同じで、1 区画ぶん。
 */
export function hasAwareness(skills: Skills): boolean {
  return levelOf(skills, 'awareness') > 0
}

export const AWARENESS_RADIUS = 15

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
/**
 * 投げる強さ。**段が無いので 2 つだけ** (取っていない / 取った)。
 *
 * 段を持っていた頃は 1.1 / 1.2 / 1.35 で、極めるのに 3 枠払っていた。1 枠に
 * 畳んだので、**旧 Lv2 と同じ飛距離**を 1 枠の値にしてある。
 *
 * 飛距離は速さの 2 乗で伸びる (放物線なので) ので、1.2 倍の速さは
 * **1.44 倍の距離**。極めた頃 (1.35 → 1.82 倍) には届かないが、齧った頃
 * (1.1 → 1.21 倍) よりは明確に遠い、という位置に置いた。
 */
const THROW_SCALE = [1, 1.2] as const
// **1 段だけ。** 添字 0 は「取っていない」
const EXPOSE_SECONDS = [0, 5] as const
