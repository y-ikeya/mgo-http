/**
 * 手榴弾 (サーバー側)。**投げた瞬間からサーバーが飛ばす。**
 *
 * 弾と違って申告を検算しない — 軌道を持っているのがこちらなので、
 * 爆発した時点の位置がそのまま正しい。
 */

import { present } from '../../src/domain/match/match'
import { canAct, canBeHurt } from '../../src/domain/player/lifecycle'
import { headHeightOf, isProtected, type MatchPlayer, type Team } from '../../src/domain/player/player'
import type { ClientMessage } from '../../src/application/protocol/types'
import { type Projectile, throwVelocity } from '../../src/sim/judge/ballistic'
import { blastExposure } from '../../src/sim/judge/blast'
import {
  blastEffect,
  BLAST_RADIUS,
  RELEASE_HEIGHT,
  THROW_LOFT,
  throwSpeedOf,
} from '../../src/domain/item/grenade'
import { stanceOf } from '../../src/domain/player/stance'
import { applyBlastDamage } from '../damage'
import { type RoomWorld, broadcast, hostileToOwner, setLife } from '../world'

/**
 * 飛んでいる手榴弾。
 *
 * **サーバーが自分で飛ばす。** クライアントは初速だけ受け取って同じ物理を解くので、
 * 位置を毎フレーム配らなくてよい (src/sim/judge/ballistic.ts が両側で同じ結果を出す)。
 *
 * 弾と違って遡らない。投げた瞬間からこちらが飛ばしているので、爆発した時点の
 * 位置がそのまま正しい。
 */
export interface Grenade {
  id: number
  owner: string
  team: Team
  body: Projectile
  /** 爆発するまでの残り (秒) */
  fuse: number
}

export let grenadeId = 0

/** 信管 (秒)。投げてから爆発するまで */
export const FUSE = 3

/**
 * 手を離れる位置を、投げる向きへどれだけ前に出すか (m)。
 * クライアントの GRENADE_RELEASE_FORWARD と揃える。
 *
 * 体の中心から出すと、真下へ投げたときに自分の足元をすり抜ける。
 */
export const RELEASE_FORWARD = 0.45

/**
 * 1 つの命で持てる数は support の表 (domain/item/weapons.ts) が決める。
 *
 * **数を持っているのはこちら。** 投げられるか置けるかを決めているのがこちらなので、
 * 表を読む側もこちらでないと、画面の数だけ減って実際には投げられる、が起きる。
 * 手榴弾 3 / クレイモア 2 という差もそこに書いてある。
 */

export function throwGrenade(room: RoomWorld, from: MatchPlayer, event: ClientMessage): void {
  if (event.type !== 'grenade') return
  if (!canAct(from.life) || from.grenades <= 0) return

  // 向きは信じる (どこを向いているかは本人にしか分からない) が、
  // 位置と速さは信じない。位置は控えてあるものを使い、初速はこちらで作り直す。
  // 壁の中から投げる / 地図の反対側まで飛ばす、を初速の捏造で作れなくする
  const [dx, dy, dz] = event.dir
  const length = Math.hypot(dx, dy, dz)
  if (!(length > 0.001)) return
  // 速さと上向きの下駄は共有の式で決める。予測線と同じ軌道になる。
  //
  // **速さは投げた本人のスキルから引く。** 申告された速さは相変わらず信じない
  // — 見るのは席に付いているスキルで、それを決めたのはこちら (server/skills.ts)。
  const v = throwVelocity(
    dx / length, dy / length, dz / length, throwSpeedOf(from.skills), THROW_LOFT,
  )

  from.grenades--
  // 投げた時点で無敵は切れる。守られたまま攻撃はできない
  if (isProtected(from)) setLife(room, from, 'alive')
  const id = ++grenadeId
  // 前へ出す量は水平方向だけで測る (上下を向いても手の位置が動かないように)
  const flat = Math.hypot(v.x, v.z) || 1
  /*
   * 手を離れる高さは構えで決まる。**申告は受けない** — 位置や速さと同じで、
   * 見るのは控えてある姿勢 (毎秒 64 通届いている locomotion)。伏せて投げれば
   * 腕も低い所を通るので、そこから飛ばさないと壁の裏から投げられる。
   */
  const body: Projectile = {
    x: from.x + (v.x / flat) * RELEASE_FORWARD,
    y: from.y + RELEASE_HEIGHT[stanceOf(from.locomotion)],
    z: from.z + (v.z / flat) * RELEASE_FORWARD,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    bounces: 0,
    resting: false,
  }
  room.grenades.push({ id, owner: from.id, team: from.team, body, fuse: FUSE })

  // 初速だけ配る。受け取った側が同じ物理を解いて同じ軌道を描く。
  //
  // 弾倉の囮と違って、**全員に見せる**。落ちてきたのに気付けないと、
  // 逃げるという手が最初から無い。避けられるからこそ投げる場所に意味が出る。
  broadcast(room, {
    type: 'grenade',
    id,
    from: [body.x, body.y, body.z],
    velocity: [body.vx, body.vy, body.vz],
    fuse: FUSE,
  })
}

