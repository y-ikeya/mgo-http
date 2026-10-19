import * as THREE from 'three'

/**
 * 同じ画像のテクスチャを 1 枚にまとめる。**GPU に同じ絵を何枚も載せない。**
 *
 * --- なぜ要るか ---
 * WebGPU は Texture の物 1 つにつき GPU のテクスチャを 1 枚作る。複製 (clone) した
 * Texture は画像を共有していても、GPU には別々に載る (WebGL は画像ごとに共有していた)。
 *
 * GLTFLoader は、絵のずらし (KHR_texture_transform) が付いた欄ごとにテクスチャを
 * 複製する。gltfpack は UV を整数に詰めて、戻すための拡大・ずらしをこの形で付けるので、
 * ステージの glb はほぼ全部の欄が複製になる。金属・粗さの絵は粗さと陰り (occlusion) の
 * 2 欄でそれぞれ複製される — city で concrete_wall_009_arm 1 枚が 8 枚になり、
 * 1.5GB のうち約 540MB が同じ絵の重複だった (2026-10-19)。
 *
 * --- やること ---
 * 1. ずらしを形の UV に焼き込む (材質の全部の欄が同じずらしと同じ UV の組を持つ時だけ)。
 *    2 本目の UV (uv1) を使う材質は、1 本目 (uv) へ移す
 * 2. 焼き込んだ材質の欄を、同じ画像・同じ設定の 1 枚に差し替える
 *
 * 形を共有している物が別のずらしを使うなら、その形と材質は触らない (片方の UV が壊れる)。
 */
export function shareGltfTextures(root: THREE.Object3D): { merged: number; kept: number } {
  type Entry = { mesh: THREE.Mesh; material: THREE.Material; key: string | null }
  const entries: Entry[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    // 1 つの形に複数の材質 (groups) は扱わない。UV を材質ごとに分けられない
    if (Array.isArray(mesh.material)) return
    entries.push({ mesh, material: mesh.material, key: transformKey(mesh.material) })
  })

  // 形と材質の組み合わせが食い違うものを、決まるまで外していく
  const ok = new Set(entries.filter((e) => e.key !== null))
  for (let changed = true; changed; ) {
    changed = false
    const byGeometry = new Map<THREE.BufferGeometry, Entry[]>()
    const byMaterial = new Map<THREE.Material, Entry[]>()
    for (const e of entries) {
      push(byGeometry, e.mesh.geometry, e)
      push(byMaterial, e.material, e)
    }
    for (const group of [...byGeometry.values(), ...byMaterial.values()]) {
      const keys = new Set(group.map((e) => e.key))
      if (keys.size === 1 && group.every((e) => ok.has(e))) continue
      for (const e of group) if (ok.delete(e)) changed = true
    }
  }

  const baked = new Set<THREE.BufferGeometry>()
  const swapped = new Set<THREE.Material>()
  const canon = new Map<string, THREE.Texture>()
  let merged = 0
  for (const e of ok) {
    const slots = textureSlots(e.material)
    const channel = slots[0][1].channel
    if (!baked.has(e.mesh.geometry)) {
      baked.add(e.mesh.geometry)
      // 2 本目以降の UV を使う材質は、1 本目へ移す。同じ絵を 1 本目で使う材質と共有できる
      // (欄が使う UV は Texture が持つので、組が違うと別の Texture = GPU に別の 1 枚になる)
      if (e.key !== IDENTITY || channel !== 0) bakeUv(e.mesh.geometry, uvName(channel), 'uv', slots[0][1].matrix)
    }
    if (swapped.has(e.material)) continue
    swapped.add(e.material)
    const record = e.material as unknown as Record<string, THREE.Texture>
    for (const [slot, texture] of slots) {
      const key = settingsKey(texture)
      let shared = canon.get(key)
      if (!shared) {
        shared = texture.clone()
        shared.offset.set(0, 0)
        shared.repeat.set(1, 1)
        shared.rotation = 0
        shared.center.set(0, 0)
        shared.channel = 0
        shared.updateMatrix()
        canon.set(key, shared)
      }
      record[slot] = shared
      merged++
    }
    e.material.needsUpdate = true
  }
  return { merged, kept: entries.length - ok.size }
}

const IDENTITY = 'identity'

/** 材質の欄の UV の向き。全部の欄が同じ UV の組と同じずらしなら、その印。違えば null */
function transformKey(material: THREE.Material): string | null {
  const slots = textureSlots(material)
  if (slots.length === 0) return null
  let key: string | null = null
  for (const [, texture] of slots) {
    texture.updateMatrix()
    const k = `${texture.channel}:${texture.matrix.elements.map((v) => v.toPrecision(9)).join(',')}`
    if (key === null) key = k
    else if (key !== k) return null
  }
  const identity = `${slots[0][1].channel}:${new THREE.Matrix3().elements.map((v) => v.toPrecision(9)).join(',')}`
  return key === identity ? IDENTITY : key
}

function textureSlots(material: THREE.Material): [string, THREE.Texture][] {
  return Object.entries(material).filter(
    (entry): entry is [string, THREE.Texture] => (entry[1] as THREE.Texture | null)?.isTexture === true,
  )
}

/** 同じ GPU の絵として共有してよいか。画像と、サンプルのしかたが同じなら同じ */
function settingsKey(t: THREE.Texture): string {
  return [
    t.source.uuid, t.colorSpace, t.wrapS, t.wrapT, t.flipY, t.magFilter, t.minFilter, t.anisotropy,
    t.generateMipmaps, t.premultiplyAlpha, t.format, t.type,
  ].join('|')
}

function uvName(channel: number): string {
  return channel === 0 ? 'uv' : `uv${channel}`
}

/** UV にずらしを掛けて、浮動小数で持ち直す (詰めた整数の UV もここで戻る)。from の組を読んで to へ書く */
function bakeUv(geometry: THREE.BufferGeometry, from: string, to: string, matrix: THREE.Matrix3): void {
  const uv = geometry.getAttribute(from)
  if (!uv) return
  const e = matrix.elements
  const out = new Float32Array(uv.count * 2)
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    out[i * 2] = e[0] * u + e[3] * v + e[6]
    out[i * 2 + 1] = e[1] * u + e[4] * v + e[7]
  }
  geometry.setAttribute(to, new THREE.BufferAttribute(out, 2))
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * 画像の絵を 1 回だけ読んで使い回す。**同じ URL・同じ色の扱いなら同じ Texture を返す。**
 *
 * 地面と、コンクリートの箱が同じ ground_*.jpg を別々に読んで、GPU に 2 枚ずつ載っていた。
 * 繰り返しの回数 (repeat) は Texture に持たせない — 共有できなくなるので、使う側が UV で持つ。
 */
const loaded = new Map<string, Promise<THREE.Texture>>()

export function loadSharedTexture(url: string, srgb: boolean, anisotropy: number): Promise<THREE.Texture> {
  const key = `${url}|${srgb}|${anisotropy}`
  let pending = loaded.get(key)
  if (!pending) {
    pending = new THREE.TextureLoader().loadAsync(url).then((texture) => {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.anisotropy = anisotropy
      if (srgb) texture.colorSpace = THREE.SRGBColorSpace
      return texture
    })
    // 失敗を覚えない。次に呼ばれたら読み直す
    pending.catch(() => loaded.delete(key))
    loaded.set(key, pending)
  }
  return pending
}
