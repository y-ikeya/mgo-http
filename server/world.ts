/**
 * 部屋の世界。**試合と、その中に在る物。**
 *
 * 配る相手を引くのもここ (broadcast)。
 */

import { type Match, connected, newMatch, nextSlot } from '../src/domain/match/match'
import { ROOM_MODE, ROOM_STAGES, type RoomName } from '../src/domain/match/room'
import { STAGES, nextStage } from '../src/domain/match/stage'
import type { Life } from '../src/domain/player/lifecycle'
import { type Player, type Team, enterLife, newBot } from '../src/domain/player/player'
import type { ServerMessage } from '../src/protocol/types'
import type { Claymore } from './arms/claymore'
import type { Dropped } from './arms/drops'
import type { Grenade } from './arms/grenade'
import { sessionOf } from './session'
import { terrainOf, type Terrain } from './stage'

export interface Client {
  /** 発行元が保証した ID。名乗った値ではない (認証が有効なとき) */
  id: string
  /** 発行元が持っていた表示名 */
  name?: string
  /** 繋ぐ前に確かめてある (isRoomName)。以後は部屋の名前として扱ってよい */
  room: RoomName
}

/**
 * 部屋の世界。**試合 (Match) と、そこに在る物。**
 *
 * 語彙では「Match = 試合 = 部屋 1 つ」なのに、実装では手榴弾もクレイモアも
 * 落ちている武器も**モジュール全域の配列**に置いてあり、要素が
 * `room: RoomName` を持って自分がどの部屋の物かを申告していた。そのせいで
 *
 *   - 部屋の名前を 21 本の関数に引き回すことになり
 *   - 物を触るたびに「この部屋の物か」を確かめる行が要り
 *   - 部屋を畳んでも中身が残った (落ちた武器は拾われる以外に消える道が無い)
 *
 * 部屋が持てば全部消える。**Match に足せないのは domain が sim を知らない
 * ため** (手榴弾は Projectile を持つ)。だからサーバー側で包む。
 */
export interface RoomWorld extends Match {
  /** 部屋の名前。配る相手を引くのに要る */
  name: RoomName
  /** 飛んでいる手榴弾 */
  grenades: Grenade[]
  /** 置かれたクレイモア */
  claymores: Claymore[]
  /** 落ちている武器 */
  dropped: Dropped[]
  /**
   * いま乗っている地形。
   *
   * **部屋が持つ。** module の定数として全員が見ていたが、部屋ごとに違う
   * ステージを回すようになった時点で、それは「どの部屋も同じ地形」を
   * 前提にした形だった。
   *
   * 回す表 (domain/match/stage.ts) から選び直すのは試合の切れ目で、
   * いまはどの部屋も 1 枚だけの fixed なので変わらない。
   */
  stage: Terrain
}

export const rooms = new Map<RoomName, RoomWorld>()

/**
 * 投げた物・置いた物の持ち主から見て敵か。
 *
 * 弾と違って手元に Player が無い (飛んでいる物は陣営しか覚えていない) ので、
 * 陣営を渡して同じドメインルールに通す。DM では同じ色でも巻き込む。
 */
export function hostileToOwner(room: Match, owner: Team, victim: Player): boolean {
  if (room.mode.hostility === 'none') return false
  if (room.mode.hostility === 'all') return true
  return victim.team !== owner
}

/** 同じ側か。物の側に Player が無いとき用 */
export function friendlyTeam(room: Match, viewer: Player, owner: Team): boolean {
  if (room.mode.hostility === 'all') return false
  return viewer.team === owner
}

/** 1 部屋の上限。4 対 4 */
export const ROOM_CAPACITY = 8

export function roomOf(name: RoomName): RoomWorld {
  let room = rooms.get(name)
  if (!room) {
    // 回す表から 1 枚選ぶ。**初回なので前は無い** (previous = null)
    const stage = nextStage(ROOM_STAGES[name], null, Math.random())
    room = {
      ...newMatch(ROOM_MODE[name]),
      name,
      grenades: [],
      claymores: [],
      dropped: [],
      stage: terrainOf(stage),
    }
    if (room.mode.id === 'PRACTICE') placeTargets(room)
    rooms.set(name, room)
  }
  return room
}

/** 部屋の全員へ。except を渡すとその 1 人を除く */
export function broadcast(room: RoomWorld, message: ServerMessage, except?: string): void {
  const payload = JSON.stringify(message)
  for (const player of connected(room)) {
    if (player.id !== except) sessionOf(player).socket.send(payload)
  }
}

/**
 * 状態を移す。**書き換えるのはここだけ。**
 *
 * 直に代入させないのは、遷移が飛ぶと辻褄が合わなくなるため。倒れた人を
 * 支度を経ずに湧かせると装備が配り直されないし、離脱中の席を生き返らせると
 * 誰も居ない場所に人が立つ。通ってよい道は lifecycle.ts の表が持っている。
 *
 * 変わったことは全員へ知らせる。知らせないと、受け取る側がまた
 * 「位置が来ないから倒れたのだろう」と推し量ることになる。
 */
export function setLife(room: RoomWorld, player: Player, next: Life, now = Date.now()): void {
  const before = player.life
  if (!enterLife(player, next, now)) {
    if (before !== next) console.warn(`[状態] ${player.name}: ${before} → ${next} は通れない`)
    return
  }
  broadcast(room, { type: 'life', id: player.id, state: next })
}

/**
 * 練習部屋の的。**建物の西、外壁沿いの一直線に 10m 間隔**で並べる。
 *
 * 用は**距離の練習**。P90 の頭 1 発は 12m まで、AK47 は 25m まで
 * (src/domain/README.md) — その境目は説明を読むより撃ったほうが早い。
 *
 * 青の湧き地点 (-30, 30) から南へ真っ直ぐ伸びる車路で、**湧き地点の遮蔽を
 * 出た所 (z≒22) から 10 / 20 / 30 / 40 / 50m**。建物の外なので柱にも階にも
 * 邪魔されない。5 点とも床が 0m で、押し戻しも視線の遮りも無いことを
 * ステージの箱に当てて確かめてある。
 *
 * 一直線に並べても手前が奥を隠さないのは、**外した弾がそのまま次の的へ飛ぶ**
 * のがむしろ都合がよいため (縦に並んだ的は距離が読みやすい)。
 */
/** 倒してから戻るまで (ms) */
export const TARGET_RESPAWN = 3000

/**
 * 的を並べる。**座標はステージが持っている** (domain/match/stage.ts)。
 *
 * ここにレプリカを置いていて、モールの的を東棟へ移したときに取り残された
 * (試験だけが 45m 先を撃っていた)。地形の点は地形の側に 1 つ。
 */
export function placeTargets(room: RoomWorld): void {
  const now = Date.now()
  STAGES[room.stage.name].targets.forEach((at, i) => {
    const bot = newBot({
      id: `target-${i}`,
      name: `TARGET ${i + 1}`,
      slot: nextSlot(room),
      team: 'red',
      x: at.x,
      z: at.z,
      now,
    })
    room.players.set(bot.id, bot)
  })
}
