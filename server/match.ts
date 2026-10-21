import type { Locomotion } from '../src/domain/player/locomotion'
/**
 * 試合の段階と時計。
 *
 * 誰が湧いて、いつ始まって、いつ終わるか。得点そのもののドメインルールは domain
 * (rule/scoring.ts)、ここに在るのはそれを試合の時間に当てはめる側。
 */

import {
  MIN_PLAYERS,
  ASSEMBLED_SECONDS,
  READY_SECONDS,
  type Match,
  connected,
  holdingSeats,
  leakingOf,
  present,
  shuffleTeams,
  soleTeam,
} from '../src/domain/match/match'
import { livesOf, primariesOf, secondaryOf, supportsOf } from '../src/domain/match/room'
import { clearTsneTarget, placeTsneTarget, updateTsneTarget } from './target'
import { canRespawn, cautionUntil, sideOf, stealthActive, standing, swapSides } from '../src/domain/match/sides'
import { fitLoadout } from '../src/domain/player/equip'
import { canChoose, isDowned, isSeated } from '../src/domain/player/lifecycle'
import { type MatchPlayer, type Team, lifeElapsed, refill, reviveBot } from '../src/domain/player/player'
import { MAX_HEALTH, knockSpeed } from '../src/domain/rule/damage'
import { MAX_STAMINA, isAsleep } from '../src/domain/player/stamina'
import { encodeSnapshot } from '../src/infra/codec/snapshot'
import type { ServerMessage } from '../src/application/protocol/types'
import { clearClaymores } from './arms/claymore'
import { clearDolls } from './arms/doll'
import { trapStage } from '../src/domain/item/doll'
import { clearDecoys } from './arms/decoy'
import { clearLocators } from './arms/locator'
import { relayState, sendHealth, sendStamina } from './relay'
import { sessionFor, sessionOf, sessions } from './session'
import { closeMatch, recordPlayer } from './stats'
import { type RoomWorld, TARGET_RESPAWN, TARGET_STAND, broadcast, releaseCqc, setLife } from './world'
import { forgetPoses, recordPose } from './history'

/** 1 試合の長さ (ms) */
export const MATCH_DURATION_MS = 5 * 60 * 1000

/**
 * 陣営ごとの残機。TDM の勝敗はこれの削り合いで決まる。
 *
 * 死因を問わず 1 ずつ減り、**0 になった側が負け**。時間切れなら多く残っている
 * ほうが勝ち。倒した数ではなく「相手をどれだけ削れたか」で決まるので、
 * 相打ちを重ねても差が付かない。
 *
 * 20 は 4 対 4 で 5 分の試合を想定した数。1 人あたり 5 回死ねる勘定で、
 * 削り切って終わることも時間切れになることも両方ある辺り。**実際に回して詰める**
 * ものなので、環境変数で変えられるようにしてある (箱の上で試すのに再配置が要らない)。
 */
export const TICKETS = Math.max(1, Number(process.env.MGO2_TICKETS) || 20)
/**
 * 揃った告知の長さ (ms)。**試験だけ 0 にする** (MGO2_ASSEMBLE_MS)。試験は揃ってすぐ
 * READY を押すので、5 秒の告知の間に押した分は支度に入った所で消えてしまう
 */
const ASSEMBLE_MS = process.env.MGO2_ASSEMBLE_MS !== undefined ? Number(process.env.MGO2_ASSEMBLE_MS) : ASSEMBLED_SECONDS * 1000
/**
 * 全員の READY が揃ってから数え始めるまで (ms)。**この間に誰かが取り消せば支度へ戻る。**
 * 揃った瞬間に始めていた頃は、相手が先に押していると自分の 1 押しで支度が終わり、
 * 押し間違いに気付いても取り消す間が無かった (2026-10-09 本人)。試験は 0 (test/server.ts)
 */
const READY_GRACE_MS = process.env.MGO2_READY_GRACE_MS !== undefined ? Number(process.env.MGO2_READY_GRACE_MS) : 3000

/**
 * ラウンドの合間 (ms)。「ROUND 1 OVER」を見せる時間。最後の 1 秒で画面が黒へ落ちる (Hud.tsx)
 */
export const ROUND_BREAK_MS = 4 * 1000

/**
 * 決着してから次の支度が始まるまで (ms)。結果を読む時間。
 *
 * **結果の曲が鳴り終わるまで待つ** (2026-10-17 本人)。「試合終了」の帯 2.4 秒の後に結果の画面が
 * 開いて曲 (public/audio/result1.mp3、11.45 秒) が始まるので、2.4 + 11.45 に少し足して 14.5 秒。
 * 曲を差し替えたらここも合わせる
 */
export const INTERMISSION_MS = 14.5 * 1000

/**
 * 試合が始まるまでの数え (ms)。
 *
 * 全員を湧き地点へ戻してから始める。戻す瞬間にいきなり撃ち合いが始まると、
 * 画面が切り替わった側が一方的に不利になる。
 */
export const COUNTDOWN_MS = 5 * 1000

/** 試合の状態を配る間隔 (ms)。残り時間の表示に要る */
/** 刻み 1 回ぶんの秒。**index.ts の TICK_MS と揃える** */
const TICK_SECONDS = 1 / 64

export const MATCH_BROADCAST_MS = 1000

