/**
 * 対戦サーバー。
 *
 *   bun run server
 *
 * 体力・生死・復帰・キルを持つ。位置や見た目は持たず、そのまま中継する。
 *
 * ダメージの計算は src/domain/rule/damage.ts を**そのまま読み込んでいる**。Bun は
 * TypeScript を直接動かせるので、クライアントと文字どおり同じコードが走る。
 * 移植しないので値がずれようがなく、片方だけ直して忘れる、が起きない。
 *
 * --- まだ守れていないこと ---
 * 「当たった」と言っているのはクライアント。壁抜けも自動照準もこれでは防げない。
 * 防ぐにはサーバーが位置・当たり判定・地形を持つ必要があり、それは Rust 版の仕事。
 * ここで先に押さえたのは、二重にキルが数えられない・体力が全員で一致する、
 * という「試合として成立させる」ための最低限。
 */

import { dropWeapon, pickUp } from './arms/drops'

import { detonateClaymore, placeClaymore, relayClaymores, shotHitsClaymore } from './arms/claymore'
import { detonate, dropGrenade, throwGrenade } from './arms/grenade'
import { MAX_FALL_SPEED, applyBlastDamage, applyDamage, reject} from './damage'
import { leaveRoom, matchState, recordSeat, sendSelf, spawn, updateMatch, updateTargets } from './match'
import { receiveSnapshot, relayShot, relayState, sendHealth } from './relay'
import { newSession, sessionFor, sessionOf, sessions } from './session'
import { type Client, ROOM_CAPACITY, broadcast, roomOf, rooms, setLife } from './world'
import { RECOVER_CAP, RECOVER_DELAY, RECOVER_RATE } from '../src/domain/rule/damage'
import { verifyToken, type Identity } from './auth'
import { lifeElapsed, newPlayer, type Player } from '../src/domain/player/player'
import { MODES, ROOM_MODE, ROOM_NAMES, isRoomName, modeOf } from '../src/domain/match/room'
import { RECONNECT_GRACE, assignTeam, connected, present, nextSlot } from '../src/domain/match/match'
import { stampLocomotion, stampProtected } from '../src/protocol/snapshot'
import { fallDamage } from '../src/domain/rule/damage'
import { HELD } from '../src/domain/item/held'
import { triggeredBy } from '../src/sim/judge/claymore'
import { TRIGGER_COS, TRIGGER_RANGE } from '../src/domain/item/claymore'
import { flush } from './stats'
import { loadSkills } from './skills'
import { costOf } from '../src/domain/player/skill'
import { FIXED_STEP, stepProjectile } from '../src/sim/judge/ballistic'
import { canBeHurt, canChoose, CHOOSE_FLOOR, CHOOSE_TIMEOUT, DOWN_DURATION, SPAWN_PROTECT } from '../src/domain/player/lifecycle'
import type { ClientMessage, RoomSummary, ServerMessage } from '../src/protocol/types'
import { chooseLoadout, chooseSkills } from '../src/domain/player/equip'


const PORT = Number(process.env.PORT ?? 8787)

/**
 * サーバーの刻み (ms)。64Hz。
 *
 * 描画ループとは無関係に進む必要があるのでサーバーが持つ。クライアントの
 * タブが裏に回っても止まらない。
 *
 * いま刻んでいるのは復帰と回復の時計だけで、そこには 10Hz でも足りていた。
 * 先に上げてあるのは、これから載せるもの (投げ物の飛翔、弾道) が
 * 刻みの細かさをそのまま精度にするため。420 m/s の弾は 10Hz だと
 * 1 刻みで 42m 進む — ステージの端から端まで 2 刻みで着いてしまう。
 */
const TICK_MS = 1000 / 64

/**
 * 切れた人の体を配り直す間隔 (ms)。
 *
 * 動かないので細かく送る意味が無い。受け取る側が「途切れた」と判断しない
 * 程度で足りる (相手ごとの猶予は届く間隔の 3 倍、下限 0.35 秒)。
 */
