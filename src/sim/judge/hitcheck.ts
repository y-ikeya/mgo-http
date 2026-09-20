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

import type { HitZone } from '../../domain/rule/damage'
import type { SightBlocker } from '../space/vision'
import type { Pose } from '../../domain/player/player'
import { leanShift, type Stance } from '../../domain/player/stance'
import { cameraPoint } from '../space/eyepoint'
import { hasLineOfSight } from '../space/vision'

// 姿の形は domain (人の過去の姿そのものなので)。ここからも出す
export type { Pose }

/**
 * 検算に要るドメインルール。**import せずに受け取る。**
 *
 * 間合いも許容も「その構えに刃が通るか」も遊びの決めごとで、持っているのは
 * domain。ここが直接 import すると、**幾何の層が遊びの数字に縛られる** —
 * 試験のたびに本物の数字を持ち出すことになるし、ドメインルールを変えるとこちらの試験が
 * 動く。渡してもらえば、判定の形だけを見ていられる。
 *
 * 渡す物は domain がひとまとめにして持っている (rule/damage.ts の HIT_RULES)。
 */
export interface HitRules {
  /**
   * その構えの頭の高さ (m)。
   *
   * **構えそのものを渡す。** しゃがみと箱の 2 つの真偽で引いていた頃、
   * 伏せを足した途端に穴が開いた — 這っている人は crouching が立っているので
   * 0.94m の所に頭があることになり、実際に頭がある 0.4m を撃っても
   * 通らなかった。姿勢が増えるたびに増える引数ではなく、**姿勢を 1 つ**渡す。
   */
  headHeight(stance: Stance): number
  /** その構えのカメラの注視点の高さ (m)。撃った線をカメラから引き直すのに要る */
  viewHeight(stance: Stance): number
  /** その部位の大きさ (半径 m)。中心の 1 点ではなく球の中のどこかが見えていれば通す */
  zoneRadius(zone: HitZone): number
  /** その部位の縦の幅 (頭の高さに対する比率、下端と上端)。胴と脚は筒なので球では足りない */
  zoneSpan(zone: HitZone): readonly [number, number]
  /** その構えに刃が通るか */
  canBeStabbed(stance: string, aimPitch: number): boolean
  /** ナイフの間合い (m) と、そこに許す余裕 */
  meleeRange: number
  meleeSlack: number
  /** 背後と認める内積の上限 */
  backstabDot: number
  /** 距離の申告に許す誤差 (固定ぶんと、距離に比例するぶん) */
  distanceSlack: number
  distanceSlackRate: number
}

/** 申告の中身 */
export interface HitClaim {
  kind: 'bullet' | 'melee'
  zone?: HitZone
  distance?: number
  /**
   * 弾道の膨らみ (m)。**弦から見て、どれだけ上を通ったか。**
   *
   * 銃口と着弾点を結ぶ直線 (弦) に対して、実際の弾は**上へ膨らむ** —
   * 落ちるぶんを見越して上へ狙うので、途中は弦より高い所を通る。放り投げた
   * 球が手と的の直線より上を通るのと同じ。
   *
   * 渡さなければ 0 = 直線。速い銃 (AK47 で 80m を撃って 4.5cm) は渡す意味が
   * 無いが、**麻酔銃は 80m で 54cm** 膨らむので、直線で見ると低い遮蔽の
   * 向こうへ通した正当な射撃を弾く。
   *
   * 出すのは domain (judge/bullet.ts の bulletSag)。ここは受け取るだけ。
   */
  sag?: number
}

/**
 * 判定の答え。
 *
 * **通ったときは、通った瞬間の姿も返す。** 巻き戻しは 28 コマを舐めて 1 つでも
 * 成立したら確定するので、**どのコマで通ったかは呼ぶ側から見えない。** 返さない
 * と、削る量を決める側が別のコマの向きで背後刺しを判じることになる。
 *
 *     コマ A   間合いに居るが、正面
 *     コマ B   背後だが、間合いの外
 *
 * A で成立させたのに B の向きで数えてしまう、という食い違いが起きる。
 */