/**
 * 自分の本当の値を配る間隔 (ms)。**試合の便より粗い。**
 *
 * あちらは全員へ同じ物を 1 通、こちらは**人ごとに違う物を人数分**送るので、
 * 同じ間隔だと 8 人部屋で 8 倍になる。
 *
 * 粗くてよいのは、これが**ずれ直し専用**だから。撃った瞬間に減らすのも
 * 体力 0 で倒れるのもクライアントがやっていて、ここは「本当はこう」を
 * 後から渡すだけ。ずれるのは申告が落ちたときだけなので稀で、3 秒直らなくても
 * 遊びには出ない。
 */
export const SELF_BROADCAST_MS = 3000

/**
 * 往復の時間を測る間隔 (ms)。
 *
 * 細かく測っても使い道が無い (切る判断は 5 回続いたときなので、1 秒でも
 * 5 秒で答えが出る)。**測るために通信を増やすのは本末転倒**なので、
 * 1 人 1 秒に 1 往復までにする。
 */
export const PING_INTERVAL_MS = 1000

/**
 * 遮蔽になる箱。ステージの書き出しが glb と一緒に作る。
 *
 * サーバーが glb を解析する必要は無い。要るのは箱の位置と寸法だけで、
 * それは書き出しのときに分かっている。glb と同時に書かれるので、
 * 片方だけ古い形を見ている、ということが起きない。
 */
/**
 * 的を動かす (動かないが、生き死にと配信はする)。
 *
 * 位置はサーバーが作る。人のように**送ってくる相手が居ない**ので、姿を組み立てて
 * 自分で配る。遮蔽の判定は人と同じ道 (relayState) を通すので、壁の裏の的は
 * 見えない。
 */
export function updateTargets(room: RoomWorld, now: number): void {
  for (const bot of room.players.values()) {
    if (!bot.bot) continue

    /*
     * 爆風で飛んでいる間、こちらが滑らせる。
     *
     * **的は接続を持たない**ので、動かす人が居ない。人は自分の画面で自分を
     * 動かす (位置を持っているのがクライアント) が、的はサーバーが持っている。
     *
     * 速さの式は人と同じ (domain/rule/damage.ts の knockSpeed)。別に持つと
     * **同じ爆風で飛ぶ距離が変わる**。
     */
    if (bot.knockLeft > 0) {
      const step = Math.min(bot.knockLeft, TICK_SECONDS)
      const speed = knockSpeed(bot.knockLeft)
      bot.x += bot.knockX * speed * step
      bot.z += bot.knockZ * speed * step
      bot.knockLeft = Math.max(0, bot.knockLeft - TICK_SECONDS)
    }
    if (bot.downLeft > 0) bot.downLeft = Math.max(0, bot.downLeft - TICK_SECONDS)

    /*
     * 眠りから醒める。**的も自分では起きられない。**
     *
     * 人のほうは接続のある席だけを回して醒ましている (server/index.ts)。的は
     * 接続を持たないのでその輪に入らず、**一度眠ったら二度と起きなかった**。
     * 動かす人が居ない物はここで動かす、という他の処理 (爆風で滑る・時間で
     * 立ち上がる) と同じ扱いにする。
     */
    if (bot.sleepUntil > 0 && now >= bot.sleepUntil) {
      bot.sleepUntil = 0
      bot.stamina = MAX_STAMINA
    }

    patrol(bot, now)

    if (isDowned(bot.life) && lifeElapsed(bot, now) >= TARGET_RESPAWN) {
      reviveBot(bot, now)
      broadcast(room, { type: 'life', id: bot.id, state: 'alive' })
      broadcast(room, { type: 'respawn', id: bot.id })
      broadcast(room, { type: 'health', id: bot.id, health: bot.health, damage: 0, flinch: false })
    }
    // **見せている姿を、審判が見る姿にもする。** 送る姿だけ組み立てていた頃は、
    // 転んでいても眠っていても審判の中では立っていて、足元の的に真っ直ぐ前を
    // 刺しても刺さった (2026-10-08)
    const next = targetLocomotion(bot, now)
    // 姿が変わった時刻を控える。**途中から見えた人は、その分だけ型を進めて流す** (locomotionAge)。
    // 0 のまま送っていて、眠っている的の傍で画面を読み直すと倒れる所から流れた
    if (next !== bot.locomotion) botPoseSince.set(bot, now)
    bot.locomotion = next
    // 箱を被った的は、座っている間だけ箱の中 (倒されたら箱が落ち、起き上がったらまた被る)
    bot.boxed = bot.homeStance === 'box' && next === 'sit'
    recordPose(bot)
    relayState(room, bot, targetPayload(bot, now))
  }
}

/*
 * 的の姿。倒れた / 眠っている / 転んでいる / 起き上がっている / 立っている。
 *
 * **起き上がる型を挟む。** 転んだ姿から直に立ち姿へ飛ばすと、寝た脚と
 * 立った上半身が混ざって、銃を上空へ構えて見える。
 *
 * **倒れたほうが眠りより強い。** 眠っている的を撃って倒したら、
 * 眠ったままではなく倒れた姿へ移らないと、何が起きたのか読めない。
 *
 * 眠りを爆風の転倒より先に見るのは、**眠っている間は飛ばされても
 * 起き上がらない**から。転んで立ち上がる型に移ると、眠っているのに
 * 立つ、という絵になる。
 */
