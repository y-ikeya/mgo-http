/**
 * 配る。**誰に何を見せるか。**
 *
 * 見えている相手にだけ位置を配る、音は届く距離だけ、という判断がここ。
 * 見えるかどうかを決める幾何は sim (vision / eyepoint)。
 */

import { connected, isLeaking } from '../src/domain/match/match'
import { recordPose } from './history'
import { isFriendly } from '../src/domain/match/room'
import { canChoose, canSee, isDowned, isJoining, onBattlefield } from '../src/domain/player/lifecycle'
import { isLeakedTo } from '../src/domain/player/player'
import { STEP_UP } from '../src/domain/player/moving'
import { type MatchPlayer, headHeightOf, isProtected, lifeElapsed } from '../src/domain/player/player'
import { surfaceOf } from '../src/domain/stage'
import { SNAPSHOT_BYTES, decodeSnapshot, isSnapshot, stampProtected, stampSlot } from '../src/infra/codec/snapshot'
import type { ServerMessage } from '../src/application/protocol/types'
import { checkMove, checkMoveOnMesh } from '../src/sim/judge/motioncheck'
import { cameraPoint, seesFromCamera, type Viewer } from '../src/sim/space/eyepoint'
import { bodyVisible, groundUnder, hasLineOfSight } from '../src/sim/space/vision'
import { sessionOf } from './session'
import { type RoomWorld, broadcast, setLife } from './world'
import { weaponOf } from '../src/domain/item/weapons'
import { isHeard, shotReach, stepReach } from '../src/domain/rule/noise'
import { BODY_BOX, HEAD_HEIGHT, MOVE_PROBE_HEIGHT, VAULT_PROBE_HEIGHT, VIEW_HEIGHT, leanOf, leanShift, stanceOf } from '../src/domain/player/stance'
import { canHold } from '../src/domain/player/equip'
import type { HitZone } from '../src/domain/rule/damage'
import { isSeated } from '../src/domain/player/lifecycle'

/**
 * 位置が届いたとき。
 *
 * 中身は詰め直さず、送り主の席番号だけを書き込んで、そのまま配る。
 * 送り主に名乗らせないので、他人になりすませない。
 */
/**
 * 状態が変わってから、移動の検査を始めるまで (ms)。
 *
 * 湧き直しでは湧き地点へ正当に跳ぶ (倒れた場所から数十 m 動く)。
 * 繋ぎ直した直後も前の位置とは繋がっていない。その分をここで見逃す。
 */
export const WARP_GRACE = 1000

