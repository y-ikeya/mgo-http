/**
 * ダメージの規則。
 *
 * ここは Three.js を import しない。**サーバーがそのまま読み込むため**。
 * Bun は TypeScript をそのまま動かせるので、クライアントとサーバーが
 * 文字どおり同じコードを実行できる。移植しないので、値がずれようがない。
 *
 * Rust へ移すときも、このファイルが仕様書になる。読んで訳すだけで済むよう、
 * 外部への依存を持たせない (これが sim/ の唯一の規則)。
 */

import { headHeightWhen, type Stance } from '../player/stance'
import { DISTANCE_SLACK, DISTANCE_SLACK_RATE, MELEE_SLACK } from './lag'

/** 命中部位。判定の形は hitbox.ts が持つが、名前と倍率はここ */
export type HitZone = 'HEAD' | 'BODY' | 'LEGS'

export const MAX_HEALTH = 100
/** 1 発の基礎ダメージ。胴に当たれば 5 発で倒れる */
/**
 * 弾の威力・部位の倍率・距離減衰は武器ごとに違うので weapons.ts が持つ。
 * ここに残すのは、武器に依らないもの (体力・近接・回復) だけ。
 */

export const MELEE_RANGE = 2.0
/** ナイフの有効範囲 (正面からの半角の cos)。60° 以内 */
export const MELEE_CONE_COS = Math.cos((60 * Math.PI) / 180)
/**
 * 刺したときのダメージ。**どこを刺しても即死。**
 *
 * 背後と正面で分けていない。代償は**先に払われている** — ナイフは持ち替えの
 * 枠なので、刺しに行く人は銃をしまってから近づいている。撃つ手段を手放し、
 * 間合い (2m) に入るまで無防備でいる。そこまでやって届いたなら絶対、という
 * 釣り合いにしてある (docs/weapons.md)。
 *
 * 持ち替えが入るまでは正面 50 (2 回) にしてあった。銃を持ったまま一瞬で
 * 刺せる状態で即死にすると、代償が無いまま報酬だけが残る。
 */
export const MELEE_BACK_DAMAGE = MAX_HEALTH
export const MELEE_FRONT_DAMAGE = MAX_HEALTH
/**
 * 「背後から」と判定する内積の閾値。
 * 攻撃者と被害者が同じ向きを向いていれば背後を取っている。
 */
export const BACKSTAB_DOT = 0.34

/**
 * ローリングが当たったと見なす距離 (m)。
 * 体当たりなので、ナイフより近い。
 */
export const ROLL_HIT_RANGE = 1.1
/**
 * ローリングで押しのける距離 (m)。
 * 倒すのではなく体勢を崩させる。ダメージは入れない。
 */
export const ROLL_KNOCKBACK = 0.8

/** 倒れてから復帰するまでの待ち時間 (秒)。倒れるモーションの尺に足される */
export const RESPAWN_DELAY = 3

/**
 * これ以下なら瀕死。画面の縁が脈打つ。
 *
 * 胴 1 発 (20) で落ちる残量。次の一発で終わる、という線をここに引いている。
 */
export const CRITICAL_HEALTH = 30

/**
 * 集中して回復できる上限。
 *
 * 全快はしない。瀕死を脱するところまでで止める。撃ち合いに負けた傷は
 * 消えず、次の撃ち合いは不利なまま始まる。
 * 縁の脈動が止まる (CRITICAL_HEALTH) より少し上に置いて、
 * 「もう瀕死ではない」が見て分かるようにしてある。
 */
export const RECOVER_CAP = 35
/**
 * 集中を始めてから回復が始まるまで (秒)。
 *
 * 集中そのものの立ち上がり (音が聞こえるまで 1 秒) より長い。
 * 音を取るだけなら 1 秒、傷を癒すなら 3 秒、という段差にしてある。
 */
export const RECOVER_DELAY = 3
/** 回復する速さ (毎秒)。10 から上限まで約 3 秒 */
export const RECOVER_RATE = 8


/**
 * 被弾のダメージを出す。
 *
 * サーバーが呼ぶ。クライアントは「どこに当てたか」と「距離」だけを申告し、
 * 数値そのものは決めない。申告できる余地を狭くしておくほど、後で権威を
 * 強めるときの変更が小さくなる。
 */

/** ナイフのダメージ。背後からなら即死 */
export function meleeDamage(fromBehind: boolean): number {
  return fromBehind ? MELEE_BACK_DAMAGE : MELEE_FRONT_DAMAGE
}

/**
 * 落ちても平気な着地速度 (m/s)。
 *
 * **1 層は無傷で降りられる。** 重力 9.8 に下降の倍率 1.8 が掛かるので、階高 4.0m を
 * 落ちると 11.9 m/s で着く。そこに余裕を足した値。
 *
 * **ステージの階高に紐付いている。** 階を高くするならここも上げないと、
 * 1 層降りるだけで削れるようになる (逆も同じ)。数字の出どころは
 * tools/make_garage.py の LEVEL。
 *
 * 降りるのがタダでないと、立体的なステージで**下りだけスロープを回らされる**。
 * 飛び降りて逃げる・回り込むのは階のある地形の一番面白い所なので、そこは残す。
 */
