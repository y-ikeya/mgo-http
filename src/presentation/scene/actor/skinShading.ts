import * as THREE from 'three'
import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu'
import { diffuseColor, normalView, vec3 } from 'three/tsl'

/**
 * 肌と目の膜。**Blender で見える「透き通った肌」と「潤んだ目」を、ゲームの材質で似せる** (2026-11-19 本人
 * 「ゲームだとなんか色が透き通ってないというか塗ったような感じ」)。
 *
 * Blender の Freya の肌は肌の下で光が散る設定 (Subsurface Weight 0.44、赤く散る) で、影の境目が赤く柔らかく
 * 回り込む。glTF にはこの項目が無く、書き出しで落ちる。本物の散乱は重いので、**光の当たる側から影の側へ、
 * 赤みを帯びた光を少し回り込ませる** (wrap lighting) だけにする。重さはほぼ増えない。
 *
 * 目の表面の膜 (Glass) は、黒い色で**足し合わせて描く** — 色は足されず照り返しだけが乗る。普通に描くと
 * 不透明になって黒目を白く覆った (前に書き出しで外していた理由)。
 */

/** 回り込みの幅。0 なら普通の当たり方。大きいほど影の側まで光が回る */
const SKIN_WRAP = 0.45
/** 回り込んだ光の色。赤が残り、青が抜ける (肌の下を通る光) */
const SKIN_SCATTER = new THREE.Color(1, 0.42, 0.3)

class SkinLightingModel extends PhysicalLightingModel {
  // three の型定義には direct の引数の型が無い
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  direct(input: any, builder: any): void {
    super.direct(input, builder)
    const { lightDirection, lightColor, reflectedLight } = input
    const nl = normalView.dot(lightDirection)
    // 回り込ませた当たり方から、普通の当たり方を引いたぶんだけを足す (光の当たる側は変えない)
    const extra = nl.add(SKIN_WRAP).div(1 + SKIN_WRAP).clamp().sub(nl.clamp())
    reflectedLight.directDiffuse.addAssign(
      extra.mul(lightColor).mul(diffuseColor.rgb).mul(vec3(SKIN_SCATTER.r, SKIN_SCATTER.g, SKIN_SCATTER.b)).mul(1 / Math.PI),
    )
  }
}

class SkinNodeMaterial extends MeshStandardNodeMaterial {
  setupLightingModel(): PhysicalLightingModel {
    return new SkinLightingModel()
  }
}

/** 普通の材質から、同じ絵と値を持つ肌の材質を作る */
function skinFrom(source: THREE.MeshStandardMaterial): SkinNodeMaterial {
  const skin = new SkinNodeMaterial()
  skin.name = source.name
  skin.color.copy(source.color)
  skin.map = source.map
  skin.normalMap = source.normalMap
  skin.normalScale.copy(source.normalScale)
  skin.roughness = source.roughness
  skin.roughnessMap = source.roughnessMap
  skin.metalness = source.metalness
  skin.metalnessMap = source.metalnessMap
  skin.aoMap = source.aoMap
  skin.side = source.side
  skin.alphaTest = source.alphaTest
  skin.transparent = source.transparent
  return skin
}

/** 目の膜。照り返しだけを足す */
function eyeFilm(source: THREE.Material): MeshStandardNodeMaterial {
  const film = new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.04, metalness: 0 })
  film.name = source.name
  // 膜の凹凸の絵 (角膜の膨らみ) は使わない。付けると全身を映す試写 (body.html?at=all) が真っ暗のまま描けなかった
  void source
  film.transparent = true
  film.depthWrite = false
  film.blending = THREE.AdditiveBlending
  return film
}

/**
 * 体ごとに、どの材質を肌にし、どれを目の膜にするか (glb の材質の名前)。**載っていない体は何もしない**
 */
const SHADING: Readonly<Record<string, { skin: readonly string[]; film: readonly string[] }>> = {
  soldier_freya: { skin: ['Body'], film: ['Glass'] },
  // 名無し: 体 (Kachujin) と Tripo の頭。目玉に膜は無い (2026-11-19 本人「nanashi にもやって」)
  soldier_nanashi: { skin: ['kachujin_MAT', 'tripo_mat_fd22bf99'], film: [] },
}

/** 読み込んだ体の材質を差し替える。体ごとに 1 度だけ (assets.ts の loadSoldier) */
export function applySkinShading(skin: string, root: THREE.Object3D): void {
  const spec = SHADING[skin]
  if (!spec) return
  const made = new Map<THREE.Material, THREE.Material>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const swap = (material: THREE.Material): THREE.Material => {
      const done = made.get(material)
      if (done) return done
      let next = material
      if (spec.skin.includes(material.name) && material instanceof THREE.MeshStandardMaterial) next = skinFrom(material)
      else if (spec.film.includes(material.name)) next = eyeFilm(material)
      made.set(material, next)
      return next
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
    // 膜は影を落とさない (目に影が落ちる)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((m) => spec.film.includes(m.name))) mesh.castShadow = false
  })
}
