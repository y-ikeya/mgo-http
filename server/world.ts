/**
 * 部屋の世界。**試合と、その中に在る物。**
 *
 * 配る相手を引くのもここ (broadcast)。
 */

import { type Match, connected, newMatch, nextSlot } from '../src/domain/match/match'
import { ROOMS, type RoomName } from '../src/domain/match/room'
import { STAGES, nextStage } from '../src/domain/stage'
import type { Life } from '../src/domain/player/lifecycle'
import { type MatchPlayer, type Team, enterLife, newBot } from '../src/domain/player/player'
import type { ServerMessage } from '../src/application/protocol/types'
import type { Claymore } from './arms/claymore'
import type { Doll } from './arms/doll'
import { IMMUNE_SECONDS } from '../src/domain/item/doll'
import type { Decoy } from './arms/decoy'
import type { Dropped } from './arms/drops'
import type { Grenade } from './arms/grenade'
import type { Locator } from './arms/locator'
import { sessionFor, sessionOf } from './session'
import { terrainOf, type Terrain } from './stage'

export interface Client {
  /** 発行元が保証した ID。名乗った値ではない (認証が有効なとき) */
  id: string
  /** 発行元が持っていた表示名 */
  name?: string
  /** 繋ぐ前に確かめてある (isRoomName)。以後は部屋の名前として扱ってよい */
  room: RoomName
  /**
   * 部屋の帳簿 (rooms) を引く鍵。**普段は部屋の名前そのもの。** 自分だけの練習部屋
   * (?private=1) は `foxtrot~<id>` のように人ごとに分かれる (privateRoomKey)
   */
  roomKey: string
  /**
   * 断る理由。**付いていれば open で閉じる。**
   *
   * 認証の切れた token で来た接続に、符号付きの close を返すために一度受ける
   * (protocol の AUTH_CLOSE_CODE)。席は作らない。
   */
  reject?: 'auth'
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
  /** 部屋の名前。ルールと地形はこの名前の表から引く */
  name: RoomName
  /** 帳簿 (rooms) の鍵。共有の部屋は名前と同じ、自分だけの練習部屋は人ごと */
  key: string
  /** 支度の段階で全員の READY が揃った時刻 (ms)。0 なら揃っていない (server/match.ts の READY_GRACE_MS) */
  allReadyAt: number
  /** 揃う前の支度の締め切り。誰かが取り消したらここへ戻す */
  readyDeadline: number
  /** 飛んでいる手榴弾 */
  grenades: Grenade[]
  /** 置かれたクレイモア */
  claymores: Claymore[]
  /** 置かれた decoy。**割れるまでそこに在る** */
  decoys: Decoy[]
  /** 置かれた猫 (DOLL)。**釘付けにして時間が経つか、撃ち抜かれるまでそこに在る** */
  dolls: Doll[]
  /**
   * 投げられた E LOCATOR。**飛んでいる間もここに在る。**
   *
   * 手榴弾と違って、止まってからが本番 (そこで周りを暴く)。飛ぶ間と
   * 置かれた後を別の入れ物に分けると、**転がっている最中の 1 つが
   * どちらにも居ない瞬間**ができる。
   */
  locators: Locator[]
  /** 落ちている武器 */
  dropped: Dropped[]
  /**
   * いま乗っている地形。
   *
   * **部屋が持つ。** module の定数として全員が見ていたが、部屋ごとに違う
   * ステージを回すようになった時点で、それは「どの部屋も同じ地形」を
   * 前提にした形だった。
   *
   * 回す表 (domain/stage) から選び直すのは試合の切れ目で、
   * いまはどの部屋も 1 枚だけの fixed なので変わらない。
   */
  stage: Terrain
}

export const rooms = new Map<string, RoomWorld>()

/**
 * 自分だけの練習部屋の鍵。**同じルールの部屋を人ごとに作る** (2026-10-08 本人「練習で出会うな」)。
 * 一覧 (/rooms) は名前で引くので、ここで作った部屋は出ない
 */
export function privateRoomKey(name: RoomName, id: string): string {
  return `${name}~${id}`
}

/**
 * 投げた物・置いた物の持ち主から見て敵か。
 *
 * 弾と違って手元に人が無い (飛んでいる物は陣営しか覚えていない) ので、
 * 陣営を渡して同じドメインルールに通す。DM では同じ色でも巻き込む。
 */
export function hostileToOwner(room: Match, owner: Team, victim: MatchPlayer): boolean {
  if (room.mode.hostility === 'none') return false
  if (room.mode.hostility === 'all') return true
  return victim.team !== owner
}

/** 同じ側か。物の側に MatchPlayer が無いとき用 */
export function friendlyTeam(room: Match, viewer: MatchPlayer, owner: Team): boolean {
  if (room.mode.hostility === 'all') return false
  return viewer.team === owner
}

