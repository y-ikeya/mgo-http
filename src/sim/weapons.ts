/**
 * 武器の性能表。
 *
 * --- なぜ 1 枚にまとめるか ---
 * これまで武器の値は 4 つのファイルに散らばっていた。
 *
 *   Game.ts        発射間隔・弾数・リロード・散布
 *   ballistics.ts  弾速・落下
 *   damage.ts      威力・距離減衰
 *   camera.ts      構えたときの画角と寄り
 *
 * 1 種類しか無いうちは動くが、2 本目を足した瞬間に**同じ if を 4 か所に書く**
 * ことになる。姿勢や移動でやったのと同じで、先に表へ寄せる。
 *
 * three.js に依存しない。サーバーがそのまま読む — 連射の速さも威力も、
 * 「その人が持っている武器」で検証しないと意味が無い。
 *
 * 見た目 (握りの位置・銃口の座標) はここに入れない。あれは three の座標なので
 * src/game/weapon.ts が持つ。**遊びに効く数字だけ**をここに置く。
 */

import type { HitZone } from './damage'

export type WeaponId = 'rifle' | 'sniper'

export interface WeaponSpec {
  id: WeaponId
  /** 調整パネルなどに出す名前 */
  label: string
  /** キル表示に出す名前。実銃の呼び名 */
  kill: string
  /** 撃ったときの音 (audio.ts の名前) */
  shotSound: 'rifle' | 'snipe'
  /** モデルのファイル名 (拡張子なし) */
  model: 'rifle' | 'sniper'

  // --- 威力 ---
  /**
   * 部位ごとのダメージ。**体力 100 に対する点数**をそのまま書く。
   *
   * 倍率ではなく点数で持つ。「脚は 4 発」と決めたときに書く値が
   * `100 / 4 = 25` で済み、胴の何倍かを逆算しなくてよい。
   * 倍率で持っていたときは、その換算を毎回間違えた。
   */
  zone: Record<HitZone, number>
  /** ここまでは減衰しない (m) */
  fullRange: number
  /** ここから先は minScale で頭打ち (m) */
  minRange: number
  minScale: number

  // --- 撃つ ---
  /** 発射間隔 (秒) */
  fireInterval: number
  /** 押しっぱなしで撃ち続けるか */
  auto: boolean
  /**
   * 1 発ごとにボルトを操作するか。
   *
   * 動作の尺がそのまま次の 1 発までの間隔になる。音・動き・撃てない時間が
   * 3 つとも同じ長さで揃うので、外したときの隙が見た目に出る。
   */
  bolt: boolean
  magazine: number
  /** リロードにかかる時間 (秒)。クリップの尺が取れればそちらを使う */
  reload: number

  // --- 弾道 ---
  bulletSpeed: number
  bulletGravity: number

  // --- 散布 (度) ---
  /** 1 発ごとに広がる量 */
  spreadPerShot: number
  /** 連射で広がる上限 */
  spreadMax: number
  /** 移動の速さ 1 m/s あたり */
  spreadPerSpeed: number
  /** しゃがみの倍率。止まって狙う価値をここで作る */
  spreadCrouchScale: number
  /** 空中 */
  spreadAirborne: number
  /** 姿勢を変えている間 (1/秒 あたり) */
  spreadPerStance: number

  // --- 構え ---
  /** 構えたときの画角 (度)。小さいほど寄る */
  aimFov: number
  /** カメラの引き (m) */
  aimDistance: number
  /** 肩越しの横ずれ (m) */
  aimShoulder: number
  /** 構えている間の移動速度の倍率 */
  aimSpeedScale: number
  /**
   * 照準器の段。空なら覗けない。
   *
   * 構えただけでは肩越しのまま (aimFov)。ホイールで段を上げると初めて
   * 覗いた画になる。狙撃銃でも近距離では肩越しで撃ちたいので、
   * 「構える」と「覗く」を別の操作にしてある。
   *
   * 各段は { 画角 (度), 表示する倍率 }。
   */
  scope: { fov: number; label: string }[]
}

/**
 * 突撃銃。基準になる 1 挺。
 *
 * ここの値はこれまで散らばっていたものをそのまま移しただけで、
 * 挙動は変えていない。
 */
