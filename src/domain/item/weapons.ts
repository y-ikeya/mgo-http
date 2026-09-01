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
 * src/presentation/scene/arms/weapon.ts が持つ。**遊びに効く数字だけ**をここに置く。
 */

import { MAX_HEALTH, type HitZone } from '../rule/damage'

export type WeaponId = 'smg' | 'rifle' | 'sniper' | 'm9' | 'm1911' | 'shotgun'

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
  primary: ['smg', 'rifle', 'sniper', 'shotgun'],
  secondary: ['m9', 'm1911'],
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
  reloadSound: 'reload' | 'pistolReload' | 'm1911Reload' | 'smgReload'
  /** 撃ったときの音 (audio.ts の名前) */
  shotSound: 'rifle' | 'snipe' | 'm9' | 'm1911' | 'smg' | 'shotgun'
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
  /**
   * 麻酔銃か。**当てても体力は削らない。**
   *
   * zone の数字を「体力」ではなく「スタミナ」を削る量として読ませる
   * (domain/player/stamina.ts)。距離の減衰は同じ式を通るので、**遠くの麻酔は
   * 効きが薄い** — ここだけ距離を無視すると、当たりさえすればよい銃になって
   * 狙撃と食い合う。
   */
  tranquilizer?: boolean
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
   * 1 発で飛ぶ粒の数。**散弾だけ 1 より大きい。**
   *
   * 粒ごとに別々に当たり判定を取って、当たった数だけ削る。1 発の威力を
   * 上げるのとは違う — **近いほど多く当たり、離れるほど当たらなくなる**ので、
   * 距離の減衰を書かなくても間合いの武器になる。
   */
  pellets?: number
  /**
   * 粒が散る角度 (度、半角)。**銃そのものの散らばり。**
   *
   * 狙いの散布 (spread.ts の degrees) とは別に足す。あちらは動くと開く
   * 「腕の乱れ」で、こちらは止まって構えても消えない銃の性質。
   */
  pelletSpread?: number
  /** ボルトを操作する音。無ければ鳴らさない (狙撃銃は発砲音に入っている) */
  boltSound?: 'shotgunCock'
  /**
   * ボルトを操作する型の再生速度。**1 より小さいほど遅い。**
   *
   * 次の 1 発までの間隔は型の尺そのものなので、ここを下げると**撃てない時間が
   * 伸びる**。動きと待ち時間が必ず一致する形は保ったまま、銃ごとに重さを
   * 変えられる。
   *
   * **その銃を極めれば速くなる** (masteryReloadScale で割る)。弾倉の入れ替えと
   * 同じで「手が速い」という一つの効き目にしてある。
   */
  boltScale?: number
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

  /**
   * 銃声が届く距離 (m)。**撃てば居場所が漏れる、その漏れ方。**
   *
   * 遠くまで届くほど、撃ったこと自体が相手への情報になる。狙撃銃が一番広いのは
   * 「遠くから安全に撃てる代わりに、音は遠くまで行く」という交換のため。
   */
  noiseRange: number

  // --- 散布 (度) ---
  /**
   * 手ブレの振れ幅 (度)。**照準そのものが泳ぐ量。**
   *
   * --- 散らすのではなく、動かす ---
   * 散布 (spreadPerShot など) は**撃った弾を円錐の中へばらけさせる**もので、
   * 狙点は動かない。撃った結果でしか分からないので、撃つ前の判断に使えない。
   *
   * こちらは**狙点が滑らかに泳ぐ**。照準が動いて見えるので、
   * **落ち着いた瞬間に撃つ**という手が生まれる — 運ではなく待ちになる。
   * 弾は泳いだ先へ真っ直ぐ飛ぶので、見えているものと当たる場所が一致する。
   *
   * --- 長らく 0 だった ---
   * 止まれば散布界がちょうど 0 で、**1 発目は必ず狙った一点へ飛んだ**。
   * そのせいで 2 つ死んでいた:
   *
   *   - **距離が効かない。** 止まってさえいれば 10m も 100m も同じ確度
   *   - **MASTERY が効かない。** 倍率は合計に掛かるので、0 に何を掛けても 0
   *
   * --- どこで折り合ったか ---
   * **見える大きさと当たる精度が、同じ 1 つの角度に縛られている。** 肩越しの
   * 画角 (45 度) では 1 度がおよそ 25 画素なので、画面で泳いで見えるだけの
   * 振れ幅を採ると、そのぶん確実に当たらなくなる。
   *
   *     0.14 度   画面 ±3px    25m で  6cm   ほぼ見えない
   *     0.30 度   画面 ±7px    25m で 13cm   ← ここ
   *     0.50 度   画面 ±11px   25m で 22cm   頭が入らない
   *
   * --- 主武器は 3 挺とも同じ ---
   * 銃ごとに変えない。**変える理由が無い** — 銃の性格は威力の帯・連射・
   * 弾倉・重さで既に分かれていて、そこへ「泳ぎ方も違う」を足すと、
   * どれが効いているのか撃っている側から分からなくなる。
   *
   * 拳銃 (secondary) だけ小さい。**主武器のほうが大きく泳ぐ**ので、
   * 遠くを狙うなら主武器を極める (MASTERY) 動機が要る形になる。
   *
   * しゃがみで締まる (spreadCrouchScale)。狙撃銃はここが最も強く効くので、
   * **立って撃てば胴、しゃがめば頭**という差が距離で出る。
   */
  sway: number
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
 * サブマシンガン (FN P90)。**近距離を受け持つ。**
 *
 * --- 何で勝ち、何で負けるか ---
 * 装弾 50 発・900 発/分・反動が小さい。近づいてしまえば当て続けられる。
 * 軽い (2.6kg) ので足も速い。**代わりに頭 1 発の間合いが 12m しかない** —
 * 突撃銃の半分以下で、20m 離れれば頭 2 発、30m から先は 4 発になる。
 *
 * **胴で削り合えばほぼ互角**にしてある。SMG は 7 発 0.39 秒、突撃銃は 5 発
 * 0.36 秒で、**近くでも突撃銃がわずかに速い**。勝っているのは弾倉の大きさと
 * 足の速さで、殴り合いの強さではない。ここを上げると「近くても遠くても SMG」
 * になり、選ぶ意味が消える。
 *
 * 棲み分けの表は src/domain/README.md。
 */