const LIMBO_MS = 100

/**
 * 時計を進める。
 *
 * **例外でサーバーごと落とさない。** 的 (接続を持たない Player) に向かって
 * 送ろうとした所で例外が出て、**プロセスが落ちて全部屋が消えた**ことがある。
 * 1 回の刻みを捨てるだけなら、次の刻みで何事もなく続く。
 *
 * 握り潰さずに大きく出す。落ちなくなったぶん、気づけるのはログだけになる。
 */
setInterval(() => {
  try {
    const now = Date.now()
    for (const room of rooms.values()) {
      // 自分の本当の値を 1 人ずつ配る。**予測を直すため**で、普段は一致している
      sendSelf(room, now)
      // 切れた人の体をその場に残す。
      //
      // 位置は「届いたときに配る」形なので、送ってこなくなれば自然に止まり、
      // 相手の画面から消える。消えると**ブラウザを閉じるのが逃げ道**になる
      // (閉じれば消え、戻れば続きから)。最後のパケットを配り直して、
      // 撃てるし倒せる的として残す。
      //
      // 姿勢だけ away に差し替える。そのまま配ると、走っていた人がその場で
      // 走り続ける絵になる
      if (now - room.lastLimbo >= LIMBO_MS) {
        room.lastLimbo = now
        for (const player of room.players.values()) {
          // 的は切れない (接続を持たない)。ここは人の話
          if (player.bot || player.life !== 'dropped') continue
          const last = sessionOf(player).lastPayload
          if (!last) continue
          const view = new DataView(last.buffer, last.byteOffset, last.byteLength)
          stampLocomotion(view, 'away')
          stampProtected(view, false)
          relayState(room, player, last)
        }
      }

      // 待ち切った席を畳む。部屋が空になったらここで初めて部屋も消える
      for (const player of room.players.values()) {
        if (player.life === 'dropped' && lifeElapsed(player, now) >= RECONNECT_GRACE) {
          // 待ち切っても戻らなかった。走っている試合を置いて消えたのと同じ
          if (room.phase === 'playing') recordSeat(room, player, true)
          room.players.delete(player.id)
          sessions.delete(player.id)
          // ここで初めて消してもらう。切れた時点では配らない —
          // 配ると受け取った側が実体を捨ててしまい、そのあと届く体を
          // 新品として作り直して状態を見失う
          broadcast(room, { type: 'leave', id: player.id })
        }
      }
      if (room.players.size === 0) {
        // **部屋ごと畳む。** 中に在った物 (手榴弾・クレイモア・落ちている武器) も
        // 一緒に消える。持ち主が部屋なので、掃除を書き忘れようがない
        rooms.delete(room.name)
        continue
      }

      updateMatch(room, now)
      if (room.mode.id === 'PRACTICE') updateTargets(room, now)
      relayClaymores(room)
      for (const player of connected(room)) {
        // --- 時間で進む遷移 ---
        //
        // 状態ごとに別の時計を持たない。「その状態に入ってから何秒経ったか」
        // だけを見る。以前は respawnAt と protectedUntil が別々にあり、
        // 置き忘れた場所 (途中参加) だけ無敵が付かなかった。
        switch (player.life) {
          case 'downed':
            // 倒れる尺が終わったら支度へ。ここで初めて装備画面が出る
            if (lifeElapsed(player, now) >= DOWN_DURATION * 1000) {
              setLife(room, player, 'choosing', now)
            }
            continue
          case 'choosing':
            // 決めないまま放っておかれた。相手の試合を止めないために打ち切る
            if (lifeElapsed(player, now) >= CHOOSE_TIMEOUT * 1000) spawn(room, player, now)
            continue
          case 'spawning':
            if (lifeElapsed(player, now) >= SPAWN_PROTECT * 1000) {
              setLife(room, player, 'alive', now)
            }
            break
          case 'joining':
            continue
        }

        // --- 回復 ---
        // 集中し続けた時間で買う。全快はせず、瀕死を脱するところまで。
        // 撃ち合いに負けた傷は残り、次の撃ち合いは不利なまま始まる。
        if (player.health <= 0 || player.health >= RECOVER_CAP) continue
        if (player.concentratingSince === 0) continue
        if (now - player.concentratingSince < RECOVER_DELAY * 1000) continue

        const healed = Math.min(RECOVER_CAP, player.health + (RECOVER_RATE * TICK_MS) / 1000)
        if (healed === player.health) continue
        player.health = healed

        // 回復そのものは毎刻み進めるが、配るのは表示が変わるときだけ。
        // 刻みを 64Hz に上げたぶんをそのまま流すと、回復中だけ通信が跳ね上がる。
        // 受け取る側は整数に丸めて出しているので、変わらない値を送る意味が無い。
        const shown = Math.ceil(player.health)
        if (shown === sessionOf(player).healthShown && player.health < RECOVER_CAP) continue
        sessionOf(player).healthShown = shown
        sendHealth(room, player, 0, false)
      }

      // --- 手榴弾 ---
      // 固定の刻みで解く。クライアントも同じ刻みで解くので軌道が一致する
      for (let i = room.grenades.length - 1; i >= 0; i--) {
        const nade = room.grenades[i]
        const steps = Math.max(1, Math.round(TICK_MS / 1000 / FIXED_STEP))
        for (let k = 0; k < steps; k++) stepProjectile(nade.body, room.stage.solid)
        nade.fuse -= TICK_MS / 1000
        if (nade.fuse <= 0) {
          detonate(room, nade)
          room.grenades.splice(i, 1)
        }
      }

      // クレイモア。前を敵が通ったら起爆する
      if (room.phase === 'playing') {
        for (let i = room.claymores.length - 1; i >= 0; i--) {
          const claymore = room.claymores[i]
          // 起爆させるのも同じ顔ぶれ。**置いた本人が前を通れば起爆する**
          const hit = present(room).some(
            (p) =>
              canBeHurt(p.life) &&
              (p.id === claymore.owner || p.team !== claymore.team) &&
              triggeredBy(claymore, p, TRIGGER_RANGE, TRIGGER_COS),
          )
          if (!hit) continue
          detonateClaymore(room, claymore)
          room.claymores.splice(i, 1)
        }
      }
    }
  } catch (error) {
    console.error('[刻み] 例外。この刻みは捨てる', error)
  }
}, TICK_MS)