export type Verdict =
  | { ok: true; attacker: Pose; target: Pose }
  | { ok: false; reason: string }

/**
 * 部位の高さ。足元からの比率で持つ。
 *
 * 姿勢が変われば頭の高さが変わり、体も脚もそれに追随する。絶対値で持つと
 * しゃがんだ相手の胴を撃ったときに合わなくなる。
 */
const ZONE_RATIO: Record<HitZone, number> = { HEAD: 1, BODY: 0.72, LEGS: 0.28 }

/**
 * 遮蔽の判定を、肩の幅だけ横にずらしても試す。
 *
 * TPS の照準は肩越しのカメラから引くので、キャラの頭からは見えない角も撃てる。
 * 頭から一直線だけで判定すると、正当な射撃を弾いてしまう。
 */
const SHOULDER_OFFSET = 0.55

/**
 * 弾道を何本の線分に割って調べるか。
 *
 * 膨らみは滑らかな山なので、細かく割っても答えはほとんど変わらない。6 本だと
 * 頂点付近の誤差が膨らみの 1% ほど — 麻酔銃の 54cm に対して 5mm で、遮蔽の
 * 大きさに比べて無視できる。
 */
const ARC_STEPS = 6

/**
 * 膨らみを無視してよい高さ (m)。**これ未満なら直線で見る。**
 *
 * 速い銃はここに入る (AK47 が 80m 撃って 4.5cm)。線分を 6 本に増やす負担を、
 * 答えの変わらない銃にまで払わない。
 */
const ARC_IGNORE = 0.06

/**
 * 弾の通り道が開いているか。**弦ではなく、膨らんだ弧で見る。**
 *
 * 弧は弦の**上**を通る。弦の t の位置での高さの差は 4·sag·t·(1-t) で、
 * 真ん中で sag になる山。
 *
 * --- なぜ直線で済ませないか ---
 * ずれる向きが悪い。弧は弦より上なので、**直線では遮蔽に当たるが実際は越えて
 * いた**、が起きる。つまり直線で見ると**正当な射撃を弾く**。逆 (実際は当たって
 * いたのに通す) は起きない。
 *
 * 麻酔銃は頭 1 発で眠らせるので、遠くから狙う手が成立する。そこで弾かれると
 * 「当てたのに何も起きない」になり、しかも撃った側には理由が分からない。
 */
function isArcClear(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  world: SightBlocker,
  sag: number,
): boolean {
  if (sag < ARC_IGNORE) return world.clear(fromX, fromY, fromZ, toX, toY, toZ)

  let px = fromX
  let py = fromY
  let pz = fromZ
  for (let i = 1; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS
    const qx = fromX + (toX - fromX) * t
    const qy = fromY + (toY - fromY) * t + 4 * sag * t * (1 - t)
    const qz = fromZ + (toZ - fromZ) * t
    if (!world.clear(px, py, pz, qx, qy, qz)) return false
    px = qx
    py = qy
    pz = qz
  }
  return true
}


/** その姿勢での部位の位置 */
export function zonePoint(pose: Pose, zone: HitZone, head: number): [number, number, number] {
  return [pose.x, pose.y + head * ZONE_RATIO[zone], pose.z]
}

/** yaw から前方向 (XZ)。ローカル -Z が前 */
export function forwardOf(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)]
}

/**
 * 撃つ側の、体のどこから線を引くか。頭・胸・腹 (頭の高さに対する比率)。
 *
 * 頭 1 本だった頃、梯子の脇の板の 28cm の隙間から撃つと、頭がちょうど隙間に
 * 無い限り通らなかった。銃は胸のあたりにあるので、胸と腹からも引く。
 */
const EYE_RATIOS = [1, 0.72, 0.5] as const