export function receiveSnapshot(room: RoomWorld, player: MatchPlayer, raw: ArrayBuffer | ArrayBufferView): void {
  const bytes =
    raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!isSnapshot(view)) {
    // 形が合わない位置は捨てるしかないが、**黙って捨てると原因が分からない**。
    //
    // 位置の大きさは作りを変えるたびに増えている (33 → 35 → 36 バイト)。
    // 古いクライアントが繋ぐと、その人の位置だけが全部落ちる。落ちた人は
    // 「まだ位置を知らせていない人」の扱いになるので、誰の位置も配られない —
    // 銃声だけ聞こえて姿が見えない、という形で表に出る。
    // 時刻はここで取る。**下の const now より前なので、そちらは参照できない** —
    // 参照すると ReferenceError で落ちる (形の合わない位置が届いた瞬間に、
    // 古いクライアントを知らせるはずの道でサーバーが例外を投げていた)
    const at = Date.now()
    if (at - sessionOf(player).badPacketAt > 5000) {
      sessionOf(player).badPacketAt = at
      console.warn(
        `[位置] ${player.name}: 形が合わない (${bytes.byteLength} バイト、期待は ${SNAPSHOT_BYTES})。` +
          'クライアントが古い可能性',
      )
    }
    return
  }

  const snapshot = decodeSnapshot(view, player.id)

  // 通信の様子を控える。/health に出す。
  //
  // 「見えない敵が居る」の原因は、遮蔽の判定・届く間隔・時計のずれの
  // どれでも起こる。判定だけ疑って何度も試すことになったので、
  // 残りの 2 つは常に測っておく
  const arrived = Date.now()
  if (sessionOf(player).lastPacketAt > 0) {
    const gap = arrived - sessionOf(player).lastPacketAt
    sessionOf(player).packetGap =
      sessionOf(player).packetGap > 0 ? sessionOf(player).packetGap + (gap - sessionOf(player).packetGap) * 0.1 : gap
  }
  sessionOf(player).lastPacketAt = arrived
  sessionOf(player).clockSkew = snapshot.time - arrived

  // 跳んだ / 抜けたを弾く。
  //
  // 通ったものはそのまま信じる (速さは測らない)。ここが緩いままだと、
  // 座標を書き換えるだけで「そこから見える相手」を配らせられる —
  // 位置が可視を決めているので、詐称は壁抜けの視界になる。
  //
  // **状態が変わった直後は見ない。** 湧き直しでは湧き地点へ正当に跳ぶし、
  // 繋ぎ直した直後も前の位置とは繋がっていない
  const settled = onBattlefield(player.life) && lifeElapsed(player, arrived) > WARP_GRACE
  if (settled) {
    /*
     * 線を引く高さは姿勢で下げる。**伏せている人を胸の高さで見ると、潜れる物の
     * 下を這っただけで弾かれる。** 前後どちらかが低ければ低いほう。
     */
    // 跳び越えている間は枠の上で引く。立ちの高さだと窓枠そのものを貫く
    const vaulting = [player.locomotion, snapshot.locomotion].some((l) => l === 'vault' || l === 'vault_up')
    const probe = vaulting
      ? VAULT_PROBE_HEIGHT
      : Math.min(
          MOVE_PROBE_HEIGHT[stanceOf(player.locomotion)],
          MOVE_PROBE_HEIGHT[stanceOf(snapshot.locomotion)],
        )
    const verdict = room.stage.body
      ? checkMoveOnMesh(player, snapshot, room.stage.body, room.stage.arenaHalf, probe)
      : checkMove(player, snapshot, room.stage.solid, room.stage.arenaHalf)
    if (!verdict.ok) {
      sessionOf(player).rejected++
      sessionOf(player).lastReject = verdict.reason ?? ''
      if (arrived - sessionOf(player).badMoveAt > 5000) {
        sessionOf(player).badMoveAt = arrived
        console.warn(`[位置] ${player.name}: ${verdict.reason}`)
      }
      // 動かさない。姿勢や向きは受けてよいので、位置だけ据え置く
      return
    }
  }

  player.x = snapshot.x
  player.y = snapshot.y
  player.z = snapshot.z
  // 低くなった瞬間を控える。高くなったら即座に解く
  // (立ち上がりは「見えるようになる」方向なので、遅らせる理由が無い)
  const lowered = snapshot.crouching || snapshot.boxed
  if (!lowered) player.loweredAt = 0
  else if (player.loweredAt === 0) player.loweredAt = Date.now()
  player.crouching = snapshot.crouching
  player.boxed = snapshot.boxed
  player.yaw = snapshot.yaw
  player.cameraYaw = snapshot.cameraYaw
  player.pitch = snapshot.pitch
  player.aiming = snapshot.aiming
  player.locomotion = snapshot.locomotion
  // 持っている銃。威力と連射の上限をこれで引く
  /*
   * **手にある物は申告だが、持てない物は受け取らない。**
   *
   * 位置と一緒に流れてくるので素通ししていたが、これは状態ではなく意思。
   * 選んでいない銃を名乗って撃つ、が形の上では通っていた (撃つ側で 1 か所
   * 見ていただけ)。持てるかどうかはドメインルールが決める (domain/player/equip.ts)。
   *
   * **弾いたら前の値のまま。** 送り返して直させるより、こちらが知っている
   * 姿を配り続けるほうが素直 — 他人の画面には正しい物が映る。
   */
  if (canHold(player, snapshot.weapon)) player.weapon = snapshot.weapon
  // いま手にある物。撃てるかどうかの判断に使う
  if (canHold(player, snapshot.held)) player.held = snapshot.held
  // 振りかぶって持っているか。倒された瞬間に足元へ落とすのに要る
  player.holdingGrenade = snapshot.holdingGrenade
  // 位置が届いた。どこに居るか分かったので支度に進める
  if (isJoining(player.life)) setLife(room, player, 'choosing')
  recordPose(player)

  // 足音は位置が動いた分から出す。見えない相手にも音だけは届ける。
  // 戦場に居ないうち (支度中) は鳴らさない — 湧き地点で選んでいるだけなので
  if (onBattlefield(player.life)) {
    const step = player.footsteps.update(player.x, player.y, player.z, player.locomotion, true)
    if (step) emitNoise(room, player, { kind: 'step', ...step })
  }

  const now = Date.now()
  if (!snapshot.concentrating) player.concentratingSince = 0
  else if (player.concentratingSince === 0) player.concentratingSince = now

  stampSlot(view, player.slot)
  // 無敵かどうかはこちらが知っている。送り主に名乗らせない
  stampProtected(view, isProtected(player))
  // 切れたときに配り直せるよう、レプリカを取っておく。
  // bytes は受信バッファなので、持ち回すなら複製が要る
  sessionOf(player).lastPayload = new Uint8Array(bytes)
  relayState(room, player, bytes)
}


