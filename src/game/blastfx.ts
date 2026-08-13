import * as THREE from 'three'

/**
 * 爆発の見た目。
 *
 * --- 板 1 枚では立体に見えない ---
 * カメラを向く板 (ビルボード) は、どこから見ても同じ絵になる。1 枚だけ出すと
 * 平たい紙が浮いているようにしか見えない。
 *
 * 立体感は板そのものではなく**板の散らばり方**から出る。小さめの粒を 3 次元に
 * ばらまき、1 つずつ大きさ・向き・膨らむ速さ・消える時刻をずらす。それぞれが
 * カメラを向いていても、配置が立体なので角度で見え方が変わる。
 *
 * さらに、板ではない物を混ぜる。地面に寝かせた土埃の輪と点光源は実体があるので、
 * どの角度から見ても正しい。ここが「絵を貼っただけ」との差になる。
 *
 * 粒の絵は Kenney の Smoke Particle pack (CC0)。tools で 4x4 の 1 枚にまとめてある。
 */

/** 粒の絵。4x4 の格子で、行ごとに種類が変わる */
const COLS = 4
const ROWS = 4
/** 行の意味。アトラスを作り直すときはこの順を守る */
const ROW_SMOKE = 0
const ROW_DUST = 1
const ROW_FIRE = 2
const ROW_FLASH = 3

/** 爆風の届く距離 (m)。sim/blast.ts の BLAST_RADIUS と揃える */
const RADIUS = 7

interface Puff {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  /** 速度 (m/s) */
  velocity: THREE.Vector3
  /** 残り時間 (秒) と、その初期値 */
  life: number
  span: number
  /** 大きさ (m)。始まりと終わり */
  from: number
  to: number
  /** 一番濃いときの不透明度 */
  peak: number
  /** 立ち上がるまでの遅れ (秒)。全部が同時に出ると 1 枚に見える */
  delay: number
}

/** 種類ごとの数と振る舞い */
const RECIPE = [
  // 閃光。爆心に一瞬だけ、大きく
  { row: ROW_FLASH, count: 2, span: 0.22, from: 1.2, to: 5.5, peak: 1, spread: 0.3, rise: 0, delay: 0 },
  // 炎の核。すぐ縮んで煙に呑まれる
  { row: ROW_FIRE, count: 5, span: 0.5, from: 1.4, to: 4.2, peak: 0.95, spread: 1.4, rise: 1.6, delay: 0.04 },
  // 黒煙。膨らみながら上がって薄れる。一番長く残る
  { row: ROW_SMOKE, count: 10, span: 2.4, from: 1.8, to: 7, peak: 0.5, spread: 2.6, rise: 2.4, delay: 0.18 },
  // 土埃。地面に沿って外へ。爆風の半径まで広がる
  { row: ROW_DUST, count: 8, span: 1.6, from: 1.2, to: 5, peak: 0.42, spread: 3.4, rise: 0.5, delay: 0.1 },
] as const

/** 地面の輪が広がりきるまで (秒) */
const RING_SPAN = 0.55

export class BlastFx {
  private readonly group = new THREE.Group()
  private readonly puffs: Puff[] = []
  private readonly ring: THREE.Mesh
  private readonly ringMaterial: THREE.MeshBasicMaterial
  private ringLife = 0
  private readonly light: THREE.PointLight
  private lightLife = 0
  private readonly at = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    scene.add(this.group)

