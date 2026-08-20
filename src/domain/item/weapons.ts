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

import type { HitZone } from '../rule/damage'

export type WeaponId = 'rifle' | 'sniper' | 'pistol'

/**
 * 装備の枠。
 *
 * 湧き地点で**それぞれ 1 つずつ**選ぶ。銃を並べて順に持ち替える形にしないのは、
 * 選ぶこと自体を手にしたいため — 狙撃銃を選んだなら、詰められたときに突撃銃は無い。
 *
 * **2 本目以降は戦場で手に入れる。** 味方が外した銃を拾う、CQC で落とさせる。
 * 持てる数に上限は置かない — 上限で縛る代わりに「奪ってこないと増えない」で縛る。
 */
export type Slot = 'primary' | 'secondary' | 'support'

/** その枠に入れられる銃 */
export const CHOICES: Record<'primary' | 'secondary', WeaponId[]> = {
  primary: ['rifle', 'sniper'],
  secondary: ['pistol'],
}

/**
 * support の枠に入る物。
 *
 * 投げる物と置く物。**弾倉はここに入らない** — 撃った弾が 1 弾倉ぶん溜まるごとに
 * 勝手に増える副産物であって、枠を使って選ぶ装備ではない。
 *
 * 以前は `grenade | magazine` の二択にして「手榴弾は相手を動かす道具、弾倉は
 * 相手を騙す道具。交換になっているのが肝」と理屈まで書いていたが、**作り話だった**。
 * 本家では弾倉は選ぶものではない。
 */
export type SupportId = 'grenade' | 'claymore'

export const SUPPORTS: SupportId[] = ['grenade', 'claymore']

export interface SupportSpec {
  id: SupportId
  /**
   * 装備画面に出す名前。
   *
   * **実銃の型番ではなく「それが何か」を書く。** 銃は AK47 と書けば何か分かるが、
   * M26 / M18 は覚えている人にしか通じない。選ぶ画面で要るのは
   * 「投げる物か、置く物か」であって、正式名称ではない。
   */
  label: string
  /** 1 つの命で持てる数 */
  count: number
  hint: string
}

export const SUPPORT_SPECS: Record<SupportId, SupportSpec> = {
  grenade: {
    id: 'grenade',
    label: 'GRENADE',
    count: 3,
    hint: '爆風で削って転ばせる',
  },
  claymore: {
    id: 'claymore',
    label: 'CLAYMORE',
    // 手榴弾より少ない。置きっぱなしで効き続けるので、数を配ると
    // 「通り道を全部塞ぐ」ができてしまう
    count: 2,
    hint: '置いて離れる。前を通った敵で起爆',
  },
}

export interface WeaponSpec {
  id: WeaponId
  /** 調整パネルなどに出す名前 */
  label: string
  /** キル表示に出す名前。実銃の呼び名 */
  kill: string
  /** リロードの音 (audio.ts の名前)。銃ごとに違う */
  reloadSound: 'reload' | 'pistolReload'
  /** 撃ったときの音 (audio.ts の名前) */
  shotSound: 'rifle' | 'snipe' | 'pistol'
  /** モデルのファイル名 (拡張子なし) */
  model: WeaponId

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
  /** どの枠に入る銃か */
  slot: Slot
  /**
   * 重さ (kg)。実銃の値。
   *
   * 移動の速さはここから導く (carrySpeedScale)。銃ごとに速さの倍率を
   * 直接持たせると、銃が増えるたびに勘で数字を決めることになる。
   * **重さは実物から引ける**ので、決める余地が無いぶん揉めない。
   */
  weight: number
  /**
   * 持ち点 (DP)。湧き地点で組むときの値段。
   *
   * MGO2 は上限つきの持ち点で装備を組ませていた。強い銃ほど高く、
   * 全部は持てない。「なぜ常に最強を選ばないのか」への答えがこれ。
   *
   * 今は選べる物が少なく、値段を付けても選択にならないので全部 0。
   * 増えたときに UI を作り直さずに済むよう、欄だけ先に置いてある。
   */
  cost: number
  /**
   * 弾倉の外に持っている弾 (発)。1 つの命ぶん。
   *
   * 弾倉の数ではなく**発数の池**として持つ。半分残った弾倉を替えても
   * 残りは池へ戻るので、こまめに替えることが損にならない。
   * 「撃つ前に替えておく」を選べるようにしたい。
   */
  reserve: number
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
  reloadSound: 'reload',
  model: 'rifle',

