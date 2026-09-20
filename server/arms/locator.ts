/**
 * E LOCATOR (サーバー側)。投げる・転がって止まる・周りを暴く・壊れる。
 *
 * 飛ばすところは手榴弾と同じ (投げた瞬間からサーバーが飛ばす)。止まってから
 * 先が違う:
 *
 *   1. **爆ぜない。** 止まった所に居座って、寿命まで周りを見る
 *   2. **削らない。** 効き目は damage ではなく情報 (revealTo)
 *   3. **壊せる。** 撃っても刺しても壊れる (decoy と同じ判定の形)
 *
 * 暴く仕掛けそのものは持たない。**気配にするのは aware.ts の revealTo** —
 * AWARENESS が物の気配を出すのと同じ霧で、暴かれた人の居場所を出す。
 * 長らく damage.ts の exposeTo (輪郭の発光) を使っていたが、輪郭だと向きも
 * 姿勢も読めて壁越しに撃つ準備まで済む。覗く道具は「どの辺に居るか」まで。
 */

import { connected, present } from '../../src/domain/match/match'
import { canAct, canBeHurt } from '../../src/domain/player/lifecycle'
import { MELEE_CONE_COS, MELEE_RANGE } from '../../src/domain/rule/damage'
import { isProtected, type MatchPlayer, type Team } from '../../src/domain/player/player'
import { stanceOf } from '../../src/domain/player/stance'
import type { ClientMessage, ServerMessage } from '../../src/application/protocol/types'
import { type Projectile, throwVelocity } from '../../src/sim/judge/ballistic'
import { RELEASE_HEIGHT, THROW_LOFT, throwSpeedOf } from '../../src/domain/item/grenade'
import {
  LIFE_SECONDS,
  SENSE_SECONDS,
  SCAN_RADIUS,
  SCAN_SECONDS,
  SHOT_HALF,
  SHOT_TOP,
} from '../../src/domain/item/locator'
import { type StageBox, segmentHitsBox } from '../../src/sim/space/vision'
import { revealTo } from '../aware'
import { sessionOf } from '../session'
import { type RoomWorld, broadcast, hostileToOwner, setLife } from '../world'

/**
 * 飛んでいる / 置かれている E LOCATOR。
 *
 * **置いた本人が死んでも残る。** 投げて離れる道具なので、本人が生きているかは
 * 関係ない (クレイモア・decoy と同じ)。ただし**誰の物かは覚えている** —
 * 暴いた相手を知らせる先が要る。
 */
export interface Locator {
  id: number
  owner: string
  team: Team
  body: Projectile
  /**
   * 消える時刻 (ms)。**止まるまでは決まらない。**
   *
   * 飛んでいる間に減らすと、投げ損なって遠くへ転がった分まで寿命を食う。
   * 止まった所から数え始める (domain/item/locator.ts の LIFE_SECONDS)。
   */
  dieAt: number | null
  /** 次に周りを見る時刻 (ms) */
  scanAt: number
}

export let nextLocatorId = 1

/**
 * 手を離れる位置を、投げる向きへどれだけ前に出すか (m)。手榴弾と同じ。
 *
 * 体の中心から出すと、真下へ投げたときに自分の足元をすり抜ける。
 */
const RELEASE_FORWARD = 0.45

/**
 * 投げる。**位置も初速もサーバーが作る。**
 *
 * 手榴弾と同じ式を通す (throwVelocity)。別の式にすると、同じ構えから投げても
 * 落ちる場所が変わって、画面に出ている予測線が嘘になる。
 */
