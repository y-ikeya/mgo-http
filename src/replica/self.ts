/**
 * 自分の本当の値。**サーバーが持っている、自分についての状態。**
 *
 * --- なぜ要るか ---
 * 体力も弾数もサーバーが権威なのに、**クライアントには自分で数えた値しか
 * 無かった**。体力は届いていたが presentation が直に受け、弾数はそもそも
 * 届いていない。名簿 (roster) は他人の体力まで持っているのに、自分だけ
 * レプリカを通っていなかった。
 *
 * 権威の形を 1 つにする — **サーバーが持っている物はレプリカに入る**。
 *
 * --- 予測は消さない ---
 * 撃った瞬間に残弾が減り、体力 0 で倒れて悲鳴を上げる、という反応は
 * presentation が自分の数でやる。**押した瞬間に返らないと手触りが壊れる**ので、
 * 届くのを待たない。
 *
 * ここに入るのは 3 秒ごとに届く「本当はこう」という値だけで、**ずれていたら
 * 合わせる**ために使う。普段は一致しているので何も起きない。
 *
 * --- 持たない物 ---
 * three も音も持たない。ずれたかどうかを答えるだけで、**どう直すかは
 * presentation が決める** (弾数は静かに合わせる、体力は音を出す、など)。
 */

import type { WeaponId } from '../domain/item/weapons'
import type { SelfMessage, ServerMessage } from '../protocol/types'

export interface SelfReplica {
  /** 一度でも届いたか。**届く前は何も比べない** */
  known: boolean
  health: number
  magazine: Record<WeaponId, number>
  reserve: Record<WeaponId, number>
  grenades: number
}

export function newSelfReplica(): SelfReplica {
  return {
    known: false,
    health: 0,
    magazine: {} as Record<WeaponId, number>,
    reserve: {} as Record<WeaponId, number>,
    grenades: 0,
  }
}

/**
 * 報せを 1 つ受けて、値を進める。
 *
 * @returns 受け取ったか。**自分宛て以外は false**
 */
export function applySelf(replica: SelfReplica, message: ServerMessage): boolean {
  if (message.type !== 'self') return false
  const self = message as SelfMessage
  replica.known = true
  replica.health = self.health
  replica.magazine = self.magazine
  replica.reserve = self.reserve
  replica.grenades = self.grenades
  return true
}

/**
 * 予測した値と、本当の値のずれ。
 *
 * **どう直すかはここで決めない。** ずれていることだけを返して、直し方は
 * presentation が持つ — 弾数は黙って合わせてよいが、体力は音や画面の反応が
 * 付いて回るので、同じ扱いにはできない。
 */
export interface Drift {
  health: number
  magazine: number
  reserve: number
  grenades: number
}

export function driftOf(
  replica: SelfReplica,
  predicted: { health: number; magazine: number; reserve: number; grenades: number },
  weapon: WeaponId,
): Drift {
  if (!replica.known) return { health: 0, magazine: 0, reserve: 0, grenades: 0 }
  return {
    health: replica.health - predicted.health,
    magazine: (replica.magazine[weapon] ?? 0) - predicted.magazine,
    reserve: (replica.reserve[weapon] ?? 0) - predicted.reserve,
    grenades: replica.grenades - predicted.grenades,
  }
}