/**
 * その部位が攻撃者から撃てたか。**2 つの筋のどちらかで通す。**
 *
 *   1. 体からの線。頭・胸・腹から、肩の幅ぶん左右にもずらして、1 本でも通れば
 *   2. **カメラの線が通り、かつ相手の目から攻撃者の体が見える**
 *
 * --- なぜ 2 が要るか ---
 * 客の弾は照準 (カメラ) から飛ぶ。カメラは体の後ろ上に在るので、狭い隙間を
 * 通す線は体からの線と一致しない。1 だけだと「画面では当たるのに通らない」が
 * 隙間で残る。
 *
 * --- なぜカメラの線だけでは駄目か ---
 * カメラは体より高い。塔の縁の裏にしゃがんだままカメラだけで縁を越えて
 * 撃てると、**相手からは体が見えないのに撃たれる**。だから 2 には
 * 「相手の目から自分の体が見える」を付ける — **撃てるなら見える**。
 * 隙間越しなら体の一部が隙間に在るので通り、覗きは通らない。
 *
 * **客も撃つ前にこれを呼ぶ。** 同じ問いを両側が呼ぶので、手元で通した物を
 * 審判が弾くことは無い (巻き戻しの姿のずれを除く)。通らない弾は手元でも当てない。
 */
/**
 * 傾いている分だけ横へずらした姿勢。**ずらした物は lean を消して返す** —
 * 二度通しても二度ずれない。傾いていなければそのまま。
 */
function leaned(pose: Pose): Pose {
  if (!pose.lean) return pose
  const shift = leanShift(pose.lean, pose.stance, pose.yaw)
  return { ...pose, x: pose.x + shift.x, z: pose.z + shift.z, lean: 0 }
}

