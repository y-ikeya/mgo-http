/**
 * 構え。**頭の高さと、足音の届く距離がこれで決まる。**
 *
 * 屈めば頭が 1.47m から 0.94m へ下がる。壁の陰に隠れられるかも、遠くから
 * 見えるかも、この値で変わる — **遊びを変えたくなったら触る数字**なので、
 * ここ (domain) に置く。
 *
 * --- なぜ 1 本にするか ---
 * 構えは 3 か所で解釈されている。動かす側 (presentation/scene/actor/player)、映す側
 * (presentation/scene/actor/remoteSoldier)、判定する側 (server)。同じ名前の状態を別の意味で
 * 読むと、片方だけ壊れる。
 *
 * 頭の高さがまさにその穴だった。遮蔽の判定に使う 1.47 / 0.94 はクリップから
 * 実測した値なのに、モーションを差し替えても黙って古いままになる。
 *
 * **どのモーションを流すか**は見た目の話なので、ここには無い
 * (presentation/scene/actor/motion.ts)。
 */

import type { Locomotion } from './locomotion'

/**
 * 体の構え。頭の高さと足音の届く距離がこれで決まる。
 *
 * 8 方向の区別は含めない。向きは「どちらへ歩いているか」であって構えではない。
 */
export type Stance = 'stand' | 'crouch' | 'box' | 'prone' | 'down'

/** そのモーションのときの構え */
export function stanceOf(locomotion: Locomotion): Stance {
  if (locomotion === 'death' || locomotion === 'death_front' || locomotion === 'death_back')
    return 'down'
  // 爆風で倒れている間。起き上がりの途中も含めて低い姿勢として扱う
  if (locomotion === 'sweep' || locomotion === 'stand') return 'prone'
  if (locomotion === 'sneak' || locomotion === 'sit') return 'box'
  // ダンボールが落ちた直後。棒立ちなので、頭は立ちの高さに戻っている
  if (locomotion === 'bump') return 'stand'
  // 伏せている。爆風で倒れているのと同じ高さで扱う
  if (
    locomotion === 'prone_idle' ||
    locomotion === 'crawl_f' ||
    locomotion === 'crawl_b' ||
    locomotion === 'prone_stab'
  )
    return 'prone'
  // 伏せたまま倒れた。**倒れているので down** (頭の高さは死体のもの)
  if (locomotion === 'prone_death') return 'down'
  /*
   * 伏せへの出入り。**高いほうで採る。**
   *
   * 頭は 0.84m から 0.34m まで動く (逆も同じ)。低いほうで採ると、まだ立って
   * いる体が遮蔽の裏に居ることになって「見えているのに映らない」が起きる。
   * 迷ったら送る側に倒す、はこのファイルの他の判断と同じ。
   */
  if (locomotion === 'prone_down' || locomotion === 'prone_rise') return 'crouch'
  // 横への半回転は**寝たまま**。伏せへの出入りと違って腰が上がらない
  if (locomotion === 'prone_roll_down') return 'prone'
  // クレイモアはかがんで置く。頭が下がるので、見つかりにくさもしゃがみと同じ
  if (locomotion === 'claymore_windup' || locomotion === 'claymore_place') return 'crouch'
  if (locomotion === 'crouch_idle' || locomotion.startsWith('crouch_')) return 'crouch'
  // しゃがんで傾く。名前が crouch_ で始まらないので別に書く
  if (locomotion === 'lean_crouch_left' || locomotion === 'lean_crouch_right') return 'crouch'
  return 'stand'
}

/**
 * 構えごとの頭の高さ (m)。tools/measure/crouch_size.js の実測値。
 *
 * ダンボールで静止すると 0.59m まで下がるが、遮蔽の判定では採らない。
 * 見えるはずの相手を送り忘れると「居るのに映らない」になるのに対し、
 * 見えない相手を送ってしまうのは覗き見の余地が少し残るだけで済む。
 * 迷ったら送る側に倒す。
 */