const SMG: WeaponSpec = {
  id: 'smg',
  label: 'サブマシンガン',
  kill: 'P90',
  shotSound: 'smg',
  reloadSound: 'smgReload',
  model: 'smg',

  // 頭 1 発 / 胴 7 発 (0.39 秒) / 脚 15 発
  slot: 'primary',
  cost: 0,
  // P90 の実重量 (空)。3.5kg を等倍として 105%
  weight: 2.6,
  zone: { HEAD: 100, BODY: 15, LEGS: 7 },
  /*
   *      12m まで  HEAD 100  1 発       同じ部屋・角の向こう
   *      20m       HEAD  67  2 発
   *      25m       HEAD  46  3 発
   *      30m 以降  HEAD  25  4 発       胴なら 7 発 → 27 発。弾倉は足りるが遅い
   *
   * **突撃銃と重ならない**ように 12m で切ってある。25m まで頭 1 発の銃が
   * 2 挺あると、軽くて弾倉の大きいほうだけが選ばれる。
   */
  fullRange: 12,
  minRange: 30,
  minScale: 0.25,

  fireInterval: 0.065, // 約 900 RPM。実銃と同じ
  auto: true,
  bolt: false,
  magazine: 50,
  // 弾倉 2 つぶん。1 発が軽いので、撃ち切るのは突撃銃より速い
  reserve: 100,
  /*
   * **長い。突撃銃 (2.5s) より遅い。**
   *
   * 弾倉が機関部の上に寝ているので、差し込んで倒して留める手数がある。
   * 遊びの側から見ても、50 発の弾倉に釣り合う代償がここにしか無い —
   * 撃ち続けられる銃が素早く替えられると、弾切れが弱点でなくなる。
   */
  reload: 3.0,

  bulletSpeed: 715, // 5.7x28mm の初速
  bulletGravity: 9.8,
  noiseRange: 110,

  // **反動が小さい。** 押しっぱなしでも散らばりにくいのがこの銃の取り柄
  sway: 0.30,
  spreadPerShot: 0.08,
  spreadMax: 1.1,
  spreadPerSpeed: 0.2,
  spreadCrouchScale: 0.5,
  spreadAirborne: 1.5,
  spreadPerStance: 0.07,

  // 突撃銃より寄らない。近距離で振り回す銃なので、視野を狭めない
  aimFov: 42,
  aimDistance: 1.3,
  aimShoulder: 0.4,
  // 軽いぶん構えたままでも動ける
  aimSpeedScale: 0.62,
  scope: [],
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

  bulletSpeed: 715, // 7.62x39mm の初速
  bulletGravity: 9.8,
  noiseRange: 130,

  sway: 0.30,
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

  bulletSpeed: 880, // .300 Win Mag の初速
  bulletGravity: 9.8,
  noiseRange: 170,

  // 連射で広がる分は大きいが、そもそも連射できない
  sway: 0.30,
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
  id: 'm9',
  // **麻酔銃。** 当てても体力は減らず、スタミナが減る
  tranquilizer: true,
  slot: 'secondary',
  cost: 0,
  // M9。この作りで一番軽い
  weight: 0.95,
  label: '麻酔銃',
  kill: 'M9',
  shotSound: 'm9',
  reloadSound: 'pistolReload',
  model: 'm9',
  // 胴 4 発。突撃銃 (5 発) よりわずかに速いだけで、離れると減衰で届かなくなる
  zone: { HEAD: 100, BODY: 25, LEGS: 12.5 },
  /*
   * **距離で弱まらない。** 麻酔は当たれば効く。
   *
   * 薬が入るかどうかは針が刺さったかどうかで、飛んできた速さとは関係が無い。
   * 遠くの相手にじわじわ効く、という中間が無いので、減衰させる場所が無い。
   *
   * 代わりに**当てるのが難しい**。弾が遅く (120 m/s、他の銃の 1/3)、そのぶん
   * 落ちる。
   *
   *      20m   0.17 秒で 14cm 落ちる
   *      40m   0.33 秒で 54cm  — 頭を狙うなら肩ひとつ上
   *      60m   0.50 秒で 1.2m  — 落ちる量が体の高さを超える
   *
   * 遠いほど当たらない、という形は同じだが、**理由が「弱くなる」ではなく
   * 「当てられない」**になっている。当てさえすれば 4 発で眠る。
   */
  fullRange: 200,
  minRange: 200,
  minScale: 1,
  fireInterval: 0.28,
  auto: false,
  /*
   * **1 発ごとに遊底を引く。**
   *
   * 引き金だけで 0.28 秒ごとに撃てた頃は、**当てる腕前が要らない銃**だった。
   * 胴 4 発が 1.1 秒で揃うので、詰められた側は撃ち返す間もなく眠る。
   *
   * 型の尺がそのまま次の 1 発までの間隔になるので、動き・音・撃てない時間が
   * 必ず揃う。4 発を当て切るのに 2.4 秒かかる — その間ずっと相手を捉えて
   * いなければならない、という形にした。
   *
   * **音は鳴らさない。** 消音された銃なので、遊底の音だけが響くのはおかしい。
   * 専用の音が来たら boltSound に足す。
   */
  bolt: true,
  boltScale: 1.6,
  magazine: 12,
  reserve: 48,
  reload: 2.1,
  // **遅い。** 他の銃の 1/3 で、そのぶん落ちる
  bulletSpeed: 120,
  bulletGravity: 9.8,
  /*
   * **消音されている。** 銃声が届く距離 (m)。
   *
   * 麻酔銃は音が小さい。一番うるさい狙撃銃 (170m) の 1/5 で、**同じ部屋の
   * 中にしか届かない**。
   *
   * これが麻酔銃を選ぶ理由の半分になっている — 殺せないぶん、**撃っても
   * 気づかれない**。1 人を眠らせて、周りに知られないまま次へ行ける。
   *
   * **走る足音 (rule/noise.ts の STEP_RANGE = 20m) と同じ。** 撃っても、
   * そこを走り抜けるのと同じだけしか漏れない、という所に置いてある。
   * 85m のままだと撃った時点で部屋の半分に知らせることになって、静かに
   * 始末する道具にならなかった。
   */
  noiseRange: 20,
  // 片手で構えるので跳ねる。連射するほど散る
  sway: 0.20,
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

/**
 * 散弾銃。**間合いの武器。**
 *
 * 1 発が 8 粒に分かれて、粒ごとに当たり判定を取る。近ければ全部当たって
 * 一撃で倒れ、離れると散って数粒しか掠らない。**距離の減衰を書かなくても
 * 間合いが決まる** — 当たる粒の数がそのまま威力になる。
 *
 * --- 威力は当たった距離で決まる ---
 * **粒の数では数えない。** 1 発のうち 1 粒でも当たれば、その距離の帯の量だけ
 * 削る (SHOTGUN_BANDS)。粒は散らばりと当たり判定のためにあって、8 粒当たった
 * から 8 倍、にはしない — 近さがそのまま威力、を段で言い切る形にしてある。
 *
 *     〜8m    50 削って**吹き飛ばす**。2 発で倒れる
 *     〜16m   25 削って**怯ませる**。撃ち合いには入れるが押し切れない
 *     〜24m   12.5 だけ。怯みもしないので、牽制にもならない
 *     24m〜   **当たらない**
 *
 * --- なぜ 1 発が重いのか ---
 * ポンプ式なので次の 1 発まで 0.9 秒かかる。**外したら詰められる**ので、
 * 曲がり角を取る武器であって、開けた場所へ持ち出す物ではない。
 * 突撃銃と真っ向から撃ち合うと、間合いへ入る前に削り切られる。
 */
/**
 * M1911。**殺傷の副武器。**
 *
 * M9 が麻酔になったので、拳銃で人を倒したいならこちら。撃ち切っても倒せない
 * 距離があるのは M9 と同じ考え方で、**副武器は主武器の代わりにならない**。
 *
 * M9 との違いは「重い代わりに効く」。7 発で 12 発より少なく、撃つ間隔も遅い。
 * そのぶん胴 3 発で、M9 の 4 発より 1 発早い。**外せる回数が減る**、という形の
 * 交換になっている — 弾が少ないほど 1 発の重みが上がる。
 *
 *      12m まで  HEAD 100  1 発
 *      18m       HEAD  66  2 発
 *      24m 以降  HEAD  30  4 発
 */
const M1911: WeaponSpec = {
  id: 'm1911',
  slot: 'secondary',
  cost: 0,
  // M9 より重い。持つと走りが少しだけ落ちる
  weight: 1.05,
  label: '拳銃',
  kill: 'M1911',
  shotSound: 'm1911',
  reloadSound: 'm1911Reload',
  model: 'm1911',
  // 胴 3 発。M9 (4 発) より 1 発早い
  zone: { HEAD: 100, BODY: 34, LEGS: 16 },
  fullRange: 12,
  minRange: 24,
  minScale: 0.3,
  // M9 (0.28) より遅い。押し切る速さで負ける
  fireInterval: 0.34,
  auto: false,
  bolt: false,
  // **7 発。** M9 の 12 発に対して、外せる回数がはっきり少ない
  magazine: 7,
  reserve: 35,
  reload: 2.3,
  bulletSpeed: 390,
  bulletGravity: 9.8,
  noiseRange: 95,
  // 反動は M9 より大きい。連射するほど散る
  sway: 0.22,
  spreadPerShot: 0.34,
  spreadMax: 2.4,
  spreadPerSpeed: 0.34,
  spreadCrouchScale: 0.5,
  spreadAirborne: 2,
  spreadPerStance: 0.12,
  aimFov: 44,
  aimDistance: 1.5,
  aimShoulder: 0.46,
  aimSpeedScale: 0.7,
  scope: [],
}

const SHOTGUN: WeaponSpec = {
  id: 'shotgun',
  label: 'ショットガン',
  kill: 'M870',
  shotSound: 'shotgun',
  boltSound: 'shotgunCock',
  reloadSound: 'reload',
  model: 'shotgun',

  slot: 'primary',
  cost: 0,
  // M870。木製ストックの実銃の値
  weight: 3.6,
  /*
   * 部位では変えない。**距離だけで決まる** (SHOTGUN_BANDS)。
   *
   * 撒いた粒のどれが頭に入ったかで倍率が変わると、近距離では常に頭に
   * 当たって即死、遠距離では当たっても意味が無い、という両極になる。
   * 部位を捨てて距離で言い切ると、**間合いを詰めるかどうか**だけが問いになる。
   *
   * この表は他の銃と同じ形を保つためだけに置いてある (bulletDamage は
   * 散弾を通らない)。
   */
  zone: { HEAD: 50, BODY: 50, LEGS: 50 },
  pellets: 8,
  // 粒の散り。**止まって構えても消えない** — 銃そのものの性質
  pelletSpread: 3.2,
  // 距離の効きは帯が持つ (SHOTGUN_BANDS)。ここは通らない
  fullRange: 200,
  minRange: 200,
  minScale: 1,

  /*
   * ポンプ式。**次の 1 発までの間隔は型の尺が決める** (boltScale)。
   *
   * ここに書いてあるのはサーバーが弾く下限。極めた人の間隔 (1.32 秒) より
   * 短くしておかないと、速く撃てるようになった本人の申告が弾かれる。
   */
  fireInterval: 1.2,
  auto: false,
  bolt: true,
  /*
   * ポンプを遅くしてある。素で 1.69 秒、極めれば 1.32 秒。
   *
   * **1 発の重さがこの銃の性格**なので、撃ってから次までの間が長いほど
   * 「外したら詰められる」が効く。同時に SG MASTERY の値打ちにもなる —
   * 極めれば 0.37 秒早く次が撃てる。
   */
  boltScale: 0.75,
  magazine: 6,
  // 弾倉 4 つぶん。1 発が重いので数は少なくてよい
  reserve: 24,
  // 1 発ずつ装填する銃なので長い。極めれば 3.4 秒
  reload: 4.4,

  // 粒は軽くてすぐ落ちる。遠くまで届かないことが弾道にも出る
  bulletSpeed: 380,
  bulletGravity: 9.8,
  noiseRange: 140,

  // 構えても腕は揺れる。突撃銃と同じ
  sway: 0.30,
  // 連射できないので、開く分は 1 発ぶんだけ大きく採る
  spreadPerShot: 0.5,
  spreadMax: 2.4,
  spreadPerSpeed: 0.32,
  spreadCrouchScale: 0.45,
  spreadAirborne: 2.2,
  spreadPerStance: 0.12,

  // 覗く物ではない。肩越しのまま間合いへ入る
  aimFov: 42,
  aimDistance: 1.35,
  aimShoulder: 0.42,
  aimSpeedScale: 0.5,
  // 覗く段は持たない。間合いへ入る武器なので、遠くを見る道具が要らない
  scope: [],
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  smg: SMG,
  shotgun: SHOTGUN,
  rifle: RIFLE,
  sniper: SNIPER,
  m9: PISTOL,
  m1911: M1911,
}

export const DEFAULT_WEAPON: WeaponId = 'rifle'

/**
 * 散弾の威力の帯。**近い順に並べる。**
 *
 * 1 発のうち 1 粒でも当たれば、その距離の帯の量だけ削る。粒を数えないのは、
 * 数えると「たまたま何粒入ったか」で結果が変わるから — 近さで言い切るほうが、
 * **間合いを詰めるかどうか**という一つの問いになる。
 *
 * 一番外 (24m) より遠ければ当たらない。撒いた粒が偶然届いて削れる、を無くす。
 *
 * 刻みは 8m。10m 刻みにしていた頃は**中距離でも押せて**、突撃銃と正面から
 * 撃ち合えてしまった。間合いの武器である、を保つ幅として詰めてある。
 */
export interface ShotgunBand {
  /** ここまでの距離 (m) */
  within: number
  /** 削る量 */
  damage: number
  /** 吹き飛ばすか */
  knock: boolean
  /** 怯ませるか */
  flinch: boolean
}

export const SHOTGUN_BANDS: readonly ShotgunBand[] = [
  { within: 8, damage: MAX_HEALTH / 2, knock: true, flinch: false },
  { within: 16, damage: MAX_HEALTH / 4, knock: false, flinch: true },
  { within: 24, damage: MAX_HEALTH / 8, knock: false, flinch: false },
]

/** その距離の帯。**外れていれば当たらない** */
export function shotgunBand(distance: number): ShotgunBand | null {
  return SHOTGUN_BANDS.find((band) => distance <= band.within) ?? null
}

/** 1 発で飛ぶ粒の数。**散弾以外は 1** */
export function pelletsOf(spec: WeaponSpec): number {
  return spec.pellets ?? 1
}

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
 * **サーバーとクライアントが同じ式を読む。** 弾数はサーバーがレプリカを持って
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


/**
 * その持ち物は麻酔銃か。**銃でない物は false。**
 *
 * 見せる側 (HUD / 装備画面) が色を分けるのに使う。`WEAPONS[id].tranquilizer`
 * を直に引くと、ナイフや手榴弾を渡されたときに落ちる — 手にある物は銃とは
 * 限らないので、**持ち物の id で聞ける口**をここに置く。
 */
export function isTranquilizer(id: string): boolean {
  const spec = (WEAPONS as Record<string, WeaponSpec | undefined>)[id]
  return spec?.tranquilizer === true
}
