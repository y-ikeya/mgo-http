/**
 * ステージと、その回し方。
 *
 * --- なぜ「1 部屋 1 ステージ」にしないか ---
 * いまは部屋ごとに 1 枚しか無いので、`room.stage` という欄で足りる。それでも
 * **回す表 (Rotation) の形で持つ**のは、行き先が「部屋を作った人が、どの
 * ステージをどんな順で回すかを決める」だからで、そこへ向かうときに
 * 「欄を表に変える」改修を後からやると、読む側が全部変わる。
 *
 *     いま      各部屋 stages が 1 枚の fixed
 *     この先    部屋を作るときに stages と order を選ばせる
 *
 * 変わるのは ROOM_STAGES を作る場所だけで済むようにしてある。
 *
 * --- 座標をここに置く理由 ---
 * 湧き地点と的の位置は、**クライアントとサーバーの両方が要る**。湧くのは
 * クライアント、的を並べるのはサーバー。片方に置くともう片方が重複を持つので、
 * 「ステージを直したのに的だけ前の場所」が起きる (実際、的が東棟へ移ったとき
 * 試験の座標だけ取り残されて 45m 先を撃っていた)。
 *
 * 地形そのもの (箱) はここに書かない。あれは .blend から書き出されるもので、
 * 手で書く物ではない。ここに在るのは**遊びの側が決める点**だけ。
 */

import type { Team } from '../player/player'

export type StageName = 'mall' | 'training'

/**
 * 地面の上の 1 点。
 *
 * **高さは地形から一意に決まらない。** モールは 3 階建てで、同じ柱に床が 3 つ
 * ある — 「その柱のいちばん上」を採ると屋根に、「いちばん下」を採ると
 * 地上階に落ちる。どの階に立たせたいかは地形ではなく作った人が決めることなので、
 * 点の側が宣言する。
 *
 * 省けば地上 (0)。高台の上に置きたいときだけ書く。
 */
export interface Spot {
  x: number
  z: number
  /** 立つ床の高さ (m)。省略で 0 */
  y?: number
}

export interface StageSpec {
  name: StageName
  /** 画面に出す名前 */
  label: string
  /** 陣営ごとの基地。枠を描くのも湧くのもここが中心 */
  bases: Record<Team, Spot>
  /**
   * 陣営の無い部屋 (個人戦・休憩) の湧き地点。
   *
   * **散らす。** 1 か所だと湧いた瞬間に鉢合わせる。
   */
  solo: Spot[]
  /**
   * 練習の的を並べる場所。
   *
   * **距離を変えながら撃てるように置く。** 同じ距離に並べても、確かめられるのが
   * 1 つの間合いだけになる。練習部屋以外では使われない (空でよい)。
   */
  targets: Spot[]
}

/**
 * モール。**2 棟を中央の通路 1 本で繋いだ屋内。**
 *
 * 遮蔽が多く、視線が通る筋が限られる。接敵までのステルスが効く側の地形。
 *
 *     西棟   x -32.7 〜  -3.8   中庭の中心 x = -18.2
 *     通路   x -17.8 〜  18.3   幅 8m / 高さ 5m (concrete_link_*)
 *     東棟   x   4.3 〜  33.2   中庭の中心 x =  18.7
 */
const MALL: StageSpec = {
  name: 'mall',
  label: 'MALL',
  /*
   * **噴水より外側**、棟のいちばん奥。
   *
   * 中庭の真ん中は噴水が占めていて (西 x -26〜-19 / 東 x 20〜27)、そこに
   * 湧かせると噴水の上に立つ。奥へ寄せると**噴水が湧き地点の盾**になり、
   * 通路から真っ直ぐ抜かれない。
   *
   * 外周に置いていた頃 (立体駐車場) は、出た所から建物まで走る時間があった。
   * モールは 2 棟が通路で繋がった形なので、**片方ずつの中庭に湧かせて、
   * 通路を交戦地帯にする** — 抜けるか抜けないかが最初の判断になる。
   * どちらの中庭も同じ形 (東棟は西棟の複製) なので、地形の有利不利は無い。
   */
  bases: {
    blue: { x: -30.5, z: 0 },
    red: { x: 30.5, z: 0 },
  },
  // 噴水を挟んで奥と手前、それに南北の 4 点を 2 棟ぶん。
  // どれも地上階の開いている升目に当ててある
  solo: [
    { x: -30.5, z: 0 },
    { x: -16, z: 0 },
    { x: -22, z: -8 },
    { x: -22, z: 8 },
    { x: 30.5, z: 0 },
    { x: 16, z: 0 },
    { x: 22, z: -8 },
    { x: 22, z: 8 },
  ],
  /*
   * **的は置かない。** 練習は訓練場でやる。
   *
   * 東棟の中庭に 5 体並べていたが、5 体とも西の湧き地点から 45〜53m で、
   * **間合いが 8m しか変わらなかった** — 距離を確かめる場所として成立して
   * いない。遮蔽だらけの地形でもある。ここは撃ち合う地形として使う。
   */
  targets: [],
}