export function zoneExposed(
  attacker: Pose,
  target: Pose,
  zone: HitZone,
  world: SightBlocker,
  rules: HitRules,
  sag: number,
): boolean {
  attacker = leaned(attacker)
  target = leaned(target)
  const head = rules.headHeight(attacker.stance)
  const [tx, ty, tz] = zonePoint(target, zone, rules.headHeight(target.stance))

  // 攻撃者から相手へ向かう線に直交する向き。ここへ肩の幅だけずらす
  const dx = tx - attacker.x
  const dz = tz - attacker.z
  const length = Math.hypot(dx, dz)
  const px = length > 1e-4 ? -dz / length : 1
  const pz = length > 1e-4 ? dx / length : 0

  /*
   * 狙う先は部位の中心 1 点ではなく、**筒の中の何点か**。
   *
   * 画面の当たりは骨に沿った球の列 (筒) なので、縁に掠っても当たる。中心だけ
   * 見ると、板の縁のそばで「縁は見えているのに中心は裏」の帯ができて、画面で
   * 当たった弾が通らない。中心を先に見て、通れば 1 本で返る。
   *
   * 縦は筒の下端から上端 (zoneSpan) に半径ぶん足した幅、横は中心と左右。
   * 胴は腰から首まで在るので、中心の球 1 つだと**上胸に当たった弾が板の裏**
   * になった (梯子の脇の看板の隙間で実測)。
   */
  const r = rules.zoneRadius(zone)
  const targetHead = rules.headHeight(target.stance)
  const [low, high] = rules.zoneSpan(zone)
  const bottom = target.y + targetHead * low - r
  const top = target.y + targetHead * high + r
  const targets: [number, number, number][] = [
    [tx, ty, tz],
    [tx, top, tz],
    [tx, bottom, tz],
    [tx, (top + bottom) / 2, tz],
    [tx + px * r, ty, tz + pz * r],
    [tx - px * r, ty, tz - pz * r],
    [tx + px * r, top, tz + pz * r],
    [tx - px * r, top, tz - pz * r],
  ]
  const reaches = (fx: number, fy: number, fz: number): boolean => {
    for (const [qx, qy, qz] of targets) if (isArcClear(fx, fy, fz, qx, qy, qz, world, sag)) return true
    return false
  }

  for (const ratio of EYE_RATIOS) {
    const eyeY = attacker.y + head * ratio
    for (const side of [0, 1, -1]) {
      const ox = attacker.x + px * SHOULDER_OFFSET * side
      const oz = attacker.z + pz * SHOULDER_OFFSET * side
      if (reaches(ox, eyeY, oz)) return true
    }
  }

  /*
   * 覗いているときのカメラ。**注視点そのもの** (引きも肩のずれも 0)。
   *
   * スコープを覗くと画面のカメラは体の中 (注視点) に来る。覗いているかは
   * 送られてこないので、この線も常に試す — 体の中から引く線なので、縁の裏から
   * 覗く抜け道にはならない。狙撃銃で板の隙間を通すとき、頭の線 (0.1m 下) は
   * 下の板に当たるのに画面の照準は通っている、が起きていた。
   */
  if (reaches(attacker.x, attacker.y + rules.viewHeight(attacker.stance), attacker.z)) return true

  // 2. カメラの線。**相手から体が見えるときだけ**
  const cam = cameraPoint(
    attacker.x, attacker.y, attacker.z,
    attacker.cameraYaw ?? attacker.yaw, attacker.pitch, attacker.aiming ?? true,
    rules.viewHeight(attacker.stance),
  )
  if (!reaches(cam.x, cam.y, cam.z)) return false
  const targetEyeY = target.y + rules.headHeight(target.stance)
  return hasLineOfSight(target.x, targetEyeY, target.z, attacker.x, attacker.y, attacker.z, head, world)
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
  world: SightBlocker,
  rules: HitRules,
): Verdict {
  attacker = leaned(attacker)
  target = leaned(target)
  const zone: HitZone = claim.zone ?? 'BODY'
  const [tx, ty, tz] = zonePoint(target, zone, rules.headHeight(target.stance))
  const eyeY = attacker.y + rules.headHeight(attacker.stance)
  const actual = Math.hypot(tx - attacker.x, ty - eyeY, tz - attacker.z)

  if (claim.kind === 'melee') {
    // 倒れている相手には刺さらない
    if (!rules.canBeStabbed(target.stance, attacker.pitch)) {
      return { ok: false, reason: `刺さる姿勢ではない (${target.stance})` }
    }

    // 間合い。撃つのと違って、届かない位置からは絶対に当たらない
    const flat = Math.hypot(target.x - attacker.x, target.z - attacker.z)
    if (flat > rules.meleeRange + rules.meleeSlack) {
      return { ok: false, reason: `ナイフの間合いの外 (${flat.toFixed(1)}m)` }
    }

    /*
     * **背後かどうかはここで判じない。**
     *
     * 位置と向きから分かるので、申告を受け取る理由が無い。通ったコマを返すので、
     * 削る量を決める側がそこから出す (isBackstab)。
     */
    return { ok: true, attacker, target }
  }

  // 弾。申告された距離が実際と合っているか
  const claimed = claim.distance ?? 0
  const slack = rules.distanceSlack + actual * rules.distanceSlackRate
  if (Math.abs(claimed - actual) > slack) {
    return {
      ok: false,
      reason: `距離が合わない (申告 ${claimed.toFixed(1)}m / 実際 ${actual.toFixed(1)}m)`,
    }
  }

  // その部位が見えていたか。頭を隠して脚だけ出している相手の頭は撃てない
  if (!zoneExposed(attacker, target, zone, world, rules, claim.sag ?? 0)) {
    return { ok: false, reason: `${zone} は遮蔽の裏` }
  }

  return { ok: true, attacker, target }
}

/**
 * 背後から刺したか。**通ったコマから出す。**
 *
 * 申告で受け取っていた頃があるが、位置と向きから分かるので受け取る理由が無い。
 * **通ったコマで判じる**のが肝で、別のコマの向きで数えると「間合いに居るのは
 * A のコマ、背後なのは B のコマ」という食い違いが起きる。
 */
export function isBackstab(attacker: Pose, target: Pose, backstabDot: number): boolean {
  const [vfx, vfz] = forwardOf(target.yaw)
  const [afx, afz] = forwardOf(attacker.yaw)
  return vfx * afx + vfz * afz > backstabDot
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
  attackerHistory: readonly Pose[],
  targetHistory: readonly Pose[],
  claim: HitClaim,
  world: SightBlocker,
  window: number,
  rules: HitRules,
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

    last = verifyPose(attacker, target, claim, world, rules)
    if (last.ok) return last
  }

  return last
}
