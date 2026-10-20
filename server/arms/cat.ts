/**
 * CAT (猫の置物、サーバー側)。置く・配る・釘付けにする・消える・解く。
 *
 * 置き方と配り方は decoy と同じ形を通す (置ける場所の判定・遮蔽で隠さず全員へ)。
 * 違うのは効き目で、**円に入った敵の体を止める** (domain/item/cat.ts)。
 *
 * 止まっている間の操作は本人の手元が止める (体の旗 trapped、domain/player/moves.ts)。
 * こちらは「誰がどの猫に掛かっているか」(trappedBy) を持ち、解ける時を知らせる。
 */

import { connected } from '../../src/domain/match/match'
import { canAct } from '../../src/domain/player/lifecycle'
import { STEP_UP } from '../../src/domain/player/moving'
import type { MatchPlayer, Team } from '../../src/domain/player/player'
import type { ServerMessage } from '../../src/application/protocol/types'
import { type Placed, placeSpot } from '../../src/sim/judge/claymore'
import { SHOT_HALF, SHOT_TOP, TRAP_SECONDS, inLure } from '../../src/domain/item/cat'
import { overflowing } from '../../src/domain/item/held'
import { type StageBox, segmentHitsBox } from '../../src/sim/space/vision'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast, hostileToOwner } from '../world'

export { releaseTrapped } from '../world'

/** 置かれた猫。**置いた本人が死んでも残る** (decoy と同じ) */
export interface Cat extends Placed {
  id: number
  owner: string
  team: Team
  /** 釘付けにした時刻 (ms)。0 ならまだ誰も掛かっていない */
  sprungAt: number
  /** 掛かった人 */
  victims: string[]
}

let nextCatId = 1

/** 置く。**位置も向きもサーバーが決める** (decoy と同じ判定)。置けなければ数は減らさない */
export function placeCat(room: RoomWorld, from: MatchPlayer): void {
  if (!canAct(from.life) || from.held !== 'cat' || from.grenades <= 0) return
  const spot = placeSpot(from, room.stage.solid, STEP_UP, room.stage.body)
  if (!spot.ok) return
  from.grenades--
  // 場に置ける数の上限 (PLACED_LIMIT)。溢れたら古いほうから黙って消す
  for (const old of overflowing(room.cats, from.id)) removeCat(room, old, false)
  room.cats.push({
    id: nextCatId++,
    owner: from.id,
    team: from.team,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    // 置いた本人のほうを向かせる (decoy と同じ。通りかかった側から顔が見える)
    yaw: from.yaw + Math.PI,
    sprungAt: 0,
    victims: [],
  })
}

/** 置かれた猫を配る。**敵にも見せる** — 見えないと撃ち抜けない */
export function relayCats(room: RoomWorld): void {
  for (const viewer of connected(room)) {
    const seen = sessionOf(viewer).seenCats
    for (const cat of room.cats) {
      if (seen.has(cat.id)) continue
      seen.add(cat.id)
      sessionOf(viewer).socket.send(
        JSON.stringify({
          type: 'catPlaced',
          id: cat.id,
          owner: cat.owner,
          at: [cat.x, cat.y, cat.z],
          yaw: cat.yaw,
        } satisfies ServerMessage),
      )
    }
  }
}

/**
 * 釘付けにする / 時間が来たら消す。毎刻み。
 *
 * **申告は受けない。** 猫は止まっていて、人の位置は毎刻み届いている — 判定に要る物が
 * 両方こちらに在る。掛かるのは**置いた人の敵だけ**。CBOX を被っている人・眠っている人・
 * 既に別の猫に掛かっている人は掛からない。伏せていても掛かる。
 */
export function updateCats(room: RoomWorld, now: number): void {
  for (const cat of [...room.cats]) {
    if (cat.sprungAt > 0) {
      if (now - cat.sprungAt >= TRAP_SECONDS * 1000) removeCat(room, cat, false)
      continue
    }
    const victims: MatchPlayer[] = []
    for (const player of connected(room)) {
      if (player.id === cat.owner || !hostileToOwner(room, cat.team, player)) continue
      if (!canAct(player.life) || player.boxed || player.trappedBy !== 0) continue
      if (player.sleepUntil > now) continue
      if (!inLure(cat, player.x, player.y, player.z)) continue
      victims.push(player)
    }
    if (victims.length === 0) continue
    cat.sprungAt = now
    cat.victims = victims.map((v) => v.id)
    for (const victim of victims) victim.trappedBy = cat.id
    broadcast(room, { type: 'catSprung', id: cat.id, victims: cat.victims })
  }
}

/**
 * 撃ち抜かれた猫を壊す。**申告を増やさない** (shot の線分と当たりで見る。decoy と同じ)。
 * 敵味方を問わず壊れる (置物を撃てば壊れる)
 */
export function shotHitsCat(room: RoomWorld, from: readonly number[], to: readonly number[]): void {
  for (const cat of [...room.cats]) {
    const box: StageBox = {
      name: 'cat',
      min: [cat.x - SHOT_HALF, cat.y, cat.z - SHOT_HALF],
      max: [cat.x + SHOT_HALF, cat.y + SHOT_TOP, cat.z + SHOT_HALF],
    }
    if (!segmentHitsBox(from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, box)) continue
    removeCat(room, cat, true)
  }
}

/** 消す。止まっていた人はここで解ける */
function removeCat(room: RoomWorld, cat: Cat, broken: boolean): void {
  const at = room.cats.indexOf(cat)
  if (at >= 0) room.cats.splice(at, 1)
  const freed: string[] = []
  for (const id of cat.victims) {
    const player = room.players.get(id)
    if (player && player.trappedBy === cat.id) {
      player.trappedBy = 0
      freed.push(id)
    }
  }
  broadcast(room, { type: 'catGone', id: cat.id, at: [cat.x, cat.y, cat.z], broken, freed })
  for (const viewer of connected(room)) sessionOf(viewer).seenCats.delete(cat.id)
}

/** 湧き直しや試合の切れ目で片付ける */
export function clearCats(room: RoomWorld): void {
  for (const cat of [...room.cats]) removeCat(room, cat, false)
  for (const player of room.players.values()) player.trappedBy = 0
}