/**
 * 訓練場。**80m 四方の更地。**
 *
 * 遮蔽が無い。**間合いと弾道だけを確かめる場所**なので、隠れる要素を
 * 入れていない — 撃った結果が地形のせいなのか腕のせいなのかを分けたい。
 *
 * 的は青の基地から北へ向かって 10m 刻みに置く。手前から順に撃てば、
 * **どの銃がどこまで届くか**がそのまま並んで見える (P90 は 12m を過ぎると
 * 頭 2 発、30m から 4 発になる)。
 */
const TRAINING: StageSpec = {
  name: 'training',
  label: 'TRAINING',
  /*
   * **高台の上。** concrete_base_* は高さ 5.4m の塊で、その天面が基地になる。
   *
   * 見下ろせるので、湧いた瞬間に**盤面が読める**。更地で低い所に湧かせると、
   * どちらへ進むかを向きだけで決めることになる。
   *
   * 天面は 5.8 × 5.1m。散らす半径 (SPAWN_SPREAD 1.5m) より広いので、
   * 誰も縁から落ちない。
   */
  bases: {
    blue: { x: -37.1, z: -37.75, y: 5.4 },
    red: { x: 37, z: 37.75, y: 5.4 },
  },
  solo: [
    { x: -30, z: -30 },
    { x: -30, z: -22 },
    { x: -22, z: -30 },
    { x: 30, z: 30 },
    { x: 30, z: 22 },
    { x: 22, z: 30 },
  ],
  // 青の高台から北東へ。**地上に置く** — 見下ろして撃つ形になる
  targets: [
    { x: -30, z: -25 },
    { x: -23, z: -18 },
    { x: -16, z: -11 },
    { x: -9, z: -4 },
    { x: -2, z: 3 },
  ],
}

export const STAGES: Record<StageName, StageSpec> = {
  mall: MALL,
  training: TRAINING,
}

export function isStageName(name: string): name is StageName {
  return name in STAGES
}

/**
 * 回す順の決め方。
 *
 *     fixed   先頭 1 枚だけ。ずっと同じ
 *     cycle   並べた順に 1 枚ずつ
 *     random  毎回引き直す。**同じ物が続くのは許す** — 避けると
 *             「次はこれではない」が読めて、それ自体が情報になる
 */
export type RotationOrder = 'fixed' | 'cycle' | 'random'

export interface Rotation {
  stages: StageName[]
  order: RotationOrder
}

/** 1 枚だけを回す。いまの部屋は全部これ */
export function only(stage: StageName): Rotation {
  return { stages: [stage], order: 'fixed' }
}

/**
 * 次の試合のステージ。
 *
 * @param previous 前の試合のステージ。初回は null
 * @param roll     0..1 の一様乱数。**時計も乱数もここでは引かない** —
 *                 引くと同じ引数で答えが変わり、試験が書けなくなる
 */
export function nextStage(rotation: Rotation, previous: StageName | null, roll: number): StageName {
  const list = rotation.stages.length > 0 ? rotation.stages : (['mall'] as StageName[])
  if (rotation.order === 'fixed') return list[0]
  if (rotation.order === 'random') {
    return list[Math.min(list.length - 1, Math.floor(roll * list.length))]
  }
  // cycle。前が表に無ければ (表を組み替えた直後など) 先頭から
  const at = previous === null ? -1 : list.indexOf(previous)
  return list[(at + 1) % list.length]
}