export function targetLocomotion(bot: MatchPlayer, now: number): Locomotion {
  if (isDowned(bot.life)) return bot.downFromBehind ? 'death_front' : 'death_back'
  if (isAsleep(bot.sleepUntil, now)) return 'sleep'
  // 猫に釘付け (掛かっている / 立ち上がっている途中)。眠りより後、転倒より先
  const trap = trapped(bot, now)
  if (trap) return trap
  if (bot.downLeft > TARGET_STAND) return bot.downThrown ? 'cqc_thrown' : bot.downRolled ? 'hit2back' : 'sweep'
  if (bot.downLeft > 0) return 'stand'
  if (patrolling(bot, now)) return 'run_f'
  // 左右へ lean し続ける的。LEAN_SWAP_MS ごとに入れ替える (体の出し入れは型が受け持つ)
  if (bot.homeStance === 'lean') return Math.floor(now / LEAN_SWAP_MS) % 2 === 0 ? 'lean_left' : 'lean_right'
  return REST[bot.homeStance]
}

/** lean し続ける的が左右を入れ替える間隔 (ms) */
const LEAN_SWAP_MS = 1500

/** 猫に釘付けの姿 (掛かっている / 立ち上がっている途中)。どちらでもなければ null */
function trapped(bot: MatchPlayer, now: number): 'trapped' | 'trapped_hold' | 'trapped_out' | null {
  const stage = trapStage(bot.trappedBy, bot.trapFreeAt, now, bot.trappedAt)
  return stage === 'in' ? 'trapped' : stage === 'hold' ? 'trapped_hold' : stage === 'out' ? 'trapped_out' : null
}

/**
 * 走り続ける的の速さ (m/s)。**人の走りと同じ** — CQC の練習で、走ってくる相手に
 * 合わせられるように (soldier.ts の MOVE_SPEED)
 */
const PATROL_SPEED = 2.74

/** 的が走っている最中か。倒れている・眠っている・転んでいる・投げられている間は走らない */
function patrolling(bot: MatchPlayer, now: number): boolean {
  return (
    bot.patrolTo !== null &&
    !isDowned(bot.life) &&
    !isAsleep(bot.sleepUntil, now) &&
    bot.downLeft <= 0 &&
    bot.knockLeft <= 0 &&
    // 猫に釘付けの間・立ち上がっている間は止まる
    trapStage(bot.trappedBy, bot.trapFreeAt, now) === null &&
    // 体当たりで怯んでいる間も止まる
    now >= bot.staggerUntil
  )
}

/**
 * 走り続ける的を 1 刻みぶん進める。**置き場と patrolTo の間を往復する。**
 *
 * 端に着いたら折り返す。転ばされた後はその場から、いま向かっていた端へ走り直す
 * (並び直すのは倒された時だけ、reviveBot)。向きは走っている向き
 */
function patrol(bot: MatchPlayer, now: number): void {
  if (!patrolling(bot, now) || !bot.patrolTo) return
  const goal = bot.patrolOut ? bot.patrolTo : { x: bot.homeX, z: bot.homeZ }
  const dx = goal.x - bot.x
  const dz = goal.z - bot.z
  const left = Math.hypot(dx, dz)
  const step = PATROL_SPEED * TICK_SECONDS
  if (left <= step) {
    bot.x = goal.x
    bot.z = goal.z
    bot.patrolOut = !bot.patrolOut
    return
  }
  bot.x += (dx / left) * step
  bot.z += (dz / left) * step
  // 向き 0 で -Z を向く (domain/player/stance.ts の leanShift と同じ取り方)
  bot.yaw = Math.atan2(-dx, -dz)
}

/** 的の姿が変わった時刻 (ms)。型の経過 (locomotionAge) を出すのに使う */
const botPoseSince = new WeakMap<MatchPlayer, number>()

/** 的が何もされていない時の姿。構えごと */
const REST: Record<MatchPlayer['homeStance'], Locomotion> = {
  stand: 'idle',
  crouch: 'crouch_idle',
  prone: 'prone_idle',
  // 箱を被って座っている (人が箱の中で止まった時と同じ姿)
  box: 'sit',
  // lean し続ける的の、どちらでもない時の姿 (targetLocomotion が左右を決める)
  lean: 'idle',
}

/** 的の姿を 1 通ぶん組み立てる。人が送ってくるものと同じ形 */
export function targetPayload(bot: MatchPlayer, now: number): Uint8Array {
  return new Uint8Array(
    encodeSnapshot(
      {
        id: bot.id,
        time: now,
        x: bot.x,
        y: bot.y,
        z: bot.z,
        yaw: bot.yaw,
        pitch: 0,
        cameraYaw: bot.yaw,
        locomotionAge: (now - (botPoseSince.get(bot) ?? now)) / 1000,
        locomotion: bot.locomotion,
        aiming: false,
        weapon: 'rifle',
        crouching: bot.homeStance === 'crouch' && bot.locomotion === 'crouch_idle',
        boxed: bot.boxed,
        reloading: false,
        protectedNow: false,
        stealthed: false,
        holdingGrenade: false,
        // 箱を被っているかは手にある物で届く (snapshot.ts の held === 'box')
        held: bot.boxed ? 'box' : 'rifle',
        concentrating: false,
        saluteHeld: false,
      },
      bot.slot,
    ),
  )
}

