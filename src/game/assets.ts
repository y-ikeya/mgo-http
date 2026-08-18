import type * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_SKIN } from './skin'

/**
 * モデルの読み込みを 1 回に集約する。
 *
 * 兵士のモデルは自機も他プレイヤーも同じものを使う。素直に各所で読むと
 * HTTP キャッシュは効いても glTF のパースが人数分走るので、Promise ごと共有する。
 * 実体は 1 つで、使う側が SkeletonUtils.clone で複製する。
 */

/**
 * public/ の下のどこに何が置いてあるか。
 *
 * **ここだけが知っている。** 以前は `${import.meta.env.BASE_URL}audio/...` のような
 * 組み立てが 7 か所に散っていて、置き場所を動かすときに全部を見つけて回る必要があった
 * (見つけ損ねても組み立ては通る — 404 になって初めて分かる)。
 *
 * BASE_URL は配置先で変わる (Pages のプレビューはサブパスに出る) ので、
 * 直書きの絶対パスにはできない。
 */
export const asset = {
  model: (file: string) => `${import.meta.env.BASE_URL}models/${file}`,
  audio: (file: string) => `${import.meta.env.BASE_URL}audio/${file}`,
  texture: (file: string) => `${import.meta.env.BASE_URL}textures/${file}`,
} as const

const RIFLE_URL = asset.model('rifle.glb')
const SNIPER_URL = asset.model('sniper.glb')
const PISTOL_URL = asset.model('pistol.glb')
const CASING_URL = asset.model('casing_rifle.glb')
const KNIFE_URL = asset.model('knife.glb')
const CLAYMORE_URL = asset.model('claymore.glb')
const GRENADE_URL = asset.model('grenade.glb')
const STAGE_URL = asset.model('stage.glb')

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

/**
 * 兵士のモデル。skin で差し替えられる (見た目の試作。src/game/skin.ts)。
 *
 * 種類ごとに Promise を分けて持つので、同じ物を 2 回解析しない。
 */
export function loadSoldier(skin: string = DEFAULT_SKIN): Promise<GLTF> {
  return load(asset.model(`${skin}.glb`))
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

/**
 * 薬莢。銃ごとに分けていない — 飛んで転がるだけの物なので、
 * 見分けが付く距離では既に消えている。
 */
export function loadCasing(): Promise<GLTF> {
  return load(CASING_URL)
}

export function loadKnife(): Promise<GLTF> {
  return load(KNIFE_URL)
}

export function loadClaymore(): Promise<GLTF> {
  return load(CLAYMORE_URL)
}

export function loadGrenade(): Promise<GLTF> {
  return load(GRENADE_URL)
}

/** ステージ。無ければコード側のブロックアウトを使うので、失敗しても構わない */
export function loadStage(): Promise<GLTF> {
  return load(STAGE_URL)
}
