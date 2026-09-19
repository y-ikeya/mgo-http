/**
 * TARGET ALERT。**自分を攻撃してきた相手の気配が分かる。**
 *
 * EE と向きが逆 — あちらは victim を attacker の陣営へ、こちらは attacker を
 * victim の陣営へ。ただし**出るのは輪郭ではなく霧** (aware.ts の revealTo)。
 * 輪郭は「自分で見つけて撃ち抜いた」EE の実りとして残し、撃たれた側が得るのは
 * 「どの辺から来たか」まで。輪郭は分かりやすい分だけ強く、守る側に渡すと
 * 撃った側の位置取りの意味が消える。
 *
 * 入口は 3 つ (段ごと。domain/player/skill.ts の alertTriggeredBy):
 *
 *     hit   当てられた           damage.ts の expose から呼ばれる
 *     shot  撃たれた (外れても)   index.ts の shot で弾道を見る
 *     aim   構えて狙われた        刻みごとに照準を見る
 *
 * どれも**申告は受けない**。位置も向きも弾道もサーバーが持っているので、
 * 「狙われた」と名乗る手段は無い。
 */

import { HELD } from '../src/domain/item/held'
import { isHostile } from '../src/domain/match/room'
import { connected } from '../src/domain/match/match'
import { canAct } from '../src/domain/player/lifecycle'
import type { MatchPlayer } from '../src/domain/player/player'
import {
  ALERT_AIM_WIDTH,
  ALERT_AIM_RANGE,
  ALERT_SECONDS,
  ALERT_SHOT_RADIUS,
  alertTriggeredBy,
} from '../src/domain/player/skill'
import { aimedAt, shotPassesNear } from '../src/sim/judge/alert'
import { viewDirection } from '../src/sim/space/eyepoint'
import { revealTo } from './aware'
import { seesPlayer, viewOf, visibleHead } from './relay'
import { sessionOf } from './session'
import type { RoomWorld } from './world'

/** 当てられた。**EE の鏡。** damage.ts の expose と同じ所から呼ばれる */
export function alertHit(room: RoomWorld, victim: MatchPlayer, attacker: MatchPlayer): void {
  if (!alertTriggeredBy(victim.skills, 'hit')) return
  revealTo(room, attacker, victim, ALERT_SECONDS)
}

/**
 * 撃たれた。**外れた弾でも、体のそばを通れば。**
 *
 * 弾道 (from → to) は撃った本人の申告だが、嘘をついても損しかしない
 * (自分の位置と向きを偽って言う理由が無い)。
 */
export function alertShot(
  room: RoomWorld,
  shooter: MatchPlayer,
  from: readonly number[],
  to: readonly number[],
  now: number,
): void {
  for (const victim of connected(room)) {
    if (victim.id === shooter.id) continue
    if (!alertTriggeredBy(victim.skills, 'shot')) continue
    if (!canAct(victim.life) || !isHostile(room.mode, shooter, victim)) continue
    if (!shotPassesNear(from, to, victim, visibleHead(victim, now), ALERT_SHOT_RADIUS)) continue
    revealTo(room, shooter, victim, ALERT_SECONDS)
  }
}

/**
 * 狙われた。**構えて、照準が体を捉えている間。**
 *
 * 刻みごとに全員 × 全員を見るが、構えている人 × Lv3 を持つ人にしか
 * 幾何は走らない。8 人部屋で高々 16 組。
 *
 * --- 気配は伸ばし続ける、知らせは 1 秒に 1 度 ---
 * 捉えている間は気配が続いてほしいので、毎刻み revealTo を呼べば伸びる。
 * ただし伸びるたびに知らせが飛ぶと、刻みの数だけ通が出る。**残りが 1 秒
 * 減るまでは呼ばない** — 気配は切れず、知らせは秒に 1 度で済む。霧の位置も
 * 秒に 1 度しか動かないので、E LOCATOR と同じ粗さになる。
 *
 * --- 壁越しは数えない ---
 * 見えていない相手に構えても狙ったことにはならない。可視の線は位置を配る
 * ときと同じ (カメラから、頭まで)。
 */
export function alertAims(room: RoomWorld, now: number): void {
  for (const attacker of connected(room)) {
    if (!attacker.aiming || !canAct(attacker.life)) continue
    // 銃口。撃てない物 (手榴弾・ナイフ) を構えても銃口は無い
    if (!HELD[attacker.held]?.shoots) continue

    let eye: { x: number; y: number; z: number } | null = null
    let dir: [number, number, number] | null = null
    for (const victim of connected(room)) {
      if (victim.id === attacker.id) continue
      if (!alertTriggeredBy(victim.skills, 'aim')) continue
      if (!canAct(victim.life) || !isHostile(room.mode, attacker, victim)) continue
      // 残りが十分あるうちは触らない (知らせを刻みごとに出さない)
      const left = (sessionOf(victim).revealed.get(`player:${attacker.id}`) ?? 0) - now
      if (left > (ALERT_SECONDS - 1) * 1000) continue

      eye ??= viewOf(room, attacker, now)
      dir ??= viewDirection(attacker.cameraYaw, attacker.pitch)
      const head = visibleHead(victim, now)
      if (!aimedAt(eye, dir, victim, head, ALERT_AIM_WIDTH, ALERT_AIM_RANGE)) continue
      if (!seesPlayer(room, attacker, victim, now)) continue
      revealTo(room, attacker, victim, ALERT_SECONDS)
    }
  }
}