/**
 * 少ないほうへ入れる。同数なら青。
 *
 * 本人に選ばせない。人数が偏ったまま始まると、腕前より頭数で決まってしまう。
 */

/** 残機を削り切ったか。個人戦は部屋で 1 つの池を見る */
export function ticketsGone(room: Match): boolean {
  return room.mode.teams ? room.blue <= 0 || room.red <= 0 : room.blue <= 0
}

/**
 * 勝敗。
 *
 * 陣営戦は残機の多いほう。**個人戦は勝った「陣営」が無い**ので、色としては
 * draw を返す — 誰が勝ったかは倒した数 (成績表) が答える。
 */
export function decideWinner(room: Match): Team | 'draw' {
  if (!room.mode.teams) return 'draw'
  /*
   * **攻守に分かれる部屋は、両方残ったまま時間が来たら守る側の勝ち。**
   * blue / red はまだ戦える人数 (standingCounts)。片方が 0 なら下の通り相手の勝ち
   */
  // **ターゲットを自陣まで運んだら攻める側の勝ち** (domain/match/target.ts)。人数より先に見る
  if (room.mode.sides && room.targetDelivered) return room.attack
  if (room.mode.sides && room.blue > 0 && room.red > 0) {
    return room.attack === 'blue' ? 'red' : 'blue'
  }
  if (room.blue <= 0 || room.red <= 0) {
    return room.blue <= 0 && room.red <= 0 ? 'draw' : room.blue <= 0 ? 'red' : 'blue'
  }
  return room.blue === room.red ? 'draw' : room.blue > room.red ? 'blue' : 'red'
}

export function matchState(room: Match): ServerMessage {
  // **光っている人**を送る。1 位かどうかではなく、位置が公になっているか
  const leader = leakingOf(room)
  return {
    type: 'match',
    // いま走っている試合の札。URL と戦績の表で同じ物を指す
    matchId: room.matchId ?? undefined,
    mode: room.mode.id,
    leader: leader?.id,
    blue: room.blue,
    red: room.red,
    attack: room.mode.sides ? room.attack : undefined,
    stealth: room.mode.sides ? stealthActive(room, Date.now()) : undefined,
    cautionUntil: cautionUntil(room, Date.now()) ?? undefined,
    round: room.mode.sides ? room.round : undefined,
    roundWins: room.mode.sides ? room.roundWins : undefined,
    target: room.target
      ? { x: room.target.x, y: room.target.y, z: room.target.z, carrier: room.target.carrier }
      : undefined,
    endsAt: room.endsAt,
    sentAt: Date.now(),
    phase: room.phase,
    present: connected(room).length,
    required: MIN_PLAYERS,
    winner: room.winner,
    // 戦績。1 秒ごとに配られるので、成績表はこれを見れば足りる。
    //
    // 離脱中の人も**消さずに残す**。リロードしている 2 秒のあいだ行が消えて
    // 戻ってくると、点差を見ている側には試合が壊れたように見える
    // **的 (bot) は出さない。** 成績表に「動かない相手」の行が並んでも読めない
    players: [...room.players.values()].filter((p) => !p.bot).map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      suicides: p.suicides,
      stuns: p.stuns,
      ready: p.ready,
      away: !isSeated(p.life),
      // 位置が届いている回数 (通/秒)。名目は 64。
      //
      // **全員に見せる。** 「相手がカクつく / 消える」の原因が誰にあるかは、
      // これを見れば一目で分かる。調べるのに /health を叩いたり
      // DevTools を開いてもらったりしていた
      rate: sessionOf(p).packetGap > 0 ? Math.round(1000 / sessionOf(p).packetGap) : 0,
    })),
  }
}

/**
 * その人の装備を、部屋 (と側) で持ち込める物に合わせる。
 *
 * 入った時と試合の頭で呼ぶ。攻守に分かれる部屋は側ごとに縛りが違う (room.ts の armory)
 */
export function fitToRoom(room: RoomWorld, player: MatchPlayer): void {
  const side = sideOf(room, player.team)
  fitLoadout(player, primariesOf(room.name, side), secondaryOf(room.name, side), supportsOf(room.name, side))
}

/**
 * 後攻のラウンドへ。**支度 (スキル選び) を挟まず、攻守を入れ替えて秒読みから** (TSNE)。
 *
 * 試合の札・戦績はそのまま (1 試合の続き)。置いた物は片付ける — 前のラウンドの守る側の
 * クレイモアが、次のラウンドでは攻める側の物として残ることになる。装備は側が変わったので
 * 選び直す (支度の画面は出す。スキルの窓は出さない)
 */
function startNextRound(room: RoomWorld, now: number): void {
  room.round += 1
  swapSides(room)
  clearTsneTarget(room)
  room.revealedUntil = 0
  room.grenades.length = 0
  clearClaymores(room)
  clearDecoys(room)
  clearDolls(room)
  clearLocators(room)
  for (const player of connected(room)) {
    fitToRoom(room, player)
    player.roundDeaths = 0
    player.sleepUntil = 0
    setLife(room, player, 'choosing', now)
    player.health = MAX_HEALTH
    player.concentratingSince = 0
    sendHealth(room, player, 0, false)
  }
  room.phase = 'countdown'
  room.endsAt = now + COUNTDOWN_MS
  room.winner = undefined
  broadcast(room, rosterMessage(room))
}