/** 1 部屋の上限。4 対 4 */
export const ROOM_CAPACITY = 8

export function roomOf(name: RoomName, key: string = name): RoomWorld {
  let room = rooms.get(key)
  if (!room) {
    // 回す表から 1 枚選ぶ。**初回なので前は無い** (previous = null)
    const stage = nextStage(ROOMS[name].stages, null, Math.random())
    room = {
      ...newMatch(ROOMS[name].mode),
      name,
      key,
      allReadyAt: 0,
      readyDeadline: 0,
      grenades: [],
      claymores: [],
      decoys: [],
      dolls: [],
      locators: [],
      dropped: [],
      stage: terrainOf(stage),
    }
    if (room.mode.id === 'PRACTICE') placeTargets(room)
    rooms.set(key, room)
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
export function setLife(room: RoomWorld, player: MatchPlayer, next: Life, now = Date.now()): void {
  const before = player.life
  if (!enterLife(player, next, now)) {
    if (before !== next) console.warn(`[状態] ${player.name}: ${before} → ${next} は通れない`)
    return
  }
  broadcast(room, { type: 'life', id: player.id, state: next })
  // 戦場を離れた (倒れた・切れた・支度へ戻った)。投げている相手は放す。猫に釘付けなら解く
  if (next !== 'alive' && next !== 'spawning') {
    releaseCqc(room, player)
    releaseTrapped(room, player)
  }
}

/**
 * 猫に釘付けの人を解く (撃たれた・倒れた・投げられた。server/arms/doll.ts)。**猫は残る** —
 * 他の人が掛かっていればそのまま、時間が来れば消える
 */
export function releaseTrapped(room: RoomWorld, player: MatchPlayer): void {
  if (player.trappedBy === 0) return
  freeFromTrap(player, Date.now())
  broadcast(room, { type: 'trapReleased', id: player.id })
}

/** 解く。**しばらくはどの猫にも掛からない** (立ち上がる間 + 1 秒。IMMUNE_SECONDS) */
export function freeFromTrap(player: MatchPlayer, now: number): void {
  player.trappedBy = 0
  player.trapFreeAt = now + IMMUNE_SECONDS * 1000
}

/**
 * CQC で投げている相手を**放す**。背中が地面に着く前に投げた側が倒れた・抜けた時。
 *
 * 相手は倒れかけの所から立ち直り、スタミナは減らない (着いた時の始末を取り消す)。
 * 人には本人へ released を送る (倒れているのは本人の画面なので)。的はこちらで立たせる
 */
/**
 * 爆風・散弾で吹き飛ばされた。**CQC より吹き飛ぶほうが強い。**
 *
 * 投げている側なら相手を放す (releaseCqc)。投げられている側なら、投げた側の
 * 着地の始末 (スタミナ) を取り消す — 本人は吹き飛ぶ型へ移る (knockdown が届く) ので
 * 放す知らせは要らない。的の転び方は呼ぶ側 (knockAway) が上書きする
 */
export function cancelCqc(room: RoomWorld, player: MatchPlayer): void {
  releaseCqc(room, player)
  for (const other of room.players.values()) {
    const session = sessionFor(other)
    if (session?.cqcThrow?.victim !== player) continue
    clearTimeout(session.cqcThrow.timer)
    session.cqcThrow = null
  }
}

export function releaseCqc(room: RoomWorld, attacker: MatchPlayer): void {
  // 的には接続が無い (投げることも無い)
  const session = sessionFor(attacker)
  const pending = session?.cqcThrow
  if (!session || !pending) return
  session.cqcThrow = null
  clearTimeout(pending.timer)
  const victim = pending.victim
  if (room.players.get(victim.id) !== victim) return
  if (victim.bot) {
    victim.downLeft = 0
    victim.downThrown = false
    return
  }
  sessionFor(victim)?.socket.send(JSON.stringify({ type: 'released' } satisfies ServerMessage))
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
 * 起き上がる型の尺 (秒)。**モデルの stand クリップに合わせてある。**
 *
 * ここを短くすると、起き上がり切る前に立ち姿へ飛んで**脚だけワープ**する。
 */
export const TARGET_STAND = 3.1

/**
 * 的が爆風で転んでから立ち終わるまで (秒)。**転ぶ間 + 起き上がる間。**
 *
 * 人は押すまで倒れたままだが、的は誰も操作しないので時間で起きる。
 * 残りが TARGET_STAND を切ったら起き上がりへ移る。
 */
export const TARGET_DOWN = 2.0 + TARGET_STAND

/**
 * 的を並べる。**座標はステージが持っている** (domain/stage)。
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
      // 地面が 0 でないステージで埋まらないように (検証場の地面は 0.1)
      y: at.y,
      stance: at.stance,
      patrol: at.patrol,
      now,
    })
    room.players.set(bot.id, bot)
  })
}
