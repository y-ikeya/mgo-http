/**
 * DOLL (猫の置物、サーバー側)。置く・配る・釘付けにする・消える・解く。
 *
 * 置き方と配り方は decoy と同じ形を通す (置ける場所の判定・遮蔽で隠さず全員へ)。
 * 違うのは効き目で、**円に入った敵の体を止める** (domain/item/doll.ts)。
 *
 * 止まっている間の操作は本人の手元が止める (体の旗 trapped、domain/player/moves.ts)。
 * こちらは「誰がどの猫に掛かっているか」(trappedBy) を持ち、解ける時を知らせる。
 */

import { connected, present } from '../../src/domain/match/match'
import { canAct } from '../../src/domain/player/lifecycle'
import { STEP_UP } from '../../src/domain/player/moving'
import type { MatchPlayer, Team } from '../../src/domain/player/player'
import type { Locomotion } from '../../src/domain/player/locomotion'
import type { ServerMessage } from '../../src/application/protocol/types'
import { type Placed, placeSpot } from '../../src/sim/judge/claymore'
import { SHOT_HALF, SHOT_TOP, TRAPPED_CLIP_SECONDS, TRAP_SECONDS, inLure } from '../../src/domain/item/doll'
import { overflowing } from '../../src/domain/item/held'
import { type StageBox, segmentHitsBox } from '../../src/sim/space/vision'
import { STAGES } from '../../src/domain/stage'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast, freeFromTrap, hostileToOwner } from '../world'

export { releaseTrapped } from '../world'

/** 置かれた猫。**置いた本人が死んでも残る** (decoy と同じ) */
export interface Doll extends Placed {
  id: number
  owner: string
  team: Team
  /** 釘付けにした時刻 (ms)。0 ならまだ誰も掛かっていない */
  sprungAt: number
  /** 掛かった人 */
  victims: string[]
  /** 練習の部屋に置いた猫なら、ステージの置き場所の番号 (practiceDolls)。置き直すのに使う */
  practice?: number
}

let nextDollId = 1

/** 足場に立っていない姿。この間は人形に掛けない (updateDolls) */
const OFF_FOOTING: ReadonlySet<string> = new Set<Locomotion>([
  'climb',
  'climb_top',
  'hang',
  'hang_drop',
  'hang_climb',
  'vault',
  'vault_up',
])