/**
 * ラウンドの決着。**後攻まで終わっていれば試合の決着** (勝ったラウンドが多い側、1 対 1 は引き分け)。
 * まだなら後攻のラウンドへ。分かれない部屋はそのまま試合の決着
 */
function endRound(room: RoomWorld, now: number): void {
  const winner = decideWinner(room)
  if (room.mode.sides) {
    if (winner !== 'draw') room.roundWins[winner] += 1
    if (room.round < 2) {
      // 合間を挟んでから後攻へ (updateMatch の break)。winner はこのラウンドの勝ち
      room.phase = 'break'
      room.winner = winner
      room.endsAt = now + ROUND_BREAK_MS
      return
    }
    const { blue, red } = room.roundWins
    room.winner = blue === red ? 'draw' : blue > red ? 'blue' : 'red'
  } else {
    room.winner = winner
  }
  room.phase = 'over'
  room.endsAt = now + INTERMISSION_MS
  finishMatch(room)
}

/** 全員を湧き地点へ戻して立たせる。段階が変わるたびに呼ぶ */
export function resetPlayers(room: RoomWorld): void {
  /*
   * 前の試合の手榴弾が残っていると、始まった直後に爆発する。
   *
   * **置いた物も片付ける。** 残すと次の試合が前の試合の罠だらけで始まるし、
   * 陣営は切り直される (下の shuffleTeams) ので、**前の試合の自分の罠が
   * 今の試合では味方の罠**になる。誰の物として数えるかが決まらない。
   */
  room.grenades.length = 0
  clearClaymores(room)
  clearDecoys(room)
  clearDolls(room)
  clearLocators(room)
  /*
   * **陣営を切り直す。** 入室で 1 回決めたきりだと、同じ面子が同じ側で
   * 何試合も続く。強い側が勝ち続け、負けている側から抜けていく。
   *
   * 切ったら名簿を配り直す。**差分 (life / health) では陣営が動かない**ので、
   * 配らないとクライアントは前の試合の色のまま描く。
   */
  /*
   * **攻守に分かれる部屋 (TSNE) は切り直さない。** 同じ顔ぶれで攻めと守りを入れ替えるのが
   * 攻守交代 — 切り直すと、誰が攻めるかが毎回くじになる。入れ替えは enterReady
   */
  if (!room.mode.sides) shuffleTeams(room, Math.random)
  /*
   * 試合ごとの数は**席を持っている全員**で戻す (戻りを待っている人も)。繋がっている人だけ
   * 戻していた頃は、試合の合間にリロードした人の roundDeaths が前の試合のまま残り、TSNE では
   * 次の試合の頭から「もう湧けない人」に数えられて、始まった途端にラウンドが終わった
   * (2026-10-19、ターゲットの試験で出た)
   */
  for (const player of room.players.values()) {
    player.kills = 0
    player.deaths = 0
    player.roundDeaths = 0
    // 記録に残す分もここで戻す。**足したら必ずここにも足す** —
    // 戻し忘れると前の試合の数が次に混ざる
    player.headshots = 0
    player.headDeaths = 0
    player.suicides = 0
    player.killsByWeapon = {}
    player.sleepUntil = 0
  }
  for (const player of connected(room)) {
    // 側が変われば持ち込める物も変わる。前の側の銃を持ったまま出さない
    if (room.mode.sides) fitToRoom(room, player)
    // 仕切り直しは支度から。いきなり湧かせない —
    // 前の試合の装備のまま次が始まるのは、選ぶ場面を 1 回飛ばすのと同じ
    setLife(room, player, 'choosing')
    player.health = MAX_HEALTH
    player.concentratingSince = 0
    sendHealth(room, player, 0, false)
  }
  broadcast(room, rosterMessage(room))
}

/**
 * 湧かせる。装備を配り直して、無敵を付けて、戦場へ出す。
 *
 * 支度からしか呼ばない。倒れた直後にここへ跳ぶと装備が配り直されない
 * (setLife が通してくれないので、書き間違えても状態が壊れることはない)。
 */
export function spawn(room: RoomWorld, player: MatchPlayer, now = Date.now()): void {
  /*
   * **復活の回数を使い切った人は湧かせない** (TSNE の lives)。倒れたまま待たせるのは
   * advanceLife だが、リロードで入り直すと支度から来るので、ここでも止める
   */
  if (!canRespawn(player, livesOf(room.name))) return
  refill(player)
  // スタンナイフは満ちた状態で湧く
  player.stunReadyAt = now
  // **眠りも醒める。** 知らせないと、湧いた本人の画面が暗いまま
  sendStamina(player)
  setLife(room, player, 'spawning', now)
  broadcast(room, { type: 'respawn', id: player.id })
  sendHealth(room, player, 0, false)
}

/**
 * 席を畳む。切れるのを待たずに消す。
 *
 * 名乗った id ではなく接続の player を受ける。他人を追い出せてしまうので。
 */
