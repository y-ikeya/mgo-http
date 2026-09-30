import * as THREE from 'three'
import type { StageFx } from '../world/stage'

/**
 * ステージに置いた煙 (残骸からくすぶる煙など)。
 *
 * Blender の `fx_smoke_◯◯` (Empty) が stage.json に落ち、その場所から煙を出し続ける。
 * 爆発の煙 (blastfx.ts) と同じく無灯の Sprite で、日向でも日陰でも同じ濃さで浮く。
 * 1 か所 24 枚を使い回す: 湧いて、風に流されながら上がり、広がって、薄れて消える。
 * 見た目だけで、当たりも音も無い。
 */
const SPRITES_PER_SOURCE = 24
/** 1 枚の寿命 (秒)。湧く間隔は寿命 / 枚数 */
const SPAN = 5.5
const RISE = 0.9
const WIND = new THREE.Vector3(0.45, 0, 0.25)
const START_SIZE = 0.9
const END_SIZE = 3.4
const OPACITY = 0.55

let sharedTexture: THREE.Texture | null = null

/** 柔らかい煙の玉。絵を持ち込まず、その場で描く */
function smokeTexture(): THREE.Texture {
  if (sharedTexture) return sharedTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // 中心の濃い玉を少しずらして何個か重ねると、丸に見えない
  for (const [cx, cy, r, a] of [
    [0.5, 0.5, 0.5, 1.0],
    [0.36, 0.42, 0.34, 0.8],
    [0.62, 0.38, 0.3, 0.7],
    [0.52, 0.64, 0.32, 0.75],
  ] as const) {
    const gradient = ctx.createRadialGradient(cx * size, cy * size, 0, cx * size, cy * size, r * size)
    gradient.addColorStop(0, `rgba(255,255,255,${a})`)
    gradient.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`)
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  sharedTexture = new THREE.CanvasTexture(canvas)
  sharedTexture.colorSpace = THREE.SRGBColorSpace
  return sharedTexture
}

interface Puff {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  origin: THREE.Vector3
  size: number
  /** 経過 (秒)。負なら湧く前 */
  life: number
  drift: THREE.Vector3
  spin: number
}

export class StageSmoke {
  private readonly group = new THREE.Group()
  private readonly puffs: Puff[] = []
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene, sources: readonly StageFx[]) {
    this.scene = scene
    const texture = smokeTexture()
    for (const source of sources) {
      const origin = new THREE.Vector3(source.x, source.y, source.z)
      for (let i = 0; i < SPRITES_PER_SOURCE; i++) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          color: new THREE.Color(0.22, 0.21, 0.2),
        })
        const sprite = new THREE.Sprite(material)
        sprite.visible = false
        // 手前の物に隠れてほしいので深さは比べる (depthTest は既定で有効)
        this.group.add(sprite)
        this.puffs.push({
          sprite,
          material,
          origin,
          size: source.size,
          // 最初から途中まで進んだ煙が並ぶように、湧く時刻をばらす
          life: -(SPAN * i) / SPRITES_PER_SOURCE,
          drift: new THREE.Vector3(),
          spin: 0,
        })
      }
    }
    scene.add(this.group)
  }

  private spawn(puff: Puff): void {
    const r = puff.size * 0.35
    puff.sprite.position.copy(puff.origin).add(new THREE.Vector3((Math.random() - 0.5) * r, Math.random() * 0.2, (Math.random() - 0.5) * r))
    puff.drift.set((Math.random() - 0.5) * 0.35, RISE * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 0.35)
    puff.material.rotation = Math.random() * Math.PI * 2
    puff.spin = (Math.random() - 0.5) * 0.6
    puff.sprite.visible = true
  }

  update(dt: number): void {
    for (const puff of this.puffs) {
      const before = puff.life
      puff.life += dt
      if (before < 0 && puff.life >= 0) this.spawn(puff)
      if (puff.life < 0) continue
      if (puff.life >= SPAN) {
        puff.life -= SPAN
        this.spawn(puff)
      }
      const t = puff.life / SPAN
      // 上がるほど風に流され、速さは落ちる (立ち上る煙が横へ寝ていく)
      puff.sprite.position.addScaledVector(puff.drift, dt * (1 - t * 0.6))
      puff.sprite.position.addScaledVector(WIND, dt * t)
      const size = (START_SIZE + (END_SIZE - START_SIZE) * t) * puff.size
      puff.sprite.scale.set(size, size, 1)
      puff.material.rotation += puff.spin * dt
      // 立ち上がりで濃くなり、後半は薄れて消える
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85
      puff.material.opacity = OPACITY * fade
    }
  }

  dispose(): void {
    for (const puff of this.puffs) puff.material.dispose()
    this.scene.remove(this.group)
  }
}