export function throwLocator(room: RoomWorld, from: MatchPlayer, event: ClientMessage): void {
  if (event.type !== 'locator') return
  // **手にある物で決める。** 装備の選択で見ると、持ち替えた人が投げられない
  if (!canAct(from.life) || from.held !== 'locator' || from.grenades <= 0) return

  const [dx, dy, dz] = event.dir
  const length = Math.hypot(dx, dy, dz)
  if (!(length > 0.001)) return

  const v = throwVelocity(
    dx / length, dy / length, dz / length, throwSpeedOf(from.skills), THROW_LOFT,
  )

  from.grenades--
  // 投げた時点で無敵は切れる。守られたまま仕掛けはできない (手榴弾と同じ)
  if (isProtected(from)) setLife(room, from, 'alive')

  const id = nextLocatorId++
  const flat = Math.hypot(v.x, v.z) || 1
  const body: Projectile = {
    x: from.x + (v.x / flat) * RELEASE_FORWARD,
    // 手を離れる高さは構えで決まる。**申告は受けない** (手榴弾と同じ)
    y: from.y + RELEASE_HEIGHT[stanceOf(from.locomotion)],
    z: from.z + (v.z / flat) * RELEASE_FORWARD,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    bounces: 0,
    resting: false,
  }
  room.locators.push({ id, owner: from.id, team: from.team, body, dieAt: null, scanAt: 0 })

  broadcast(room, {
    type: 'locatorThrown',
    id,
    owner: from.id,
    team: from.team,
    from: [body.x, body.y, body.z],
    velocity: [body.vx, body.vy, body.vz],
  })
}

/**
 * 周りを暴く。**壁を見ない。**
 *
 * 見通しを要るようにすると、置いた瞬間に仕事が終わっている — 見えている相手は
 * 既に見えているので、覗く道具にならない。壁を抜けるからこそ、部屋の中や
 * 階の上を暴ける (domain/item/locator.ts の SCAN_RADIUS)。
 *
 * **宛先は投げた人 (の陣営)。** 決めているのは revealTo の中の leakTag なので、
 * ここで陣営を見る必要は無い。投げた人が抜けていれば、知らせる先が無いので
 * 何も起きない — 装置は残るが、誰の気配も出ない。
 */
function scan(room: RoomWorld, locator: Locator): void {
  const owner = room.players.get(locator.owner)
  if (!owner) return

  for (const victim of present(room)) {
    // 暴くのは戦場に立っている敵だけ。倒れている人・支度中の人は数えない
    if (!canBeHurt(victim.life)) continue
    if (victim.id === locator.owner) continue
    if (!hostileToOwner(room, locator.team, victim)) continue

    // 高さも込みで測る。**階が違えば届かない** — 平面で測ると、真上の階に
    // 居るだけの相手まで暴けて、地図の作りが意味を失う
    const distance = Math.hypot(victim.x - locator.body.x, victim.y - locator.body.y, victim.z - locator.body.z)
    if (distance > SCAN_RADIUS) continue

    revealTo(room, victim, owner, SENSE_SECONDS)
  }
}

/**
 * 飛ばす・数える・暴く。**刻みごとに呼ぶ。**
 *
 * @param steps 1 刻みで進める物理の回数。手榴弾と同じ刻みで解く
 */
export function stepLocators(
  room: RoomWorld,
  now: number,
  step: (body: Projectile) => void,
  steps: number,
): void {
  for (let i = room.locators.length - 1; i >= 0; i--) {
    const locator = room.locators[i]!
    if (!locator.body.resting) {
      for (let k = 0; k < steps; k++) step(locator.body)
      // 止まった。ここから寿命と走査が始まる
      if (locator.body.resting) {
        locator.dieAt = now + LIFE_SECONDS * 1000
        locator.scanAt = now
      }
      continue
    }

    if (locator.dieAt !== null && now >= locator.dieAt) {
      // **音は出さない。** 寿命で消えたのに鳴らすと「誰かが壊した」に読める
      removeLocator(room, i, false)
      continue
    }

    // 暴くのは試合中だけ。支度の間や結果を読んでいる間に位置が漏れると、
    // 何が起きたのか分からなくなる (銃や爆風と同じドメインルール)
    if (room.phase !== 'playing') continue
    if (now < locator.scanAt) continue
    locator.scanAt = now + SCAN_SECONDS * 1000
    scan(room, locator)
  }
}

/**
 * 置かれている装置を、まだ見ていない人へ配る。
 *
 * **飛ぶところを見ていない人に要る。** 途中から入った人と繋ぎ直した人は
 * locatorThrown を受け取っていない。届かないと、光っているのに何処に在るか
 * 分からない装置ができて、壊しようが無くなる。
 *
 * **遮蔽で隠さない** (decoy と違う)。壁の裏に在る装置は、そもそも画面で壁に
 * 隠れて見えない。配り分けても見え方は変わらないのに、見えた瞬間に届ける
 * 仕掛けだけが要る。
 */