/**
 * しゃがみが体に現れるまで (ms)。
 *
 * クライアント側のモーション補間に合わせてある。この間は立った高さで見る。
 * 迷ったら送る側に倒す — 見えるはずの相手を送り忘れるほうが、
 * 見えない相手を少し長く送ってしまうより困る。
 */
export const LOWER_SETTLE_MS = 300

/** 遮蔽の判定に使う頭の高さ。沈み切るまでは立った高さで見る */
export function visibleHead(player: MatchPlayer, now: number): number {
  const settled = player.loweredAt > 0 && now - player.loweredAt >= LOWER_SETTLE_MS
  return settled ? headHeightOf(player) : HEAD_HEIGHT.stand
}

/**
 * その人のカメラの注視点の高さの幅 (足元から)。
 *
 * 姿勢の表 (domain/player/stance.ts の VIEW_HEIGHT) を引く。沈み切るまでの間は
 * 画面のカメラも立った高さから下りてくる途中なので、**立ちとその姿勢の両方を
 * 覆う幅**にする (visibleHead と同じ判断)。
 */
export function viewHeightsOf(player: MatchPlayer, now: number): readonly [number, number] {
  const own = VIEW_HEIGHT[stanceOf(player.locomotion)]
  const settled = player.loweredAt > 0 && now - player.loweredAt >= LOWER_SETTLE_MS
  if (settled) return own
  const stand = VIEW_HEIGHT.stand
  return [Math.min(own[0], stand[0]), Math.max(own[1], stand[1])]
}

/**
 * その人の画面に、その点に立つ相手が映るか。
 *
 * 可視を問うところは全部これを通す。位置を配るとき・銃声を配るとき・
 * 足音を配るとき・置き物を見せるときで別々に出すと、定義がずれて
 * 「姿も音も無い敵」が生まれる。
 *
 * **カメラの高さの幅の両端で引く** (sim の seesFromCamera)。1 つの高さで
 * 決めていた頃、しゃがんで隙間から覗くと画面には映っているのに配られなかった。
 */
export function sees(
  room: RoomWorld,
  viewer: MatchPlayer,
  targetX: number,
  targetFeetY: number,
  targetZ: number,
  targetHead: number,
  now: number,
): boolean {
  return seesFromCamera(
    viewer,
    viewHeightsOf(viewer, now),
    // 壁に寄せる。省くと壁を背にした瞬間にカメラが壁の中へ入り、
    // その人だけ全方位が見えなくなる。**どこで当たったかが要るので箱**
    room.stage.camera,
    (ex, ey, ez) => hasLineOfSight(ex, ey, ez, targetX, targetFeetY, targetZ, targetHead, room.stage.sight),
    viewEye,
  )
}

/**
 * その人の画面に、相手 (人) が映るか。**体の箱の 12 辺で見る。**
 *
 * 点 (頭・胸・足元 …) で見ていた頃は、点の間隔より細い隙間から見えている体を
 * 取りこぼして、相手が急に現れたり消えたりした。箱の辺を線分として見れば
 * 間隔が無い (vision.ts の bodyVisible、bvh.ts の segmentVisible)。
 *
 * 箱の寸法は構えごと (domain/player/stance.ts の BODY_BOX)。伏せは向きに沿って
 * 前に長い。沈み切る前は立ちの箱で見る (visibleHead と同じ判断)。
 */