export const HEAD_HEIGHT: Record<Stance, number> = {
  stand: 1.47,
  crouch: 0.94,
  box: 0.94,
  // 伏せている間。実測で頭が 0.11m まで下がるが、起き上がりの途中は上がるので
  // その中間を採る。低く採りすぎると「見えているのに映らない」が起きる
  prone: 0.5,
  down: 0.3,
}

/**
 * 壁抜けを見る線の高さ (m)。**両端のうち高いほうの足元から。**
 *
 * 立っていれば胸 (0.9)。伏せている人は体が 0.3m しかないので、胸の高さで
 * 引くと**潜れる物の下を這っただけで「抜けた」になる**。姿勢で下げる。
 *
 * 低くするほど検査は緩む (低い段差を跨いだ線が通る) が、それは客が既に
 * 押し戻している範囲。ここが見るのは明らかに不可能な申告だけ。
 */
export const MOVE_PROBE_HEIGHT: Record<Stance, number> = {
  stand: 0.9,
  crouch: 0.6,
  box: 0.6,
  prone: 0.3,
  down: 0.3,
}

/**
 * 体を包む箱 (m)。**可視の判定はこの箱の 12 辺で見る。**
 *
 * 点 (頭・胸・足元…) で見ていた頃は、点の間隔より細い隙間から見えている体を
 * 取りこぼして、相手が急に現れたり消えたりした。箱の辺を**線分**として見れば
 * 間隔という物が無くなる (sim/space/bvh.ts の segmentVisible)。
 *
 * 箱は体より少し大きい (角が輪郭から 10〜20cm 出る) ので、**送る側に倒れる**。
 * 迷ったら送る側、はこのファイルの他の判断と同じ。
 *
 * 前後は向き (yaw) に沿う。伏せた体は前に長い — 頭は中心の 0.53m 前、足は
 * 0.9m 後ろ (prone_fire の骨の実測) — ので、そちらだけ前後が非対称。
 * 高さは頭の中心 (HEAD_HEIGHT) に頭の球ぶんを足した所。
 */
export interface BodyBox {
  /** 中心から左右へ (m) */
  halfWidth: number
  /** 中心から後ろへ / 前へ (m) */
  back: number
  front: number
  /** 足元からの高さ (m) */
  height: number
}

export const BODY_BOX: Record<Stance, BodyBox> = {
  stand: { halfWidth: 0.22, back: 0.15, front: 0.15, height: 1.6 },
  crouch: { halfWidth: 0.22, back: 0.25, front: 0.25, height: 1.07 },
  box: { halfWidth: 0.22, back: 0.25, front: 0.25, height: 1.07 },
  prone: { halfWidth: 0.22, back: 0.95, front: 0.65, height: 0.4 },
  down: { halfWidth: 0.3, back: 0.9, front: 0.9, height: 0.45 },
}

/**
 * 構えごとの、カメラの注視点の高さ (m) の幅。**足元から。**
 *
 * --- なぜ幅で持つか ---
 * 画面のカメラは「頭の実測 + 0.1m」を注視点にしている (presentation の
 * soldier.ts)。頭は姿勢だけでなく動きでも上下する — しゃがみ歩きは静止より
 * 18cm 高い。サーバーは骨を持たないので実測は追えない。
 *
 * 1 つの値に決めると、隙間越しの視線で食い違う。筏の塔の縁の板は床から 12cm
 * 浮いていて、そこを 40m 先まで通す線は数 cm の高さの差で通ったり塞がったり
 * する。サーバーが 1.53m 固定だった頃、しゃがんで隙間から覗くと、画面には
 * 通っているのにサーバーは板に遮られて相手を配らなかった。
 *
 * 幅の両端で線を引いて、**どちらかで通れば見えている**とする。迷ったら送る側に
 * 倒す (HEAD_HEIGHT と同じ判断)。
 *
 *     stand   頭 1.47 + 0.1。走りの上下で数 cm 動く
 *     crouch  静止 0.94 + 0.1 から、歩きの +0.18 まで
 *     box     しゃがみと同じ体
 *     prone   頭 0.11 + 0.1 から、起き上がりかけの 0.5 + 0.1 まで
 *     down    倒れている。頭 0.3 のあたり
 */