export function relayLocators(room: RoomWorld): void {
  for (const viewer of connected(room)) {
    const seen = sessionOf(viewer).seenLocators
    for (const locator of room.locators) {
      // 飛んでいる間は配らない。止まってから 1 度だけ
      if (!locator.body.resting) continue
      if (seen.has(locator.id)) continue
      seen.add(locator.id)
      sessionOf(viewer).socket.send(
        JSON.stringify({
          type: 'locatorPlaced',
          id: locator.id,
          owner: locator.owner,
          team: locator.team,
          at: [locator.body.x, locator.body.y, locator.body.z],
        } satisfies ServerMessage),
      )
    }
  }
}

/**
 * 撃たれた装置を壊す。**申告を増やさない。**
 *
 * shot は銃口と着弾点を既に送ってきているので、その線分と当たりを見れば済む
 * (decoy と同じ)。「壊した」と言わせると、撃っていないのに壊せる。
 *
 * **飛んでいる間は壊れない。** 空を飛んでいる小さな物に当たりを立てても、
 * 撃つ側には狙えないし、当たったかどうかも見て分からない。
 */
export function shotHitsLocator(
  room: RoomWorld,
  from: readonly number[],
  to: readonly number[],
): void {
  for (let i = room.locators.length - 1; i >= 0; i--) {
    const locator = room.locators[i]!
    if (!locator.body.resting) continue
    /*
     * **地面から上へ立てる。** 止まった装置は地面に載っていて、
     * `body.y` がその接地面 (模型も底が原点に来るよう揃えてある)。
     * 中心に立てると**半分が地面に埋まって**、狙って撃った弾が下半分で外れる。
     */
    const box: StageBox = {
      name: 'locator',
      min: [locator.body.x - SHOT_HALF, locator.body.y, locator.body.z - SHOT_HALF],
      max: [locator.body.x + SHOT_HALF, locator.body.y + SHOT_TOP, locator.body.z + SHOT_HALF],
    }
    if (!segmentHitsBox(from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, box)) continue
    removeLocator(room, i, true)
  }
}

/**
 * 刺された装置を壊す。**申告を増やさない。**
 *
 * 送られてくるのは「振った」だけ。どこで振ったかはこちらが持っている
 * (decoy の stabHitsDecoy と同じ)。歩いて壊しに行った人が、目の前の装置を
 * 刃で壊せないと理屈が通らない。
 */
export function stabHitsLocator(room: RoomWorld, from: MatchPlayer): void {
  if (!canAct(from.life)) return
  // yaw = θ のときローカル -Z が (-sinθ, 0, -cosθ)
  const forward = [-Math.sin(from.yaw), -Math.cos(from.yaw)]
  for (let i = room.locators.length - 1; i >= 0; i--) {
    const locator = room.locators[i]!
    if (!locator.body.resting) continue
    const dx = locator.body.x - from.x
    const dz = locator.body.z - from.z
    const reach = Math.hypot(dx, dz)
    if (reach > MELEE_RANGE || reach < 1e-4) continue
    if ((dx / reach) * forward[0]! + (dz / reach) * forward[1]! < MELEE_CONE_COS) continue
    // 高さも見る。真上や真下の階に在る物へ刃が届いては困る
    if (Math.abs(from.y - locator.body.y) > SHOT_TOP + 1.5) continue
    removeLocator(room, i, true)
  }
}

/**
 * 場から外す。
 *
 * @param broken 壊されたなら true。寿命で消えただけなら false —
 *   **音を鳴らし分ける**ので、ここを間違えると嘘の情報になる
 */
function removeLocator(room: RoomWorld, index: number, broken: boolean): void {
  const locator = room.locators[index]!
  room.locators.splice(index, 1)
  broadcast(room, {
    type: 'locatorGone',
    id: locator.id,
    at: [locator.body.x, locator.body.y, locator.body.z],
    broken,
  })
  for (const viewer of connected(room)) sessionOf(viewer).seenLocators.delete(locator.id)
}

/** 湧き直しや試合の切れ目で片付ける */
export function clearLocators(room: RoomWorld): void {
  for (const locator of room.locators) {
    broadcast(room, {
      type: 'locatorGone',
      id: locator.id,
      at: [locator.body.x, locator.body.y, locator.body.z],
      broken: false,
      cleared: true,
    })
  }
  room.locators.length = 0
  for (const viewer of connected(room)) sessionOf(viewer).seenLocators.clear()
}
