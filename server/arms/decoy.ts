/**
 * 囮の人形 (サーバー側)。置く・膨らむ・配る・割れる。
 *
 * クレイモアと同じ「置く道具」なので、置ける場所の判定も配り方もあちらと
 * 同じ形を通す。違うのは 3 つ:
 *
 *   1. **敵にも見せる。** 見えないと撃たせられない (クレイモアは逆で、
 *      見つかった時点で仕事が半分終わる)
 *   2. **膨らむ間がある。** 半分の大きさの人形は偽物だと分かるので、
 *      展開中に見られたら罠が死ぬ
 *   3. **割れると撃った相手を晒す。** 効き目は爆風ではなく情報
 */

import { connected } from '../../src/domain/match/match'
import { canAct } from '../../src/domain/player/lifecycle'
import { STEP_UP } from '../../src/domain/player/moving'
import type { MatchPlayer, Team } from '../../src/domain/player/player'
import type { ServerMessage } from '../../src/application/protocol/types'
import { type Placed, canPlaceAt } from '../../src/sim/judge/claymore'
import {
  DEPLOY_SECONDS,
  PLACE_FORWARD,
  SHOT_HALF,
  SHOT_TOP,
} from '../../src/domain/item/decoy'
import { overflowing } from '../../src/domain/item/held'
import { type StageBox, groundUnder, segmentHitsBox } from '../../src/sim/space/vision'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast } from '../world'

/**
 * 置かれた人形。
 *
 * **置いた本人が死んでも残る。** 置いて離れる道具なので、本人が生きているかは
 * 関係ない (クレイモアと同じ)。ただし**誰の物かは覚えている** — 割れたときに
 * 晒す相手を知らせる先が要る。
 */
export interface Decoy extends Placed {
  id: number
  owner: string
  team: Team
  /**
   * 見た目。**置いた本人と同じ姿でなければ意味が無い。**
   *
   * 「その人が居る」と読ませるのが仕事なので、別の姿だと誰か分からない
   * 人形になって、撃つ理由が薄れる。
   */
  skin: string
  /** 膨らみ切る時刻 (ms)。これを過ぎるまでは半分の大きさ */
  readyAt: number
}

export let nextDecoyId = 1

/**
 * 置く。**位置も向きもサーバーが決める** — 送らせると壁の中に置ける。
 *
 * クレイモアと同じ判定を通す。置けなければ**数は減らさない** — 置けなかった
 * のに手フラグが減ると、押し間違いが取り返しの付かない損になる。
 */
export function placeDecoy(room: RoomWorld, from: MatchPlayer, now: number): void {
  // **手にある物で決める。** 装備の選択で見ると、拾って持ち替えた人が置けない
  if (!canAct(from.life) || from.held !== 'decoy' || from.grenades <= 0) return

  const forward = [-Math.sin(from.yaw), -Math.cos(from.yaw)]
  const x = from.x + forward[0] * PLACE_FORWARD
  const z = from.z + forward[1] * PLACE_FORWARD

  const ground = groundUnder(x, z, from.y, room.stage.solid, STEP_UP).top
  if (!canPlaceAt(x, z, from.y, ground, room.stage.solid)) return

  from.grenades--
  /*
   * **場に置ける数には上限がある** (クレイモアと同じ規則、PLACED_LIMIT)。
   *
   * 溢れたら古いほうから黙って消す。**破裂音を鳴らしてはいけない** —
   * 置いた本人には「誰かが撃った」と読めてしまう。**嘘の情報**になる。
   */
  evictOldest(room, from.id)

  room.decoys.push({
    id: nextDecoyId++,
    owner: from.id,
    team: from.team,
    skin: from.name,
    x,
    // 地面に乗せる。足元をそのまま使うと、段差の上に置いたときに沈む
    y: ground,
    z,
    /*
     * **置いた本人と向かい合わせにする。**
     *
     * 本人と同じ向きにすると、置いた人の背中を見ることになる。人形は
     * 「そこに誰か居る」と読ませる物なので、通りかかった側から顔が
     * 見えるほうが効く。
     */
    yaw: from.yaw + Math.PI,
    readyAt: now + DEPLOY_SECONDS * 1000,
  })

  // ここでは配らない。**見えている人にだけ**、tick が配る (relayDecoys)
}

/**
 * その人の物が上限を超えていたら、古いほうから黙って消す。
 *
 * **音も破片も出さない。** 破裂音は「撃たれた」という意味を持っているので、
 * 自分で押し出した物に鳴らすと、置いた本人が「誰かが撃った」と読む。
 */
