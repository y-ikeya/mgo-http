import type { MatchPlayer } from '../src/domain/player/player'
import { canBeHurt, isDowned } from '../src/domain/player/lifecycle'
import { isAsleep } from '../src/domain/player/stamina'
import { trapStage } from '../src/domain/item/doll'
import { isHostile } from '../src/domain/match/room'
import { weaponOf } from '../src/domain/item/weapons'
import { AIM_RATIO, BOT_GUN, type BodyInPath, type BotGunSpec, botGunOf, botShot, firstBodyHit } from '../src/domain/rule/botGun'
import { applyDamage } from './damage'
import { dropGrenade } from './arms/grenade'
import { relayShot, seesPlayer, visibleHead } from './relay'
import type { RoomWorld } from './world'
import { leanOf, leanShift, stanceOf } from '../src/domain/player/stance'

/**
 * 撃ち返す的 (MatchPlayer.fires) を 1 刻みぶん動かす。**見えた敵へ振り向いて撃つ。**
 *
 * 決まり (距離・見える範囲・反応・ぶれ) は domain/rule/botGun.ts。ここは「誰を狙うか」と
 * 「撃ったことを配る」だけ。弾はサーバーが作るので、人の弾のような申告の確かめは通さない
 * (damage.ts の applyDamage が attacker.bot を見て飛ばす)。
 *
 * @returns 敵を狙っているか (構えて見せる)
 */
export function botGunTick(room: RoomWorld, bot: MatchPlayer, now: number, dt: number): boolean {
  const aim = aims.get(bot) ?? fresh(bot)
  if (!canShoot(room, bot, now)) {
    aim.target = null
    return false
  }
  const spec = botGunOf(bot.weapon)
  const target = pick(room, bot, aim.target, spec.range, now)
  if (!target) {
    aim.target = null
    return false
  }
  if (target.id !== aim.target) {
    aim.target = target.id
    aim.seenAt = now
    aim.burstLeft = spec.burst
  }

  // 振り向く。**照準が合うまでは撃たない**
  const dx = target.x - bot.x
  const dz = target.z - bot.z
  const distance = Math.hypot(dx, dz)
  const want = Math.atan2(-dx, -dz)
  const diff = wrap(want - bot.yaw)
  const step = BOT_GUN.turnRate * dt
  bot.yaw = Math.abs(diff) <= step ? want : bot.yaw + Math.sign(diff) * step
  bot.cameraYaw = bot.yaw
  const head = visibleHead(target, now)
  // 上下の向き。胸の高さへ (画面に構えの角度として見せる)
  aim.pitch = Math.atan2(target.y + head * AIM_RATIO - (bot.y + MUZZLE_HEIGHT), distance)

  if (now - aim.seenAt < BOT_GUN.reaction * 1000) return true
  if (Math.abs(wrap(want - bot.yaw)) > BOT_GUN.aimTolerance) return true
  if (now < aim.nextShotAt) return true

  fire(room, bot, target, distance, head, spec, now)
  aim.burstLeft--
  // 次の 1 発。**銃の連射の間隔より早くは撃たない** (狙撃銃はボルト操作を待つ)
  const interval = weaponOf(bot.weapon).fireInterval * 1000
  if (aim.burstLeft > 0) {
    aim.nextShotAt = now + interval
  } else {
    aim.burstLeft = spec.burst
    aim.nextShotAt = now + Math.max(spec.burstGap * 1000, interval)
  }
  return true
}

/** 撃ち返す的が敵を狙っているか (画面に構えて見せる) */
export function botAiming(bot: MatchPlayer): boolean {
  return !!aims.get(bot)?.target
}

/** 撃ち返す的の上下の向き (rad)。狙っていなければ 0 */
export function botPitch(bot: MatchPlayer): number {
  const aim = aims.get(bot)
  return aim?.target ? aim.pitch : 0
}

/** 銃口の高さ (足元から、m)。立って構えた肩の辺り */
const MUZZLE_HEIGHT = 1.4
/** 作業場。fire の中で使い切る */
const muzzleShift = { x: 0, z: 0 }

interface Aim {
  target: string | null
  /** 今の相手を見つけた時刻 (ms) */
  seenAt: number
  nextShotAt: number
  burstLeft: number
  pitch: number
}

const aims = new WeakMap<MatchPlayer, Aim>()
/** 相手の動きの速さを測るための、前の刻みの位置 */
const lastSeen = new WeakMap<MatchPlayer, { x: number; z: number; at: number; speed: number }>()

function fresh(bot: MatchPlayer): Aim {
  const aim: Aim = { target: null, seenAt: 0, nextShotAt: 0, burstLeft: BOT_GUN.burst, pitch: 0 }
  aims.set(bot, aim)
  return aim
}

/** 撃てる体か。倒れている・眠っている・転がされている・猫に釘付け・怯んでいる間は撃たない */
function canShoot(room: RoomWorld, bot: MatchPlayer, now: number): boolean {
  return (
    room.phase === 'playing' &&
    !isDowned(bot.life) &&
    !isAsleep(bot.sleepUntil, now) &&
    bot.downLeft <= 0 &&
    bot.knockLeft <= 0 &&
    trapStage(bot.trappedBy, bot.trapFreeAt, now) === null &&
    now >= bot.staggerUntil
  )
}

