/**
 * ダメージを入れる。**審判はここ。**
 *
 * 量を決める規則は domain (rule/damage.ts)。ここでやるのは、申告を検算して、
 * 通ったぶんを体力から引き、倒れたら記録に残すこと。
 */

import { bulletDamage, weaponOf } from '../src/domain/item/weapons'
import { loseTicket } from '../src/domain/match/match'
import { isHostile } from '../src/domain/match/room'
import { canBeHurt, isSeated } from '../src/domain/player/lifecycle'
import { downedBy, hurt, type Player, isProtected } from '../src/domain/player/player'
import { HIT_RULES, type HitZone, meleeDamage } from '../src/domain/rule/damage'
import { LAG_WINDOW } from '../src/domain/rule/lag'
import { type ClientMessage } from '../src/protocol/types'
import { verifyHit } from '../src/sim/judge/hitcheck'
import { dropGrenade } from './arms/grenade'
import { matchState } from './match'
import { bearingTo } from './relay'
import { sessionFor, sessionOf } from './session'
import { stageBoxes } from './stage'
import { type RoomWorld, broadcast, setLife } from './world'

/**
 * 爆風のダメージを 1 人に入れる。
 *
 * **手榴弾とクレイモアが同じ道を通る。** 倒したときに動くものが多い
 * (体力・残機・戦績・キル表示・握っていた物・倒した相手を映す先) ので、
 * 2 つ目の爆発物を足すときにここを写すと、必ずどれかを写し忘れる。
 *
 * @param amount 与える量。届くかどうかと、どれだけ届くかは呼ぶ側が決める
 * @param knock 転ばせるか。手榴弾もクレイモアも、近ければ転ぶ
 */
/**
 * 落下速度の上限 (m/s)。
 *
 * これ以上は同じ扱い。**申告に頼っているので、青天井にしない** — 移動を持って
 * いるのがクライアントなので、あり得ない速さを送られても分からない。
 * ステージの一番高い所 (7.5m) から落ちて 16.3 m/s なので、そこに余裕を足した値。
 */
export const MAX_FALL_SPEED = 25

/** 死因の表示。表にしておかないと、増やしたときに三項演算子が伸びる */
export const KILL_LABEL = { grenade: 'grenade', claymore: 'CLAYMORE', fall: '落下' } as const

export function applyBlastDamage(
  room: RoomWorld,
  victim: Player,
  amount: number,
  fromX: number,
  fromZ: number,
  ownerId: string,
  weapon: 'grenade' | 'claymore' | 'fall',
  knock: boolean,
): void {
  // 削るのも、倒れるかも人の側の振る舞い (domain/player/player.ts)
  const wound = hurt(victim, amount)

  // 爆心の方向。撃たれたときと同じで、どこから来たかだけ渡す
  const bearing = Math.atan2(fromX - victim.x, -(fromZ - victim.z))

  if (!wound.downed) {
    sendHealth(room, victim, amount, false, bearing)
    // **的にも爆風は当たる。** 送り先が無いなら送らないだけ
    if (knock && isSeated(victim.life)) {
      sessionFor(victim)?.socket.send(JSON.stringify({ type: 'knockdown' }))
      // 振りかぶったまま転んだら手を離す。**ピンは抜けている**ので、そのまま爆ぜる
      dropGrenade(room, victim)
    }
    return
  }

  // 誰の手柄か、戦績にどう残るかは人の側が決める
  const killer = room.players.get(ownerId) ?? null
  downedBy(victim, killer, weapon)
  setLife(room, victim, 'downed')
  // 握っていたものは足元に落ちる。誘爆する
  dropGrenade(room, victim)
  // 死因を問わず、倒された側の残機が 1 減る。**削り合わない部屋では動かさない**
  if (room.mode.tickets) loseTicket(room, victim.team)
  sendHealth(room, victim, amount, false, bearing)
  broadcast(room, matchState(room))
  broadcast(room, {
    type: 'kill',
    killer: killer?.id ?? victim.id,
    killerName: killer?.name ?? victim.name,
    killerTeam: killer?.team ?? victim.team,
    victim: victim.id,
    victimName: victim.name,
    victimTeam: victim.team,
    weapon: KILL_LABEL[weapon],
    headshot: false,
  })
}

export function sendHealth(
  room: RoomWorld,
  player: Player,
  damage: number,
  flinch: boolean,
  fromBearing?: number,
  zone?: HitZone,
): void {
  // 撃たれた方向と部位は本人にだけ渡す。
  //
  // 全員へ流すと、位置と合わせて撃った側を逆算できてしまう。被害者の座標は
  // 状態として配られているので、そこから方向へ線を引けば射手の居場所が出る。
  // 「誰に撃たれたかは渡さない」と決めた意味が無くなる。
  // 的には送り先が無い (接続を持たない)
  if (isSeated(player.life) && !player.bot) {
    sessionOf(player).socket.send(
      JSON.stringify({
        type: 'health',
        id: player.id,
        health: player.health,
        damage,
        flinch,
        fromBearing,
        zone,
      }),
    )
  }

  // 他の人に要るのは、誰がどれだけ削られたかまで。倒れた表現に使う
  broadcast(
    room,
    { type: 'health', id: player.id, health: player.health, damage, flinch },
    player.id,
  )
}