/**
 * 倒された人が握っていた手榴弾を足元に落とす。
 *
 * 振りかぶった所で止めて持てるようにした以上、持ちっぱなしにできてはいけない。
 * 落ちて爆ぜるなら、**振りかぶっている間ずっと自分が的**になる。
 * 撃つ側にも「今撃てば道連れになる」という読みが生まれる。
 *
 * 投げるときと同じ経路に乗せるので、見た目も音も爆風も全部そのまま働く。
 */
export function dropGrenade(room: RoomWorld, from: MatchPlayer): void {
  // **振りかぶっている手榴弾だけ。** 手にしているだけなら落ちないし、
  // クレイモアを構えていた人の足元に手榴弾が湧いても困る
  if (!from.holdingGrenade || from.held !== 'grenade' || from.grenades <= 0) return
  from.holdingGrenade = false
  from.grenades--

  const id = ++grenadeId
  const body: Projectile = {
    x: from.x,
    // 手から落ちる高さ。地面に埋まった状態で始めない
    y: from.y + 0.6,
    z: from.z,
    vx: 0,
    vy: 0,
    vz: 0,
    bounces: 0,
    resting: false,
  }
  room.grenades.push({ id, owner: from.id, team: from.team, body, fuse: FUSE })
  broadcast(room, {
    type: 'grenade',
    id,
    from: [body.x, body.y, body.z],
    velocity: [0, 0, 0],
    fuse: FUSE,
  })
}

/** 爆発させる。届いた相手を削って、近ければ吹き飛ばす */
export function detonate(room: RoomWorld, nade: Grenade): void {
  const { x, y, z } = nade.body

  // 爆発の位置は隠さない。音も光も壁を回り込んで届くので、伏せる意味が無い
  broadcast(room, { type: 'explosion', id: nade.id, at: [x, y, z] })

  // 削るのは試合中だけ。支度の間や結果を読んでいる間に得点が動くと、
  // 何が起きたのか分からなくなる (銃と同じドメインルール)。
  // 飛ぶことと爆ぜることは止めない — 一人で立ち上げて試せなくなる
  if (room.phase !== 'playing') return

  for (const victim of present(room)) {
    // 撃たれる状態に居る人だけ。まだ湧いていない・無敵・倒れている最中は通らない
    if (!canBeHurt(victim.life)) continue
    // 味方は巻き込まない。銃と同じドメインルールにする (誤爆で試合が壊れるより分かりやすい)。
    // 投げた本人だけは例外 — 足元に落とせば自分が吹き飛ぶ
    if (victim.id !== nade.owner && !hostileToOwner(room, nade.team, victim)) continue

    // sim が測るのは**どこに誰がどれだけ晒されていたか**まで。
    // 何ダメージかを決めるのはドメインルールの側 (domain/item/grenade.ts)
    const head = headHeightOf(victim)
    const seen = blastExposure(x, y, z, victim, head, BLAST_RADIUS, room.stage.sight)
    if (!seen) continue
    const result = blastEffect(seen.distance, seen.cover)
    if (result.damage <= 0) continue

    const hurt = applyBlastDamage(room, victim, result.damage, x, z, nade.owner, 'grenade', result.knock)
    // 手が緩んだら握っていた物が足元に落ちる。**誘爆する**
    if (hurt.letGo) dropGrenade(room, victim)
  }
}