export function seesPlayer(room: RoomWorld, viewer: MatchPlayer, target: MatchPlayer, now: number): boolean {
  const settled = target.loweredAt > 0 && now - target.loweredAt >= LOWER_SETTLE_MS
  const box = BODY_BOX[settled ? stanceOf(target.locomotion) : 'stand']
  // 傾いていれば体もその分横に居る
  const shift = leanShift(leanOf(target.locomotion), stanceOf(target.locomotion), target.yaw, targetShift)
  const tx = target.x + shift.x
  const tz = target.z + shift.z
  return seesFromCamera(
    eyeOf(viewer),
    viewHeightsOf(viewer, now),
    room.stage.camera,
    (ex, ey, ez) => bodyVisible(ex, ey, ez, tx, target.y, tz, target.yaw, box, room.stage.sight),
    viewEye,
  )
}

/** 作業場。seesPlayer / eyeOf は同期で、返した物はその場で使い切る */
const targetShift = { x: 0, z: 0 }
const viewerShift = { x: 0, z: 0 }
const leanedViewer: Viewer = { x: 0, y: 0, z: 0, cameraYaw: 0, pitch: 0, aiming: false }

/**
 * 見ている側の目の置き場。**傾いていれば横へずらす。**
 *
 * ずらさないと、覗いた本人の画面では角の向こうが見えているのに、サーバーは
 * 元の位置から見て「見えない」と言って配らない。
 */
function eyeOf(viewer: MatchPlayer): Viewer {
  const shift = leanShift(leanOf(viewer.locomotion), stanceOf(viewer.locomotion), viewer.yaw, viewerShift)
  leanedViewer.x = viewer.x + shift.x
  leanedViewer.y = viewer.y
  leanedViewer.z = viewer.z + shift.z
  leanedViewer.cameraYaw = viewer.cameraYaw
  leanedViewer.pitch = viewer.pitch
  leanedViewer.aiming = viewer.aiming
  return leanedViewer
}

/**
 * 音を配る。
 *
 * **見えている相手には送らない。** 見えていれば位置が届いているので、
 * 受け取った側が自分で鳴らせる。ここで送るのは「姿は見えないが音は届く」場合だけ。
 *
 * 位置は入れない。方向と距離だけ渡す — それが耳で分かることの全部だから。
 */
export function emitNoise(
  room: RoomWorld,
  from: MatchPlayer,
  noise: { kind: 'step' | 'shot'; volume?: number; range?: number; climbing?: boolean },
): void {

  // どこまで届くかはドメインルール (domain/rule/noise.ts)。銃声は武器ごとに違う
  const reach =
    noise.kind === 'shot' ? shotReach(weaponOf(from.weapon)) : stepReach(noise.range ?? 1)
  const now = Date.now()

  /*
   * 何の上を踏んだかは地形から出す。申告させるものではない。
   *
   * **立てる面 (solid) から引く。** 視線を止める面 (sight) は三角の網になって
   * 材質を持たないし、そもそも「乗っている面」は物がぶつかる側の話。
   */
  // 梯子の段は足の下の床ではなく梯子そのもの。**梯子は金属**
  const surface =
    noise.kind !== 'step'
      ? undefined
      : noise.climbing
        ? 'metal'
        : surfaceOf(groundUnder(from.x, from.z, from.y, room.stage.solid, STEP_UP).name)

  for (const listener of connected(room)) {
    if (listener.id === from.id) continue
    if (!canSee(listener.life)) continue

    // 距離と、見えているかは幾何 (sim)。聞こえるかを決めるのはドメインルール (domain)
    const distance = Math.hypot(from.x - listener.x, from.z - listener.z)
    const visible =
      isFriendly(room.mode, listener, from) ||
      seesPlayer(room, listener, from, now)
    if (!isHeard(distance, reach, visible)) continue

    sessionOf(listener).socket.send(
      JSON.stringify({
        type: 'noise',
        kind: noise.kind,
        bearing: Math.atan2(from.x - listener.x, -(from.z - listener.z)),
        distance,
        surface,
        climbing: noise.climbing || undefined,
        weapon: noise.kind === 'shot' ? from.weapon : undefined,
        range: noise.range,
        volume: noise.volume,
      }),
    )
  }
}

/**
 * 発砲を配る。見えている相手には曳光ごと、見えない相手には音だけ。
 */
