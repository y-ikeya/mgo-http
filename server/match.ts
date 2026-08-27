/**
 * 試合の段階と時計。
 *
 * 誰が湧いて、いつ始まって、いつ終わるか。得点そのもののドメインルールは domain
 * (rule/scoring.ts)、ここに在るのはそれを試合の時間に当てはめる側。
 */

import {
  MIN_PLAYERS,
  type Match,
  connected,
  holdingSeats,
  leakingOf,
  present,
  shuffleTeams,
  soleTeam,
} from '../src/domain/match/match'
import { isSeated } from '../src/domain/player/lifecycle'
import { type Player, type Team, lifeElapsed, refill, reviveBot } from '../src/domain/player/player'
import { MAX_HEALTH } from '../src/domain/rule/damage'
import { encodeSnapshot } from '../src/infra/codec/snapshot'
import type { ServerMessage } from '../src/application/protocol/types'
import { recordPose, relayState, sendHealth } from './relay'
import { sessionFor, sessionOf, sessions } from './session'
import { closeMatch, recordPlayer } from './stats'
import { saveSkills } from './skills'
import { type RoomWorld, TARGET_RESPAWN, broadcast, setLife } from './world'

/** 1 試合の長さ (ms) */
export const MATCH_DURATION = 5 * 60 * 1000

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

/** 決着してから次の支度が始まるまで (ms)。結果を読む時間 */
export const INTERMISSION = 10 * 1000

/**
 * 試合が始まるまでの数え (ms)。
 *
 * 全員を湧き地点へ戻してから始める。戻す瞬間にいきなり撃ち合いが始まると、
 * 画面が切り替わった側が一方的に不利になる。
 */
export const COUNTDOWN = 5 * 1000

/** 試合の状態を配る間隔 (ms)。残り時間の表示に要る */
export const MATCH_BROADCAST = 1000

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
export const SELF_BROADCAST = 3000

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
    if (bot.life === 'downed' && lifeElapsed(bot, now) >= TARGET_RESPAWN) {
      reviveBot(bot, now)
      broadcast(room, { type: 'life', id: bot.id, state: 'alive' })
      broadcast(room, { type: 'respawn', id: bot.id })
      broadcast(room, { type: 'health', id: bot.id, health: bot.health, damage: 0, flinch: false })
    }
    recordPose(bot)
    relayState(room, bot, targetPayload(bot, now))
  }
}

