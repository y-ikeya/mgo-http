/**
 * 「当てた」という申告が本当かを調べる。
 *
 * 当たり判定そのものはクライアントが持っている。骨の姿勢を持っているのが
 * あちらだけで、同じものをサーバーで動かすには骨格ごと積む必要があるため。
 *
 * その代わり、申告が**幾何学的に成立するか**をこちらで確かめる。
 * 距離が合っているか、その部位が本当に見えていたか、ナイフが届く間合いか。
 * 撃った本人しか知り得ないことは信じ、位置から分かることは信じない。
 *
 * three.js に依存しない。サーバー (bun) がこのファイルをそのまま読む。
 */

import { BACKSTAB_DOT, MELEE_RANGE, type HitZone } from './damage'
import { headHeight, isPathClear, type StageBox } from './vision'
import type { Stance } from './stance'

/** 判定に使う、ある時刻の姿 */
export interface Pose {
  /** 記録した時刻 (Date.now) */
  time: number
  x: number
  y: number
  z: number
  /** 体の向き (rad)。ローカル -Z が前 */
  yaw: number
  crouching: boolean
  boxed: boolean
  /**
   * そのときの構え。**ナイフが刺さる姿勢かどうか**に使う。
   *
   * crouching / boxed とは別に持つ。あれは「しゃがんでいるか / 箱を被っているか」
   * という操作の状態で、**吹っ飛んで倒れているかは表せない** (本人は何も
   * 押していない)。倒れているかを知っているのはモーションのほう。
   */
  stance: Stance
}

/**
 * ナイフが刺さる構え。
 *
 * **立ちと中腰だけ。** 吹っ飛んで倒れている相手には刺さらない — 立っている人が
 * 地面の的に向かって同じ型で刺す絵にならないし、爆風で転ばせてから刺す、が
 * 安すぎる。倒れている間は撃って仕留める。
 *
 * 箱は含める。中に居るのは立っているか中腰の人なので、被っただけで刃が
 * 通らなくなるのはおかしい (被れば無敵、という抜け道になる)。
 */
const STABBABLE: ReadonlySet<Stance> = new Set<Stance>(['stand', 'crouch', 'box'])

/** 申告の中身 */
export interface HitClaim {
  kind: 'bullet' | 'melee'
  zone?: HitZone
  distance?: number
  fromBehind?: boolean
}

export type Verdict = { ok: true } | { ok: false; reason: string }

/**
 * 部位の高さ。足元からの比率で持つ。
 *
 * 姿勢が変われば頭の高さが変わり、体も脚もそれに追随する。絶対値で持つと
 * しゃがんだ相手の胴を撃ったときに合わなくなる。
 */
const ZONE_RATIO: Record<HitZone, number> = { HEAD: 1, BODY: 0.72, LEGS: 0.28 }

/**
 * 距離の申告に許す誤差。
 *
 * 撃った瞬間と、サーバーが知っている位置には時間差がある。相手が走っていれば
 * その間に動く。固定値だけだと遠射で足りず、比率だけだと至近で足りない。
 */
const DISTANCE_SLACK = 3
const DISTANCE_SLACK_RATE = 0.06

/**
 * 遮蔽の判定を、肩の幅だけ横にずらしても試す。
 *
 * TPS の照準は肩越しのカメラから引くので、キャラの頭からは見えない角も撃てる。
 * 頭から一直線だけで判定すると、正当な射撃を弾いてしまう。
 */
const SHOULDER_OFFSET = 0.55

/** ナイフの間合いに許す余裕 (m)。踏み込みと時間差のぶん */
const MELEE_SLACK = 1.2

/** その姿勢での部位の位置 */
export function zonePoint(pose: Pose, zone: HitZone): [number, number, number] {
  const head = headHeight(pose.crouching, pose.boxed)
  return [pose.x, pose.y + head * ZONE_RATIO[zone], pose.z]
}

/** yaw から前方向 (XZ)。ローカル -Z が前 */
export function forwardOf(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)]
}

/**
 * その部位が攻撃者から見えていたか。
 *
 * 肩の幅だけ左右にずらした線も試して、1 本でも通れば見えていたとする。
 * 見えているものを撃てないほうが、見えないものを撃たれるより困る。
 */
