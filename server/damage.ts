/**
 * ダメージを入れる。**審判はここ。**
 *
 * 量を決めるドメインルールは domain (rule/damage.ts)。ここでやるのは、申告を検算して、
 * 通ったぶんを体力から引き、倒れたら記録に残すこと。
 */

import {
  bulletDamage,
  pelletsOf,
  shotgunBand,
  weaponOf,
  type ShotgunBand,
} from '../src/domain/item/weapons'
import { loseTicket } from '../src/domain/match/match'
import { isHostile } from '../src/domain/match/room'
import { canBeHurt, isSeated } from '../src/domain/player/lifecycle'
import {
  downedBy,
  hurt,
  isLeakedTo,
  leakTag,
  type Player,
  isProtected,
} from '../src/domain/player/player'
import { HIT_RULES, KNOCK_TIME, type HitZone, meleeDamage } from '../src/domain/rule/damage'
import { LAG_WINDOW } from '../src/domain/rule/lag'
import { exposeSeconds } from '../src/domain/player/skill'
import { SLEEP_SECONDS, drainStamina, isAsleep } from '../src/domain/player/stamina'
import type { ClientMessage, ServerMessage } from '../src/application/protocol/types'
import { verifyHit } from '../src/sim/judge/hitcheck'
import { bulletSag } from '../src/sim/judge/bullet'
import { matchState } from './match'
import { bearingTo, isBehind, sendHealth, sendStamina } from './relay'
import { sessionFor, sessionOf } from './session'
import { TARGET_DOWN, type RoomWorld, broadcast, setLife } from './world'

/**
 * 爆風のダメージを 1 人に入れる。
 *
 * **手榴弾とクレイモアが同じ道を通る。** 倒したときに動くものが多い
 * (体力・残機・戦績・キル表示・握っていた物・倒した相手を映す先) ので、
 * 2 つ目の爆発物を足すときにここを写すと、必ずどれかをレプリカ忘れる。
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
export const KILL_LABEL = { grenade: 'grenade', claymore: 'CLAYMORE', fall: '落下', drown: '溺死' } as const

/**
 * 削った結果。**その先の始末は呼ぶ側がやる。**
 *
 * 「倒れたら握っていた手榴弾が足元に落ちる」は武器の話で、削る側が知っている
 * 必要は無い。damage が arms を呼ぶと**審判と武器が互いを呼び合う**ことになり、
 * どちらが上か決まらなくなる (実際そうなっていた)。
 */
export interface Hurt {
  /** 倒れたか */
  downed: boolean
  /** 手が緩んだか。握っていた物を足元に落とす */
  letGo: boolean
}

/** 何も起きなかった。申告が通らなかったときなど */
const NOT_HURT: Hurt = { downed: false, letGo: false }

/**
 * 当てた相手を光らせる。**ENEMY EXPOSURE。**
 *
 * --- 倒さなくても情報になる、という枠 ---
 * 当てただけで数秒ぶんの位置が抜ける。**撃ち合いに勝てなくても仕事になる**ので、
 * 「見つけて撃つ」以外の役割が予算 4 の中に生まれる。
 *
 * --- 誰に見えるか ---
 * 陣営ぜんぶ (個人戦なら本人だけ)。宛先の決め方は domain (leakTag)。
 * **抜かれた本人には送らない** — 光っていることを本人が知れると、
 * 「いま位置が漏れている」まで確定して抜いた側の利が消える。
 *
 * --- 上書きする ---
 * 既に光っていても、当て直せば伸びる。別の人が当てれば宛先ごと移る
 * (フラグは 1 人ぶんしか無い)。**短いほうへは縮めない** — Lv1 の人が当てたせいで
 * Lv3 の人の光が消えるのは、当てた側から見て理屈が通らない。
 */