  // 頭 1 発 / 胴 5 発 / 脚 10 発
  slot: 'primary',
  cost: 0,
  // AK47 の実重量。速さの基準になる
  weight: 3.5,
  zone: { HEAD: 100, BODY: 20, LEGS: 10 },
  /*
   * 中距離を受け持つ。近くでは速く、遠くでは狙撃銃に譲る。
   *
   * **下限 (minScale) が 0.5 だと減衰が頭に効かない。** HEAD が 100 (体力ちょうど)
   * なので、下限 0.5 は 50 = 体力の半分。**80m でも頭 2 発、0.09 秒**で殺せていた。
   * 狙撃銃が胴 2 発で 1.57 秒かかるので、**長距離で狙撃銃より速い**という逆転が
   * 起きていた。拳銃で見つけたのと同じ穴。
   *
   * **等倍の射程 (25m) は縮めない。** 穴は下限のほうで、そこを直せば逆転は消える。
   * 即死の間合いまで縮めると、エイムの脅威そのものを弱めることになる —
   * 脅威が残っているからこそ、それを迂回する手に価値がある (docs/design.md)。
   *
   *      25m まで  HEAD 100  1 発          即死。エイムの脅威が届く範囲
   *      30-45m    HEAD  91-73  2 発       主戦場
   *      55m       HEAD  55  2 発
   *      60m 以降  HEAD  30  4 発 0.27s    狙撃銃 (どこでも頭 1 発) に負ける
   */
  fullRange: 25,
  minRange: 60,
  minScale: 0.3,

  fireInterval: 0.09, // 約 660 RPM
  auto: true,
  bolt: false,
  magazine: 30,
  // 弾倉 3 つぶん。全弾を胴に当てれば 24 人だが、当てられなければ 6〜8 人で尽きる
  reserve: 90,
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
  reloadSound: 'reload',
  model: 'sniper',

  // 頭 1 発 / 胴 2 発 / 脚 4 発。
  //
  // 当てさえすれば良い武器にしない。外れ気味に当たった脚では決まらないので、
  // 狙った所に当たったときだけ 1.57 秒の間隔が報われる。
  slot: 'primary',
  cost: 0,
  // XM2010。長物のうえに照準器が乗るので重い
  weight: 5.5,
  zone: { HEAD: 130, BODY: 65, LEGS: 25 },
  // 遠くから撃つ武器なので減衰させない。近距離で強すぎる分は連射の遅さで払う
  fullRange: 200,
  minRange: 200,
  minScale: 1,

