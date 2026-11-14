import type * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DEFAULT_SKIN } from './actor/skin'
import { shareGltfTextures } from './util/texshare'
import type { StageName } from '../../domain/stage'

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

const SMG_URL = asset.model('smg.glb')
const RIFLE_URL = asset.model('rifle.glb')
const SHOTGUN_URL = asset.model('shotgun.glb')
const SNIPER_URL = asset.model('sniper.glb')
const MOSIN_URL = asset.model('mosin.glb')
const M4_URL = asset.model('m4.glb')
const M1911_URL = asset.model('m1911.glb')
const PISTOL_URL = asset.model('m9.glb')
const CASING_URL = asset.model('casing_rifle.glb')
const KNIFE_URL = asset.model('knife.glb')
const CLAYMORE_URL = asset.model('claymore.glb')
const GRENADE_URL = asset.model('grenade.glb')
const LOCATOR_URL = asset.model('locator.glb')
const TARGET_URL = asset.model('target.glb')
const DOLL_URL = asset.model('doll.glb')

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

/**
 * KTX2 の絵 (KHR_texture_basisu) を読む。**GPU が圧縮のまま持てる形に、読む時に変える。**
 *
 * WebP / JPEG は GPU に載せる時に 1 画素 4 バイトへ展開される (city で 422MB)。KTX2 は
 * BC7 / ASTC / ETC2 など、その GPU が読める圧縮の形へ変えて載せるので 4〜8 分の 1 で済む。
 * 変換器 (public/basis/) は three の examples/jsm/libs/basis/ の写し。three を上げたら写し直す。
 *
 * どの形が読めるかは描画器に訊くのが本来だが、描画器は試合・待合・試写でばらばらに
 * 作られ、glb は描画器より先に読み始める。WebGPU の描画器は**アダプタが持つ機能を全部
 * 要求して**デバイスを作る (three の WebGPUBackend) ので、アダプタに直接訊いて同じ答えになる。
 * WebGPU が無い時は何も読めない扱いにして、展開した RGBA に落とす (重いが必ず映る)。
 */
let ktx2: Promise<KTX2Loader> | null = null
function ktx2Loader(): Promise<KTX2Loader> {
  ktx2 ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    const loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
    loader.detectSupport({
      isWebGPURenderer: true,
      hasFeature: (name: string) => adapter?.features.has(name) ?? false,
    } as never)
    return loader
  })()
  return ktx2
}

function load(url: string): Promise<GLTF> {
  let pending = cache.get(url)
  if (!pending) {
    // ステージと兵士の glb は gltfpack で meshopt 圧縮している
    // (ステージは tools/export_stage.py、兵士は tools/convert_character.py)
    pending = ktx2Loader()
      .then((ktx) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx).loadAsync(url))
      .then((gltf) => {
        // 絵のずらしごとに複製されたテクスチャを 1 枚にまとめる (util/texshare.ts)。
        // WebGPU は複製ごとに GPU へ載せるので、city では同じ絵が 540MB ぶん重なっていた
        shareGltfTextures(gltf.scene)
        return gltf
      })
    cache.set(url, pending)
  }
  return pending
}

/**
 * 兵士のモデル。skin で差し替えられる (見た目の試作。src/presentation/scene/actor/skin.ts)。
 *
 * 種類ごとに Promise を分けて持つので、同じ物を 2 回解析しない。
 */
export function loadSoldier(skin: string = DEFAULT_SKIN): Promise<GLTF> {
  // 無い型の警告は体を組み立てる所で出す (actor/animation.ts の warnMissingClips)
  return load(asset.model(`${skin}.glb`))
}

export function loadSmg(): Promise<GLTF> {
  return load(SMG_URL)
}

export function loadRifle(): Promise<GLTF> {
  return load(RIFLE_URL)
}

export function loadShotgun(): Promise<GLTF> {
  return load(SHOTGUN_URL)
}

export function loadSniper(): Promise<GLTF> {
  return load(SNIPER_URL)
}

export function loadMosin(): Promise<GLTF> {
  return load(MOSIN_URL)
}

export function loadM4(): Promise<GLTF> {
  return load(M4_URL)
}

export function loadPistol(): Promise<GLTF> {
  return load(PISTOL_URL)
}

export function loadM1911(): Promise<GLTF> {
  return load(M1911_URL)
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

/** TSNE のターゲット (人形、tools/convert_target.py) */
export function loadTarget(): Promise<GLTF> {
  return load(TARGET_URL)
}

/** DOLL (猫の置物、tools/convert_target.py で縮めた物) */
export function loadDoll(): Promise<GLTF> {
  return load(DOLL_URL)
}

export function loadLocator(): Promise<GLTF> {
  return load(LOCATOR_URL)
}

/**
 * ステージ。**名前で引く。**
 *
 * 無ければコード側のブロックアウトを使うので、失敗しても構わない。
 * どれを読むかは部屋が決める (domain/match/room.ts の ROOMS)。
 */
export function loadStage(name: StageName): Promise<GLTF> {
  return load(asset.model(`stage_${name}.glb`))
}

/**
 * **試合の前に武器と道具を全部読む** (2026-11-03 本人「match 始まる前に asset を全部読む方針に」)。
 *
 * 武器は、その武器を持った人が初めて見えた所で読んでいた。試合の頭で相手が見えた瞬間に
 * 落として解いて、画面が止まった (本番のログ、2026-11-03)。武器は誰が何を持つか分からないので
 * 全部読む (合わせても小さい)。**体は全部は読まない** — 部屋に居る人の分だけ (Game.warmSkin、
 * 本人「そのマッチに参加している分だけ読めば良くない？」)。読んだ物は load の Promise に
 * 溜まるので、後で同じ物を頼めばすぐ返る
 *
 * 1 つ失敗しても他は読み続ける (読めなかった物は、今まで通り見えた時にもう一度頼む)
 */
export function preloadArms(): Promise<GLTF[]> {
  const loads = [
    loadSmg(),
    loadRifle(),
    loadShotgun(),
    loadSniper(),
    loadMosin(),
    loadM4(),
    loadPistol(),
    loadM1911(),
    loadCasing(),
    loadKnife(),
    loadClaymore(),
    loadGrenade(),
    loadTarget(),
    loadDoll(),
    loadLocator(),
  ]
  return Promise.all(loads.map((p) => p.catch(() => null))).then((all) => all.filter((g): g is GLTF => g !== null))
}