export function relayShot(room: RoomWorld, from: MatchPlayer, message: ServerMessage): void {
  const payload = JSON.stringify(message)
  const now = Date.now()

  for (const listener of connected(room)) {
    if (listener.id === from.id) continue

    const visible =
      isFriendly(room.mode, listener, from) ||
      !canSee(listener.life) ||
      seesPlayer(room, listener, from, now)

    if (visible) sessionOf(listener).socket.send(payload)
  }

  // 見えない相手には音として届ける
  emitNoise(room, from, { kind: 'shot' })
}

/**
 * 位置を、見えている相手にだけ配る。
 *
 * これがこのゲームの肝。全員へ流すと、ブラウザの JS を覗くだけで壁の向こうの
 * 相手が読める。接敵するまではステルス、という前提が丸ごと崩れる。
 *
 * 味方には無条件で配る。TDM で味方の位置が分からないと連携のしようがないし、
 * 隠すべき情報は敵に対するものだけ。判定の回数も半分以下になる。
 *
 * 見えなくなった相手には何も送らない。「見えなくなった」と伝えると、
 * それ自体が「さっきまで見ていた」という情報になる。受け取る側は最後に
 * 届いた位置のまま置いておく。
 */
/** カメラ位置の置き場。毎フレーム作らないよう使い回す */
export const viewEye = { x: 0, y: 0, z: 0 }

/**
 * その人の画面がどこから見ているか。**1 点が要るとき用** (照準の向きなど)。
 *
 * 可視を問うのはこれではなく sees / seesPlayer。あちらは高さの幅の両端で引く。
 * ここは幅の真ん中 1 点。
 */
export function viewOf(room: RoomWorld, player: MatchPlayer, now: number): { x: number; y: number; z: number } {
  const [low, high] = viewHeightsOf(player, now)
  const eye = eyeOf(player)
  return cameraPoint(
    eye.x,
    eye.y,
    eye.z,
    player.cameraYaw,
    player.pitch,
    player.aiming,
    (low + high) / 2,
    room.stage.camera,
    viewEye,
  )
}

export function relayState(room: RoomWorld, from: MatchPlayer, payload: Uint8Array): void {

  const now = Date.now()
  /*
   * **光っている人は遮蔽を無視して配る。**
   *
   * 光る = 位置が公になっている、という語彙 (docs/design.md の 3)。いまは
   * 個人戦の 1 位だけで、リンクを抜かれた相手も同じフラグに乗る。**誰が光るかは
   * ドメインルールが決める** (domain/match/match.ts の isLeaking)。
   *
   * 見る人には依らないので、ループの外で 1 回だけ引く。
   */
  const glowing = isLeaking(room, from)
  // 戦場に居ない人 (支度中・まだ位置を知らせていない) は誰にも配らない。
  // 倒れた場所に体が 30 秒残ることになる
  const present = onBattlefield(from.life)

  for (const viewer of connected(room)) {
    if (viewer.id === from.id) continue

    // 見る側として成立するか。どこから見ているか分からない相手には配らない
    let visible = present && canSee(viewer.life)

    // 倒された側には、倒した相手だけ遮蔽を無視して配る。
    //
    // その画面はいまその人を映している (kill cam)。映すものが無いと画面が
    // 成立しない。倒れている間だけで、支度に移った瞬間に切れる。
    //
    // **代償**: 倒された人は撃ってきた相手の居場所を 5 秒間見られる。
    // 味方に伝えられるので、隠れている側の利は少し削られる。それでも
    // 「どこから撃たれたのか分からないまま死ぬ」よりは読み合いになる、
    // という判断で入れてある。
    const killCam = isDowned(viewer.life) && viewer.killedBy === from.id

    // **抜いた相手は遮蔽越しに見える。** ENEMY EXPOSURE (domain/player/skill.ts)。
    //
    // 1 位の光 (glowing) と違って、**見る人によって答えが変わる** — 抜いた側の
    // 陣営にだけ配る。だから輪の中で引く。
    //
    // ここが EE の本体。輪郭を出すだけなら「見えている相手が光る」で終わって
    // しまい、既に見えているものに色が付くだけで情報が増えない。壁を通すから、
    // 当てたことが次の一手を選ぶ材料になる。
    const exposed = isLeakedTo(from, viewer, now)

    /*
     * **支度中にも、既に公になっている位置だけは届ける。**
     *
     * `canSee` は「戦場に居るか」なので、倒れて支度に移った人はここから外れる
     * — どこから見ているか分からない相手に遮蔽の判定はできない、という理屈で、
     * それ自体は正しい。
     *
     * ただし**遮蔽を問わない位置**は別。光っている相手 (exposed: EE / TA /
     * decoy を撃った人) と、1 位の光 (glowing) は、見る人の目とは関係なく
     * 公になっている。当てた実りが、死んだ瞬間から見えなくなるのは理屈が通らない。
     * (E LOCATOR はここを通らない — 暴いた相手は位置ではなく気配 (sensed) で届く)
     *
     * 目で見る分 (遮蔽越し) は増やさない。支度中の人はまだ戦場に居ないので、
     * そこまで配ると「死んでいる間の偵察」になる。
     */
    if (!visible && present && canChoose(viewer.life) && (exposed || glowing)) visible = true

    // 味方は無条件。TDM で味方の位置が分からないと連携のしようがないし、
    // 隠すべき情報は敵に対するものだけ。判定の回数も半分以下になる
    if (
      visible &&
      !killCam &&
      !glowing &&
      !exposed &&
      !isFriendly(room.mode, viewer, from)
    ) {
      // **目ではなくカメラから**線を引く。三人称なので、画面に映るものを
      // 決めているのはカメラの位置。目で見ると、遮蔽の裏にしゃがんだ相手が
      // 「カメラからは見えているのに送られてこない」ことになる。
      //
      // カメラのほうが後ろ上から見下ろすぶん、目より広く見える。そこは許す —
      // 描いている物と送る物がずれているほうが困る
      visible = seesPlayer(room, viewer, from, now)
    }

    if (!visible) {
      // 配るのをやめる瞬間に 1 通だけ知らせる。
      //
      // 黙って止めると、受け取る側は沈黙の長さから察するしかない。
      // 沈黙は「隠れた」でも「相手の機械が遅れている」でも起きるので、
      // 区別が付かず、遅れて届く相手が見えたり消えたりする。
      if (sessionOf(viewer).seen.delete(from.id)) {
        sessionOf(viewer).socket.send(JSON.stringify({ type: 'hidden', id: from.id } satisfies ServerMessage))
      }
      continue
    }

    sessionOf(viewer).seen.add(from.id)
    sessionOf(viewer).socket.send(payload)
  }
}