export function leaveRoom(room: RoomWorld, player: MatchPlayer): void {
  // 走っている試合を捨てて出た。抜けたことごと残す
  if (room.phase === 'playing') recordSeat(room, player, true)
  // 投げている途中で出た。相手を放す
  releaseCqc(room, player)
  room.players.delete(player.id)
  // 持っていた過去も捨てる。**残すと、入り直した人が前の命の位置で当たる**
  forgetPoses(player.id)
  sessions.delete(player.id)
  // 本人はもう聞いていない。残った人に消してもらう
  broadcast(room, { type: 'leave', id: player.id })
}

/**
 * その人の一戦分を残す。
 *
 * **試合の終わりにまとめて、ではない。** 抜けた人は終わる頃にはもう部屋に
 * 居ないので、席を畳む側からもここを呼ぶ。関数は冪等なので、同じ人を
 * 二度書いても増えない。
 */
export function recordSeat(room: RoomWorld, player: MatchPlayer, leftEarly: boolean): void {
  if (!room.matchId) return
  recordPlayer({
    matchId: room.matchId,
    room: room.name,
    startedAt: room.startedAt,
    // 発行元での識別子。認証を通しているので player.id がそれになっている
    subject: player.id,
    name: player.name,
    team: player.team,
    kills: player.kills,
    deaths: player.deaths,
    headshots: player.headshots,
    headDeaths: player.headDeaths,
    suicides: player.suicides,
    killsByWeapon: player.killsByWeapon,
    leftEarly,
  })
}

/**
 * 決着した。残っている全員を書いて、試合を締める。
 *
 * 途中で抜けた人は既に書かれている (recordSeat) ので、ここには出てこない。
 */
export function finishMatch(room: RoomWorld): void {
  if (!room.matchId) return
  for (const player of room.players.values()) {
    // 接続が切れているだけの人も含める。席は残っているので、まだ抜けてはいない
    recordSeat(room, player, false)
  }
  closeMatch(room.matchId, room.name, room.startedAt, room.winner ?? 'draw')
}

/**
 * 試合の進行。
 *
 * 時間切れで決着、しばらく結果を見せてから次の試合を始める。
 * クライアント側で時計を回すと、タブが裏に回ったぶんだけずれるのでサーバーが持つ。
 */

/**
 * 支度の段階へ入る。**READY を全員ぶん戻してから。**
 *
 * 前の試合で押した READY が残っていると、次の試合が押した覚えのないまま
 * 始まる。段階に入るたびに聞き直す。
 */
function enterReady(room: RoomWorld, now: number, afterMatch = false): void {
  /*
   * 前の試合の札を落とす。**札は「走っている試合」だけを指す。**
   *
   * 結果を見せている間は残す (その URL を貼れば同じ結果が開く) が、次の支度に
   * 入った時点でもう別の話。残したままだと、部屋で待っている人の URL が終わった
   * 試合を指し続ける。
   */
  room.matchId = null
  room.phase = 'ready'
  room.endsAt = now + READY_SECONDS * 1000
  room.allReadyAt = 0
  room.readyDeadline = room.endsAt
  room.blue = TICKETS
  room.red = TICKETS
  room.winner = undefined
  // **攻守交代。** 試合を 1 つ終えるたびに必ず入れ替える (2026-10-17 本人)。
  // 1 試合は先攻と後攻の 2 ラウンドなので、終わった時点で 1 度入れ替わっている。戻して同じ色から始める
  if (room.mode.sides && afterMatch) swapSides(room)
  room.revealedUntil = 0
  room.round = 1
  room.roundWins = { blue: 0, red: 0 }
  clearTsneTarget(room)
  for (const player of room.players.values()) player.ready = false
  resetPlayers(room)
  if (room.mode.sides) standingCounts(room, now)
}

/**
 * 攻守に分かれる部屋の blue / red。**残機ではなく、まだ戦える人数。**
 *
 * 倒れて復活できない人と眠っている人を除く。0 になった側の負け (ticketsGone がそのまま使える)
 */
function standingCounts(room: RoomWorld, now: number): void {
  const seats = holdingSeats(room, now)
  const lives = livesOf(room.name)
  room.blue = standing(seats, 'blue', lives, now)
  room.red = standing(seats, 'red', lives, now)
}

/**
 * 全員の支度が済んだか。**席を持っている人を全員数える** (戻りを待っている人も)。
 *
 * 繋がっている人だけを数えていた頃は、相手がリロードで一瞬切れた間に残った 1 人が
 * 押すと揃ったことになり、相手を置いて始まった (2026-10-09)。戻ってこない人で部屋が
 * 止まることは無い — 支度の締め切り (READY_SECONDS) で始まり、席も 30 秒で畳まれる
 */
function allReady(room: RoomWorld): boolean {
  const here = [...room.players.values()].filter((p) => !p.bot)
  return here.length > 0 && here.every((p) => p.ready)
}

