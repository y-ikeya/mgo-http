/**
 * 手榴弾。**倒す道具ではなく、動きを止める道具。**
 *
 * ここに置いてあるのは、変えると遊び方が変わる数字だけ。跳ね方や転がり方
 * (どれだけ弾んで、いつ止まるか) は「そう見えない」から触るものなので
 * sim/judge/ballistic.ts にある。
 */

import { throwScale, type Skills } from '../player/skill'

/** 爆風が届く距離 (m) */
export const BLAST_RADIUS = 7

/**
 * 爆心での威力。体力 100 に対する点数。
 *
 * **足元で爆ぜても死なない。** 満タンなら 75 削られて 25 残る。
 *
 * 一撃で倒せると、撃ち合う前に投げるのが常に最善になって読み合いが消える。
 * 削って転ばせるだけなら、投げたあとに詰めるか退くかを選ぶ必要が残るし、
 * 投げられた側にも「削られた体力で撃ち合うか、下がって回復を待つか」が残る。
 *
 * 距離で 3 つの帯に分かれる (半径 7m、線形で落とす):
 *
 *   0〜2m  60〜75 削られて転ぶ
 *   2〜5m  20〜60 削られて転ぶ
 *   5〜7m  0〜20 削られるが立っていられる
 *
 * 削られた相手に止めを刺せば得点にはなる。手榴弾だけで完結しない、というだけ。
 */
export const BLAST_DAMAGE = 75

/**
 * 遮蔽の裏でどれだけ残るか。
 *
 * 0 にすると壁 1 枚で完全に無傷になり、部屋へ投げ込む意味が消える。
 * 残しておくと「隠れても少しは食らう」になり、退く判断に重みが出る。
 */
export const BLAST_SHADOWED = 0.25

/**
 * 転ぶ近さ。半径に対する割合 (7m のうち 5m 以内)。
 *
 * 死なない以上、**転倒がこの武器の主な効き目**。ここが狭いと、ただ少し
 * 削れるだけの物になって投げる理由が無くなる。壁の裏で削られただけの相手は
 * 転ばない (遮蔽の外に居ることも条件)。
 */
export const KNOCK_NEAR = 0.28

/**
 * 投げ出す速さ (m/s)。
 *
 * サーバーが上限として使い、予測線もこれで引く。申告された速さは信じない。
 */
export const THROW_SPEED = 12

/**
 * その人が投げ出す速さ (m/s)。**THROWING MASTERY を掛けた後の値。**
 *
 * ここを通すのは、**予測線と実際の軌道を必ず一致させる**ため。素の
 * THROW_SPEED を直に読む場所が 2 つ (サーバーの投擲と、画面の予測線) あって、
 * 片方だけにスキルを掛けると**見えている落下点と落ちる場所がずれる**。
 * 手榴弾は「そこへ落とす」判断そのものが手なので、ずれた時点で武器が壊れる。
 *
 * 速さだけを動かして上向きの下駄 (THROW_LOFT) は据え置く。角度も変えると
 * 距離だけでなく山なりの形まで変わって、投げ慣れた感覚が段ごとに別物になる。
 */
export function throwSpeedOf(skills: Skills): number {
  return THROW_SPEED * throwScale(skills)
}

/**
 * 狙った向きより何度上へ投げるか (rad)。
 *
 * 狙いの向きそのままだと、水平に狙えば水平に飛ぶ。速いぶん低く伸びて、
 * 野球の送球のような射線になる。手榴弾は放物線で置きに行く物なので、
 * 常に上へ下駄を履かせて山なりにする。
 *
 * 狙う側は落下点の印を見て決めるので、向きと着地点がずれても困らない。
 */
export const THROW_LOFT = (28 * Math.PI) / 180

/** 爆風を受けた結果 */
export interface BlastEffect {
  /** 削る量 */
  damage: number
  /** 吹き飛ぶか */
  knock: boolean
}

/**
 * その距離と遮蔽で、どれだけ削れて転ぶか。
 *
 * **近いほど強い。** 中心付近だけ極端にせず、素直に線形で落とす。遮蔽は
 * 体の何割が爆心から見えていたか (cover) をそのまま掛ける — 半分だけ壁から
 * 出ていれば、半分だけ食らう。
 *
 * 転ぶのは**遮蔽の外に居る相手だけ**。壁の裏で削られただけの相手まで
 * 転ばせると理不尽になる。
 *
 * 距離と遮蔽を測るのは sim (judge/blast.ts の blastExposure)。
 */
export function blastEffect(distance: number, cover: number): BlastEffect {
  const near = 1 - distance / BLAST_RADIUS
  if (near <= 0) return { damage: 0, knock: false }
  const shade = BLAST_SHADOWED + (1 - BLAST_SHADOWED) * cover
  return { damage: BLAST_DAMAGE * near * shade, knock: cover > 0 && near > KNOCK_NEAR }
}