  fireInterval: 1.57, // 音のボルト操作が終わるまで
  auto: false,
  bolt: true,
  magazine: 5,
  // 弾倉 3 つぶん。胴なら 10 人ぶんだが、外すと一気に減る
  reserve: 15,
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

/**
 * 拳銃。副武器。
 *
 * 近ければ強く、離れると急に落ちる。主武器を撃ち切ったときの逃げ道であり、
 * 狙撃銃を選んだ人が詰められたときの最後の手でもある。
 *
 * 頭は 1 発。この作りでは全部の銃がそうなっている — 当てた側が勝つ、を
 * 距離や銃の格で覆さない。
 */
const PISTOL: WeaponSpec = {
  id: 'pistol',
  slot: 'secondary',
  cost: 0,
  // M9。この作りで一番軽い
  weight: 0.95,
  label: '拳銃',
  kill: 'M9',
  shotSound: 'pistol',
  reloadSound: 'pistolReload',
  model: 'pistol',
  // 胴 4 発。突撃銃 (5 発) よりわずかに速いだけで、離れると減衰で届かなくなる
  zone: { HEAD: 100, BODY: 25, LEGS: 12 },
  /*
   * 至近では危険、中距離から先は選択として間違い、になる形。
   *
   * **下限 (minScale) が効いていなかった。** 0.5 だと HEAD の下限が 50 =
   * 体力のちょうど半分になり、**どんなに遠くても頭 2 発で死ぬ**。距離減衰が
   * 頭に対して何の意味も持っていなかった。60m から 0.28 秒で殺せていた。
   *
   * 拳銃は軽くて速く動ける。そのうえ遠距離まで 2 発なら、持たない理由が無い。
   *
   *      10m まで  HEAD 100  1 発
   *      15m       HEAD  69  2 発
   *      20m       HEAD  38  3 発
   *      22m 以降  HEAD  25  4 発
   *
   * 10m は同じ部屋の中。そこで頭を抜けば 1 発、というのは残す — 詰めると
   * 決めた側への報酬であって、遠くから狙う腕前への報酬ではない。
   *
   * 22m から先は胴で 16 発かかる (弾倉は 12)。**撃ち切っても倒せない。**
   * それでよい。遠くの相手に拳銃を向けるのは間違いだ、と数字で言っている。
   */
  fullRange: 10,
  minRange: 22,
  minScale: 0.25,
  // 引き金を引くたび 1 発。押しっぱなしでは撃てない。
  // 連射の下限も遅くしてある — 速く押しても撃てる速さは変わらない
  fireInterval: 0.28,
  auto: false,
  bolt: false,
  magazine: 12,
  reserve: 48,
  reload: 2.1,
  bulletSpeed: 380,
  bulletGravity: 9.8,
  // 片手で構えるので跳ねる。連射するほど散る
  spreadPerShot: 0.28,
  spreadMax: 2.2,
  spreadPerSpeed: 0.34,
  spreadCrouchScale: 0.5,
  spreadAirborne: 2,
  spreadPerStance: 0.12,
  // 覗く倍率は持たない。肩越しのまま撃つ銃
  aimFov: 44,
  aimDistance: 1.5,
  aimShoulder: 0.46,
  aimSpeedScale: 0.72,
  scope: [],
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rifle: RIFLE,
  sniper: SNIPER,
  pistol: PISTOL,
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
/**
 * 重さの基準 (kg)。突撃銃をここに置く。
 *
 * これより軽ければ速く、重ければ遅い。基準を実在の銃に置いておくと、
 * 新しい銃を足すときに「AK より重いか軽いか」だけで速さが決まる。
 */
const REFERENCE_WEIGHT = 3.5

/** 1kg あたり何割速さが変わるか */
const WEIGHT_EFFECT = 0.06

/**
 * 提げているときの移動の速さ (倍率)。
 *
 * 構えている間の速さは別 (aimSpeedScale)。あちらは狙いの安定の話で、
 * こちらは荷物の重さの話なので、同じ数字にまとめない。
 */
export function carrySpeedScale(spec: WeaponSpec): number {
  return 1 + (REFERENCE_WEIGHT - spec.weight) * WEIGHT_EFFECT
}

export function bulletDamage(spec: WeaponSpec, zone: HitZone, distance: number): number {
  return spec.zone[zone] * falloff(spec, distance)
}

/**
 * 湧いたときに配る持ち物。
 *
 * **サーバーとクライアントが同じ式を読む。** 弾数はサーバーが写しを持って
 * いて、繋ぎ直したときにそれを返す。両側で別々に計算すると、返した値が
 * 画面と食い違う。
 *
 * 銃ごとの池として持つので、**持っていない銃の弾も席に載っている**。
 * 戦場で拾った銃をそのまま撃てるようにするための形。
 */
export interface Ammo {
  /** 銃ごとの装填済み */
  magazine: Record<WeaponId, number>
  /** 銃ごとの予備 */
  reserve: Record<WeaponId, number>
}

export function startingAmmo(): Ammo {
  const magazine = {} as Record<WeaponId, number>
  const reserve = {} as Record<WeaponId, number>
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    magazine[id] = WEAPONS[id].magazine
    reserve[id] = WEAPONS[id].reserve
  }
  return { magazine, reserve }
}

/**
 * 投げられる弾倉が 1 個増えるまでに撃つ発数。
 *
 * **その銃の弾倉 1 つぶん。** リロードの回数ではなく撃った発数で数える —
 * 回数で数えると、半分残ったまま替えても増えてしまい、篭って替え続けるのが
 * 最適になる。撃った弾で数えれば、実弾を使わないと囮は増えない。
 */
export function roundsPerDecoy(id: WeaponId): number {
  return WEAPONS[id].magazine
}

/**
 * 装填。予備から弾倉へ、入るぶんだけ移す。
 *
 * 弾倉に残っていた分は捨てない (差分だけ足す)。**その場で書き換える** —
 * サーバーもクライアントも、自分が持っている表を直に更新したいので。
 */
export function reloadInto(ammo: Ammo, id: WeaponId): void {
  const take = Math.min(WEAPONS[id].magazine - ammo.magazine[id], ammo.reserve[id])
  if (take <= 0) return
  ammo.magazine[id] += take
  ammo.reserve[id] -= take
}