function expose(room: RoomWorld, victim: Player, attacker: Player | undefined): void {
  if (!attacker || attacker.id === victim.id) return
  const seconds = exposeSeconds(attacker.skills)
  if (seconds <= 0) return

  const now = Date.now()
  const until = now + seconds * 1000
  const tag = leakTag(attacker, room.mode.teams)
  // 同じ宛先で、いまより短くなるなら何もしない
  if (tag === victim.leakedTo && until <= victim.leakedUntil) return
  victim.leakedUntil = until
  victim.leakedTo = tag

  const notice = JSON.stringify({
    type: 'exposed',
    id: victim.id,
    seconds,
  } satisfies ServerMessage)
  for (const viewer of room.players.values()) {
    if (viewer.id === victim.id) continue
    if (!isLeakedTo(victim, viewer, now)) continue
    sessionFor(viewer)?.socket.send(notice)
  }
}

/**
 * その場所と逆へ突き飛ばして転ばせる。**爆風も散弾も同じ道を通る。**
 *
 * **人には向きだけ渡す** — 位置を持っているのはクライアントなので、動かすのは
 * あちら。**的は自分で動かす** — 接続を持たないので渡す先が無い
 * (server/match.ts の updateTargets が滑らせる)。
 *
 * 2 か所に書いていた頃、散弾を足すときに片方だけ直すことになった。飛ばす形は
 * 1 つなので、呼び分けるのは「いつ飛ばすか」だけにする。
 */
function knockAway(victim: Player, fromX: number, fromZ: number): void {
  const awayX = victim.x - fromX
  const awayZ = victim.z - fromZ
  const reach = Math.hypot(awayX, awayZ) || 1
  victim.knockX = awayX / reach
  victim.knockZ = awayZ / reach
  if (victim.bot) {
    victim.knockLeft = KNOCK_TIME
    // 滑り終わってからも転んだまま。**時間で立ち上がる**
    victim.downLeft = TARGET_DOWN
    return
  }
  sessionFor(victim)?.socket.send(
    JSON.stringify({
      type: 'knockdown',
      dirX: victim.knockX,
      dirZ: victim.knockZ,
    } satisfies ServerMessage),
  )
}

/**
 * その申告が散弾のどの帯か。
 *
 *     null    散弾ではない (今まで通りの計算へ)
 *     'miss'  一番外の帯より遠い / この 1 発ではもう削った
 *     帯      その量だけ削る
 *
 * **1 発につき 1 回だけ削る。** 8 粒ぶん届くので、2 粒目からは 'miss' に
 * なる。粒は散らばりと当たり判定のためにあって、威力を数えるためではない。
 */
function shotgunBandFor(
  attacker: Player,
  event: Extract<ClientMessage, { type: 'damage' }>,
): ShotgunBand | null | 'miss' {
  if (event.kind !== 'bullet') return null
  if (pelletsOf(weaponOf(attacker.weapon)) <= 1) return null
  const session = sessionOf(attacker)
  if (session.hitThisShot) return 'miss'
  const band = shotgunBand(event.distance ?? Number.POSITIVE_INFINITY)
  if (!band) return 'miss'
  session.hitThisShot = true
  return band
}

/**
 * 散弾を近くで食らったら突き飛ばす。
 *
 * --- なぜ弾で飛ばすのがここだけか ---
 * 弾は当たっても体を動かさない。突き飛ばすのは爆風だけ、という形にしてある —
 * 撃たれるたびに位置がずれると、撃ち合いが「動かない側が有利」でなくなる。
 *
 * 散弾だけ別にするのは、**近さがそのまま効き目**という武器だから。粒が
 * まとまって当たる間合い (SHOTGUN_KNOCK_RANGE) に入られた時点で撃ち合いは
 * 終わっている、という形にする。離れれば数粒しか届かないので飛ばさない —
 * 掠っただけで転ぶことにはしない。
 *
 * **1 発につき 1 回。** 粒ごとに飛ばすと 8 回重なって吹き飛ぶ (怯みと同じ)。
 */
function pushIfShotgun(attacker: Player, victim: Player, band: ShotgunBand | null): void {
  if (!band?.knock) return
  const session = sessionOf(attacker)
  if (session.pushedThisShot) return
  session.pushedThisShot = true
  if (!isSeated(victim.life)) return
  knockAway(victim, attacker.x, attacker.z)
}