    const atlas = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}textures/particles.png`,
      undefined,
      undefined,
      (error) => console.warn('[爆発] particles.png が読めない', error),
    )
    atlas.colorSpace = THREE.SRGBColorSpace

    // 粒ごとに別のマテリアルを持たせる。
    //
    // 濃さを 1 つずつ変えるので共有できない。格子のどのコマを出すかは
    // テクスチャの offset で決まるので、テクスチャも粒ごとに複製する
    // (画像は共有されるので、複製しても中身は増えない)。
    for (const kind of RECIPE) {
      for (let i = 0; i < kind.count; i++) {
        const texture = atlas.clone()
        texture.needsUpdate = true
        texture.repeat.set(1 / COLS, 1 / ROWS)
        // 行は上から数える。UV は下からなので反転する
        texture.offset.set((i % COLS) / COLS, 1 - (kind.row + 1) / ROWS)

        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          // 露出に左右されない。爆発が明るく見えないと何が起きたか分からない
          toneMapped: false,
        })
        const sprite = new THREE.Sprite(material)
        sprite.visible = false
        this.group.add(sprite)
        this.puffs.push({
          sprite,
          material,
          velocity: new THREE.Vector3(),
          life: 0,
          span: kind.span,
          from: kind.from,
          to: kind.to,
          peak: kind.peak,
          delay: 0,
        })
      }
    }

    // 地面に寝かせた輪。板ではないので、どの角度から見ても正しい
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8c4a4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 40), this.ringMaterial)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.visible = false
    this.group.add(this.ring)

    // 一瞬だけ周りを照らす。壁の裏に居ても反射で「近い」が分かる
    this.light = new THREE.PointLight(0xffa040, 0, RADIUS * 2.5)
    this.light.visible = false
    this.group.add(this.light)
  }

  /** 爆ぜる。ダメージはサーバーが決めるので、ここは見せるだけ */
  explode(at: THREE.Vector3): void {
    this.at.copy(at)

    let index = 0
    for (const kind of RECIPE) {
      for (let i = 0; i < kind.count; i++, index++) {
        const puff = this.puffs[index]
        // 球状にばらまく。土埃だけは地面に沿わせたいので上下を潰す
        const dir = randomDirection(kind.row === ROW_DUST ? 0.25 : 1)
        puff.sprite.position
          .copy(at)
          .addScaledVector(dir, kind.spread * 0.35 * Math.random())
        puff.velocity.copy(dir).multiplyScalar(kind.spread * (0.6 + Math.random() * 0.8))
        puff.velocity.y += kind.rise * (0.5 + Math.random())
        puff.span = kind.span * (0.8 + Math.random() * 0.4)
        puff.life = puff.span
        puff.delay = kind.delay * Math.random()
        puff.from = kind.from * (0.8 + Math.random() * 0.4)
        puff.to = kind.to * (0.8 + Math.random() * 0.4)
        puff.peak = kind.peak
        // 板ごとに回しておく。同じ向きで並ぶと 1 枚の絵に見える
        puff.material.rotation = Math.random() * Math.PI * 2
        puff.sprite.visible = true
        puff.material.opacity = 0
      }
    }

    this.ring.position.set(at.x, 0.03, at.z)
    this.ring.visible = true
    this.ringLife = RING_SPAN

    this.light.position.copy(at)
    this.light.visible = true
    this.lightLife = 0.45
  }

  update(dt: number): void {
    for (const puff of this.puffs) {
      if (!puff.sprite.visible) continue

      if (puff.delay > 0) {
        puff.delay -= dt
        continue
      }

      puff.life -= dt
      if (puff.life <= 0) {
        puff.sprite.visible = false
        puff.material.opacity = 0
        continue
      }

      // 進み具合 0..1
      const t = 1 - puff.life / puff.span
      puff.sprite.position.addScaledVector(puff.velocity, dt)
      // 空気に押されて止まっていく。等速で飛ぶと弾みたいに見える
      puff.velocity.multiplyScalar(Math.max(0, 1 - 2.2 * dt))

      const size = puff.from + (puff.to - puff.from) * easeOut(t)
      puff.sprite.scale.set(size, size, 1)
      // 出るのは速く、消えるのはゆっくり
      puff.material.opacity = puff.peak * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85)
    }

    if (this.ringLife > 0) {
      this.ringLife -= dt
      const left = Math.max(0, this.ringLife) / RING_SPAN
      if (left <= 0) this.ring.visible = false
      else {
        const size = RADIUS * (1 - left * left)
        this.ring.scale.setScalar(Math.max(0.01, size))
        this.ringMaterial.opacity = left * left * 0.55
      }
    }

    if (this.lightLife > 0) {
      this.lightLife -= dt
      const left = Math.max(0, this.lightLife) / 0.45
      if (left <= 0) this.light.visible = false
      else this.light.intensity = left * left * 70
    }
  }

  dispose(): void {
    for (const puff of this.puffs) {
      puff.material.map?.dispose()
      puff.material.dispose()
    }
    this.ring.geometry.dispose()
    this.ringMaterial.dispose()
    this.group.removeFromParent()
  }
}

/**
 * 向きを 1 つ引く。
 *
 * @param flatten 上下の潰し具合。1 で球、0 に近いほど地面に沿う
 */
function randomDirection(flatten: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2
  const height = (Math.random() * 2 - 1) * flatten
  const radius = Math.sqrt(Math.max(0, 1 - height * height))
  return new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
}

/** 最初が速く、あとが緩やかに。爆発は一気に広がってから緩む */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}