const RIFLE: WeaponSpec = {
  id: 'rifle',
  label: 'ライフル',
  kill: 'AK47',
  shotSound: 'rifle',
  model: 'rifle',

  // 頭 1 発 / 胴 5 発 / 脚 10 発
  zone: { HEAD: 100, BODY: 20, LEGS: 10 },
  fullRange: 25,
  minRange: 70,
  minScale: 0.5,

  fireInterval: 0.09, // 約 660 RPM
  auto: true,
  bolt: false,
  magazine: 30,
  reload: 2.5,

  bulletSpeed: 420,
  bulletGravity: 9.8,

  spreadPerShot: 0.13,
  spreadMax: 1.6,
  spreadPerSpeed: 0.28,
  spreadCrouchScale: 0.45,
  spreadAirborne: 1.8,
  spreadPerStance: 0.09,

  aimFov: 38,
  aimDistance: 1.35,
  aimShoulder: 0.42,
  aimSpeedScale: 0.55,
  scope: [],
}

/**
 * 狙撃銃 (Remington XM2010)。
 *
 * 突撃銃の裏返しになるよう組んである。**止まっていれば当たり、動けば当たらない。**
 * 「動かない方が有利」を武器の側から支える一挺で、近距離では連射に負ける。
 *
 * 発射間隔は音の長さで決まっている。音の後半にボルト操作が入っていて
 * (1.10 秒あたりで起こして引き、1.40 秒で閉じる)、それが終わるまで撃てない。
 * **外した代償が大きい**ので、1 発目をどこから撃つかの選択が重くなる。
 */
const SNIPER: WeaponSpec = {
  id: 'sniper',
  label: 'スナイパー',
  kill: 'XM2010',
  shotSound: 'snipe',
  model: 'sniper',

  // 頭 1 発 / 胴 2 発 / 脚 4 発。
  //
  // 当てさえすれば良い武器にしない。外れ気味に当たった脚では決まらないので、
  // 狙った所に当たったときだけ 1.57 秒の間隔が報われる。
  zone: { HEAD: 130, BODY: 65, LEGS: 25 },
  // 遠くから撃つ武器なので減衰させない。近距離で強すぎる分は連射の遅さで払う
  fullRange: 200,
  minRange: 200,
  minScale: 1,

  fireInterval: 1.57, // 音のボルト操作が終わるまで
  auto: false,
  bolt: true,
  magazine: 5,
  reload: 3.2,

  bulletSpeed: 820,
  bulletGravity: 9.8,

  // 連射で広がる分は大きいが、そもそも連射できない
  spreadPerShot: 0.9,
  spreadMax: 3.5,
  // 動くと当たらない。突撃銃の 3 倍以上散る
  spreadPerSpeed: 1.1,
  // しゃがんで止まればほぼ 0 に収束する
  spreadCrouchScale: 0.2,
  spreadAirborne: 4,
  spreadPerStance: 0.35,

  // 構えただけなら突撃銃と同じ肩越し。覗くのは別の操作
  aimFov: 38,
  aimDistance: 1.35,
  aimShoulder: 0.42,
  aimSpeedScale: 0.35,
  // 腰だめの画角 60 度を基準にした倍率。tan(30°) / tan(fov/2) で出る
  scope: [
    { fov: 16, label: '4x' },
    { fov: 8, label: '8x' },
    { fov: 4, label: '16x' },
  ],
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rifle: RIFLE,
  sniper: SNIPER,
}

export const DEFAULT_WEAPON: WeaponId = 'rifle'

export function weaponOf(id: WeaponId | undefined): WeaponSpec {
  return WEAPONS[id ?? DEFAULT_WEAPON] ?? RIFLE
}

/**
 * 距離による減衰 (0..1)。
 *
 * 近距離では減らず、遠くなるほど落ちて、ある距離から先は一定。
 * 「遠いほど当たらない」は散布のほうで作るので、こちらは緩やかでよい。
 */
export function falloff(spec: WeaponSpec, distance: number): number {
  if (distance <= spec.fullRange) return 1
  if (distance >= spec.minRange) return spec.minScale
  const t = (distance - spec.fullRange) / (spec.minRange - spec.fullRange)
  return 1 - t * (1 - spec.minScale)
}

/** その武器で、その部位に、その距離で当てたときのダメージ */
export function bulletDamage(spec: WeaponSpec, zone: HitZone, distance: number): number {
  return spec.zone[zone] * falloff(spec, distance)
}
