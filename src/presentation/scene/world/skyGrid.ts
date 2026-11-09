import * as THREE from 'three'
import { MeshStandardNodeMaterial, StorageBufferAttribute, type Node } from 'three/webgpu'
import { Fn, float, floor, materialColor, max, normalWorld, positionWorld, select, storage, uint, vec3, vec4 } from 'three/tsl'
import type { StageName } from '../../../domain/stage'
import { asset } from '../assets'
import { parseSkyTable, type SkyTable } from './skyTable'

/**
 * **空の見え方を 3D の升の表から引いて、面ごとに暗くする** (2026-11-09 本人「頂点を増やす以外に
 * 影の中を暗くする方法」)。表を読む・CPU で引くのは skyTable.ts、焼くのは tools/sky_grid.py。
 *
 * 前は「空の見え方」を頂点に焼いていた (tools/bake_stage.py)。暗さを細かくしたい所は平らな面でも
 * 頂点を割るしかなく、CC で glb を 1.6MB 食っていた。表は面の近くだけ持って 1MB 弱。
 * **表 (stage_<名>.sky.bin) のあるステージだけ表で描く。** 無いステージは今まで通り頂点の暗さ。
 *
 * --- 引き方 ---
 * 升ごとに 6 つの向き (東西南北・上・下) の半球で測った値を持ち、面の向きで混ぜる (外壁は外の
 * 半球、床は上の半球)。引く点は面の向きへ少しずらす — 壁の内と外が同じ升に入っても、向いている
 * 側の升を引ける。壁の中の升・持たない升・面をまたぐ升は混ぜない。
 *
 *     1. 25cm の格子で、面から 17.5cm ずらした点の周り 8 升。細かく持つ升 (中心が壁の中の升の
 *        中の空気) を使えたらその値。細い窓の凹みの中はこれでないと外の明るさを引く
 *     2. 使えなければ 50cm の格子で、35cm ずらした点の周り 8 升
 *     3. それでも無ければ一番暗い値
 */

const tables = new Map<StageName, Promise<SkyTable | null>>()

