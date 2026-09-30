import * as THREE from 'three'
import type { StageFx } from '../world/stage'

/**
 * ステージに置いた火花 (切れかけの電線の継ぎ目など)。
 *
 * Blender の `fx_spark_◯◯` (Empty) の場所から、時々ぱっと火花が散る。
 * 数秒に 1 度、小さな明るい粒を 10〜20 個吹き出し、重力で落ちながら 0.4〜0.9 秒で消える。
 * 粒は加算の Sprite で、露出に左右されず (toneMapped: false) 日向でも光って見える。
 * 散った瞬間だけ、その場に丸い光 (glow) を一瞬置いて明滅を作る。見た目だけで当たりも音も無い。
 */
const PARTICLES_PER_SOURCE = 20
const GRAVITY = 9.8
const BURST_MIN = 1.8
const BURST_MAX = 6.0
const PARTICLE_SIZE = 0.09
const GLOW_SIZE = 1.6
const GLOW_SPAN = 0.12

let sharedTexture: THREE.Texture | null = null

function sparkTexture(): THREE.Texture {
  if (sharedTexture) return sharedTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.3, 'rgba(255,240,200,0.9)')
  gradient.addColorStop(1, 'rgba(255,200,120,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  sharedTexture = new THREE.CanvasTexture(canvas)
  sharedTexture.colorSpace = THREE.SRGBColorSpace
  return sharedTexture
}

interface Particle {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  velocity: THREE.Vector3
  life: number
  span: number
}

interface Source {
  origin: THREE.Vector3
  size: number
  /** 次の火花までの秒数 */
  wait: number
  particles: Particle[]
  glow: THREE.Sprite
  glowMaterial: THREE.SpriteMaterial
  glowLife: number
}

export class StageSparks {
  private readonly group = new THREE.Group()
  private readonly sources: Source[] = []
  private readonly scene: THREE.Scene
  private readonly onBurst: ((origin: THREE.Vector3) => void) | undefined

  /** onBurst: 散った瞬間に呼ぶ (音を鳴らす側へ) */
  constructor(scene: THREE.Scene, points: readonly StageFx[], onBurst?: (origin: THREE.Vector3) => void) {
    this.scene = scene
    this.onBurst = onBurst
    const texture = sparkTexture()
    for (const point of points) {
      const particles: Particle[] = []
      for (let i = 0; i < PARTICLES_PER_SOURCE; i++) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          color: new THREE.Color(2.2, 1.7, 1.0),
        })
        const sprite = new THREE.Sprite(material)
        sprite.visible = false
        this.group.add(sprite)
        particles.push({ sprite, material, velocity: new THREE.Vector3(), life: 0, span: 0 })
      }
      const glowMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        color: new THREE.Color(1.6, 1.3, 0.8),
      })
      const glow = new THREE.Sprite(glowMaterial)
      glow.visible = false
      glow.position.set(point.x, point.y, point.z)
      glow.scale.set(GLOW_SIZE * point.size, GLOW_SIZE * point.size, 1)
      this.group.add(glow)
      this.sources.push({
        origin: new THREE.Vector3(point.x, point.y, point.z),
        size: point.size,
        wait: Math.random() * BURST_MAX,
        particles,
        glow,
        glowMaterial,
        glowLife: 0,
      })
    }
    scene.add(this.group)
  }

  private burst(source: Source): void {
    // 全部は使わない。少ない火花もある方が、切れかけの線らしい
    const count = 6 + Math.floor(Math.random() * (PARTICLES_PER_SOURCE - 6))
    let used = 0
    for (const particle of source.particles) {
      if (used >= count) break
      if (particle.life > 0 && particle.life < particle.span) continue
      used++
      const angle = Math.random() * Math.PI * 2
      const spread = 0.8 + Math.random() * 2.2
      particle.velocity.set(Math.cos(angle) * spread, -0.5 + Math.random() * 2.0, Math.sin(angle) * spread)
      particle.sprite.position.copy(source.origin)
      particle.life = 0.0001
      particle.span = 0.4 + Math.random() * 0.5
      particle.sprite.visible = true
    }
    source.glowLife = 0.0001
    source.glow.visible = true
    this.onBurst?.(source.origin)
  }

  update(dt: number): void {
    for (const source of this.sources) {
      source.wait -= dt
      if (source.wait <= 0) {
        this.burst(source)
        // 続けて 2 回散ることもある (バチッ、バチッ)
        source.wait = Math.random() < 0.3 ? 0.15 + Math.random() * 0.2 : BURST_MIN + Math.random() * (BURST_MAX - BURST_MIN)
      }
      if (source.glowLife > 0) {
        source.glowLife += dt
        const t = source.glowLife / GLOW_SPAN
        if (t >= 1) {
          source.glowLife = 0
          source.glow.visible = false
        } else {
          source.glowMaterial.opacity = 0.9 * (1 - t)
        }
      }
      for (const particle of source.particles) {
        if (particle.life <= 0) continue
        particle.life += dt
        if (particle.life >= particle.span) {
          particle.life = 0
          particle.sprite.visible = false
          continue
        }
        particle.velocity.y -= GRAVITY * dt
        particle.sprite.position.addScaledVector(particle.velocity, dt)
        const t = particle.life / particle.span
        // 尾を引かず、粒が小さくなって消える
        const size = PARTICLE_SIZE * source.size * (1 - t * 0.6)
        particle.sprite.scale.set(size, size, 1)
        particle.material.opacity = 1 - t * t
      }
    }
  }

  dispose(): void {
    for (const source of this.sources) {
      for (const particle of source.particles) particle.material.dispose()
      source.glowMaterial.dispose()
    }
    this.scene.remove(this.group)
  }
}