export function updateMatch(room: RoomWorld, now: number): void {
  const seats = holdingSeats(room, now)
  /*
   * 勝敗の無い部屋 (休憩・練習)。**相手を待たないし、終わらない。**
   *
   * 1 人で入って撃てないと練習にならないし、5 分で結果画面に切り替わっても
   * 邪魔なだけ。段階は playing に固定して、支度が済んだ人から順に出す。
   */
  if (!room.mode.tickets) {
    if (room.phase !== 'playing') {
      room.phase = 'playing'
      room.endsAt = 0
      room.winner = undefined
      // matchId は発番しない。**記録に残さない**のはこれで足りる
      // (recordSeat は matchId が無ければ何も書かない)
    }
    // 支度の打ち切りも湧きも、人の側の刻み (下の switch) が面倒を見る。
    // ここでやることは「終わらせないこと」だけ
    if (now - room.lastBroadcast >= MATCH_BROADCAST_MS) {
      room.lastBroadcast = now
      broadcast(room, matchState(room))
    }
    return
  }
  // 続けられるかは頭数ではなく**両陣営に居るか**で決まる。
  //
  // 数だけ見ていると、片側に 2 人残って反対側が空でも「2 人居るから続行」に
  // なる。相手の居ない試合が時間切れまで走ることになる。
  // 続けられるか。**陣営戦は両陣営に、個人戦は 2 人以上**
  const enough = room.mode.teams
    ? seats.some((p) => p.team === 'blue') && seats.some((p) => p.team === 'red')
    : seats.length >= MIN_PLAYERS
  const previous = room.phase

  // 結果を見せている間は人数を見ない。見せ終わってから次を決める。
  //
  // ここを人数で割り込ませると、不戦勝を出した次の刻みで待ちへ落ちて、
  // 勝ったことが画面に出ないまま消える
  if (room.phase === 'over') {
    if (now < room.endsAt) {
      // まだ見せている最中
    } else if (enough) {
      // **次の試合の前にもう一度支度させる。** ここでスキルを組み替え直せる
      enterReady(room, now, true)
    } else {
      room.phase = 'waiting'
      room.endsAt = 0
      room.winner = undefined
      room.matchId = null
    }
  } else if (!enough && room.phase !== 'waiting') {
    // 相手が居なくなった。
    //
    // 試合中なら**残っている側の勝ち**にする。待ちへ戻すだけだと、
    // 抜けた側は負けを付けられずに済むので、劣勢になったら抜ければよい
    // ことになる。席を空けて待つ猶予 (30 秒) を過ぎるまでは畳まないので、
    // 一瞬の離脱で勝ちが転がり込むことはない。
    const survivor = soleTeam(seats)
    if (room.phase === 'playing' && survivor) {
      room.phase = 'over'
      room.winner = survivor
      room.endsAt = now + INTERMISSION_MS
      finishMatch(room)
    } else {
      room.phase = 'waiting'
      room.endsAt = 0
      room.winner = undefined
      room.matchId = null
    }
  } else if (room.phase === 'waiting' && enough) {
    // **すぐ支度へ入らない。** 揃ったことを告げてから (domain/match/match.ts の assembled)
    room.phase = 'assembled'
    room.endsAt = now + ASSEMBLE_MS
  } else if (room.phase === 'assembled' && now >= room.endsAt) {
    enterReady(room, now)
  } else if (room.phase === 'ready') {
    /*
     * 支度の段階。**全員が押すか、締め切りが来たら数え始める。**
     *
     * 押さない人が居ても止めない。席を離れた人 1 人で部屋が止まるのは、
     * 装備の打ち切り (CHOOSE_TIMEOUT) と同じ理由で困る。
     */
    /*
     * **揃っても少し待つ** (READY_GRACE_MS)。待っている間は締め切りをそこまで
     * 縮めて見せ、誰かが取り消したら元の締め切りへ戻す
     */
    const all = allReady(room)
    if (all && room.allReadyAt === 0) {
      room.allReadyAt = now
      room.readyDeadline = room.endsAt
      room.endsAt = Math.min(room.endsAt, now + READY_GRACE_MS)
      broadcast(room, matchState(room))
    } else if (!all && room.allReadyAt !== 0) {
      room.allReadyAt = 0
      room.endsAt = room.readyDeadline
      broadcast(room, matchState(room))
    }
    if (now >= room.endsAt) {
      room.allReadyAt = 0
      room.phase = 'countdown'
      room.endsAt = now + COUNTDOWN_MS
      /*
       * **ここから装備画面で武器を選ぶ。** 待合室ではスキルだけを決め、
       * 武器はその後 (2026-10-09 本人: 待合室で武器を選ぶ必要は無い)。
       *
       * **選べるのはここから 30 秒** (lifecycle.ts の CHOOSE_TIMEOUT)。試合は秒読みの後に
       * 待たずに始まり、OK を押した人から出て動ける。30 秒経っても選んでいる人は、
       * 選んでいた装備で出す (2026-10-15 本人)。秒読み (5 秒) で始まる時に全員を出していた
       * 頃は、スキルを決めた後に武器を選ぶ間が 5 秒しかなかった。
       *
       * 人ごとの 30 秒の時計をここで 0 にする。待合室に居た間の分を数えると、入った瞬間に打ち切られる
       */
      for (const player of connected(room)) {
        if (canChoose(player.life)) player.lifeAt = now
      }
    }
  } else if (room.phase === 'break' && now >= room.endsAt) {
    // ラウンドの合間が明けた。攻守を入れ替えて後攻の秒読みへ
    startNextRound(room, now)
  } else if (room.phase === 'countdown' && now >= room.endsAt) {
    room.phase = 'playing'
    room.endsAt = now + MATCH_DURATION_MS
    // ターゲットを守る側の陣地の近くに置く (TSNE。server/target.ts)
    placeTsneTarget(room)
    // ここで身元が決まる。以後この試合の記録は全部これに紐づく。
    // **後攻のラウンドは同じ試合の続き** なので発番し直さない
    if (!(room.mode.sides && room.round > 1 && room.matchId)) {
      room.matchId = crypto.randomUUID()
      room.startedAt = now
    }
    // まだ選んでいる人は出さない。秒読みに入った時から数えて 30 秒で打ち切る (上の countdown)
  }
  // 攻守に分かれる部屋は、まだ戦える人数を数え直してから決着を見る
  if (room.mode.sides && room.phase === 'playing') standingCounts(room, now)
  // ターゲット (TSNE) を動かす。取った・落ちた・戻った・運び込んだ時はすぐ配る
  const targetChanged = room.mode.sides && updateTsneTarget(room, now)
  if (room.phase !== 'playing' || previous !== 'playing') {
    // 段階が変わった刻みでは決着を見ない (上の分岐で済んでいる)
  } else if (room.targetDelivered) {
    // **運び込んだ。** 攻める側の勝ち (decideWinner)。時間を待たずにその場で終わる
    endRound(room, now)
  } else if (ticketsGone(room)) {
    // **削り切った。** 残機が 0 になったら終わり。時間を待たずにその場で終わる
    endRound(room, now)
  } else if (now >= room.endsAt) {
    // 時間切れ。陣営戦は多く残っているほう、個人戦は倒した数が一番多い人
    endRound(room, now)
  }

  // ステルスが解けた / 戻った瞬間にも配る。1 秒ごとの便を待つと、5 秒のうち最大 1 秒ずれる
  const stealth = stealthActive(room, now)
  const stealthChanged = room.mode.sides && stealth !== room.stealthSent
  room.stealthSent = stealth
  // CAUTION (STEALTH が解けた) が始まった・延びた時もすぐ配る。全員の秒数を揃える
  const cautionChanged = room.mode.sides && room.revealedUntil !== room.cautionSent
  if (cautionChanged) room.cautionSent = room.revealedUntil
  // 段階が変わったら即座に配る。残り時間の表示のために定期的にも配る
  if (previous !== room.phase || stealthChanged || cautionChanged || targetChanged || now - room.lastBroadcast >= MATCH_BROADCAST_MS) {
    room.lastBroadcast = now
    broadcast(room, matchState(room))
  }
}