/** 表を読む。無ければ null (そのステージは頂点の暗さのまま) */
export function loadSkyTable(name: StageName): Promise<SkyTable | null> {
  const cached = tables.get(name)
  if (cached) return cached
  const pending = (async () => {
    const res = await fetch(asset.model(`stage_${name}.sky.bin`))
    if (!res.ok) return null
    return parseSkyTable(await res.arrayBuffer(), (bytes) =>
      new Response(new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(),
    )
  })().catch((error) => {
    console.warn(`[Stage] stage_${name}.sky.bin が読めない`, error)
    return null
  })
  tables.set(name, pending)
  return pending
}

/** 面の明るさ (0〜1) を引く節。材質の色に掛ける */
function skyNode(grid: SkyTable): Node<'float'> {
  const coarse = storage(new StorageBufferAttribute(grid.coarse, 1), 'uint', grid.coarse.length).toReadOnly()
  // 空の並びは GPU に渡せないので、細かく持つ升が無くても 8 語は持たせる
  const fineData = grid.fine.length > 0 ? grid.fine : new Uint32Array(8)
  const fine = storage(new StorageBufferAttribute(fineData, 1), 'uint', fineData.length).toReadOnly()
  const [n0, n1, n2] = grid.n
  const lo = vec3(grid.lo[0], grid.lo[1], grid.lo[2])
  const top = float(grid.levels - 1)

  return Fn(() => {
    // three (x, y, z) → Blender (x, -z, y)
    const toBlender = (p: Node<'vec3'>) => vec3(p.x, p.z.negate(), p.y)
    const nb = toBlender(normalWorld).toVar()
    const w = [nb.x, nb.x.negate(), nb.y, nb.y.negate(), nb.z, nb.z.negate()].map((c) => max(c, 0).mul(max(c, 0)))
    const wsum = w.reduce((a, b) => a.add(b)).max(1e-4).toVar()
    /** 24 ビットに詰めた 6 方向の値を、面の向きで混ぜる */
    const decode = (word: Node<'uint'>) =>
      w
        .map((wq, q) => wq.mul(float(word.shiftRight(uint(4 * q)).bitAnd(uint(15)))))
        .reduce((a, b) => a.add(b))
        .div(wsum)
        .div(top)
    const index = (c: Node<'vec3'>) => uint(c.x).add(uint(n0).mul(uint(c.y).add(uint(n1).mul(uint(c.z)))))
    const inside = (c: Node<'vec3'>) =>
      c.x.greaterThanEqual(0).and(c.y.greaterThanEqual(0)).and(c.z.greaterThanEqual(0))
        .and(c.x.lessThan(n0)).and(c.y.lessThan(n1)).and(c.z.lessThan(n2))
    const clampCell = (c: Node<'vec3'>) => vec3(c.x.clamp(0, n0 - 1), c.y.clamp(0, n1 - 1), c.z.clamp(0, n2 - 1))

    const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const
    const bit = (word: Node<'uint'>, k: number) => word.shiftRight(uint(k)).bitAnd(uint(1)).equal(uint(1))

    /** 25cm の格子の升。親が粗い値を持てばそれ、細かく持つ升ならその小升。値の語 (隣との間の印つき)、あるか、細かい値か */
    const fineCell = (fc: Node<'vec3'>) => {
      const parent = floor(fc.mul(0.5))
      const sub = fc.sub(parent.mul(2))
      const ok = inside(parent)
      const word = coarse.element(index(clampCell(parent))).toVar()
      const mixed = bit(word, 30)
      const slot = word.bitAnd(uint(0x3fffffff)).mul(uint(8)).add(uint(sub.x.mul(4).add(sub.y.mul(2)).add(sub.z)))
      const fw = fine.element(select(mixed, slot, uint(0))).toVar()
      const fineHere = mixed.and(bit(fw, 31))
      return { value: select(mixed, fw, word), present: ok.and(select(mixed, fineHere, bit(word, 31))), fineHere: ok.and(fineHere) }
    }

    /** 50cm の格子の升。細かく持つ升 (中心が壁の中) は粗い値を持たないので使わない */
    const coarseCell = (c: Node<'vec3'>) => {
      const ok = inside(c)
      const word = coarse.element(index(clampCell(c))).toVar()
      return { value: word, present: ok.and(bit(word, 31)) }
    }

    /**
     * **面をまたぐ升は混ぜない。** 引く点に一番近い升を基準に、その升から見て隣との間が
     * ふさがっている向きへ 1 歩でもまたぐ升を外す (斜めの升は、またぐ軸のどれかがふさがれば外す)。
     * 天井が升より薄いと、天井の下で引いた時に屋上の空気の升が混ざり、壁と天井の角が明るかった
     * (2026-11-09 本人「天井と壁のくっついてるところくらいがなんか明るい」)
     */
    const across = (ref: { value: Node<'uint'>; present: Node<'bool'> }, near: Node<'vec3'>, corner: readonly [number, number, number]) => {
      const r = [near.x, near.y, near.z]
      let blocked: Node<'bool'> | null = null
      for (let a = 0; a < 3; a++) {
        const step = corner[a] === 1 ? r[a]!.equal(0).and(bit(ref.value, 24 + 2 * a)) : r[a]!.equal(1).and(bit(ref.value, 25 + 2 * a))
        blocked = blocked ? blocked.or(step) : step
      }
      return ref.present.and(blocked!)
    }
    const nearest = (f: Node<'vec3'>) => vec3(select(f.x.greaterThan(0.5), 1, 0), select(f.y.greaterThan(0.5), 1, 0), select(f.z.greaterThan(0.5), 1, 0))

    // 1. 25cm の格子
    const half = grid.cell / 2
    const pf = toBlender(positionWorld.add(normalWorld.mul(half * 0.7))).sub(lo).div(half).sub(0.5).toVar()
    const bf = floor(pf).toVar()
    const ff = pf.sub(bf).toVar()
    const nf = nearest(ff).toVar()
    const refF = fineCell(bf.add(nf))
    const totalF = float(0).toVar()
    const weightF = float(0).toVar()
    const hit = float(0).toVar()
    for (const corner of CORNERS) {
      const [di, dj, dk] = corner
      const cell = fineCell(bf.add(vec3(di, dj, dk)))
      const tw = (di ? ff.x : ff.x.oneMinus()).mul(dj ? ff.y : ff.y.oneMinus()).mul(dk ? ff.z : ff.z.oneMinus())
      const use = cell.present.and(across(refF, nf, corner).not())
      const wt = select(use, tw, float(0))
      totalF.addAssign(decode(cell.value).mul(wt))
      weightF.addAssign(wt)
      hit.assign(max(hit, select(use.and(cell.fineHere), float(1), float(0))))
    }

    // 2. 50cm の格子
    const pc = toBlender(positionWorld.add(normalWorld.mul(grid.cell * 0.7))).sub(lo).div(grid.cell).sub(0.5).toVar()
    const bc = floor(pc).toVar()
    const fc2 = pc.sub(bc).toVar()
    const nc = nearest(fc2).toVar()
    const refC = coarseCell(bc.add(nc))
    const totalC = float(0).toVar()
    const weightC = float(0).toVar()
    for (const corner of CORNERS) {
      const [di, dj, dk] = corner
      const cell = coarseCell(bc.add(vec3(di, dj, dk)))
      const tw = (di ? fc2.x : fc2.x.oneMinus()).mul(dj ? fc2.y : fc2.y.oneMinus()).mul(dk ? fc2.z : fc2.z.oneMinus())
      const wt = select(cell.present.and(across(refC, nc, corner).not()), tw, float(0))
      totalC.addAssign(decode(cell.value).mul(wt))
      weightC.addAssign(wt)
    }

    const fromFine = totalF.div(weightF.max(1e-4))
    const fromCoarse = totalC.div(weightC.max(1e-4))
    return select(hit.greaterThan(0.5).and(weightF.greaterThan(1e-3)), fromFine, select(weightC.greaterThan(1e-3), fromCoarse, float(grid.floor)))
  })()
}

/**
 * ステージのモデルの材質を、表を引く材質に替える。**色 = 元の色 × 表の明るさ。**
 *
 * 同じ材質は 1 つを使い回す。ノードの材質 (草の揺れなど) は触らない
 */
export function applySkyGrid(model: THREE.Object3D, grid: SkyTable): void {
  const sky = skyNode(grid)
  const made = new Map<string, MeshStandardNodeMaterial>()
  const convert = (original: THREE.Material): THREE.Material => {
    if (!(original instanceof THREE.MeshStandardMaterial) || (original as { isNodeMaterial?: boolean }).isNodeMaterial) return original
    const cached = made.get(original.uuid)
    if (cached) return cached
    const material = new MeshStandardNodeMaterial()
    THREE.MeshStandardMaterial.prototype.copy.call(material, original)
    material.vertexColors = false
    // 絵のある材質は絵の透明度を残す (壁の汚れの板は透明度で抜く)。絵が無ければ色は 3 成分
    if (original.map) {
      const textured = materialColor as unknown as Node<'vec4'>
      material.colorNode = vec4(textured.rgb.mul(sky), textured.a)
    } else {
      material.colorNode = materialColor.mul(sky)
    }
    made.set(original.uuid, material)
    return material
  }
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
  })
  console.info(`[Stage] 空の見え方を升の表から引く (材質 ${made.size})`)
}