export const VIEW_HEIGHT: Record<Stance, readonly [number, number]> = {
  stand: [1.52, 1.62],
  crouch: [1.04, 1.24],
  box: [1.04, 1.24],
  prone: [0.21, 0.6],
  down: [0.3, 0.6],
}

/**
 * 伏せているときの速さ (立って走る速さに対する倍率)。
 *
 * 這う型の実効速度は 0.41 m/s (tools/measure/stride.js)。それをそのまま採ると
 * 10m 進むのに 24 秒かかって、移動として成立しない。**型より速く這わせて、
 * 再生速度のほうを合わせる** — 0.85 m/s で 2.07 倍。足は滑らないが、手足の
 * 運びは実際より忙しない。
 *
 * ここに置くのは**遊びが変わる数字**だから。速ければ伏せて詰められるし、
 * 遅ければ待ち伏せる姿勢になる。しゃがみと箱の倍率はまだ
 * presentation/scene/actor/player.ts に居るので、揃えるならそちらを寄せる。
 */
export const PRONE_SPEED_SCALE = 0.28


/**
 * しゃがみ / 箱の別から頭の高さ (m)。
 *
 * 遮蔽の判定も足音も、**モーションではなく操作の状態**から引きたい場面がある
 * (過去の姿を遡って照合するとき、姿勢のフラグしか残っていない)。
 *
 * 元は sim/space/vision.ts に置いてあったが、これは幾何ではなくドメインルール —
 * **屈めば隠れられる**の数字そのものなので、こちらに引き上げた。
 */
export function headHeightWhen(crouching: boolean, boxed: boolean): number {
  return HEAD_HEIGHT[boxed ? 'box' : crouching ? 'crouch' : 'stand']
}

/**
 * 傾き (覗きながら体を横へ出す)。-1 左 / 1 右 / 0 無し。
 *
 * 姿勢 (locomotion) から引く。位置と一緒に届くので、サーバーも他人の画面も
 * 同じ物を見る。
 */
export type Lean = -1 | 0 | 1

export function leanOf(locomotion: Locomotion): Lean {
  if (locomotion === 'lean_left' || locomotion === 'lean_crouch_left') return -1
  if (locomotion === 'lean_right' || locomotion === 'lean_crouch_right') return 1
  return 0
}

/**
 * 傾いたときに頭 (目) が横へ出る量 (m)。素材 (lean / lean_crouch) の頭の実測。
 * **左右で、そして立ちとしゃがみで違う** (腰は頭より 4〜6cm 内側)。
 *
 * 目も体もこれだけ横へ出る。サーバーの視線判定と当たり判定はこの分をずらす —
 * ずらさないと、画面では角の向こうが見えるのに配られず、体は元の所に残る。
 * 体の箱は幅 0.44m なので、腰との差は箱の中に収まる。
 */
export const LEAN_SHIFT: Record<'stand' | 'crouch', { left: number; right: number }> = {
  stand: { left: 0.21, right: 0.13 },
  // しゃがみは実機の animator で測った値 (しゃがみ構えの頭からの差)。素材の腰の
  // 振れ (0.2) より小さいのは、しゃがみ構えの頭が元々 0.15m 左に寄っているため
  crouch: { left: 0.13, right: 0.07 },
}

/** 傾きの横ずれ (m、右が正)。しゃがみ以外は立ちの値 */
export function leanMetres(lean: Lean, stance: Stance): number {
  const shift = LEAN_SHIFT[stance === 'crouch' ? 'crouch' : 'stand']
  return lean < 0 ? -shift.left : lean > 0 ? shift.right : 0
}

/** 傾きの横ずれをワールド座標で。yaw 0 で -Z を向くので、右は +X */
export function leanShift(
  lean: Lean,
  stance: Stance,
  yaw: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const metres = leanMetres(lean, stance)
  out.x = Math.cos(yaw) * metres
  out.z = -Math.sin(yaw) * metres
  return out
}
