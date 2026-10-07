import * as THREE from 'three'

/**
 * スタンナイフの放電。**刃先からバチバチと青白い火花が弾ける。**
 *
 * 眠らせる刺突 (構えて R2) を振った間だけ出す。殺す刺突と見分けが付くことが
 * 要点 — 目の前で青白く光れば、刺されたのが「眠らせる方」だと分かる。
 *
 * 1 回の放電は 0.7 秒。その間 0.05 秒ごとに小さな粒を散らし (重力で落ちる)、
 * 刃先の周りに折れ線の電弧を毎コマ引き直す (時々途切れてちらつく)。粒は
 * 加算の Sprite で露出に左右されない (toneMapped: false)。当たりは持たない。
 * 丸い光は置かない — 腕が青く塗り潰されて安っぽかった
 *
 * 出所は毎コマ聞き直す (anchor)。刃は腕と一緒に突き出されるので、
 * 振り始めの位置に置いたままだと腕から離れて宙に残る。
 */
const DURATION = 0.7
const BURST_EVERY = 0.05
const PER_BURST = 3
const POOL = 60
const PARTICLE_SIZE = 0.022
const PARTICLE_SPEED = 2.2
const GRAVITY = 6
const ARCS = 2
const ARC_POINTS = 6
const ARC_REACH = 0.3
/*
 * **控えめに。** 光らせすぎると安っぽい (本人 2026-10-08)。粒は少なく暗め、
 * 電弧は 2 本で時々途切れる
 */
/** 出し始めに見えない大きさで描くコマ数。初めて出す瞬間にシェーダーを組んで止まらないように */
const WARM_FRAMES = 3

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
  gradient.addColorStop(0.35, 'rgba(190,230,255,0.85)')
  gradient.addColorStop(1, 'rgba(120,180,255,0)')
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

/** いま放電している 1 本。出所を毎コマ聞き直す */
interface Discharge {
  anchor: (out: THREE.Vector3) => THREE.Vector3 | null
  left: number
  nextBurst: number
}

export class StunSparks {
  private readonly group = new THREE.Group()
  private readonly particles: Particle[] = []
  private readonly arcs: THREE.Line[] = []
  private readonly active: Discharge[] = []
  private readonly at = new THREE.Vector3()
  private nextParticle = 0
  private warmFrames = WARM_FRAMES

  constructor(scene: THREE.Scene) {
    scene.add(this.group)
    const texture = sparkTexture()
    for (let i = 0; i < POOL; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        color: new THREE.Color(1.0, 1.3, 1.8),
      })
      const sprite = new THREE.Sprite(material)
      sprite.scale.setScalar(PARTICLE_SIZE)
      sprite.frustumCulled = false
      this.group.add(sprite)
      this.particles.push({ sprite, material, velocity: new THREE.Vector3(), life: 0, span: 0 })
    }
    const arcMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(1.0, 1.35, 1.8),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    for (let i = 0; i < ARCS; i++) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3))
      const line = new THREE.Line(geometry, arcMaterial)
      line.frustumCulled = false
      this.group.add(line)
      this.arcs.push(line)
    }
  }

  /** 放電を始める。anchor は刃先 (無ければ手) のワールド座標を返す */
  discharge(anchor: (out: THREE.Vector3) => THREE.Vector3 | null): void {
    this.active.push({ anchor, left: DURATION, nextBurst: 0 })
  }

  update(dt: number): void {
    // 起動直後は見えない大きさで描かせるだけ (blastfx.ts と同じ下描き)
    if (this.warmFrames > 0) {
      this.warmFrames--
      const on = this.warmFrames > 0
      for (const p of this.particles) {
        p.sprite.visible = on
        p.sprite.scale.setScalar(on ? 0.001 : PARTICLE_SIZE)
      }
      for (const arc of this.arcs) arc.visible = on
      return
    }

    let anyArc = false
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i]!
      d.left -= dt
      if (d.left <= 0) {
        this.active.splice(i, 1)
        continue
      }
      const origin = d.anchor(this.at)
      if (!origin) continue
      d.nextBurst -= dt
      while (d.nextBurst <= 0) {
        d.nextBurst += BURST_EVERY
        for (let n = 0; n < PER_BURST; n++) this.emit(origin)
      }
      // 電弧は 1 本目の放電にだけ引く (重なっても見分けが付かない)
      if (!anyArc) {
        this.drawArcs(origin)
        anyArc = true
      }
    }
    for (const arc of this.arcs) arc.visible = anyArc && Math.random() > 0.45

    for (const p of this.particles) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) {
        p.sprite.visible = false
        continue
      }
      p.velocity.y -= GRAVITY * dt
      p.sprite.position.addScaledVector(p.velocity, dt)
      p.material.opacity = p.life / p.span
    }
  }

  private emit(origin: THREE.Vector3): void {
    const p = this.particles[this.nextParticle]!
    this.nextParticle = (this.nextParticle + 1) % this.particles.length
    p.sprite.position.copy(origin)
    p.velocity
      .set(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(PARTICLE_SPEED * (0.4 + Math.random() * 0.8))
    p.span = 0.15 + Math.random() * 0.25
    p.life = p.span
    p.material.opacity = 1
    p.sprite.visible = true
  }

  /** 刃先から外へ、折れ線の電弧を引き直す。毎コマ形が変わるのでバチバチに見える */
  private drawArcs(origin: THREE.Vector3): void {
    for (const arc of this.arcs) {
      const position = arc.geometry.getAttribute('position') as THREE.BufferAttribute
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      for (let i = 0; i < ARC_POINTS; i++) {
        const t = i / (ARC_POINTS - 1)
        const jitter = i === 0 ? 0 : 0.07
        position.setXYZ(
          i,
          origin.x + dir.x * ARC_REACH * t + (Math.random() - 0.5) * jitter,
          origin.y + dir.y * ARC_REACH * t + (Math.random() - 0.5) * jitter,
          origin.z + dir.z * ARC_REACH * t + (Math.random() - 0.5) * jitter,
        )
      }
      position.needsUpdate = true
    }
  }
}