/** 的の姿を 1 通ぶん組み立てる。人が送ってくるものと同じ形 */
export function targetPayload(bot: Player, now: number): Uint8Array {
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
        locomotion: bot.life === 'downed' ? 'death' : 'idle',
        aiming: false,
        weapon: 'rifle',
        crouching: false,
        boxed: false,
        reloading: false,
        protectedNow: false,
        holdingGrenade: false,
        held: 'rifle',
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
    mode: room.mode.id,
    leader: leader?.id,
    blue: room.blue,
    red: room.red,
    endsAt: room.endsAt,
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

/** 全員を湧き地点へ戻して立たせる。段階が変わるたびに呼ぶ */
export function resetPlayers(room: RoomWorld): void {
  // 前の試合の手榴弾が残っていると、始まった直後に爆発する
  room.grenades.length = 0
  /*
   * **陣営を切り直す。** 入室で 1 回決めたきりだと、同じ面子が同じ側で
   * 何試合も続く。強い側が勝ち続け、負けている側から抜けていく。
   *
   * 切ったら名簿を配り直す。**差分 (life / health) では陣営が動かない**ので、
   * 配らないとクライアントは前の試合の色のまま描く。
   */
  shuffleTeams(room, Math.random)
  for (const player of connected(room)) {
    player.kills = 0
    player.deaths = 0
    // 記録に残す分もここで戻す。**足したら必ずここにも足す** —
    // 戻し忘れると前の試合の数が次に混ざる
    player.headshots = 0
    player.headDeaths = 0
    player.suicides = 0
    player.killsByWeapon = {}
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
export function spawn(room: RoomWorld, player: Player, now = Date.now()): void {
  refill(player)
  setLife(room, player, 'spawning', now)
  broadcast(room, { type: 'respawn', id: player.id })
  sendHealth(room, player, 0, false)
}

/**
 * 席を畳む。切れるのを待たずに消す。
 *
 * 名乗った id ではなく接続の player を受ける。他人を追い出せてしまうので。
 */
export function leaveRoom(room: RoomWorld, player: Player): void {
  // 走っている試合を捨てて出た。抜けたことごと残す
  if (room.phase === 'playing') recordSeat(room, player, true)
  room.players.delete(player.id)
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
export function recordSeat(room: RoomWorld, player: Player, leftEarly: boolean): void {
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
    if (now - room.lastBroadcast >= MATCH_BROADCAST) {
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
      room.phase = 'countdown'
      room.endsAt = now + COUNTDOWN
      room.blue = TICKETS
      room.red = TICKETS
      room.winner = undefined
      resetPlayers(room)
    } else {
      room.phase = 'waiting'
      room.endsAt = 0
      room.winner = undefined
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
      room.endsAt = now + INTERMISSION
      finishMatch(room)
    } else {
      room.phase = 'waiting'
      room.endsAt = 0
      room.winner = undefined
    }
  } else if (room.phase === 'waiting' && enough) {
    room.phase = 'countdown'
    room.endsAt = now + COUNTDOWN
    room.blue = TICKETS
    room.red = TICKETS
    room.winner = undefined
    resetPlayers(room)
  } else if (room.phase === 'countdown' && now >= room.endsAt) {
    room.phase = 'playing'
    room.endsAt = now + MATCH_DURATION
    // ここで身元が決まる。以後この試合の記録は全部これに紐づく
    room.matchId = crypto.randomUUID()
    room.startedAt = now
    // 支度がまだ済んでいない人はここで押し出す。始まっているのに
    // 装備画面の裏で立ち尽くす人が出ないように
    for (const player of connected(room)) {
      if (player.life === 'choosing') spawn(room, player, now)
      /*
       * **スキルはここで確定する。** 選べる窓が閉じた瞬間 (skill.ts の
       * canChooseSkills) なので、残すならこの 1 か所でよい。
       *
       * 試合ごとに書くのは、**次の試合まで選び直せない**から — 途中参加した人に
       * 持ってこられるのは「前の試合で使っていた物」で、支度の途中で触っていた
       * 値ではない。始まった時の形をそのまま残す。
       *
       * 待たない。書けなくても試合は続く (次に入ったとき前回の選択が戻らないだけ)。
       */
      if (!player.bot) saveSkills(player.id, player.skills)
    }
  } else if (room.phase === 'playing' && ticketsGone(room)) {
    // **削り切った。** 残機が 0 になったら終わり。時間を待たずにその場で終わる
    room.phase = 'over'
    room.winner = decideWinner(room)
    room.endsAt = now + INTERMISSION
    finishMatch(room)
  } else if (room.phase === 'playing' && now >= room.endsAt) {
    // 時間切れ。陣営戦は多く残っているほう、個人戦は倒した数が一番多い人
    room.phase = 'over'
    room.winner = decideWinner(room)
    room.endsAt = now + INTERMISSION
    finishMatch(room)
  }

  // 段階が変わったら即座に配る。残り時間の表示のために定期的にも配る
  if (previous !== room.phase || now - room.lastBroadcast >= MATCH_BROADCAST) {
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
 * 自分の本当の値を、1 人ずつ配る。**3 秒ごと** (SELF_BROADCAST)。
 *
 * 全員へ同じ物を配る便 (matchState) には乗せられない。体力も弾数も人ごとに
 * 違うので、**送り先ごとに中身が変わる**。
 *
 * これはクライアントの予測を**直すため**にある。撃った瞬間に減らすのも、
 * 体力 0 で倒れるのもクライアントがやっていて、ここが渡すのは「本当はこう」
 * という値だけ。普段は一致しているので、届いても何も起きない。
 */
export function sendSelf(room: RoomWorld, now: number): void {
  if (now - room.lastSelfAt < SELF_BROADCAST) return
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
