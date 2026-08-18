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
/** 背後から刺したときのダメージ。即死 */
export const MELEE_BACK_DAMAGE = MAX_HEALTH
/** 正面から刺したときのダメージ。2 回要る */
export const MELEE_FRONT_DAMAGE = MAX_HEALTH / 2
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
