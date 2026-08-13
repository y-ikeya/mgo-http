import type * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * モデルの読み込みを 1 回に集約する。
 *
 * 兵士のモデルは自機も他プレイヤーも同じものを使う。素直に各所で読むと
 * HTTP キャッシュは効いても glTF のパースが人数分走るので、Promise ごと共有する。
 * 実体は 1 つで、使う側が SkeletonUtils.clone で複製する。
 */

const SOLDIER_URL = `${import.meta.env.BASE_URL}models/soldier.glb`
const RIFLE_URL = `${import.meta.env.BASE_URL}models/rifle.glb`
const SNIPER_URL = `${import.meta.env.BASE_URL}models/sniper.glb`
const PISTOL_URL = `${import.meta.env.BASE_URL}models/pistol.glb`
const KNIFE_URL = `${import.meta.env.BASE_URL}models/knife.glb`
const GRENADE_URL = `${import.meta.env.BASE_URL}models/grenade.glb`
const STAGE_URL = `${import.meta.env.BASE_URL}models/stage.glb`

const cache = new Map<string, Promise<GLTF>>()

// モジュールの状態なので HMR を跨いで生き残る。モデルを差し替えたのに
// 古い解析結果が居座り続けるのを防ぐため、差し替え時に捨てる。
if (import.meta.hot) {
  import.meta.hot.dispose(() => cache.clear())
}

/** クリップから取り除く前のルートの動き */
export type RootMotionTrack = { times: Float32Array; values: Float32Array }

/**
 * 取り除く前のルートの動きの控え。
 *
 * ローリングだけはクリップに焼かれた移動をそのまま使うので、取り除く前の値が要る。
 * ところがクリップの実体は全員で共有していて、値を潰すのは最初に読んだ 1 人だけ。
 * 2 人目以降は潰れたあとを控えることになり、その場で回る。
 *
 * 控えの寿命を解析結果と揃えたいのでここに置く。モデルを読み直せばクリップも
 * 作り直され、この控えも一緒に消える。動く側 (animation.ts) に置くと、
 * そのファイルだけ差し替わったときに控えだけが消えて、同じ壊れ方をする。
 */
export const rootMotionStore = new WeakMap<THREE.AnimationClip, RootMotionTrack>()

function load(url: string): Promise<GLTF> {
  let pending = cache.get(url)
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url)
    cache.set(url, pending)
  }
  return pending
}

export function loadSoldier(): Promise<GLTF> {
  return load(SOLDIER_URL)
}

export function loadRifle(): Promise<GLTF> {
  return load(RIFLE_URL)
}

export function loadSniper(): Promise<GLTF> {
  return load(SNIPER_URL)
}

export function loadPistol(): Promise<GLTF> {
  return load(PISTOL_URL)
}

export function loadKnife(): Promise<GLTF> {
  return load(KNIFE_URL)
}

export function loadGrenade(): Promise<GLTF> {
  return load(GRENADE_URL)
}

/** ステージ。無ければコード側のブロックアウトを使うので、失敗しても構わない */
export function loadStage(): Promise<GLTF> {
  return load(STAGE_URL)
}