/**
 * 認証の発行元。設定が無ければ起動しない。
 *
 * 「設定が無ければ素通し」にすると、設定を書き忘れた本番が黙って
 * 誰でも入れる状態で立ち上がる。落ちるほうが安全。
 */
const AUTH_URL = process.env.SUPABASE_URL ?? ''
/**
 * 署名を確かめずに ID を名乗れる入口。**明示的に立てたときだけ**開く。
 *
 * 試験用。アカウントを人数分作らずに、遮蔽や当たり判定を確かめられるようにする。
 */
const TEST_AUTH = process.env.MGO2_TEST_AUTH === '1'
if (TEST_AUTH) {
  console.warn('⚠ MGO2_TEST_AUTH=1 — 署名を確かめずに ID を名乗れる。試験用')
}
// 署名を確かめるのに要る。**試験用の入口を開けているときは要らない** —
// そちらは token を見ないので、公開鍵を取りに行く先も要らない。
//
// ここで落ちると、.env の無い環境 (CI) では起動すらできない。手元では bun が
// cwd の .env を勝手に読むので気づけず、CI でだけ「サーバーが起きない」になった。
if (!AUTH_URL && !TEST_AUTH) {
  console.error('SUPABASE_URL が無い。.env を読ませて起動する:\n  bun run serve')
  process.exit(1)
}

