/**
 * ステージの形。**サーバーも同じ箱を読む。**
 *
 * 遮蔽の判定も、物がぶつかる面も、これが無いと決められない。glb は解析せず、
 * 書き出しのときに一緒に書かれる json を読む — 片方だけ古い形を見る、が
 * 起きない。
 *
 * --- 1 枚ではなくなった ---
 * 長らく stage.json 1 枚を起動時に読んで、module の定数として全員が見ていた。
 * ステージが増えた時点でそれは通らない — **部屋ごとに違う地形**を見るし、
 * 行き先では試合ごとに切り替わる (domain/stage の Rotation)。
 *
 * ここは名前で引ける表にして、**どれを見るかは部屋が持つ** (server/world.ts)。
 * 読むのは起動時に 1 回だけで、切り替わっても読み直さない。
 */

import { STAGES, type StageName } from '../src/domain/stage'
import { arenaHalfOf } from '../src/sim/judge/motioncheck'
import {
  OPEN_SIGHT,
  boxSight,
  cameraBlockers,
  sightBlockers,
  solidBlockers,
  type SightBlocker,
  type StageBox,
} from '../src/sim/space/vision'
import { TriangleBvh } from '../src/sim/space/bvh'

/**
 * 1 枚ぶんの地形。**用途で 2 つに分ける。**
 *
 * 遮蔽 (sight) と、物がぶつかる面 (solid) は別の集合になる。当たり判定専用の
 * ブロックは視線を止めないので遮蔽から外れるが、手榴弾はそこで跳ねる。
 * 逆に見えない壁は視線を止めるだけで物は通る。
 */
export interface Terrain {
  name: StageName
  /**
   * 視線を止める形。**三角の網。**
   *
   * 箱で持っていた頃は、メッシュを包む直方体を判定に使っていたので**見えて
   * いる形と当たる形が違った** — 手すりの上を撃っているのに止められる、が
   * 起きる。三角なら見た目と一致する (sim/space/bvh.ts)。
   *
   * 読めなければ素通しの世界 (OPEN_SIGHT)。**遮蔽なしで動く** (位置は全員へ
   * 配られる)。
   */
  sight: SightBlocker
  /** 物がぶつかる面。**まだ箱** — 移動の当たり判定は別の形 (XZ の四角 + 上面) */
  solid: StageBox[]
  /**
   * カメラが入れない面。**これも箱。**
   *
   * 壁の手前へ寄せるには「どこで当たったか」が要るので、通るかどうかしか
   * 答えない三角の網では足りない。
   */
  camera: StageBox[]
  /** 遊べる範囲の半分 (m)。**箱の外接から出す** — 広げた分が場外にならないように */
  arenaHalf: number
}

/** 地形が読めなかったときの姿。**対戦は成立する** (全員が全員を見られる) */
function bare(name: StageName): Terrain {
  return { name, sight: OPEN_SIGHT, solid: [], camera: [], arenaHalf: Number.POSITIVE_INFINITY }
}

async function load(name: StageName): Promise<Terrain> {
  // **地形なしで立てる。** ドメインルールの試験にステージを噛ませない、というだけの環境変数。
  //
  // 試験は長らく「建物の外の開けた場所」に人を置いて、遮蔽を避けながら
  // 点数や残機を見ていた。避け方はステージの形に依存するので、**地図を
  // 描き替えるたびに、地形と関係ない試験が 15 本まとめて落ちる**。
  if (process.env.MGO2_NO_STAGE === '1') return bare(name)

  const path = new URL(`../public/models/stage_${name}.json`, import.meta.url)
  try {
    const data = (await Bun.file(path).json()) as { boxes: StageBox[] }
    const solid = solidBlockers(data.boxes)
    const half = arenaHalfOf(solid)
    const sight = await loadSight(name, data.boxes)
    console.info(
      `ステージ ${name}: 三角 ${sight instanceof TriangleBvh ? sight.size : 0} 枚 / ` +
        `物が当たる ${solid.length} 個 / ` +
        `範囲 ±${half.toFixed(1)}m`,
    )
    return { name, sight, solid, camera: cameraBlockers(data.boxes), arenaHalf: half }
  } catch {
    console.warn(`stage_${name}.json が読めない。遮蔽の判定なしで動かす (位置は全員へ配られる)`)
    return bare(name)
  }
}

/**
 * 視線を止める形を用意する。**起動時に 1 回だけ。**
 *
 * 三角があればそれを使い、無ければ箱へ戻る。**書き出し直していないステージが
 * 素通しになる**のを避ける — 遮蔽が丸ごと消えるのは、少し粗い遮蔽よりずっと
 * 悪い (全員がどこからでも見える)。
 *
 * 三角は json とは別の口から読む。**クライアントは json を落とす**ので、
 * 混ぜると遊ぶ人全員が 4MB を毎回落とすことになる (書き出しの側にも同じ
 * 理由を書いた)。生の float なので解析は要らない。
 */
async function loadSight(name: StageName, boxes: StageBox[]): Promise<SightBlocker> {
  const path = new URL(`../public/models/stage_${name}.sight.bin`, import.meta.url)
  try {
    const buffer = await Bun.file(path).arrayBuffer()
    return new TriangleBvh({ positions: new Float32Array(buffer) })
  } catch {
    const boxed = sightBlockers(boxes)
    console.info(`ステージ ${name}: 三角がまだ無いので箱で遮る (${boxed.length} 個)`)
    return boxed.length > 0 ? boxSight(boxed) : OPEN_SIGHT
  }
}

/**
 * 全部のステージ。起動時に 1 回だけ読む。
 * 数が増えても、部屋が使うのはそのうち 1 枚。
 */
const TERRAINS: Record<StageName, Terrain> = Object.fromEntries(
  await Promise.all(
    (Object.keys(STAGES) as StageName[]).map(async (name) => [name, await load(name)] as const),
  ),
) as Record<StageName, Terrain>

export function terrainOf(name: StageName): Terrain {
  return TERRAINS[name] ?? bare(name)
}