function evictOldest(room: RoomWorld, owner: string): void {
  for (const old of overflowing(room.decoys, owner)) {
    const at = room.decoys.indexOf(old)
    if (at >= 0) room.decoys.splice(at, 1)
    broadcast(room, { type: 'decoyGone', id: old.id, at: [old.x, old.y, old.z], popped: false })
    for (const viewer of connected(room)) sessionOf(viewer).seenDecoys.delete(old.id)
  }
}

/**
 * 置かれた人形を配る。
 *
 * **クレイモアと逆で、敵にも見せる。** 見えないと撃たせられないので、
 * 遮蔽で隠すだけにする — 壁の裏に居る間は届かないが、見えた瞬間に届く。
 *
 * 遮蔽の判定は位置の配り方 (relayState) と同じ物を通す。人形は人と同じ
 * 大きさなので、そちらの規則がそのまま使える。
 */
export function relayDecoys(room: RoomWorld): void {
  for (const viewer of connected(room)) {
    const seen = sessionOf(viewer).seenDecoys
    for (const decoy of room.decoys) {
      if (seen.has(decoy.id)) continue
      seen.add(decoy.id)
      sessionOf(viewer).socket.send(
        JSON.stringify({
          type: 'decoyPlaced',
          id: decoy.id,
          owner: decoy.owner,
          at: [decoy.x, decoy.y, decoy.z],
          yaw: decoy.yaw,
          team: decoy.team,
          skin: decoy.skin,
          readyIn: Math.max(0, decoy.readyAt - Date.now()) / 1000,
        } satisfies ServerMessage),
      )
    }
  }
}

/**
 * 撃たれた人形を割る。**申告を増やさない。**
 *
 * shot は銃口と着弾点を既に送ってきているので、その線分と当たりを見れば済む
 * (クレイモアと同じ)。「囮を撃った」と言わせると、**撃っていないのに
 * 割ったことにして相手を晒せる**。
 *
 * **膨らみ切るまでは割れない。** 展開中の人形は当たりが立っていない —
 * 半分の大きさの物に当たりだけ人の大きさで立っていると、見えている形と
 * 当たる形が食い違う。
 *
 * @returns 割れた人形の持ち主。撃った相手を晒すのは呼ぶ側
 */
export function shotHitsDecoy(
  room: RoomWorld,
  from: readonly number[],
  to: readonly number[],
  now: number,
): Decoy[] {
  const broken: Decoy[] = []
  for (let i = room.decoys.length - 1; i >= 0; i--) {
    const decoy = room.decoys[i]!
    if (now < decoy.readyAt) continue
    const box: StageBox = {
      name: 'decoy',
      min: [decoy.x - SHOT_HALF, decoy.y, decoy.z - SHOT_HALF],
      max: [decoy.x + SHOT_HALF, decoy.y + SHOT_TOP, decoy.z + SHOT_HALF],
    }
    if (!segmentHitsBox(from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, box)) continue
    popDecoy(room, decoy)
    room.decoys.splice(i, 1)
    broken.push(decoy)
  }
  return broken
}

/**
 * 割る。**音は隠さない。**
 *
 * 破裂音は普通の位置音として全員へ配る。近ければ聞こえ、遠ければ聞こえない —
 * 他の音と同じ規則で両側が聞く。それだけで過不足のない情報が渡る:
 *
 *   撃った側が近い   聞こえる    晒されたと分かる。**動き直せる**
 *   撃った側が遠い   聞こえない  **晒されたまま座り続ける**
 *   置いた側が近い   聞こえる    音の輪が出る → そこを見れば光る相手を捉える
 *   置いた側が遠い   聞こえない  割れたことに気づけない
 *
 * **遠くから安全に撃った人ほど、自分が晒されたことに気づけない。**
 */
function popDecoy(room: RoomWorld, decoy: Decoy): void {
  broadcast(room, {
    type: 'decoyGone',
    id: decoy.id,
    at: [decoy.x, decoy.y, decoy.z],
    popped: true,
  })
  for (const viewer of connected(room)) sessionOf(viewer).seenDecoys.delete(decoy.id)
}

/** 湧き直しや試合の切れ目で片付ける */
export function clearDecoys(room: RoomWorld): void {
  for (const decoy of room.decoys) {
    broadcast(room, { type: 'decoyGone', id: decoy.id, at: [decoy.x, decoy.y, decoy.z], popped: false })
  }
  room.decoys.length = 0
  for (const viewer of connected(room)) sessionOf(viewer).seenDecoys.clear()
}