/** 置く。**位置も向きもサーバーが決める** (decoy と同じ判定)。置けなければ数は減らさない */
export function placeDoll(room: RoomWorld, from: MatchPlayer): void {
  if (!canAct(from.life) || from.held !== 'doll' || from.grenades <= 0) return
  const spot = placeSpot(from, room.stage.solid, STEP_UP, room.stage.body)
  if (!spot.ok) return
  from.grenades--
  // 場に置ける数の上限 (PLACED_LIMIT)。溢れたら古いほうから黙って消す
  for (const old of overflowing(room.dolls, from.id)) removeDoll(room, old, false)
  room.dolls.push({
    id: nextDollId++,
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
export function relayDolls(room: RoomWorld): void {
  for (const viewer of connected(room)) {
    const seen = sessionOf(viewer).seenDolls
    for (const doll of room.dolls) {
      if (seen.has(doll.id)) continue
      seen.add(doll.id)
      sessionOf(viewer).socket.send(
        JSON.stringify({
          type: 'dollPlaced',
          id: doll.id,
          owner: doll.owner,
          team: doll.team,
          at: [doll.x, doll.y, doll.z],
          yaw: doll.yaw,
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
 * 既に掛かっている人・解けたばかりの人は掛からない。伏せていても掛かる。
 */
export function updateDolls(room: RoomWorld, now: number): void {
  for (const doll of [...room.dolls]) {
    if (doll.sprungAt > 0 && now - doll.sprungAt >= TRAP_SECONDS * 1000) {
      removeDoll(room, doll, false)
      continue
    }
    /*
     * **掛かった後も、消えるまでは後から入った敵も掛かる** (1 匹に何人でも。本人 2026-10-20)。
     * 解けるのは猫が消える時に全員まとめて。残りが型の尺より短ければ掛けない — しゃがみ込む
     * 途中で解けて、逆に流すことになる
     */
    if (doll.sprungAt > 0 && TRAP_SECONDS * 1000 - (now - doll.sprungAt) < TRAPPED_CLIP_SECONDS * 1000) continue
    const victims: MatchPlayer[] = []
    // 的 (練習の bot) も掛かる (present は bot を含む)
    for (const player of present(room)) {
      if (player.id === doll.owner || !hostileToOwner(room, doll.team, player)) continue
      if (!canAct(player.life) || player.boxed || player.trappedBy !== 0) continue
      // 解けたばかり (立ち上がっている途中 + 1 秒) は掛からない
      if (now < player.trapFreeAt) continue
      // 足場に立っていない間は掛けない (梯子・登り切る途中・ぶら下がり・跳び越え)。登り切る型の
      // 途中はまだ縁の外に居て、掛けると梯子から手が離れて下へ落ちた (本人 2026-10-20)。
      // 床に立った所で掛かる
      if (OFF_FOOTING.has(player.locomotion)) continue
      if (player.sleepUntil > now) continue
      if (!inLure(doll, player.x, player.y, player.z)) continue
      victims.push(player)
    }
    if (victims.length === 0) continue
    if (doll.sprungAt === 0) doll.sprungAt = now
    doll.victims.push(...victims.map((v) => v.id))
    for (const victim of victims) {
      victim.trappedBy = doll.id
      victim.trappedAt = now
      // 的 (bot) は猫のほうへ向き直らせる。人は本人の手元が向き直り、その向きが届く
      // yaw θ で正面が (-sinθ, -cosθ)
      if (victim.bot) victim.yaw = Math.atan2(victim.x - doll.x, victim.z - doll.z)
    }
    // 知らせるのは今回掛かった人だけ (先に掛かった人の型を流し直さない)
    broadcast(room, { type: 'dollSprung', id: doll.id, victims: victims.map((v) => v.id) })
  }
}

/**
 * 撃ち抜かれた猫を壊す。**申告を増やさない** (shot の線分と当たりで見る。decoy と同じ)。
 * 敵味方を問わず壊れる (置物を撃てば壊れる)
 */
export function shotHitsDoll(room: RoomWorld, from: readonly number[], to: readonly number[]): void {
  for (const doll of [...room.dolls]) {
    const box: StageBox = {
      name: 'doll',
      min: [doll.x - SHOT_HALF, doll.y, doll.z - SHOT_HALF],
      max: [doll.x + SHOT_HALF, doll.y + SHOT_TOP, doll.z + SHOT_HALF],
    }
    if (!segmentHitsBox(from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, box)) continue
    removeDoll(room, doll, true)
  }
}

/**
 * 爆風で壊す (手榴弾・クレイモア。claymore.ts の blastPlaced から)。**撃ち抜いた時と同じく、止まっていた人も解ける。**
 * 梯子を登り切った所に置かれた人形は、登りながらでは箱を被れず撃ちにくい — 上へ手榴弾を
 * 投げ込むのが対抗の手 (本人 2026-10-20)
 */
export function breakDoll(room: RoomWorld, doll: Doll): void {
  removeDoll(room, doll, true)
}

/** 消す。止まっていた人はここで解ける */
function removeDoll(room: RoomWorld, doll: Doll, broken: boolean): void {
  const at = room.dolls.indexOf(doll)
  if (at >= 0) room.dolls.splice(at, 1)
  if (doll.practice !== undefined) {
    const restockAt = practiceRestockAt.get(room) ?? new Map<number, number>()
    restockAt.set(doll.practice, Date.now() + PRACTICE_RESTOCK_MS)
    practiceRestockAt.set(room, restockAt)
  }
  const freed: string[] = []
  for (const id of doll.victims) {
    const player = room.players.get(id)
    if (player && player.trappedBy === doll.id) {
      freeFromTrap(player, Date.now())
      freed.push(id)
    }
  }
  broadcast(room, { type: 'dollGone', id: doll.id, at: [doll.x, doll.y, doll.z], broken, freed })
  for (const viewer of connected(room)) sessionOf(viewer).seenDolls.delete(doll.id)
}

/** 湧き直しや試合の切れ目で片付ける */
export function clearDolls(room: RoomWorld): void {
  for (const doll of [...room.dolls]) removeDoll(room, doll, false)
  for (const player of room.players.values()) player.trappedBy = 0
}

/** 練習の猫が消えてから置き直すまで (ms) */
const PRACTICE_RESTOCK_MS = 5000
/**
 * 置き直すのは、この距離 (m、高さも含む) に誰も居ない時だけ。**目の前に戻して掛けない** — 撃ち抜いた猫が
 * その場に戻り、消したはずの所で掛かった (本人 2026-10-20)。円 (1.5m) より 1m 外。
 * 4m・横だけだった頃は、塔の上 (4m 四方) や塔の真下に居る間ずっと戻らなかった
 */
const PRACTICE_RESTOCK_CLEAR = 2.5
/** 練習の猫の持ち主。人ではない (的の陣営の物として置く) */
const PRACTICE_OWNER = 'practice'
/** 練習の猫を次に置ける時刻 (ms)。置き場所の番号ごと。無ければすぐ置く */
const practiceRestockAt = new WeakMap<RoomWorld, Map<number, number>>()

/**
 * 練習の部屋に猫を置いておく (ステージの practiceDolls)。**自分で掛かって確かめるため**。
 * 的と同じ陣営 (red) の物なので、自分 (blue) が近づくと掛かる。消えたら 5 秒で置き直す
 * (近くに人が居る間は待つ)
 */
export function stockPracticeDolls(room: RoomWorld, now: number): void {
  const spots = STAGES[room.stage.name].practiceDolls ?? []
  const restockAt = practiceRestockAt.get(room)
  spots.forEach((spot, i) => {
    if (room.dolls.some((doll) => doll.practice === i)) return
    if (now < (restockAt?.get(i) ?? 0)) return
    const crowded = connected(room).some(
      (player) =>
        Math.hypot(player.x - spot.x, player.y - (spot.y ?? 0), player.z - spot.z) < PRACTICE_RESTOCK_CLEAR,
    )
    if (crowded) return
    room.dolls.push({
      id: nextDollId++,
      owner: PRACTICE_OWNER,
      team: 'red',
      x: spot.x,
      y: spot.y ?? 0,
      z: spot.z,
      yaw: 0,
      sprungAt: 0,
      victims: [],
      practice: i,
    })
  })
}