export const FALL_SAFE_SPEED = 12

/**
 * 超えた分の 1 m/s あたりに受ける量。
 *
 * 2 層 (8.0m = 16.8 m/s) で 53。**痛いが死なない。** 落ちた先で撃たれれば死ぬので、
 * 「近道をした代償を、そのあとの撃ち合いで払う」形になる。
 *
 * 上限は置かない。爆風と違って**自分でやったこと**なので、高い所から飛び降りて
 * 死ぬのは筋が通る (12.6m で致死)。手榴弾が単体で殺さないのは、相手の一手で
 * 一方的に決まらないためであって、自傷には当てはまらない。
 */
export const FALL_DAMAGE_PER_SPEED = 11

/** その着地速度で受ける量。無傷なら 0 */
export function fallDamage(impactSpeed: number): number {
  if (impactSpeed <= FALL_SAFE_SPEED) return 0
  return Math.round((impactSpeed - FALL_SAFE_SPEED) * FALL_DAMAGE_PER_SPEED)
}

/**
 * 何もしなくてもナイフが刺さる構え。
 *
 * **立ちと中腰。** 箱も含める — 中に居るのは立っているか中腰の人なので、
 * 被っただけで刃が通らなくなるのはおかしい (被れば無敵、という抜け道になる)。
 */
const STABBABLE: ReadonlySet<Stance> = new Set<Stance>(['stand', 'crouch', 'box'])

/**
 * 倒れている相手に刃が通る、見下ろしの角度 (rad)。**下が負。**
 *
 * 立ったまま真っ直ぐ前を刺しても、地面の相手には届かない。しゃがんで下を狙う、
 * という**手間を掛けたときだけ**通る。
 *
 * 爆風で転ばせてから刺す、が安すぎるという理由で以前は一切通らなくしていたが、
 * それだと倒れている相手が銃でしか処理できない。狙う動作を挟ませれば、
 * 「転ばせて即座に刺す」にはならない。
 */
export const STAB_DOWN_PITCH = -0.35

/**
 * その構えに刃が通るか。
 *
 * **クライアントも同じものを読む。** サーバーが弾くだけにしていたら、
 * 空振りなのに手元では「当たった」と出た (倒れている相手を刺すと
 * BACKSTAB の文字が出る)。当たり判定はサーバーが権威だが、
 * **当たらないと分かっている物は手元でも当てない。**
 *
 * 幾何 (間合いと角度) は sim/judge/hitcheck.ts。ここに在るのは
 * 「誰を刺せるか」という規則だけ。
 */
export function canBeStabbed(stance: Stance, aimPitch = 0): boolean {
  if (STABBABLE.has(stance)) return true
  // 倒れている相手。**下を狙っているときだけ**通る
  return aimPitch <= STAB_DOWN_PITCH
}


/** 削られた結果 */
export interface Wound {
  /** 削ったあとの体力 */
  health: number
  /** 倒れたか */
  downed: boolean
}

/**
 * 削る。**倒れたかどうかまでが規則。**
 *
 * 引き算そのものは審判 (server) がやればいい話に見えるが、「0 になったら
 * 倒れる」は遊びの決めごとで、**同じ判断をクライアントも先に回している**。
 * 2 か所に書くと、片方だけ「0 でも立っている」に変わる。
 */
export function takeDamage(health: number, amount: number): Wound {
  const left = Math.max(0, health - amount)
  return { health: left, downed: left <= 0 }
}

/**
 * 手柄は誰に付くか。
 *
 *     kill     倒した人が居る
 *     suicide  自分の物で死んだ (足元に落とした手榴弾、自分で踏んだクレイモア)
 *     none     置いた本人がもう居ない。**残っていた物で死んだのは落ち度ではない**
 *
 * 落下も自死に数える。自分でやったことなので (量を送らせない、の裏返し)。
 */
export type Credit = 'kill' | 'suicide' | 'none'

export function creditOf(victimId: string, killerId: string | null): Credit {
  if (killerId === null) return 'none'
  return killerId === victimId ? 'suicide' : 'kill'
}

/**
 * 当たり判定の検算に渡す規則、ひとまとめ。
 *
 * **判定の幾何 (sim) はこれを import しない。受け取る。** 幾何の層が遊びの
 * 数字を直に読むと、間合いを 0.1m 変えただけで幾何の試験が動く。渡す形なら、
 * あちらは「その形の物を受け取ったらこう判定する」だけを見ていられる。
 *
 * **束ねてここに置くのは、写しを作らせないため。** サーバーとクライアントが
 * 別々に組み立てると、片方だけ古い数字を渡す余地が残る。
 */
export const HIT_RULES = {
  headHeight: headHeightWhen,
  canBeStabbed,
  meleeRange: MELEE_RANGE,
  meleeSlack: MELEE_SLACK,
  backstabDot: BACKSTAB_DOT,
  distanceSlack: DISTANCE_SLACK,
  distanceSlackRate: DISTANCE_SLACK_RATE,
}
