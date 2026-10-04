/**
 * クレイモア (サーバー側)。置く・配る・起爆する。
 */

import { connected, present } from '../../src/domain/match/match'
import { canAct, canBeHurt } from '../../src/domain/player/lifecycle'
import { STEP_UP } from '../../src/domain/player/moving'
import { headHeightOf, type MatchPlayer, type Team } from '../../src/domain/player/player'
import type { ServerMessage } from '../../src/application/protocol/types'
import { type Placed, SHOT_HALF, SHOT_TOP, placeSpot } from '../../src/sim/judge/claymore'
import { blastExposure } from '../../src/sim/judge/blast'
import { BLAST_RANGE, SENSOR_HEIGHT, blastEffect } from '../../src/domain/item/claymore'
import { overflowing } from '../../src/domain/item/held'
import { type StageBox, segmentHitsBox } from '../../src/sim/space/vision'
import { applyBlastDamage } from '../damage'
import { dropGrenade } from './grenade'
import { popDecoy } from './decoy'
import { sees } from '../relay'
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

  // 壁の中や縁の外へは置けない。**弾いても数は減らさない** —
  // 置けなかったのに手フラグが減ると、押し間違いが取り返しの付かない損になる。
  // 客も同じ式で見ていて、置けない所では置く型に入らない (Game.updateClaymoreSetup)
  const spot = placeSpot(from, room.stage.solid, STEP_UP, room.stage.body)
  if (!spot.ok) return

  from.grenades--
  /*
   * **場に置ける数には上限がある** (PLACED_LIMIT)。
   *
   * 湧き直すと手元は満タンに戻る (refill) が、置いた物は残る。数えないと
   * 死ぬたびに増えて、通り道を全部塞げる。新しい数字は足さない —
   * 「持てるだけ置ける」なら覚えることが増えない。
   *
   * **溢れたら黙って消す。起爆させない。** 置いた瞬間にマップの反対側で
   * 誰かが死ぬのは理不尽だし、**遠隔起爆装置**として使える (相手の近くに
   * 置いてきた物を、遠くで 1 個置いて起爆させる)。
   */
  evictOldest(room, from.id)

  const claymore: Claymore = {
    id: nextClaymoreId++,
    owner: from.id,
    team: from.team,
    x: spot.x,
    // 地面に乗せる。足元をそのまま使うと、段差の上に置いたときに沈む
    y: spot.y,
    z: spot.z,
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
  const now = Date.now()
  for (const viewer of connected(room)) {
    for (const claymore of room.claymores) {
      // 味方の物は無条件。どこに置いたか分からないと自分が引っ掛かる
      let visible = friendlyTeam(room, viewer, claymore.team)
      if (!visible) {
        // 本体の高さ 0.2。頭の高さと同じ引数の意味 (足元からどれだけ上か)
        visible = sees(room, viewer, claymore.x, claymore.y, claymore.z, 0.2, now)
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
/**
 * その人の物が上限を超えていたら、古いほうから黙って消す。
 *
 * 消えたことは見えている人へ届く (claymoreGone の blast: false)。
 * **爆発は出さない** — 出すと置くことが遠隔起爆になる。
 */
function evictOldest(room: RoomWorld, owner: string): void {
  for (const old of overflowing(room.claymores, owner)) {
    const at = room.claymores.indexOf(old)
    if (at >= 0) room.claymores.splice(at, 1)
    broadcast(room, { type: 'claymoreGone', id: old.id, blast: false })
    for (const viewer of connected(room)) sessionOf(viewer).seenClaymores.delete(old.id)
  }
}

export function shotHitsClaymore(room: RoomWorld, from: readonly number[], to: readonly number[]): void {
  const hit = (claymore: Claymore): boolean => {
    const box: StageBox = {
      name: 'claymore',
      min: [claymore.x - SHOT_HALF, claymore.y, claymore.z - SHOT_HALF],
      max: [claymore.x + SHOT_HALF, claymore.y + SHOT_TOP, claymore.z + SHOT_HALF],
    }
    return segmentHitsBox(from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, box)
  }
  // 一覧から外してから起爆する (誘爆が一覧を書き換える。index.ts の tick と同じ形)
  for (;;) {
    const i = room.claymores.findIndex(hit)
    if (i < 0) break
    const [claymore] = room.claymores.splice(i, 1)
    detonateClaymore(room, claymore!)
  }
}

/**
 * 全部片付ける。**試合の切れ目に呼ぶ。**
 *
 * 起爆はさせない。仕切り直しで爆発が湧くのは理屈が通らない。
 */
export function clearClaymores(room: RoomWorld): void {
  for (const claymore of room.claymores) {
    broadcast(room, { type: 'claymoreGone', id: claymore.id, blast: false })
  }
  room.claymores.length = 0
  for (const viewer of connected(room)) sessionOf(viewer).seenClaymores.clear()
}

/**
 * 爆風で置き物を壊す。**クレイモアは誘爆し、DECOY は破れる。**
 *
 * 置き物を壊せるのが弾だけだと、角の罠を処理する手が「撃つ」しか無い。
 * MGO2 と同じで、手榴弾 1 個で掃除できる方が罠に対する手が増える。代わりに
 * 置く側には「並べ過ぎると 1 個で一掃される」代償が付く — 誘爆は連鎖する。
 *
 * 届く範囲は人と同じ (呼ぶ側の radius)。**遮蔽も人と同じ**で、爆心から本体へ
 * 線が通る物だけ。壁の裏の罠は残る。E LOCATOR は投げ物なので触らない。
 *
 * 誘爆の順: 一覧から外してから起爆する。外す前に起爆すると、その爆風が
 * 自分自身をもう一度見つけて止まらない。
 */
export function blastPlaced(room: RoomWorld, cx: number, cy: number, cz: number, radius: number): void {
  for (let i = room.decoys.length - 1; i >= 0; i--) {
    const decoy = room.decoys[i]!
    if (!reaches(room, cx, cy, cz, decoy.x, decoy.y + DECOY_CHEST, decoy.z, radius)) continue
    room.decoys.splice(i, 1)
    popDecoy(room, decoy)
  }
  // 誘爆。1 つ爆ぜるたびに一覧が変わるので、毎回頭から探し直す
  for (;;) {
    const i = room.claymores.findIndex((c) => reaches(room, cx, cy, cz, c.x, c.y + SENSOR_HEIGHT, c.z, radius))
    if (i < 0) break
    const [next] = room.claymores.splice(i, 1)
    detonateClaymore(room, next!)
  }
}

/** DECOY の胸の高さ (m)。爆心から見る点 */
const DECOY_CHEST = 0.9

/** 爆心から置き物へ届くか。距離の中で、線が通る */
function reaches(room: RoomWorld, cx: number, cy: number, cz: number, x: number, y: number, z: number, radius: number): boolean {
  if (Math.hypot(x - cx, y - cy, z - cz) > radius) return false
  return room.stage.sight.clear(cx, cy, cz, x, y, z)
}

/** 起爆。前に居た敵だけを巻き込む。近くの置き物は壊す (blastPlaced) */
export function detonateClaymore(room: RoomWorld, claymore: Claymore): void {
  // 起爆は隠さない。音も光も壁を回り込んで届く (手榴弾と同じドメインルール)
  broadcast(room, { type: 'claymoreGone', id: claymore.id, blast: true })
  for (const viewer of connected(room)) sessionOf(viewer).seenClaymores.delete(claymore.id)
  if (room.phase !== 'playing') return

  blastPlaced(room, claymore.x, claymore.y + SENSOR_HEIGHT, claymore.z, BLAST_RANGE)

  for (const victim of present(room)) {
    if (!canBeHurt(victim.life)) continue
    // 味方は巻き込まない。**置いた本人だけは例外** — 手榴弾を足元に落としたときと
    // 同じドメインルールで、自分の物で死ぬことがある。誰が味方かはルールが決める
    if (victim.id !== claymore.owner && !hostileToOwner(room, claymore.team, victim)) continue

    // 距離と遮蔽を測るのは sim、何ダメージかはドメインルール (domain/item/claymore.ts)。
    // **壁の裏は減る** — 手榴弾と同じ blastExposure で、体の何割が爆心から見えていたか
    const seen = blastExposure(
      claymore.x, claymore.y + SENSOR_HEIGHT, claymore.z,
      victim, headHeightOf(victim), BLAST_RANGE, room.stage.sight,
    )
    if (!seen) continue
    const hit = blastEffect(seen.distance, seen.cover)
    if (hit.damage <= 0) continue
    const hurt = applyBlastDamage(
      room, victim, hit.damage,
      claymore.x, claymore.z, claymore.owner, 'claymore', hit.knock,
    )
    // 手が緩んだら握っていた物が足元に落ちる
    if (hurt.letGo) dropGrenade(room, victim)
  }
}
