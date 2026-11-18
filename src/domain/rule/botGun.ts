import { type HitZone, ZONE_RADIUS, ZONE_SPAN } from './damage'
import type { WeaponId } from '../item/weapons'

/**
 * 撃ち返す的 (練習部屋、ステージの的の表で `fires` を付けた物)。**見えたら振り向いて撃ってくる。**
 *
 * 本人 2026-11-15「自動で動いて撃ってくる bot」の 1 段目。動かない・追わない。見つけたら
 * 反応の遅れの後に振り向いて、3 発ずつ区切って撃つ。撃ち合いの手触り (遮蔽に出る・引く・
 * 撃ち返す) を 1 人で確かめるための相手。
 *
 * 当たりは**サーバーが決める**。人の弾は画面が当てたと申告してサーバーが確かめるが、的には
 * 画面が無い。照準 (胸) からのずれを正規分布で引いて、体の筒に入ったかで部位を決める。
 * 相手が動いていれば、ずれを大きくする (動いている相手に当てにくい、を的にも持たせる)。
 */
export const BOT_GUN = {
  /** 撃ってくる距離 (m)。これより遠い相手は見ても撃たない */
  range: 40,
  /** 見える範囲 (度、正面から左右合わせて)。背後から寄れば気づかれない */
  fov: 150,
  /** 見つけてから撃ち始めるまで (秒)。見えた瞬間に撃たれると、出た所で何もできずに倒れる */
  reaction: 0.5,
  /** 振り向く速さ (rad/s) */
  turnRate: Math.PI * 1.5,
  /** 照準がこれより外れている間は撃たない (rad) */
  aimTolerance: (6 * Math.PI) / 180,
  /** 1 回に続けて撃つ数と、その後の間 (秒) */
  burst: 3,
  burstGap: 0.9,
  /** 照準のずれ (rad、正規分布の標準偏差)。止まっている相手 / 動いている相手 */
  spread: (1.4 * Math.PI) / 180,
  movingSpread: (3.2 * Math.PI) / 180,
  /** これより速く動いていれば「動いている」(m/s)。歩きの半分くらい */
  movingSpeed: 1.0,
} as const

export type BotGunSpec = { readonly [K in keyof typeof BOT_GUN]: number }

/**
 * 銃ごとの違い。**狙撃銃 (ボルト) は 1 発ずつ、遠くまで、ぶれが小さい** (本人 2026-11-15
 * 「sniper を持たせてね」)。撃つ間隔は銃の fireInterval (ボルト操作) が決める
 */
const BOLT: Partial<BotGunSpec> = {
  range: 80,
  burst: 1,
  burstGap: 0,
  // 止まって構えた狙撃手。止まった相手には 33m で 8 割当てる (0.5° では半分で、本人
  // 2026-11-15「ずっと止まってる割に集弾率悪い」)。動いている相手には 2 割に落ちる
  spread: (0.25 * Math.PI) / 180,
  movingSpread: (1.0 * Math.PI) / 180,
}
const BY_WEAPON: Partial<Record<WeaponId, Partial<BotGunSpec>>> = { sniper: BOLT, mosin: BOLT }

/** その銃を持った撃ち返す的の決まり */
export function botGunOf(weapon: WeaponId): BotGunSpec {
  return { ...BOT_GUN, ...BY_WEAPON[weapon] }
}

/** 照準を置く高さ (頭の高さに対する比)。胴の真ん中 */
export const AIM_RATIO = (ZONE_SPAN.BODY[0] + ZONE_SPAN.BODY[1]) / 2

export interface BotShot {
  /** 当たった部位。外れなら null */
  zone: HitZone | null
  /** 照準からのずれ (m)。横 (撃つ向きに対して右が正) と縦 (上が正) */
  side: number
  up: number
}

/**
 * 1 発ぶんを引く。**乱数は外から渡す** (試験で決めた値を入れられるように)。
 *
 * @param distance 相手までの距離 (m)
 * @param head 相手の頭の高さ (足元から、m)。しゃがみ・伏せで縮む
 * @param moving 相手が動いているか
 * @param random 0 以上 1 未満を返す関数。4 回引く
 * @param spec 銃ごとの決まり (botGunOf)。省けばライフル
 */
export function botShot(
  distance: number,
  head: number,
  moving: boolean,
  random: () => number,
  spec: BotGunSpec = BOT_GUN,
): BotShot {
  const sigma = moving ? spec.movingSpread : spec.spread
  const spread = Math.tan(sigma) * distance
  const side = gaussian(random) * spread
  const up = gaussian(random) * spread
  return { zone: zoneOf(head * AIM_RATIO + up, Math.abs(side), head), side, up }
}

/** 弾の通り道に立っているかもしれない体。足元の位置と頭の高さ (足元から) */
export interface BodyInPath {
  x: number
  y: number
  z: number
  head: number
}

/**
 * 弾の線 (from → to) が**最初に通る体**。無ければ null。
 *
 * 撃ち返す的の弾は、狙った相手について当たりを引くだけで、間に居る人を見ていなかった。
 * 味方の後ろに隠れると、弾が味方をすり抜けて自分に当たった (2026-11-16 本人「自分の味方は
 * 撃たれて死なないの？」)。人の弾は画面で最初に当たった体に当たるので、それに揃える。
 *
 * 体は部位ごとの太さの縦の筒 (zoneOf と同じ)。一番太い胴の筒と線が交わる区間を刻んで見る。
 *
 * @param until 線のどこまでを見るか (0〜1)。狙った相手より向こうの体は見ない
 */
export function firstBodyHit(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  bodies: readonly BodyInPath[],
  until = 1,
): { index: number; t: number; zone: HitZone } | null {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const a = dx * dx + dz * dz
  if (a < 1e-9) return null
  const reach = Math.max(ZONE_RADIUS.HEAD, ZONE_RADIUS.BODY, ZONE_RADIUS.LEGS)
  let best: { index: number; t: number; zone: HitZone } | null = null
  bodies.forEach((body, index) => {
    // 水平面で、線が体の中心から reach 以内を通る区間
    const ox = from[0] - body.x
    const oz = from[2] - body.z
    const b = 2 * (ox * dx + oz * dz)
    const c = ox * ox + oz * oz - reach * reach
    const disc = b * b - 4 * a * c
    if (disc < 0) return
    const root = Math.sqrt(disc)
    const t0 = Math.max(0, (-b - root) / (2 * a))
    const t1 = Math.min(until, (-b + root) / (2 * a))
    if (t0 > t1 || (best && t0 >= best.t)) return
    for (let k = 0; k <= SAMPLES; k++) {
      const t = t0 + ((t1 - t0) * k) / SAMPLES
      const side = Math.hypot(ox + dx * t, oz + dz * t)
      const zone = zoneOf(from[1] + dy * t - body.y, side, body.head)
      if (zone) {
        if (!best || t < best.t) best = { index, t, zone }
        return
      }
    }
  })
  return best
}
/** 体の筒の中を刻む数。筒は 40cm なので 3cm ごと */
const SAMPLES = 12

/** 照準からずれた先 (足元からの高さ・横のずれ) が、体のどこに入ったか */
export function zoneOf(height: number, side: number, head: number): HitZone | null {
  if (Math.abs(height - head) <= ZONE_RADIUS.HEAD && side <= ZONE_RADIUS.HEAD) return 'HEAD'
  for (const zone of ['BODY', 'LEGS'] as const) {
    const [low, high] = ZONE_SPAN[zone]
    if (height >= head * low && height <= head * high && side <= ZONE_RADIUS[zone]) return zone
  }
  return null
}

/** 標準正規分布 (Box–Muller) */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
