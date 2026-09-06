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
import { boxSolid } from '../src/sim/judge/ballistic'
import {
  OPEN_SIGHT,
  boxSight,
  cameraBlockers,
  sightBlockers,
  solidBlockers,
  type SightBlocker,
  type SolidWorld,
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
  /**
   * 人が止まる面。**箱のまま。**
   *
   * 移動は「線が通るか」ではなく「円柱を動かして押し戻す」なので、問いの形が
   * 違う。三角でやるなら別の仕掛けが要るし、段差の乗り方や坂の滑り方という
   * **遊びの手触りが乗っている**所なので、動かすと感触が変わる。
   */
  solid: StageBox[]
  /**
   * 投げた物がぶつかる形。**三角の網。**
   *
   * 箱で跳ねていた頃は、メッシュを包む直方体で跳ね返っていた — **手すりの
   * 無い側の空中で跳ね返る。** 弾が当たる面と同じ集合を使う (書き出しの
   * BULLET_BIT)。手すりを弾がすり抜けるなら、投げた物もすり抜けるほうが揃う。
   */
  thrown: SolidWorld
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
  return {
    name,
    sight: OPEN_SIGHT,
    solid: [],
    thrown: boxSolid([]),
    camera: [],
    arenaHalf: Number.POSITIVE_INFINITY,
  }
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
    const mesh = await loadMesh(name)
    const sight = mesh ? mesh.sight : boxedSight(name, data.boxes)
    const thrown = mesh ? mesh.thrown : boxSolid(solid)
    console.info(
      `ステージ ${name}: 三角 視線 ${sizeOf(sight)} 枚 / 物 ${sizeOf(thrown)} 枚 / ` +
        `人が止まる箱 ${solid.length} 個 / 範囲 ±${half.toFixed(1)}m`,
    )
    return { name, sight, thrown, solid, camera: cameraBlockers(data.boxes), arenaHalf: half }
  } catch {
    console.warn(`stage_${name}.json が読めない。遮蔽の判定なしで動かす (位置は全員へ配られる)`)
    return bare(name)
  }
}

/** 木の大きさ。箱の包みなら 0 */
function sizeOf(world: SightBlocker | SolidWorld): number {
  return world instanceof TriangleBvh ? world.size : 0
}

/** 三角が無いステージは箱で遮る。**素通しにするよりずっとまし** */
function boxedSight(name: StageName, boxes: StageBox[]): SightBlocker {
  const boxed = sightBlockers(boxes)
  console.info(`ステージ ${name}: 三角がまだ無いので箱で遮る (${boxed.length} 個)`)
  return boxed.length > 0 ? boxSight(boxed) : OPEN_SIGHT
}

/**
 * 三角の網を読んで、**用途ごとに木を組む。** 起動時に 1 回だけ。
 *
 *     [uint32 枚数][float32 頂点 × 枚数×9][uint8 印 × 枚数]
 *
 * 印は「何を止めるか」。視線用と物用で別々の木を組む — 1 本の木に混ぜて
 * 引くたびに印を見ると、**枝を捨てられなくなる** (捨てた枝に別用途の面が
 * 混ざっているかもしれない)。
 *
 * json とは別の口から読む。**クライアントは json を落とす**ので、混ぜると
 * 遊ぶ人全員が 4MB を毎回落とすことになる。生の数値なので解析は要らない。
 *
 * 三角が無ければ null。呼ぶ側が箱へ戻る。
 */
async function loadMesh(
  name: StageName,
): Promise<{ sight: SightBlocker; thrown: SolidWorld } | null> {
  const path = new URL(`../public/models/stage_${name}.mesh.bin`, import.meta.url)
  try {
    const buffer = await Bun.file(path).arrayBuffer()
    const count = new Uint32Array(buffer, 0, 1)[0]!
    const positions = new Float32Array(buffer, 4, count * 9)
    const marks = new Uint8Array(buffer, 4 + count * 9 * 4, count)
    return {
      sight: new TriangleBvh({ positions: subsetOf(positions, marks, EYE_BIT) }),
      thrown: new TriangleBvh({ positions: subsetOf(positions, marks, BULLET_BIT) }),
    }
  } catch {
    return null
  }
}

/** 印の付いた三角だけを抜き出す */
function subsetOf(positions: Float32Array, marks: Uint8Array, bit: number): Float32Array {
  let count = 0
  for (const mark of marks) if (mark & bit) count++
  const out = new Float32Array(count * 9)
  let at = 0
  for (let i = 0; i < marks.length; i++) {
    if (!(marks[i]! & bit)) continue
    out.set(positions.subarray(i * 9, i * 9 + 9), at)
    at += 9
  }
  return out
}

/** 何を止めるか。**書き出し (tools/export_stage.py) と揃えること** */
const EYE_BIT = 1
const BULLET_BIT = 2

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
