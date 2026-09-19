import * as THREE from 'three'

/**
 * 気配。**AWARENESS で分かる「その辺に何かある」。**
 *
 * --- 霧であって、物ではない ---
 * 物を壁越しに描くのではなく、位置に**淡い霧**を置く。くっきり光らせると
 * クレイモアの向きまで読めて、隠して置く道具の仕事が消える。霧なら
 * 「そこに何かある」までしか分からない。
 *
 * --- 壁越し ---
 * 深さを読まない (depthTest: false) ので壁の裏でも見える。それが仕事。
 * 遠くの霧が手前の壁に**貼り付いて**見えないよう、大きさは距離で変えない
 * (Sprite なので世界の大きさのまま、遠いほど小さく映る)。
 *
 * --- 揺らぐ ---
 * 止まった霧は塗った丸に見える。ゆっくり脈打たせて、少し浮かせる。
 * 物の位置は変えない (中心は届いた点のまま)。
 */

/** 霧の一辺 (m)。物より十分大きく、「その辺」が読める程度 */
const FOG_SIZE = 3.2

/** 脈の幅 (割合) と速さ (rad/s) */
const PULSE = 0.12
const PULSE_SPEED = 1.6

/**
 * 霧の濃さ。
 *
 * 0.22 で始めたら、明るい床の上で薄すぎて読めなかった。気配は**見落とすと
 * 意味が無い**ので、重ねても白飛びしない範囲で濃くしてある。
 */
const FOG_OPACITY = 0.5

/** 中心を地面から浮かせる (m)。地面に沈むと半分が見えない */
const FOG_LIFT = 0.6

/** 霧の絵の一辺 (px)。滲みだけなので大きく要らない */
const FOG_PIXELS = 128

/**
 * 霧の絵。中心が濃く、外へ滲む。
 *
 * **色は付けない。** 白の滲みを加算で乗せるだけ。誰の物かは知らせない
 * (サーバーが送ってこない) ので、陣営色も無い。
 */
function fogTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = FOG_PIXELS
  canvas.height = FOG_PIXELS
  const ctx = canvas.getContext('2d')!
  const half = FOG_PIXELS / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
  // 核を強くしない。中心が点に見えると「そこに物がある」まで読めてしまう
  gradient.addColorStop(0, 'rgba(255,255,255,0.7)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, FOG_PIXELS, FOG_PIXELS)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface Fog {
  sprite: THREE.Sprite
  /** 脈の位相 (rad)。物ごとにずらす — 揃って脈打つと 1 つの物に見える */
  phase: number
}

export class Sensed {
  private readonly group = new THREE.Group()
  private readonly fogs = new Map<string, Fog>()
  private readonly material = new THREE.SpriteMaterial({
    map: fogTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: FOG_OPACITY,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // 露出に左右されない。情報なので、暗い所でも同じに読めてほしい
    toneMapped: false,
  })
  private time = 0

  constructor(scene: THREE.Scene) {
    // 何よりも後に描く。深さを読まないので、順番が前だと壁に塗り潰される
    this.group.renderOrder = 1000
    scene.add(this.group)
  }

  /** 気配が届いた。同じ札なら位置を移す (動く物) */
  show(key: string, at: readonly number[]): void {
    let fog = this.fogs.get(key)
    if (!fog) {
      const sprite = new THREE.Sprite(this.material)
      sprite.renderOrder = 1000
      sprite.frustumCulled = false
      this.group.add(sprite)
      fog = { sprite, phase: Math.random() * Math.PI * 2 }
      this.fogs.set(key, fog)
    }
    fog.sprite.position.set(at[0] ?? 0, (at[1] ?? 0) + FOG_LIFT, at[2] ?? 0)
  }

  hide(key: string): void {
    const fog = this.fogs.get(key)
    if (!fog) return
    fog.sprite.removeFromParent()
    this.fogs.delete(key)
  }

  update(dt: number): void {
    this.time += dt
    for (const fog of this.fogs.values()) {
      const size = FOG_SIZE * (1 + PULSE * Math.sin(this.time * PULSE_SPEED + fog.phase))
      fog.sprite.scale.set(size, size, 1)
    }
  }

  clear(): void {
    for (const key of [...this.fogs.keys()]) this.hide(key)
  }

  dispose(): void {
    this.clear()
    this.material.map?.dispose()
    this.material.dispose()
    this.group.removeFromParent()
  }
}
