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
import { type StageBox, sightBlockers, solidBlockers } from '../src/sim/space/vision'

/**
 * 1 枚ぶんの地形。**用途で 2 つに分ける。**
 *
 * 遮蔽 (sight) と、物がぶつかる面 (solid) は別の集合になる。当たり判定専用の
 * ブロックは視線を止めないので遮蔽から外れるが、手榴弾はそこで跳ねる。
 * 逆に見えない壁は視線を止めるだけで物は通る。
 */
export interface Terrain {
  name: StageName
  sight: StageBox[]
  solid: StageBox[]
  /** 遊べる範囲の半分 (m)。**箱の外接から出す** — 広げた分が場外にならないように */
  arenaHalf: number
}

/** 地形が読めなかったときの姿。**対戦は成立する** (全員が全員を見られる) */
function bare(name: StageName): Terrain {
  return { name, sight: [], solid: [], arenaHalf: Number.POSITIVE_INFINITY }
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
    const sight = sightBlockers(data.boxes)
    const solid = solidBlockers(data.boxes)
    const half = arenaHalfOf(solid)
    console.info(
      `ステージ ${name}: 箱 ${data.boxes.length} 個 / 視線を止める ${sight.length} 個 / ` +
        `物が当たる ${solid.length} 個 / 範囲 ±${half.toFixed(1)}m`,
    )
    return { name, sight, solid, arenaHalf: half }
  } catch {
    console.warn(`stage_${name}.json が読めない。遮蔽の判定なしで動かす (位置は全員へ配られる)`)
    return bare(name)
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