export function applyBlastDamage(
  room: RoomWorld,
  victim: Player,
  amount: number,
  fromX: number,
  fromZ: number,
  ownerId: string,
  weapon: 'grenade' | 'claymore' | 'fall' | 'drown',
  knock: boolean,
): Hurt {
  // 削るのも、倒れるかも人の側の振る舞い (domain/player/player.ts)
  const wound = hurt(victim, amount)
  // **爆風でも抜ける。** 手榴弾とクレイモアで被曝させた相手も光る。
  // 落下と溺死 (weapon: 'fall' / 'drown') は持ち主が居ないので何も起きない
  expose(room, victim, room.players.get(ownerId))

  // 爆心の方向。撃たれたときと同じで、どこから来たかだけ渡す
  const bearing = Math.atan2(fromX - victim.x, -(fromZ - victim.z))

  if (!wound.downed) {
    sendHealth(room, victim, amount, false, bearing)
    // **的にも爆風は当たる。** 送り先が無いなら送らないだけ
    if (knock && isSeated(victim.life)) {
      knockAway(victim, fromX, fromZ)
      // **手が緩んだことは呼ぶ側に返す。** 振りかぶったまま転べば足元に落ちる
      // (ピンは抜けているのでそのまま爆ぜる) が、それをやるのは武器の側
      return { downed: false, letGo: true }
    }
    return { downed: false, letGo: false }
  }

  // 誰の手柄か、戦績にどう残るかは人の側が決める
  const killer = room.players.get(ownerId) ?? null
  downedBy(victim, killer, weapon)
  setLife(room, victim, 'downed')
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
  // 倒れた。握っていた物は足元に落ちる — **落とすのは呼ぶ側**
  return { downed: true, letGo: true }
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

export function applyDamage(room: RoomWorld, attacker: Player, event: ClientMessage): Hurt {
  if (event.type !== 'damage') return NOT_HURT
  const victim = room.players.get(event.target)
  if (!victim || !canBeHurt(victim.life)) return NOT_HURT
  /*
   * **眠っている間は撃てない。**
   *
   * 撃つのを止めているのはクライアントだが、そこは信じない — 眠らされても
   * 撃ち続けられるなら、麻酔は当てても何も起きない銃になる。
   */
  if (isAsleep(attacker.sleepUntil, Date.now())) return NOT_HURT
  // 撃った時点で自分の無敵は切れる。盾にしたまま撃たせない
  if (attacker.life === 'spawning') setLife(room, attacker, 'alive')
  // 湧いた直後の相手には当たらない
  if (isProtected(victim)) return NOT_HURT
  // 撃てる相手か。**陣営ではなくルールに聞く** — DM では同じ色でも敵で、
  // 休憩部屋では誰も敵ではない (src/domain/match/room.ts)
  if (!isHostile(room.mode, attacker, victim)) return NOT_HURT
  // 試合中以外は削らない。支度の間や結果を読んでいる間に得点が動くと、
  // 何が起きたのか分からなくなる
  if (room.phase !== 'playing') return NOT_HURT

  // --- ここから、申告が本当かを調べる ---
  //
  // 当たり判定そのものはクライアントが持っている (骨の姿勢を持っているのが
  // あちらだけなので)。だからこそ、位置から分かることは信じない。
  // 撃った本人しか知り得ないことは信じ、こちらで確かめられることは確かめる。

  /*
   * 連射の速さ。0.09 秒間隔が上限なので、それを超えて届いたら作り物。
   *
   * **散弾だけは 1 発が何通にもなる。** 8 粒が同じ瞬間に届くので、そのまま
   * 当てると 1 粒目以外が全部弾かれて、当たっているのに削れない。1 発ぶんの
   * 窓の中では粒の数まで通して、それを超えたら弾く。
   */
  if (event.kind === 'bullet') {
    const now = Date.now()
    const spec = weaponOf(attacker.weapon)
    const limit = spec.fireInterval * 1000 * FIRE_INTERVAL_SLACK
    const session = sessionOf(attacker)
    if (now - session.lastShotAt < limit) {
      if (session.pelletsLeft <= 0) {
        reject(attacker, `連射が速すぎる (${now - session.lastShotAt}ms)`)
        return NOT_HURT
      }
      session.pelletsLeft--
    } else {
      session.lastShotAt = now
      session.pelletsLeft = pelletsOf(spec) - 1
      session.flinchedThisShot = false
      session.pushedThisShot = false
      session.hitThisShot = false
    }
  }

  const spec = weaponOf(attacker.weapon)
  const verdict = verifyHit(
    attacker.history,
    victim.history,
    {
      kind: event.kind,
      zone: event.zone,
      distance: event.distance,
      fromBehind: event.fromBehind,
      /*
       * 弾道の膨らみ。**遅い弾ほど弦から離れる。**
       *
       * 麻酔銃 (120 m/s) は 80m で 54cm 上へ膨らむ。直線で見ると、低い遮蔽を
       * 越えて通した射撃を「壁の裏」と弾く — 頭 1 発で眠らせる銃なので、
       * 遠くから狙う手はちゃんと成立させる。
       */
      sag: bulletSag(event.distance ?? 0, spec.bulletSpeed, spec.bulletGravity),
    },
    room.stage.sight,
    LAG_WINDOW,
    HIT_RULES,
  )
  if (!verdict.ok) {
    reject(attacker, verdict.reason)
    return NOT_HURT
  }

  /*
   * 削る量。**散弾だけ別の道。**
   *
   * 他の銃は「部位 × 距離の減衰」だが、散弾は**当たった距離の帯**で決まる
   * (domain/item/weapons.ts の SHOTGUN_BANDS)。粒を数えないので、1 発の
   * うち最初に通った 1 粒だけが削る。
   */
  const band = shotgunBandFor(attacker, event)
  if (band === 'miss') return NOT_HURT
  const amount =
    band !== null
      ? band.damage
      : event.kind === 'melee'
        ? meleeDamage(event.fromBehind ?? false)
        : bulletDamage(
            weaponOf(attacker.weapon),
            (event.zone ?? 'BODY') as HitZone,
            event.distance ?? 0,
          )

  /*
   * --- 麻酔 ---
   *
   * **体力を削らない。** 同じ「当てた」でも、削り切ったときに起きることが
   * 違う (domain/player/stamina.ts)。倒れるのではなく、その場で眠る。
   *
   * 削る量は zone をそのまま使う。距離の減衰も同じ式を通っているので、
   * 遠くから当てた麻酔は効きが薄い。
   */
  if (weaponOf(attacker.weapon).tranquilizer && event.kind === 'bullet') {
    return applyTranquilizer(room, attacker, victim, amount, event)
  }

  /*
   * --- 麻酔 ---
   *
   * **体力を削らない。** 同じ「当てた」でも、削り切ったときに起きることが
   * 違う (domain/player/stamina.ts)。倒れるのではなく、その場で眠る。
   *
   * 削る量は zone をそのまま使う。距離の減衰も同じ式を通っているので、
   * 遠くから当てた麻酔は効きが薄い。
   */
  if (weaponOf(attacker.weapon).tranquilizer && event.kind === 'bullet') {
    return applyTranquilizer(room, attacker, victim, amount, event)
  }

  const wound = hurt(victim, amount)
  // 撃たれたら集中は途切れる。回復は最初から待ち直し。
  victim.concentratingSince = 0
  // **倒さなくても情報になる。** 当てた時点で数秒ぶんの位置が抜ける
  expose(room, victim, attacker)

  if (!wound.downed) {
    /*
     * 頭に当たったのに倒れなかったときだけ怯ませる。
     * 胴でも出すと、連射している間ずっと怯み続けて棒立ちになる。
     *
     * **1 発につき 1 回。** 散弾は 1 発が 8 粒に分かれるので、粒ごとに送ると
     * 近距離で 8 回重なって体が跳ね回る。当たった数は削れる量で出ている。
     */
    const session = sessionOf(attacker)
    // 散弾は距離の帯が決める。他の銃は今まで通り「頭に当たったのに倒れなかった」
    const wants = band ? band.flinch : event.kind === 'bullet' && event.zone === 'HEAD'
    const flinch = wants && !session.flinchedThisShot
    if (flinch) session.flinchedThisShot = true
    // **仰け反れば手が緩む。** 振りかぶったまま撃たれたら足元に落ちる。
    // 遠くから頭を撃たれた人が、そのまま何事もなく投げ切るのはおかしい

    pushIfShotgun(attacker, victim, band)

    sendHealth(
      room,
      victim,
      amount,
      flinch,
      bearingTo(victim, attacker),
      event.zone,
    )
    // **仰け反れば手が緩む。** 遠くから頭を撃たれた人が、そのまま何事もなく
    // 投げ切るのはおかしい。落とすのは呼ぶ側
    return { downed: false, letGo: flinch }
  }

  // 倒れても飛ばす。**近くで散弾を食らえば体ごと持って行かれる**
  pushIfShotgun(attacker, victim, band)
  // どちら側から撃たれたか。**的は自分で倒れる**ので、控えてから状態を移す
  const behind = event.kind === 'melee' ? (event.fromBehind ?? false) : isBehind(victim, attacker)
  victim.downFromBehind = behind

  // 記録に残す分。**表示名ではなく安定した id で数える**
  const headshot = event.kind === 'bullet' && event.zone === 'HEAD'
  const by = event.kind === 'melee' ? 'knife' : attacker.weapon
  downedBy(victim, attacker, by, headshot)
  setLife(room, victim, 'downed')
  // 振りかぶったまま倒されたら、足元に落ちて爆ぜる。
  // 撃った側にとっては「今撃つと道連れになる」という読みになる
  // 減るのは倒された側の残機だけ。倒した側には何も入らない
  if (room.mode.tickets) loseTicket(room, victim.team)
  // **倒れる向きは倒れた瞬間だけ。** 前へ倒れるか後ろへ倒れるかが絵に出る
  sendHealth(room, victim, amount, false, bearingTo(victim, attacker), undefined, behind)
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
  return { downed: true, letGo: true }
}


/**
 * 麻酔が当たった。**スタミナを削り、0 になったら眠らせる。**
 *
 * --- 眠りは倒れることではない ---
 * 残機は減らないし、湧き直しもしない。**体はその場に残る。** 眠らせた側は
 * まだ仕事が終わっておらず、寄って仕留めるか、置いて先へ進むかを選ぶ。
 *
 * 点は倒したのと同じ 3 点 (domain/match/scoring.ts の STUN_POINTS)。当てる
 * 難しさが同じで、しかも陣営の勝敗には効かないので、ここを下げると
 * 「倒せる場面で眠らせる」に理由が無くなる。
 */
function applyTranquilizer(
  room: RoomWorld,
  attacker: Player,
  victim: Player,
  amount: number,
  event: Extract<ClientMessage, { type: 'damage' }>,
): Hurt {
  const now = Date.now()
  const drain = drainStamina(victim.stamina, amount, isAsleep(victim.sleepUntil, now))
  victim.stamina = drain.stamina
  // 撃たれたら集中は途切れる。麻酔でも同じ
  victim.concentratingSince = 0
  // **倒さなくても情報になる。** 当てた時点で数秒ぶんの位置が抜ける
  expose(room, victim, attacker)

  if (!drain.slept) {
    // まだ起きている。**残りを本人にだけ知らせる** — 相手の眠気は見えない
    sendStamina(victim)
    return NOT_HURT
  }

  victim.sleepUntil = now + SLEEP_SECONDS * 1000
  attacker.stuns++
  sendStamina(victim)
  broadcast(room, {
    type: 'stun',
    by: attacker.id,
    byName: attacker.name,
    target: victim.id,
    targetName: victim.name,
    head: event.zone === 'HEAD',
  })
  broadcast(room, matchState(room))
  /*
   * **手は緩む。** 振りかぶったまま眠らされたら足元に落ちる。倒されたときと
   * 同じで、眠った体が手榴弾を握ったままなのはおかしい。
   */
  return { downed: false, letGo: true }
}
