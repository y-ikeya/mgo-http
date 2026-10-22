import * as THREE from 'three'
import { DRAW_LATER, TOWARD_CAMERA } from '../util/depth'

/**
 * **網目の物 (金網のフェンス) の影は、床へ網目の絵を貼って落とす** (2026-10-22 本人「影も上手くやって」)。
 *
 * 影の地図は 1 画素が 3〜4cm ある (UU の ±71m を 4096 で)。金網の針金は 7mm なので、地図に
 * 描いても針金はほとんど拾えず、かすれた点々にしかならなかった。そこで網目の物は影の地図に
 * 入れず、**物を日の向きに沿って床へ投げた形**に、同じ網目の絵を黒く薄く貼る。
 *
 * 投げた形の各点には、元の物の同じ点の UV をそのまま持たせる。日の向きに沿った投げ方は
 * 平行移動の一種なので、網目は本物の影と同じ所に落ちる。
 *
 * 対象は**透け方を 2 値で決める物** (glTF の MASK = alphaTest) で絵を持つ物。床は物の
 * 一番下の高さの水平面として扱う (平らな床に立つフェンスの前提)。
 */
/** 影の濃さ。日なたの床を、針金の所だけ建物の影ほどに落とす */
const SHADOW_OPACITY = 0.6
/** 床から浮かせる量 (m)。床と同じ深さで描くとちらつく */
const LIFT = 0.02

/**
 * 網目の物を探して、床に影を貼る。**ステージと太陽が揃った所で 1 度。**
 *
 * @param sunlit その点に日が当たっているか (actor/blobShadow.ts と同じ物)。影の真ん中が
 *   もう日陰なら貼らない (日陰にさらに黒を重ねると、暗い床に暗い網が浮く)
 * @returns 影の地図から外した物があったか (あれば地図を焼き直す)
 */
export function addMaskedShadows(
  scene: THREE.Object3D,
  sun: THREE.DirectionalLight,
  sunlit: (x: number, y: number, z: number) => boolean,
): boolean {
  const masked: THREE.Mesh[] = []
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.castShadow) return
    const material = mesh.material as THREE.MeshStandardMaterial
    if (Array.isArray(mesh.material) || !(material.alphaTest > 0) || !material.map) return
    masked.push(mesh)
  })
  const down = new THREE.Vector3().subVectors(sun.target.position, sun.position).normalize()
  if (down.y >= -1e-3) return false
  for (const mesh of masked) {
    const decal = shadowOf(mesh, down, sunlit)
    // 影の地図には入れない (針金を拾えず点々になる)。影はこの貼った絵が受け持つ
    mesh.castShadow = false
    if (decal) scene.add(decal)
  }
  return masked.length > 0
}

function shadowOf(
  mesh: THREE.Mesh,
  down: THREE.Vector3,
  sunlit: (x: number, y: number, z: number) => boolean,
): THREE.Mesh | null {
  mesh.updateWorldMatrix(true, false)
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const position = source.getAttribute('position')
  const uv = source.getAttribute('uv')
  if (!position || !uv) return null
  const world: THREE.Vector3[] = []
  let floor = Infinity
  for (let i = 0; i < position.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    world.push(v)
    floor = Math.min(floor, v.y)
  }
  // 日の向きに沿って床 (一番下の高さの水平面) まで投げる
  const out = new Float32Array(world.length * 3)
  const centre = new THREE.Vector3()
  world.forEach((v, i) => {
    const t = (v.y - floor) / -down.y
    const q = v.clone().addScaledVector(down, t)
    out[i * 3] = q.x
    out[i * 3 + 1] = floor + LIFT
    out[i * 3 + 2] = q.z
    centre.add(q)
  })
  centre.divideScalar(world.length)
  if (!sunlit(centre.x, floor + 0.3, centre.z)) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(out, 3))
  geometry.setAttribute('uv', uv.clone())
  const map = (mesh.material as THREE.MeshStandardMaterial).map
  const material = new THREE.MeshBasicMaterial({
    map,
    color: 0x000000,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    // 床と同じ深さなので、比べ合いで床に勝つ側へ寄せる (actor/blobShadow.ts と同じ)
    polygonOffset: true,
    polygonOffsetFactor: 2 * TOWARD_CAMERA,
    polygonOffsetUnits: 2 * TOWARD_CAMERA,
  })
  const decal = new THREE.Mesh(geometry, material)
  decal.name = `${mesh.name}_shadow`
  decal.renderOrder = DRAW_LATER
  decal.castShadow = false
  decal.receiveShadow = false
  return decal
}