/**
 * 狙う相手。**今の相手が見えている間は替えない** (撃っている途中で隣へ振らない)。
 * 居なければ、見える範囲で見えている一番近い敵
 */
function pick(room: RoomWorld, bot: MatchPlayer, current: string | null, range: number, now: number): MatchPlayer | null {
  let best: MatchPlayer | null = null
  let bestDistance = Infinity
  for (const other of room.players.values()) {
    if (other.bot || !canBeHurt(other.life) || !isHostile(room.mode, bot, other)) continue
    const dx = other.x - bot.x
    const dz = other.z - bot.z
    const distance = Math.hypot(dx, dz)
    if (distance > range) continue
    // 見える範囲。**今の相手は範囲の外へ回っても追う** (振り向いている途中で見失わない)
    if (other.id !== current && Math.abs(wrap(Math.atan2(-dx, -dz) - bot.yaw)) > (BOT_GUN.fov * Math.PI) / 360) continue
    if (!seesPlayer(room, bot, other, now)) continue
    if (other.id === current) return other
    if (distance < bestDistance) {
      best = other
      bestDistance = distance
    }
  }
  return best
}

/** 1 発撃つ。当たったかを引いて、曳光と銃声を配り、当たっていれば削る */
function fire(
  room: RoomWorld,
  bot: MatchPlayer,
  target: MatchPlayer,
  distance: number,
  head: number,
  spec: BotGunSpec,
  now: number,
): void {
  const shot = botShot(distance, head, movingSpeed(target, now) > spec.movingSpeed, Math.random, spec)
  // 銃口。lean している的は体ごと横へ出ているので、曳光もそこから (壁の中から出さない)
  const shift = leanShift(leanOf(bot.locomotion), stanceOf(bot.locomotion), bot.yaw, muzzleShift)
  const from: [number, number, number] = [bot.x + shift.x, bot.y + MUZZLE_HEIGHT, bot.z + shift.z]
  // 着弾点。照準 (胸) から横・縦にずらす。外れは相手の向こうまで伸ばす (曳光が手前で止まらない)
  const fx = (target.x - bot.x) / distance
  const fz = (target.z - bot.z) / distance
  const reach = shot.zone ? 1 : 1 + 15 / distance
  const aimY = target.y + head * AIM_RATIO + shot.up
  const to: [number, number, number] = [
    bot.x + (target.x - bot.x) * reach - fz * shot.side,
    from[1] + (aimY - from[1]) * reach,
    bot.z + (target.z - bot.z) * reach + fx * shot.side,
  ]
  /*
   * **手前に体があれば、そこで止まる** (domain/rule/botGun.ts の firstBodyHit)。味方を盾にすれば
   * 味方が撃たれる。見るのは狙った相手まで — 外れて向こうへ伸びた先の人は見ない。
   * 的の仲間が盾になった時は止まるだけで削らない (applyDamage が敵かを見る)
   */
  const others: MatchPlayer[] = []
  const bodies: BodyInPath[] = []
  for (const other of room.players.values()) {
    if (other === bot || other === target || !canBeHurt(other.life)) continue
    others.push(other)
    bodies.push({ x: other.x, y: other.y, z: other.z, head: visibleHead(other, now) })
  }
  const blocked = firstBodyHit(from, to, bodies, 1 / reach)
  if (blocked) {
    const victim = others[blocked.index]
    const at: [number, number, number] = [
      from[0] + (to[0] - from[0]) * blocked.t,
      from[1] + (to[1] - from[1]) * blocked.t,
      from[2] + (to[2] - from[2]) * blocked.t,
    ]
    relayShot(room, bot, { type: 'shot', id: bot.id, from, to: at })
    const near = Math.hypot(at[0] - from[0], at[2] - from[2])
    const hurt = applyDamage(room, bot, { type: 'damage', id: bot.id, target: victim.id, kind: 'bullet', zone: blocked.zone, distance: near })
    if (hurt.letGo) dropGrenade(room, victim)
    return
  }
  relayShot(room, bot, { type: 'shot', id: bot.id, from, to })
  if (!shot.zone) return
  const hurt = applyDamage(room, bot, { type: 'damage', id: bot.id, target: target.id, kind: 'bullet', zone: shot.zone, distance })
  if (hurt.letGo) dropGrenade(room, target)
}

/** 相手の水平の速さ (m/s)。刻みごとの位置の差から */
function movingSpeed(target: MatchPlayer, now: number): number {
  const last = lastSeen.get(target)
  if (!last) {
    lastSeen.set(target, { x: target.x, z: target.z, at: now, speed: 0 })
    return 0
  }
  const dt = (now - last.at) / 1000
  if (dt >= 0.1) {
    last.speed = Math.hypot(target.x - last.x, target.z - last.z) / dt
    last.x = target.x
    last.z = target.z
    last.at = now
  }
  return last.speed
}

/** 角度を -π..π へ */
function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
