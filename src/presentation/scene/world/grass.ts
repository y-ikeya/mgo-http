import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { Fn, clamp, float, length, max, modelWorldMatrix, positionLocal, sin, smoothstep, time, uniformArray, vec3, vec4 } from 'three/tsl'

/*
 * 草むら。**近くを人が通ると葉が押しのけられて揺れる。**
 *
 * 葉は Blender で 1 枚ずつ三角に作り、書き出しでは飾り (人・弾・視線・カメラを
 * 通す) として出している (名前に grass_)。形は動かさず、描く時に頂点をずらす。
 *
 *   近い人から離れる向きへ倒す   根元は動かさず、高い所ほど大きく
 *   その人が動いている間は震わせる   止まれば倒れたまま静まる
 *
 * 見える人しか届かないので (サーバーが見えない相手を配らない)、見えない敵が草を
 * 揺らして居場所がばれることは無い。
 */

/** 一度に草を押せる人の数。近い順ではなく届いた順 (自分が先頭) */
const MAX_PUSHERS = 8
/** 葉が押される距離 (m)。体の半径 (0.35) より広く、体が葉に埋まって見えない程度 */
const REACH = 0.9
/** これより近い葉は同じだけ倒れる (m) */
const REACH_FULL = 0.15
/** 葉先が横へ逃げる量 (m) */
const LEAN = 0.4
/** 葉先が下がる量 (m)。横へ逃げたぶん背が縮む */
const SINK = 0.12
/** 足元からこの高さで倒れ切る (m)。葉の背 (0.7〜1.15m) くらい */
const BLADE_HEIGHT = 1.1
/** 足元からこれより上の葉は押さない (m)。上の階の人が下の階の草を揺らさない */
const ABOVE_FEET = 1.6
/** 動いている間の震えの幅 (m) と速さ */
const RUSTLE = 0.07
const RUSTLE_RATE = 14
/** この速さ (m/s) で震えが最大。歩き (2m/s 前後) で 2/3 */
const RUSTLE_SPEED = 3
/** 震えの立ち上がりと静まりの速さ (1/s) */
const RUSTLE_DAMP = 6

/** 足元の位置 (xyz) と動いている度合い (w、0〜1)。使っていない枠は遥か下に置く */
const pushers = Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4(0, -1e4, 0, 0))
const pusherNode = uniformArray(pushers, 'vec4' as const)

/**
 * 頂点をずらす式。**草の材質で共有する。**
 *
 * 押す人の位置はワールド座標で届くので、葉の位置もワールドで比べる。ずらす量は
 * 向きだけの量なので、草の物が回っていなければそのまま足してよい (Blender で
 * 回さずに作っている)
 */
const bent = Fn(() => {
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz
  const offset = vec3(0, 0, 0).toVar()
  for (let i = 0; i < MAX_PUSHERS; i++) {
    const pusher = pusherNode.element(i)
    const away = world.xz.sub(pusher.xz)
    const dist = length(away)
    const near = float(1).sub(smoothstep(REACH_FULL, REACH, dist))
    const above = world.y.sub(pusher.y)
    // 根元 (足元と同じ高さ) は動かさず、上ほど大きく。2 乗で葉が弓なりに見える
    const up = clamp(above.div(BLADE_HEIGHT), 0, 1)
    const sameFloor = float(1).sub(smoothstep(ABOVE_FEET - 0.3, ABOVE_FEET, above))
    const weight = near.mul(up).mul(up).mul(sameFloor)
    const dir = away.div(max(dist, 0.001))
    const rustle = sin(time.mul(RUSTLE_RATE).add(world.x.mul(3.1)).add(world.z.mul(2.3))).mul(RUSTLE).mul(pusher.w)
    const lean = rustle.add(LEAN)
    offset.addAssign(vec3(dir.x.mul(lean), -SINK, dir.y.mul(lean)).mul(weight))
  }
  return positionLocal.add(offset)
})()

const materials = new Map<string, MeshStandardNodeMaterial>()

/** 書き出した草の材質を、揺れる材質に置き換えた物。同じ材質は 1 つを使い回す */
export function swayingGrassMaterial(original: THREE.MeshStandardMaterial): MeshStandardNodeMaterial {
  const cached = materials.get(original.uuid)
  if (cached) return cached
  const material = new MeshStandardNodeMaterial()
  material.name = original.name
  material.map = original.map
  material.color.copy(original.color)
  material.vertexColors = original.vertexColors
  material.alphaTest = original.alphaTest
  material.roughness = original.roughness
  material.metalness = original.metalness
  material.normalMap = original.normalMap
  material.roughnessMap = original.roughnessMap
  material.metalnessMap = original.metalnessMap
  material.aoMap = original.aoMap
  material.side = THREE.DoubleSide
  material.positionNode = bent
  materials.set(original.uuid, material)
  return material
}

/** 前のコマの位置。動いている度合いを出すのに使う */
const last = new Map<string, { at: THREE.Vector3; moving: number }>()

/**
 * 草を押す人を渡す。**毎コマ呼ぶ。** 自分を先頭に、見えている人の足元。
 *
 * 動いている度合いは位置の差から出す。いきなり 0 / 1 にすると、止まった瞬間に
 * 震えが切れて葉が跳ねるので、ならして上げ下げする
 */
export function pushGrass(dt: number, feet: ReadonlyMap<string, THREE.Vector3>): void {
  const ease = 1 - Math.exp(-RUSTLE_DAMP * dt)
  let slot = 0
  for (const [id, at] of feet) {
    if (slot >= MAX_PUSHERS) break
    const before = last.get(id)
    const speed = before && dt > 0 ? before.at.distanceTo(at) / dt : 0
    const target = Math.min(speed / RUSTLE_SPEED, 1)
    const moving = before ? before.moving + (target - before.moving) * ease : 0
    if (before) {
      before.at.copy(at)
      before.moving = moving
    } else {
      last.set(id, { at: at.clone(), moving })
    }
    pushers[slot]!.set(at.x, at.y, at.z, moving)
    slot++
  }
  for (const id of last.keys()) if (!feet.has(id)) last.delete(id)
  for (; slot < MAX_PUSHERS; slot++) pushers[slot]!.set(0, -1e4, 0, 0)
}
