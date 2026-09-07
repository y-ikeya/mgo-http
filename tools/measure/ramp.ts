// 坂を上るときの **1 コマの上がり幅**。
//
// 0.08m (motion.ts の STAIR_RISE_MIN) を超えると階段とみなされ、坂の途中で
// 階段のモーションが出る。**見た目は坂なのに足だけが段を上る**という形で
// 出るので、絵では気づけない。ここは数字で見る。
//
//   bun tools/measure/ramp.ts
//
// 走る速さ (4.5m/s) を 64Hz で刻んだ幅で歩かせる。実際に踏む刻みと同じにしないと、
// 粗く測って「跳んでいない」と読み違える。
import { groundHeight } from '../../src/sim/space/collision'
// json を直に読む。loadStageBoxes は fetch を使うので端末では動かない
const raw = JSON.parse(await Bun.file('public/models/stage_raft.json').text())
const boxes = raw.boxes
  .filter((b: any) => b.flags?.player)
  .map((b: any) => ({
    minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2],
    top: b.top.h + Math.max(0, b.top.dx ?? 0) * (b.max[0] - b.min[0])
       + Math.max(0, b.top.dz ?? 0) * (b.max[2] - b.min[2]),
    baseTop: b.top.h, slopeX: b.top.dx ?? 0, slopeZ: b.top.dz ?? 0,
    minY: b.min[1], surface: 'metal', thick: b.top.thick ?? 0, name: b.name,
  }))
const STEP = 0.25
// 走る速さ 4.5m/s を 64Hz で刻んだ 1 コマぶん
const FRAME = 4.5 / 64
const runs: [string, number, number, number, number, number][] = [
  ['赤 2→3F', 34.0, -0.1, 38.8, 0, 13.0],
  ['赤 2→3F 端', 34.0, -0.1, 39.7, 0, 13.0],
  ['青 2→3F', -34.0, 0.1, -38.8, 0, 13.0],
  ['青 1→2F', -34.0, 0.1, -30.4, 0, 10.0],
  ['赤 1→2F', 34.0, -0.1, 30.4, 0, 10.0],
]
const R = 0.35
/** 実際の床から歩き始める。**無い所から始めると測り方のほうが嘘になる** */
function walk(name: string, x0: number, z0: number, x1: number, z1: number): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / FRAME)
  const sx = (x1 - x0) / steps, sz = (z1 - z0) / steps
  let feet = groundHeight({ x: x0, y: 40, z: z0 }, R, boxes, 40, 99)
  let prev: number | null = null, worst = 0, at = 0
  for (let i = 0; i <= steps; i++) {
    const x = x0 + sx * i, z = z0 + sz * i
    const g = groundHeight({ x, y: feet, z }, R, boxes, feet, STEP)
    if (g > 0) feet = g
    if (prev !== null && feet - prev > worst) { worst = feet - prev; at = x }
    prev = feet
  }
  const flag = worst >= 0.08 ? ' ← 階段扱い' : ''
  console.log(`${name.padEnd(14)} 着 ${(prev ?? 0).toFixed(2)}  1 コマ最大 ${(worst * 1000).toFixed(0)}mm (x ${at.toFixed(1)})${flag}`)
}
walk('赤 2→3F', 34.0, 38.8, 27.5, 38.8)
walk('赤 2→3F 端', 34.0, 39.7, 27.5, 39.7)
walk('青 2→3F', -34.0, -38.8, -27.5, -38.8)
walk('青 2→3F 端', -34.0, -39.7, -27.5, -39.7)
walk('青 1→2F', -27.5, -30.4, -34.0, -30.4)
walk('赤 1→2F', 27.5, 30.4, 34.0, 30.4)