/**
 * 名簿を組む。**入った人へ 1 回、試合の頭でもう 1 回。**
 *
 * 入室のときにしか配っていなかった。陣営が入室で決まったきりだったので
 * それで足りていたが、**試合ごとに切り直す**ようにした以上、切った後に
 * 配り直さないとクライアントは古い色のまま描く。
 */
export function rosterMessage(room: RoomWorld): ServerMessage {
  return {
    type: 'roster',
    players: present(room).map((p) => ({
      id: p.id,
      name: p.name,
      health: p.health,
      team: p.team,
      slot: p.slot,
      // 状態も載せる。life は変わった時にしか配らないので、後から
      // 繋いだ人はここで受け取らないと既定値 (joining) のままになり、
      // **その人たちが一度も描かれない**
      life: p.life,
    })),
  } satisfies ServerMessage
}

/**
 * 自分の本当の値を、1 人ずつ配る。**3 秒ごと** (SELF_BROADCAST_MS)。
 *
 * 全員へ同じ物を配る便 (matchState) には乗せられない。体力も弾数も人ごとに
 * 違うので、**送り先ごとに中身が変わる**。
 *
 * これはクライアントの予測を**直すため**にある。撃った瞬間に減らすのも、
 * 体力 0 で倒れるのもクライアントがやっていて、ここが渡すのは「本当はこう」
 * という値だけ。普段は一致しているので、届いても何も起きない。
 */
/**
 * 往復の時間を測る。**1 秒に 1 度、1 人ずつ。**
 *
 * 打ち返しを待っている間は次を投げない。投げ続けると、遅れている人ほど
 * 未処理が溜まって**遅れをこちらで作る**ことになる。
 *
 * 前回測れた値を一緒に載せる。打ち返す側は自分の遅れを知りようがない
 * (往路も復路も片道しか見えない) ので、画面に出すにはこちらが教えるしかない。
 */
export function sendPing(room: RoomWorld, now: number): void {
  if (now - room.lastPingAt < PING_INTERVAL_MS) return
  room.lastPingAt = now
  for (const player of connected(room)) {
    const session = sessionFor(player)
    if (!session) continue
    // 打ち返しがまだ。**投げ直さない** — 返ってこないこと自体が答え
    if (session.pingAt !== 0) continue
    session.pingAt = now
    session.socket.send(
      JSON.stringify({
        type: 'ping',
        at: now,
        rtt: Math.round(session.lag.rtt),
      } satisfies ServerMessage),
    )
  }
}

export function sendSelf(room: RoomWorld, now: number): void {
  if (now - room.lastSelfAt < SELF_BROADCAST_MS) return
  room.lastSelfAt = now
  for (const player of connected(room)) {
    const ammo = player.inventory.ammoTable()
    sessionFor(player)?.socket.send(
      JSON.stringify({
        type: 'self',
        health: player.health,
        magazine: ammo.magazine,
        reserve: ammo.reserve,
        grenades: player.grenades,
      } satisfies ServerMessage),
    )
  }
}