async function resolveIdentity(url: URL): Promise<Identity | null> {
  const token = url.searchParams.get('token')
  if (token) {
    const identity = await verifyToken(token, AUTH_URL)
    if (!identity) console.warn('[認証] token を確かめられない')
    return identity
  }

  if (TEST_AUTH) {
    const id = url.searchParams.get('id')
    return id ? { subject: id } : null
  }
  return null
}

/** 一覧を取りに来るのは別のポートで動いている画面。読み取りだけなので開けてよい */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
}


/**
 * 前回の選択を席へ載せ直す。**待たせない。**
 *
 * スキルは試合が始まる前にしか選べないので、走っている試合へ入ってきた人は
 * 選ぶ窓の外に居る。本人に申告させると劣勢の側を見てから組み替えられるので、
 * 前回の選択をサーバーが持ってくる (server/skills.ts)。
 *
 * 入室は先に済ませて、届いたときに載せる。DB が遅くても落ちても、**空のまま
 * 遊べる**状態は壊さない。
 *
 * **既に選んでいたら上書きしない。** 支度の間に選び直した人の選択が、遅れて
 * 届いた読み出しで巻き戻る — 支度は数秒あるので、実際に起こり得る順番。
 */
function restoreSkills(player: Player): void {
  void loadSkills(player.id).then((skills) => {
    if (costOf(player.skills) > 0) return
    player.skills = skills
    sendSkills(player)
  })
}

/**
 * いま効いているスキルを本人へ返す。
 *
 * **選んでいない人にも要る。** 途中参加した人は窓の外に居るので、前回の選択を
 * サーバーが持ってくる — 何が効いているかを画面に出すには、こちらから知らせる
 * しかない。
 */
function sendSkills(player: Player): void {
  sessionFor(player)?.socket.send(
    JSON.stringify({ type: 'skills', skills: player.skills } satisfies ServerMessage),
  )
}

/**
 * 届いた 1 通を捌く。
 *
 * **本体を関数に出してある。** 呼ぶ側 (websocket.message) が try で包むため —
 * 1 通の例外でプロセスが落ちると、その部屋どころか**全部屋の全員が切れる**。
 */