function zoneExposed(
  attacker: Pose,
  target: Pose,
  zone: HitZone,
  boxes: StageBox[],
): boolean {
  if (boxes.length === 0) return true

  const eyeY = attacker.y + headHeight(attacker.crouching, attacker.boxed)
  const [tx, ty, tz] = zonePoint(target, zone)

  // 攻撃者から相手へ向かう線に直交する向き。ここへ肩の幅だけずらす
  const dx = tx - attacker.x
  const dz = tz - attacker.z
  const length = Math.hypot(dx, dz)
  const px = length > 1e-4 ? -dz / length : 1
  const pz = length > 1e-4 ? dx / length : 0

  for (const side of [0, 1, -1]) {
    const ox = attacker.x + px * SHOULDER_OFFSET * side
    const oz = attacker.z + pz * SHOULDER_OFFSET * side
    if (isPathClear(ox, eyeY, oz, tx, ty, tz, boxes)) return true
  }
  return false
}

/**
 * 1 組の姿に対して申告が成立するか。
 *
 * @param attacker 撃った側の、その時刻の姿
 * @param target 撃たれた側の、その時刻の姿
 */
function verifyPose(
  attacker: Pose,
  target: Pose,
  claim: HitClaim,
  boxes: StageBox[],
): Verdict {
  const zone: HitZone = claim.zone ?? 'BODY'
  const [tx, ty, tz] = zonePoint(target, zone)
  const eyeY = attacker.y + headHeight(attacker.crouching, attacker.boxed)
  const actual = Math.hypot(tx - attacker.x, ty - eyeY, tz - attacker.z)

  if (claim.kind === 'melee') {
    // 倒れている相手には刺さらない
    if (!STABBABLE.has(target.stance)) {
      return { ok: false, reason: `刺さる姿勢ではない (${target.stance})` }
    }

    // 間合い。撃つのと違って、届かない位置からは絶対に当たらない
    const flat = Math.hypot(target.x - attacker.x, target.z - attacker.z)
    if (flat > MELEE_RANGE + MELEE_SLACK) {
      return { ok: false, reason: `ナイフの間合いの外 (${flat.toFixed(1)}m)` }
    }

    // 背後からかどうかは、位置と向きから分かる。申告を信じる理由が無い
    if (claim.fromBehind) {
      const [vfx, vfz] = forwardOf(target.yaw)
      const [afx, afz] = forwardOf(attacker.yaw)
      if (vfx * afx + vfz * afz <= BACKSTAB_DOT) {
        return { ok: false, reason: '背後ではない' }
      }
    }
    return { ok: true }
  }

  // 弾。申告された距離が実際と合っているか
  const claimed = claim.distance ?? 0
  const slack = DISTANCE_SLACK + actual * DISTANCE_SLACK_RATE
  if (Math.abs(claimed - actual) > slack) {
    return {
      ok: false,
      reason: `距離が合わない (申告 ${claimed.toFixed(1)}m / 実際 ${actual.toFixed(1)}m)`,
    }
  }

  // その部位が見えていたか。頭を隠して脚だけ出している相手の頭は撃てない
  if (!zoneExposed(attacker, target, zone, boxes)) {
    return { ok: false, reason: `${zone} は遮蔽の裏` }
  }

  return { ok: true }
}

/**
 * 申告を、少し前まで遡って調べる。
 *
 * 撃った側の画面に映っているのは、通信の遅れと補間のぶんだけ過去の相手。
 * 「今」の位置だけで判定すると、正当に当てた弾が動いている相手に対して
 * 全部弾かれる。だから履歴を残しておいて、そのどこかで成立すれば通す。
 *
 * 遡る幅を広く取るほど、当てた側の体感は正しくなり、避けた側は理不尽になる。
 * ここは前者を優先している。撃ち合いが成立しないゲームは遊べない。
 *
 * @param attackerHistory 新しいものが末尾
 * @param targetHistory 同上
 */
export function verifyHit(
  attackerHistory: Pose[],
  targetHistory: Pose[],
  claim: HitClaim,
  boxes: StageBox[],
  window: number,
): Verdict {
  if (attackerHistory.length === 0 || targetHistory.length === 0) {
    return { ok: false, reason: '位置を知らない' }
  }

  const now = targetHistory[targetHistory.length - 1].time
  let last: Verdict = { ok: false, reason: '成立する時刻が無い' }

  for (let i = targetHistory.length - 1; i >= 0; i--) {
    const target = targetHistory[i]
    if (now - target.time > window) break

    // その時刻に最も近い、撃った側の姿を選ぶ
    let attacker = attackerHistory[attackerHistory.length - 1]
    let best = Math.abs(attacker.time - target.time)
    for (let k = attackerHistory.length - 2; k >= 0; k--) {
      const gap = Math.abs(attackerHistory[k].time - target.time)
      if (gap >= best) break
      attacker = attackerHistory[k]
      best = gap
    }

    last = verifyPose(attacker, target, claim, boxes)
    if (last.ok) return last
  }

  return last
}
