/**
 * 誰の過去の姿を、どれだけ持つか。**席ごとに 1 本。**
 *
 * --- なぜサーバーの持ち物なのか ---
 * 過去の姿が要るのは巻き戻して照合するときだけで、それをやるのはサーバー。
 * クライアントは自分の過去を持たないし、遊びの規則 (domain) も持たない —
 * **「どこに居たか」は規則ではなく、起きたこと。**
 *
 * 仕組みそのものは遊びを知らない部品 (sim/judge/history.ts)。ここがやるのは、
 * **この遊びの姿 (Pose) を、席ごとに結び付けること**だけ。
 *
 * --- 席が消えたら捨てる ---
 * 人の中に持たせていた頃は、人が消えれば一緒に消えた。外へ出したので、
 * **畳み忘れると積み上がる。** 席を畳む所 (match.ts の leaveRoom) から
 * forget を呼ぶ。
 */

import { framesFor, PoseTrack } from '../src/sim/judge/history'
import type { MatchPlayer, Pose } from '../src/domain/player/player'
import { stanceOf } from '../src/domain/player/stance'
import { LAG_WINDOW_MS } from '../src/domain/rule/lag'
import { SNAPSHOT_INTERVAL } from '../src/application/protocol/types'

/**
 * 何コマ持つか。**遡れる幅と、送る間隔から出す。**
 *
 * 手で決めない (sim/judge/history.ts の framesFor に理由)。
 */
export const HISTORY_SIZE = framesFor(LAG_WINDOW_MS, SNAPSHOT_INTERVAL * 1000)

/** 空の姿。**枠を貸す形にするために要る** */
const emptyPose = (): Pose => ({
  time: 0,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  stance: stanceOf('idle'),
})

const tracks = new Map<string, PoseTrack<Pose>>()

/** その席の輪。無ければ作る */
function trackOf(id: string): PoseTrack<Pose> {
  let track = tracks.get(id)
  if (!track) {
    track = new PoseTrack<Pose>(HISTORY_SIZE, emptyPose)
    tracks.set(id, track)
  }
  return track
}

/**
 * いまの姿を 1 コマ書く。**毎 tick、人ごとに。**
 *
 * 中身をここで詰めているのは、**Pose がこの遊びの語彙**だから。輪の側は
 * time しか知らない。
 */
export function recordPose(player: MatchPlayer): void {
  trackOf(player.id).write((slot) => {
    slot.time = Date.now()
    slot.x = player.x
    slot.y = player.y
    slot.z = player.z
    slot.yaw = player.yaw
    // 見下ろしていれば倒れている相手にも刃が通る。刺した瞬間の向きが要るので履歴に持つ
    slot.pitch = player.pitch
    // ナイフが刺さる姿勢かの判定に要る。**遡って照合するので履歴に持つ** —
    // 「いまの姿勢」で見ると、刺した瞬間は立っていた相手が
    // 爆風で転んだ直後に届いた申告を弾いてしまう
    slot.stance = stanceOf(player.locomotion)
  })
}

/** その席の過去の姿。**新しいものが末尾** (verifyHit が期待する並び) */
export function posesOf(player: MatchPlayer): readonly Pose[] {
  return trackOf(player.id).frames
}

/**
 * 席を畳んだ。**持っていた過去を捨てる。**
 *
 * 残すと、同じ id で入り直した人が**前の命の位置で当たる。**
 */
export function forgetPoses(id: string): void {
  tracks.delete(id)
}