function handleMessage(
  socket: Bun.ServerWebSocket<Client>,
  raw: string | Buffer | Uint8Array | ArrayBuffer,
): void {
  const room = rooms.get(socket.data.room)
  const player = room?.players.get(socket.data.id)
  if (!room || !player) return


  // 位置だけ 2 進。数が桁違いに多いので、ここだけ詰めてある
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    receiveSnapshot(room, player, raw)
    return
  }

  let message: ClientMessage
  try {
    message = JSON.parse(String(raw))
  } catch {
    // 壊れた 1 通で対戦が止まる理由はない
    return
  }

  switch (message.type) {
    case 'join':
      player.name = message.name
      // 所属と席番号を足してから配る。本人が名乗った内容をそのまま流さない
      broadcast(
        room,
        { ...message, team: player.team, slot: player.slot },
        player.id,
      )
      break

    case 'damage':
      // 送り主を信じない。名乗った ID ではなく接続の ID を使う。
      {
        const hurt = applyDamage(room, player, { ...message, id: player.id })
        // **仰け反れば手が緩む。** 落とすのは武器の側の仕事
        const victim = room.players.get(message.target)
        if (hurt.letGo && victim) dropGrenade(room, victim)
      }
      break

    case 'state':
      // 位置は 2 進でしか受け取らない。
      //
      // JSON で来たものをここで捨てないと、下の default に落ちて
      // **遮蔽の判定を通さずに全員へ配られる**。見えない相手の位置を
      // 配らない、という仕掛けが丸ごと迂回できてしまう。
      return

    case 'grenade':
      throwGrenade(room, player, message)
      break

    case 'loadout':
      // **選んだ物をそのまま書き込まない。** 表に無い名前を名乗られたら弾く
      // (弾いた先で weaponOf が undefined を返し、判定ごと壊れる)
      if (!chooseLoadout(player, message.primary, message.support, canChoose(player.life))) {
        reject(player, `選べない装備 (${message.primary} / ${message.support})`)
      }
      break

    /*
     * スキルを選び直した。**窓が閉じていたら黙って弾く。**
     *
     * 通っても弾いても、**いま効いている物を返す**。弾いたときに何も返さないと、
     * 送った側の画面だけが選び直したつもりで残る (途中参加した人には窓が
     * 最初から閉じているので、これは普通に起きる)。
     */
    case 'skills': {
      if (!chooseSkills(player, message.skills, room.phase)) {
        reject(player, `選べないスキル (${JSON.stringify(message.skills)})`)
      }
      sendSkills(player)
      break
    }

    // 支度ができた。ここで初めて戦場へ出す。
    //
    // 湧く時刻を本人に握らせる。自動で湧かせていた頃は、選んでいる途中で
    // 湧いて装備画面が消えていた。ただし早く選んだぶん早く戻れる、には
    // しない (CHOOSE_FLOOR)。選ぶのが速いことは腕前ではない
    case 'spawn':
      if (canChoose(player.life) && lifeElapsed(player, Date.now()) >= CHOOSE_FLOOR * 1000) {
        spawn(room, player)
      }
      break

    // 自分から部屋を出た。**戻りを待たない。**
    //
    // 席を空けて待つのは「うっかり切れた人が戻ってこられるように」で、
    // 出ると決めた人には要らない。待つと、残った側は居ない相手を相手に
    // 最大 30 秒立たされる (試合は続いているのに誰も来ない)。
    case 'claymore':
      placeClaymore(room, player)
      break

    /*
     * 落ちた。**量はこちらで決める** — 速さだけ受け取って共有の式に通す。
     * 量を送らせると好きな値を申告できる。
     *
     * 手柄は誰にも付かない。自分でやったことなので自死に数える
     * (爆風で自分の手榴弾に巻き込まれたときと同じ扱い)。
     */
    /*
     * 武器を地面へ置く。
     *
     * **持ち物を持っているのはクライアント側**なので、何を置いたかは
     * 申告してもらう。こちらは「その銃の写しを捨てる」だけ — 繋ぎ直した
     * ときに、置いたはずの銃が戻ってきては困る。
     */
    case 'drop':
      dropWeapon(room, player, message)
      break

    /**
     * 拾う。**どれを拾うかはこちらが決める** (一番近い物)。
     *
     * 位置を持っているのはサーバーなので、離れた所の物を指して
     * 「拾った」と言われても通らない。
     */
    case 'pickup':
      pickUp(room, player)
      break

    case 'fall': {
      if (room.phase !== 'playing') break
      if (!canBeHurt(player.life)) break
      // 速さそのものも信じ切らない。落ちきる前に着地を申告しても
      // 上限を超えた分は効かない
      const amount = fallDamage(Math.min(message.speed, MAX_FALL_SPEED))
      if (amount <= 0) break
      const hurt = applyBlastDamage(
        room, player, amount,
        player.x, player.z, player.id, 'fall', false,
      )
      // 落ちて倒れたら、握っていた物は足元へ
      if (hurt.letGo) dropGrenade(room, player)
      break
    }
    case 'leave':
      leaveRoom(room, player)
      return

    case 'shot': {
      /*
       * **撃てない物を持っている間の射撃は弾く。**
       *
       * 手榴弾やナイフに持ち替えている間は引き金が効かない、というのが
       * 持ち替えの代償 (docs/design.md の 5)。手元でそう作っても、申告は
       * 別に送れるので、こちらでも見る。
       *
       * 空の弾倉と違って**通信のずれで正当な 1 発が消える心配が無い**。
       * 持ち替えは位置と同じ流れで届くので、撃った瞬間の状態と揃っている。
       */
      if (!HELD[player.held]?.shoots) break
      /*
       * 弾を 1 発減らす。**数を持っているのはこちら** (Player.inventory)。
       *
       * **空でも拒否はしない。** 空撃ちの音は押した瞬間に要るので、
       * 鳴らす判断はクライアントに置いてある。ここで拒むと、通信のずれで
       * 正当な 1 発が消える。
       *
       * 数が権威になったので、拒む形にはいつでも移せる (damage の側で
       * 残弾を見る)。移すなら、ずれたときに**サーバーの数を配り直す**道が
       * 先に要る — いまは繋ぎ直したときにしか返していない。
       */
      player.inventory.spendGun(player.weapon)
      // 弾道の上にクレイモアがあれば起爆する
      shotHitsClaymore(room, message.from, message.to)
      // 銃声だけは扱いが違う。
      //
      // 曳光を描くには銃口の座標が要るが、それは「どこに居るか」そのもの。
      // 姿が見えている相手にだけ座標を渡し、見えない相手には音として配る。
      // 銃声は遠くまで届く設計なので位置がおおよそ漏れるのは想定内だが、
      // 座標は耳より精度が高い。
      relayShot(room, player, message)
      break
    }

    // 装填が**終わった**。尺はクライアントが持っているので、
    // こちらは移すだけでよい
    case 'reload':
      player.inventory.reloadGun(message.weapon)
      break

    default:
      // 見た目のもの (knock) は中身を見ずに流す
      broadcast(room, message, player.id)
  }
}

