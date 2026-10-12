/**
 * CQC。**左で殴って怯ませ、右腕を喉に掛けて、足を払って仰向けに倒す。**
 *
 * --- 掛かる時 ---
 * 投げる側: 構えずに引き金を引く。手にあるのが**片手で持つ物** (拳銃・ナイフ) の
 *   時だけ — 突撃銃や狙撃銃のような両手で持つ長物では掛けられない。投げる物・置く物
 *   (手榴弾・クレイモア …) は引き金がそれ自体を使うので入らない。
 * 投げられる側: **立っている時だけ。** しゃがんでいる・箱に入っている・伏せている
 *   相手には腕が掛からない (本人 2026-10-12)。
 *
 * --- 掛からなかった時 ---
 * **空振りする。** 左を出して腕を伸ばした所で止まり、少しの間棒立ちになる。
 * 寄ってしゃがむ相手に CQC を読まれたら、その隙を撃たれる — 掛ける側が賭ける形。
 *
 * --- 掛かった時 ---
 * 相手は倒れて、起き上がるまで動けない (爆風で倒れた時と同じ扱い)。体力は
 * 減らないが**スタミナが減る** (CQC_STAMINA)。
 *
 * three にも DOM にも依存しない。サーバーが同じ規則を読む。
 */
import { isGun, isTwoHanded, type HeldId } from '../item/held'
import { MOVE_DIRECTIONS, type Locomotion } from './locomotion'

/** 掛けられる距離 (m、体の中心どうし、水平)。腕を伸ばして喉に届く所まで */
export const CQC_REACH = 1.3

/**
 * 掛けられる向き。**体の正面からこの角度の内側** (cos)。60° より外は届かない。
 * 相手の向きは問わない — 背後からでも掛かる
 */
export const CQC_FACING_COS = 0.5

/**
 * 投げる型の中での 2 人の間合い (m)。投げられる側はここへ寄せられてから倒れる
 * (tools/raw/cqc.blend で組んだ時の距離)
 */
export const CQC_PAIR_DISTANCE = 0.8

/**
 * 投げられて背中が地面に着くまで (秒、掛かってから)。**スタミナはここで減る** —
 * 掛けた瞬間ではなく、倒し切った時 (本人 2026-10-12)。
 *
 * 型 (tools/raw/cqc.blend) の 55 コマ目 = 2.25 秒を、ゲームでは 1.2 倍速で流す
 * (animation.ts の CQC_RATE)。倒れている間に構えられるようになるのも同じ時刻
 */
export const CQC_LAND_SECONDS = 2.25 / 1.2

/**
 * 1 回投げられて減るスタミナ。上限 100 なので 4 回目で眠る。
 *
 * **CQC のスキルを入れていない時の値** (本人 2026-10-12)。スキルを足したら、段で
 * 増やすのはここから
 */
export const CQC_STAMINA = 25

/**
 * 空振りした後、型が終わってから動けるまで (秒)。**掛ける側の賭け金。**
 * 短いと「とりあえず押す」が損にならない
 */
export const CQC_MISS_RECOVERY = 0.6

/** その物を持って掛けられるか。両手で持つ長物は掛けられない */
export function canThrowWith(held: HeldId): boolean {
  return !isTwoHanded(held) && (isGun(held) || held === 'knife')
}

/**
 * 立っている体の状態。**ここに無いものには掛からない** — しゃがみ・箱・伏せ・
 * 梯子・宙・倒れている・他の全身の型の最中。
 *
 * 足していく形にしてある。状態が増えた時に黙って掛かるようになるより、
 * 掛からないほうが気づける
 */
const STANDING = new Set<Locomotion>([
  'idle',
  'walk',
  'salute',
  'lean_left',
  'lean_right',
  'up_stair',
  'down_stair',
  ...MOVE_DIRECTIONS.map((d) => `run_${d}` as Locomotion),
])

/** 相手が CQC を掛けられる姿勢か (立っているか) */
export function canBeThrown(locomotion: Locomotion): boolean {
  return STANDING.has(locomotion)
}
