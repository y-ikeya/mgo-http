/**
 * クレイモア (サーバー側)。置く・配る・起爆する。
 */

import { connected, present } from '../../src/domain/match/match'
import { canAct, canBeHurt } from '../../src/domain/player/lifecycle'
import { STEP_UP } from '../../src/domain/player/moving'
import type { MatchPlayer, Team } from '../../src/domain/player/player'
import type { ServerMessage } from '../../src/application/protocol/types'
import { PLACE_FORWARD, type Placed, SHOT_HALF, SHOT_TOP, blastReach, canPlaceAt } from '../../src/sim/judge/claymore'
import { blastEffect } from '../../src/domain/item/claymore'
import { type StageBox, groundUnder, hasLineOfSight, segmentHitsBox } from '../../src/sim/space/vision'
import { applyBlastDamage } from '../damage'
import { dropGrenade } from './grenade'
import { viewOf } from '../relay'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast, friendlyTeam, hostileToOwner } from '../world'

/**
 * 置かれたクレイモア。
 *
 * 手榴弾と違って**飛ばない**ので軌道は持たない。置いた瞬間に位置と向きが決まり、
 * 起爆するまでそこに在り続ける。置いた本人が死んでも残る — 置いて離れる道具なので、
 * 本人が生きているかは関係ない。
 */
export interface Claymore extends Placed {
  id: number
  owner: string
  team: Team
}

export let nextClaymoreId = 1

/**
 * 置く。**位置も向きもサーバーが決める** — 送らせると壁の中に置ける。
 *
 * 置けるのは自分の前 0.9m。そこが壁の中や段差の外なら**置かせない**
 * (sim/claymore.ts の canPlaceAt)。高さは地面に乗せる — 足元の y をそのまま
 * 使うと、段差の上に置いたときに床へ沈む。
 */
export function placeClaymore(room: RoomWorld, from: MatchPlayer): void {
  // **手にある物で決める。** 装備の選択 (support) で見ていたので、落ちている
  // クレイモアを拾って持ち替えた人が置けなかった
  if (!canAct(from.life) || from.held !== 'claymore' || from.grenades <= 0) return

  const forward = [-Math.sin(from.yaw), -Math.cos(from.yaw)]
  const x = from.x + forward[0] * PLACE_FORWARD
  const z = from.z + forward[1] * PLACE_FORWARD

  // 壁の中や縁の外へは置けない。**弾いても数は減らさない** —
  // 置けなかったのに手フラグが減ると、押し間違いが取り返しの付かない損になる
  const ground = groundUnder(x, z, from.y, room.stage.solid, STEP_UP).top
  if (!canPlaceAt(x, z, from.y, ground, room.stage.solid)) return

  from.grenades--
  const claymore: Claymore = {
    id: nextClaymoreId++,
    owner: from.id,
    team: from.team,
    x,
    // 地面に乗せる。足元をそのまま使うと、段差の上に置いたときに沈む
    y: ground,
    z,
    // 置いた本人と同じ向き。自分が来た方を向く形になる
    yaw: from.yaw,
  }
  room.claymores.push(claymore)

  // ここでは配らない。**見えている人にだけ**、tick が配る (relayClaymores)
}

/**
 * 置かれたクレイモアを、見えている人にだけ配る。
 *
 * 位置の配り方 (relayState) と同じドメインルール。味方には無条件、敵にはカメラから線が
 * 通ったときだけ。**見えなくなったら消す** — 一度見せたまま置きっぱなしにすると、
 * 物陰へ回った相手の画面に残り続けて「そこに在る」ことが漏れ続ける。
 *
 * 本体は 26cm しかないので、体のように 3 点で見ずに 1 点で見る。
 */
export function relayClaymores(room: RoomWorld): void {
  for (const viewer of connected(room)) {
    for (const claymore of room.claymores) {
      // 味方の物は無条件。どこに置いたか分からないと自分が引っ掛かる
      let visible = friendlyTeam(room, viewer, claymore.team)
      if (!visible) {
        const eye = viewOf(room, viewer)
        visible = hasLineOfSight(
          eye.x, eye.y, eye.z,
          claymore.x, claymore.y, claymore.z,
          // 本体の高さ。頭の高さと同じ引数の意味 (足元からどれだけ上か)
          0.2,
          room.stage.sight,
        )
      } else if (!visible) {
        visible = true
      }

      const known = sessionOf(viewer).seenClaymores.has(claymore.id)
      if (visible && !known) {
        sessionOf(viewer).seenClaymores.add(claymore.id)
        sessionOf(viewer).socket.send(
          JSON.stringify({
            type: 'claymorePlaced',
            id: claymore.id,
            owner: claymore.owner,
            at: [claymore.x, claymore.y, claymore.z],
            yaw: claymore.yaw,
            team: claymore.team,
          } satisfies ServerMessage),
        )
      } else if (!visible && known) {
        sessionOf(viewer).seenClaymores.delete(claymore.id)
        sessionOf(viewer).socket.send(
          JSON.stringify({ type: 'claymoreGone', id: claymore.id, blast: false } satisfies ServerMessage),
        )
      }
    }
  }
}

/**
 * 撃たれたクレイモアを起爆させる。
 *
 * **申告を増やさない。** shot は銃口と着弾点を既に送ってきているので、その線分と
 * 当たりを見れば済む。「クレイモアを撃った」と言わせると、見えていない物を
 * 撃ったことにできる。
 *
 * 見つけて壊せることが、置く側への答えになる — 通り道を塞がれたら、
 * 迂回するか壊すかを選べる。
 */
export function shotHitsClaymore(room: RoomWorld, from: readonly number[], to: readonly number[]): void {
  for (let i = room.claymores.length - 1; i >= 0; i--) {
    const claymore = room.claymores[i]
    const box: StageBox = {
      name: 'claymore',
      min: [claymore.x - SHOT_HALF, claymore.y, claymore.z - SHOT_HALF],
      max: [claymore.x + SHOT_HALF, claymore.y + SHOT_TOP, claymore.z + SHOT_HALF],
    }
    if (!segmentHitsBox(from[0], from[1], from[2], to[0], to[1], to[2], box)) continue
    detonateClaymore(room, claymore)
    room.claymores.splice(i, 1)
  }
}

/** 起爆。前に居た敵だけを巻き込む */
export function detonateClaymore(room: RoomWorld, claymore: Claymore): void {
  // 起爆は隠さない。音も光も壁を回り込んで届く (手榴弾と同じドメインルール)
  broadcast(room, { type: 'claymoreGone', id: claymore.id, blast: true })
  for (const viewer of connected(room)) sessionOf(viewer).seenClaymores.delete(claymore.id)
  if (room.phase !== 'playing') return

  for (const victim of present(room)) {
    if (!canBeHurt(victim.life)) continue
    // 味方は巻き込まない。**置いた本人だけは例外** — 手榴弾を足元に落としたときと
    // 同じドメインルールで、自分の物で死ぬことがある。誰が味方かはルールが決める
    if (victim.id !== claymore.owner && !hostileToOwner(room, claymore.team, victim)) continue

    // 距離を測るのは sim、何ダメージかはドメインルール (domain/item/claymore.ts)
    const hit = blastEffect(blastReach(claymore, victim))
    if (hit.damage <= 0) continue
    const hurt = applyBlastDamage(
      room, victim, hit.damage,
      claymore.x, claymore.z, claymore.owner, 'claymore', hit.knock,
    )
    // 手が緩んだら握っていた物が足元に落ちる
    if (hurt.letGo) dropGrenade(room, victim)
  }
}