const server = Bun.serve<Client>({
  port: PORT,

  async fetch(request, server) {
    const url = new URL(request.url)

    // ブラウザは別のポート (Vite) から一覧を取りに来る
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    if (url.pathname === '/health') {
      const lines = [...rooms].map(
        ([name, room]) =>
          `${name}: [${room.phase}] 青 ${room.blue} - 赤 ${room.red}  残り ${Math.max(0, Math.round((room.endsAt - Date.now()) / 1000))}s\n` +
          [...room.players.values()]
            .map(
              (p) =>
                `  ${p.team === 'blue' ? '青' : '赤'} ${p.name} (${Math.ceil(p.health)})` +
                // 通信の様子。姿が出ない相手が居るときはここを先に見る。
                // 64 通/秒 から落ちていれば途切れがち (1 通/秒 まで落ちて
                // いれば、その人のタブが裏に回っている)。時計差が大きければ
                // 時計の合っていない機械が混ざっている
                ((sessionFor(p)?.packetGap ?? 0) > 0
                  ? ` ${(1000 / (sessionFor(p)?.packetGap ?? 1)).toFixed(1)}通/秒 時計差 ${((sessionFor(p)?.clockSkew ?? 0) / 1000).toFixed(2)}s`
                  : '') +
                // 記録に残る分。数えられているかをここで見られる
                ` ${p.kills}/${p.deaths}` +
                (p.headshots > 0 ? ` HS${p.headshots}` : '') +
                (p.headDeaths > 0 ? ` 被HS${p.headDeaths}` : '') +
                (p.suicides > 0 ? ` 自爆${p.suicides}` : '') +
                (Object.keys(p.killsByWeapon).length > 0
                  ? ` [${Object.entries(p.killsByWeapon)
                      .map(([id, n]) => `${id}:${n}`)
                      .join(' ')}]`
                  : '') +
                ((sessionFor(p)?.rejected ?? 0) > 0 ? ` 却下 ${sessionFor(p)?.rejected}` : '') +
                ` [${p.life}]`,
            )
            .join('\n'),
      )
      return new Response(`ok\n${lines.join('\n')}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    // --- 部屋の一覧 ---
    if (url.pathname === '/rooms') {
      // 返す形は src/protocol/types.ts の RoomSummary。画面側も同じ宣言を読む。
      // satisfies なので、増やしても減らしてもここで落ちる
      const summaries = ROOM_NAMES.map((name) => {
        const room = rooms.get(name)
        const here = room ? connected(room) : []
        return {
          name,
          // **どのルールの部屋かを一覧で見せる。** 入ってから分かるのでは遅い
          mode: ROOM_MODE[name],
          label: MODES[ROOM_MODE[name]].label,
          active: MODES[ROOM_MODE[name]].active,
          players: here.length,
          capacity: ROOM_CAPACITY,
          phase: room?.phase ?? 'waiting',
          // 誰が居るか。入る前に見せる
          roster: here.map((p) => ({ id: p.id, name: p.name, team: p.team })),
          blue: room?.blue ?? 0,
          red: room?.red ?? 0,
          // 残り時間はこちらで秒に直す。時計を合わせる話を持ち込まない
          remaining: room?.endsAt ? Math.max(0, Math.round((room.endsAt - Date.now()) / 1000)) : 0,
        } satisfies RoomSummary
      })
      return Response.json(summaries, { headers: CORS })
    }

    // 誰なのかを決める。
    //
    // token があれば署名を検証して、そこから ID を導く。名乗った ID は使わない。
    // 認証を設定していない環境 (LAN で遊ぶだけ) では今までどおり名乗らせる。
    // 遊ぶのに外部サービスが要る状態にはしない。
    const identity = await resolveIdentity(url)
    if (!identity) return new Response('誰なのか分からない', { status: 401 })

    // 部屋は決まったものだけ。知らない名前で新しく作らせない
    const name = url.searchParams.get('room') ?? ROOM_NAMES[0]
    if (!isRoomName(name)) return new Response('そんな部屋は無い', { status: 404 })

    // まだ開けていないルール。**一覧には出すが繋がせない** —
    // 何を作れば開くかが見える形にしておきたい (TSNE は非殺傷武器が要る)
    if (!modeOf(name).active) {
      return new Response('この部屋はまだ開いていない', { status: 503 })
    }

    // 満員。ただし席を持っている本人 (繋ぎ直し) は通す
    const existing = rooms.get(name)
    const seated = existing?.players.has(identity.subject) ?? false
    if (!seated && existing && connected(existing).length >= ROOM_CAPACITY) {
      return new Response('満員', { status: 503 })
    }

    const upgraded = server.upgrade(request, {
      data: {
        id: identity.subject,
        name: identity.name,
        room: name,
      },
    })
    return upgraded ? undefined : new Response('WebSocket でつないでほしい', { status: 426 })
  },

  websocket: {
    open(socket) {
      const room = roomOf(socket.data.room)
      const seat = room.players.get(socket.data.id)
      /** 続きへ戻す人。名簿を送ったあとに渡す */
      let resumed: Player | null = null

      if (seat && seat.life === 'dropped') {
        // 席が残っていた。**その命の続きから始める。**
        //
        // 猶予を 30 秒空けているのは「うっかり切れた人が戻ってこられるように」で
        // あって、湧き直させるためではない。支度からやり直させていた頃は、
        // **瀕死でリロードすれば全快して、装備も選び直せて、弾も満タン**になった。
        // 撃ち合いで不利になったらリロードするのが最適解になる。
        //
        // 所属と名前も引き継ぐ。少ない側へ割り振り直すと、リロードしただけで
        // 敵味方が入れ替わる。
        // 帳簿は作り直す (newSession の註釈にある通り、引き継ぐと壊れる)
        sessions.set(seat.id, newSession(seat, socket))
        // 倒れている最中に切れた人だけは支度から。どのみち次は湧く。
        //
        // 戻す先は **alive**。spawning にすると 3 秒の無敵がタダで手に入り、
        // 「不利になったらリロードして無敵を貰う」ができてしまう。
        // クライアント側でも spawning は respawnSelf を呼ぶので、弾が満タンに戻る
        const resuming = seat.wasAlive
        setLife(room, seat, resuming ? 'alive' : 'choosing')
        // 続きを返すのは名簿のあと (下)。**順番が要る** — 名簿を受けた
        // クライアントは placeAtSpawn で湧き地点へ自分を置くので、先に
        // 続きを渡すと上書きされて**湧き地点へワープする**
        resumed = resuming ? seat : null
        seat.concentratingSince = 0
        seat.holdingGrenade = false
      } else {
        // 名前は発行元が持っていればそれ、無ければ join で名乗るまで仮のもの
        const joined = newPlayer({
          id: socket.data.id,
          name: socket.data.name ?? socket.data.id.slice(0, 4).toUpperCase(),
          team: assignTeam(room),
          slot: nextSlot(room),
          now: Date.now(),
        })
        room.players.set(joined.id, joined)
        sessions.set(joined.id, newSession(joined, socket))
        restoreSkills(joined)
      }

      // 今いる全員と試合の状態を渡す。
      // 参加の通知を 1 通取りこぼしても、名簿で回復できる。
      socket.send(
        JSON.stringify({
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
        } satisfies ServerMessage),
      )
      socket.send(JSON.stringify(matchState(room)))

      // **名簿のあとに渡す。** 名簿を受けたクライアントは placeAtSpawn で
      // 自分を湧き地点へ置くので、先に渡すと上書きされてワープになる
      if (resumed) {
        socket.send(
          JSON.stringify({
            type: 'resume',
            x: resumed.x,
            y: resumed.y,
            z: resumed.z,
            health: resumed.health,
            ...(() => {
              const ammo = resumed.inventory.ammoTable()
              return { magazine: ammo.magazine, reserve: ammo.reserve }
            })(),
            grenades: resumed.grenades,
            support: resumed.support,
            primary: resumed.primary,
          } satisfies ServerMessage),
        )
      }
    },

    message(socket, raw) {
      try {
        handleMessage(socket, raw)
      } catch (error) {
        // **1 通の躓きでサーバーを落とさない。** 落ちると全部屋の全員が切れる
        console.error(`[通] ${socket.data.id} の 1 通で例外`, error)
      }
    },

    close(socket) {
      const room = rooms.get(socket.data.room)
      const player = room?.players.get(socket.data.id)
      if (!room || !player) return
      // 同じ ID で繋ぎ直したあとに、古い接続の後始末が届くことがある。
      // それで新しいほうを離脱扱いにしないよう、送り主を確かめる。
      if (sessions.get(player.id)?.socket !== socket) return

      // 席は残す。畳むのは待ち切ってから (tick)
      // 続きへ戻せる状態だったかを控える。倒れている最中なら、どのみち次は湧く
      player.wasAlive = player.life === 'alive' || player.life === 'spawning'
      setLife(room, player, 'dropped')

      // **leave は配らない。**
      //
      // 以前はここで配っていた (「閉じた側が立ち尽くしたまま残る」のを防ぐため)
      // が、いまはその立ち尽くしこそが欲しい挙動になった — 閉じても体は残って
      // 撃たれる。leave を配ると受け取った側は実体ごと捨てるので、そのあと
      // 体のパケットが届いても**新品として作り直され、状態が既定の joining に
      // 戻る**。戦場に居ない扱いになって、一度も描かれない。
      //
      // 配るのは席を畳むとき (猶予切れ / 自分から出たとき) だけ。
    },
  },
})

console.info(`対戦サーバー: ws://localhost:${server.port}  (確認: http://localhost:${server.port}/health)`)

/**
 * 止める合図。**配置のたびにここを通る。**
 *
 * 部屋はメモリにしか無いので、そのまま落ちると走っていた試合の戦績が丸ごと
 * 消える。ここで書き出せば、決着は付かない (ended_at は null のまま) が
 * 数字は残る。
 *
 * **離脱にはしない。** 抜けさせたのはこちらの都合であって、本人ではない。
 * 配置のたびに全員へ離脱が付くようだと、その数字は誰も信用しなくなる。
 */
function shutdown(signal: string): void {
  console.info(`[終了] ${signal}。走っている試合を書き出す`)
  for (const room of rooms.values()) {
    if (room.phase !== 'playing') continue
    for (const player of room.players.values()) recordSeat(room, player, false)
  }
  // 送り終わるのを待ってから落ちる。待たないと書いた意味が無い
  void flush().then(() => process.exit(0))
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