/**
 * 被害者から見た攻撃者の方向 (rad)。ワールド基準で 0 が -Z。
 *
 * 位置そのものは渡さない。方向だけなら、遮蔽の向こうに居る相手を
 * 特定する手掛かりにならない。
 */
export function bearingTo(from: MatchPlayer, to: MatchPlayer): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z))
}

/**
 * その相手は背後に居たか。**倒れる向きを決めるのに使う。**
 *
 * yaw = θ のとき前方は (-sinθ, -cosθ)。そこへ射影して負なら背後。
 * 刺突の「背後を取った」(BACKSTAB_DOT) とは別の問い — あちらは**同じ向きを
 * 向いているか**で、こちらは**どちら側に居るか**。
 */
export function isBehind(victim: MatchPlayer, attacker: MatchPlayer): boolean {
  const dx = attacker.x - victim.x
  const dz = attacker.z - victim.z
  return dx * -Math.sin(victim.yaw) + dz * -Math.cos(victim.yaw) < 0
}

/**
 * スタミナを本人にだけ知らせる。
 *
 * **相手の眠気は見えない。** 見えると「あと 1 発で眠る」が撃つ側に分かって、
 * 麻酔が確実な道具になる。当てた手応えは自分の目盛りだけで読む。
 *
 * 眠っているかどうかは別で、これは**全員に見える** (姿勢として出る) —
 * 倒れている体がそこに在るのは隠しようがない。
 */
export function sendStamina(player: MatchPlayer): void {
  if (!isSeated(player.life) || player.bot) return
  sessionOf(player).socket.send(
    JSON.stringify({
      type: 'stamina',
      id: player.id,
      stamina: player.stamina,
      sleepUntil: player.sleepUntil,
    } satisfies ServerMessage),
  )
}

export function sendHealth(
  room: RoomWorld,
  player: MatchPlayer,
  damage: number,
  flinch: boolean,
  fromBearing?: number,
  zone?: HitZone,
  fromBehind?: boolean,
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
        fromBehind,
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