/**
 * ダメージの申告を処理する。
 *
 * 倒れている相手への攻撃は捨てる。これが無いと、同じ死体に当てた全員が
 * キルを取ることになる (撃った側の画面ではまだ生きて見えているため、
 * 申告そのものは正当に届く)。
 */
/**
 * 連射の検査に持たせる余裕 (0..1)。
 *
 * 通信のゆらぎで詰まって届くことがあるので、武器の間隔をそのまま使わず
 * 少し緩める。0.85 なら 15% 早い連射までは通す。
 */
export const FIRE_INTERVAL_SLACK = 0.85

/**
 * 申告を弾く。
 *
 * 落とすだけで、撃った側には何も返さない。「弾かれた」と伝えると、
 * 何が通って何が通らないかを試して回れてしまう。
 */
export function reject(attacker: Player, reason: string): void {
  sessionOf(attacker).rejected++
  console.warn(`[却下] ${attacker.name}: ${reason}`)
}

export function applyDamage(room: RoomWorld, attacker: Player, event: ClientMessage): void {
  if (event.type !== 'damage') return
  const victim = room.players.get(event.target)
  if (!victim || !canBeHurt(victim.life)) return
  // 撃った時点で自分の無敵は切れる。盾にしたまま撃たせない
  if (attacker.life === 'spawning') setLife(room, attacker, 'alive')
  // 湧いた直後の相手には当たらない
  if (isProtected(victim)) return
  // 撃てる相手か。**陣営ではなくルールに聞く** — DM では同じ色でも敵で、
  // 休憩部屋では誰も敵ではない (src/domain/match/room.ts)
  if (!isHostile(room.mode, attacker, victim)) return
  // 試合中以外は削らない。支度の間や結果を読んでいる間に得点が動くと、
  // 何が起きたのか分からなくなる
  if (room.phase !== 'playing') return

  // --- ここから、申告が本当かを調べる ---
  //
  // 当たり判定そのものはクライアントが持っている (骨の姿勢を持っているのが
  // あちらだけなので)。だからこそ、位置から分かることは信じない。
  // 撃った本人しか知り得ないことは信じ、こちらで確かめられることは確かめる。

  // 連射の速さ。0.09 秒間隔が上限なので、それを超えて届いたら作り物
  if (event.kind === 'bullet') {
    const now = Date.now()
    const limit = weaponOf(attacker.weapon).fireInterval * 1000 * FIRE_INTERVAL_SLACK
    if (now - sessionOf(attacker).lastShotAt < limit) {
      reject(attacker, `連射が速すぎる (${now - sessionOf(attacker).lastShotAt}ms)`)
      return
    }
    sessionOf(attacker).lastShotAt = now
  }

  const verdict = verifyHit(
    attacker.history,
    victim.history,
    {
      kind: event.kind,
      zone: event.zone,
      distance: event.distance,
      fromBehind: event.fromBehind,
    },
    stageBoxes,
    LAG_WINDOW,
    HIT_RULES,
  )
  if (!verdict.ok) {
    reject(attacker, verdict.reason)
    return
  }

  const amount =
    event.kind === 'melee'
      ? meleeDamage(event.fromBehind ?? false)
      : bulletDamage(weaponOf(attacker.weapon), (event.zone ?? 'BODY') as HitZone, event.distance ?? 0)

  const wound = hurt(victim, amount)
  // 撃たれたら集中は途切れる。回復は最初から待ち直し。
  victim.concentratingSince = 0

  if (!wound.downed) {
    // 頭に当たったのに倒れなかったときだけ怯ませる。
    // 胴でも出すと、連射している間ずっと怯み続けて棒立ちになる。
    const flinch = event.kind === 'bullet' && event.zone === 'HEAD'
    // **仰け反れば手が緩む。** 振りかぶったまま撃たれたら足元に落ちる。
    // 遠くから頭を撃たれた人が、そのまま何事もなく投げ切るのはおかしい
    if (flinch) dropGrenade(room, victim)
    sendHealth(
      room,
      victim,
      amount,
      flinch,
      bearingTo(victim, attacker),
      event.zone,
    )
    return
  }

  // 記録に残す分。**表示名ではなく安定した id で数える**
  const headshot = event.kind === 'bullet' && event.zone === 'HEAD'
  const by = event.kind === 'melee' ? 'knife' : attacker.weapon
  downedBy(victim, attacker, by, headshot)
  setLife(room, victim, 'downed')
  // 振りかぶったまま倒されたら、足元に落ちて爆ぜる。
  // 撃った側にとっては「今撃つと道連れになる」という読みになる
  dropGrenade(room, victim)
  // 減るのは倒された側の残機だけ。倒した側には何も入らない
  if (room.mode.tickets) loseTicket(room, victim.team)
  sendHealth(room, victim, amount, false, bearingTo(victim, attacker))
  broadcast(room, matchState(room))
  broadcast(room, {
    type: 'kill',
    killer: attacker.id,
    killerName: attacker.name,
    killerTeam: attacker.team,
    victim: victim.id,
    victimName: victim.name,
    victimTeam: victim.team,
    // 背後から刺したかは表記に出さない。即死かどうかで結果は既に出ているし、
    // 倒された側に「背後を取られた」と明示しても、次に活かせる情報にならない。
    // 倒したときに使っていた銃。表から引く (直書きすると増やすたびに嘘になる)
    weapon: event.kind === 'melee' ? 'KNIFE' : weaponOf(attacker.weapon).kill,
    headshot: event.kind === 'bullet' && event.zone === 'HEAD',
  })
}
