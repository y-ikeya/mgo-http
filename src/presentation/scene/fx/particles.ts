import * as THREE from 'three'
import { SpriteNodeMaterial, type Node } from 'three/webgpu'
import { materialColor, materialReference, texture, uv, vec2, vec4 } from 'three/tsl'

import { asset } from '../assets'

/**
 * 粒の絵 (public/textures/particles.png)。**1 枚を全部の粒で使う。**
 *
 * 4×4 の格子に煙・土埃・火・閃光のコマが並んでいて、爆発 (blastfx.ts) と撃った跡の煙
 * (shots.ts) が粒ごとにどれかのコマを出す。
 *
 * 以前はコマを Texture の offset で選ぶために、粒ごとに読み込んでいた (爆発 25 + 煙 48)。
 * WebGPU は Texture の物ごとに GPU へ載せるので、同じ 1.3MB の絵が 73 枚 (約 95MB) 並んでいた
 * (2026-10-19)。**コマは材質の値 (particleCell) で選び、絵は共有する。**
 *
 * --- なぜ材質の値か ---
 * コマのずらしを粒ごとの node (uniform) で持つと、node ごとに別のシェーダーとして組まれる
 * (three は node の id で組み分ける)。初めての爆発で 25 本組み直して止まる。材質の値を読む
 * node (materialReference) は 1 つを全部の粒で共有できるので、組むのは 1 本で済む
 * (three の materialColor と同じ作り)。
 *
 * --- なぜ 1 枚で読むか ---
 * 粒ごとに複製すると、画像が届いた瞬間に複製の数だけ作り直しが走る。three r185 の WebGPU では
 * それが提出中のバッファの破棄になって、以後ずっと描画が崩れた (箱の影が出ず、人の影が
 * 置き去りになる)。1 枚なら届いた時に作り直すのも 1 枚。
 *
 * 絵は Game の寿命より長く持つ (捨てない)。1 枚なので、作り直すより持っている方が安い。
 */
const COLS = 4
const ROWS = 4

let shared: THREE.Texture | null = null
const waiting: (() => void)[] = []
let ready = false

/** 粒の絵。初めて呼んだ時に読み始める。届いたら onLoad を呼ぶ (届いていれば次の機会に呼ぶ) */
export function particleTexture(onLoad?: () => void): THREE.Texture {
  if (!shared) {
    shared = new THREE.TextureLoader().load(
      asset.texture('particles.png'),
      () => {
        ready = true
        for (const done of waiting.splice(0)) done()
      },
      undefined,
      (error) => console.warn('[粒] particles.png が読めない', error),
    )
    shared.colorSpace = THREE.SRGBColorSpace
  }
  if (onLoad) {
    if (ready) queueMicrotask(onLoad)
    else waiting.push(onLoad)
  }
  return shared
}

/** 材質に持たせるコマの位置 (格子の左下の UV)。全部の粒が同じ node を読む */
const CELL = materialReference('particleCell', 'vec2') as unknown as Node<'vec2'>

let colorNode: Node<'vec4'> | null = null

/** 粒の色。絵のコマ × 材質の色 (SpriteMaterial の map × color と同じ) */
function particleColor(): Node<'vec4'> {
  if (!colorNode) {
    const cell = uv().mul(vec2(1 / COLS, 1 / ROWS)).add(CELL)
    colorNode = texture(particleTexture(), cell).mul(vec4(materialColor, 1))
  }
  return colorNode
}

export type ParticleMaterial = SpriteNodeMaterial & { particleCell: THREE.Vector2 }

/**
 * 格子の col 列・row 行 (上から数える) を出す粒の材質。
 *
 * 色・濃さ・回転・トーンマップなどはふつうの SpriteMaterial と同じく値で渡す。
 */
export function particleMaterial(
  col: number,
  row: number,
  parameters: THREE.SpriteMaterialParameters = {},
): ParticleMaterial {
  // 値が undefined の欄は渡さない (three が欄ごとに警告を出す。閃光以外の粒は color を持たない)
  const given = Object.fromEntries(Object.entries(parameters).filter(([, v]) => v !== undefined))
  const material = new SpriteNodeMaterial(given) as ParticleMaterial
  // 行は上から数える。UV は下からなので反転する
  material.particleCell = new THREE.Vector2(col / COLS, 1 - (row + 1) / ROWS)
  material.colorNode = particleColor()
  return material
}
