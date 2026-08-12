import * as THREE from 'three'

/** トレーサーの表示時間 (秒)。弾道を目で追える最低限だけ残す */
const TRACER_LIFE = 0.05
/** 着弾痕の表示時間 (秒) */
const IMPACT_LIFE = 2.5
/** それぞれのプール数。使い切ったら古いものから再利用する */
const POOL_SIZE = 24
/** 着弾痕の半径 (m) */
const IMPACT_RADIUS = 0.07

/** 爆発の閃光が残る時間 (秒)。実際の爆風より短い — 目に残る印だけ */
const FLASH_LIFE = 0.55
/** 閃光が広がりきる半径 (m)。爆風の届く距離 (BLAST_RADIUS) に合わせてある */
const FLASH_RADIUS = 7

/**
 * 発砲の見た目 (トレーサー + 着弾痕) だけを担当する。
 *
 * ここにあるのは完全にクライアントローカルな演出で、ヒット判定そのものではない。
 * サーバー権威に移行したあとも、判定結果を受けてこのクラスを呼ぶ関係は変わらない。
 * 毎発 new すると GC が跳ねるので、固定数のプールを使い回す。
 */
export class Shots {
  private readonly group = new THREE.Group()

  private readonly tracers: THREE.Line[] = []
  private readonly tracerLife: number[] = []
  private tracerNext = 0

  private readonly impacts: THREE.Mesh[] = []
  private readonly impactLife: number[] = []
  private impactNext = 0

  private readonly impactGeometry = new THREE.CircleGeometry(IMPACT_RADIUS, 12)
  private readonly lookTarget = new THREE.Vector3()

  /**
   * 爆発の閃光。
   *
   * 1 つだけ持ち回す。同時に 2 発爆ぜることはまず無いし、あっても
   * 音と体力の変化で伝わる。見た目のために数を持つ理由が無い。
   */
  private readonly flash: THREE.Mesh
  private readonly flashLight: THREE.PointLight
  private flashLife = 0

  constructor(scene: THREE.Scene) {
    scene.add(this.group)

    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffb055,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        // 露出に左右されない。爆発が明るく見えないと何が起きたか分からない
        toneMapped: false,
      }),
    )
    this.flash.visible = false
    this.group.add(this.flash)

    // 一瞬だけ周りを照らす。壁の裏に居ても閃光の反射で「近い」が分かる
    this.flashLight = new THREE.PointLight(0xffa040, 0, FLASH_RADIUS * 2.5)
    this.flashLight.visible = false
    this.group.add(this.flashLight)

    for (let i = 0; i < POOL_SIZE; i++) {
      // 2 頂点だけの線分。発砲のたびに座標を書き換える
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }),
      )
      // 銃口とカメラが近いので、深度でチラつかせないよう常に手前に描く
      line.frustumCulled = false
      line.visible = false
      this.group.add(line)
      this.tracers.push(line)
      this.tracerLife.push(0)

      const impact = new THREE.Mesh(
        this.impactGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffd9a0,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      impact.visible = false
      this.group.add(impact)
      this.impacts.push(impact)
      this.impactLife.push(0)
    }
  }

  /**
   * 1 発分の演出を出す。
   *
   * @param from 銃口位置 (見た目の始点)
   * @param to 着弾点
   * @param normal 着弾面の法線。null なら着弾痕を出さない (何にも当たらず飛び去った)
   */
  fire(
    from: THREE.Vector3,
    to: THREE.Vector3,
    normal: THREE.Vector3 | null,
    impactColor = 0xffd9a0,
  ): void {
    const line = this.tracers[this.tracerNext]
    const position = line.geometry.getAttribute('position') as THREE.BufferAttribute
    position.setXYZ(0, from.x, from.y, from.z)
    position.setXYZ(1, to.x, to.y, to.z)
    position.needsUpdate = true
    line.visible = true
    this.tracerLife[this.tracerNext] = TRACER_LIFE
    this.tracerNext = (this.tracerNext + 1) % POOL_SIZE

    if (!normal) return

    const impact = this.impacts[this.impactNext]
    ;(impact.material as THREE.MeshBasicMaterial).color.setHex(impactColor)
    // 面と完全に同一平面だと Z ファイティングするので法線方向へ僅かに浮かせる
    impact.position.copy(to).addScaledVector(normal, 0.01)
    impact.lookAt(this.lookTarget.copy(impact.position).add(normal))
    impact.visible = true
    this.impactLife[this.impactNext] = IMPACT_LIFE
    this.impactNext = (this.impactNext + 1) % POOL_SIZE
  }

  /** 爆発の閃光。ダメージはサーバーが決めるので、ここは見せるだけ */
  explode(at: THREE.Vector3): void {
    this.flash.position.copy(at)
    this.flash.scale.setScalar(0.6)
    this.flash.visible = true
    this.flashLight.position.copy(at)
    this.flashLight.visible = true
    this.flashLife = FLASH_LIFE
  }

  update(dt: number): void {
    if (this.flashLife > 0) {
      this.flashLife -= dt
      const left = Math.max(0, this.flashLife) / FLASH_LIFE
      if (left <= 0) {
        this.flash.visible = false
        this.flashLight.visible = false
      } else {
        // 広がりながら薄れる。最初の一瞬だけ濃く見えるよう二乗で落とす
        this.flash.scale.setScalar(0.6 + (1 - left) * FLASH_RADIUS)
        ;(this.flash.material as THREE.MeshBasicMaterial).opacity = left * left * 0.75
        this.flashLight.intensity = left * left * 60
      }
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.tracerLife[i] > 0) {
        this.tracerLife[i] -= dt
        const material = this.tracers[i].material as THREE.LineBasicMaterial
        if (this.tracerLife[i] <= 0) {
          this.tracers[i].visible = false
          material.opacity = 0
        } else {
          material.opacity = this.tracerLife[i] / TRACER_LIFE
        }
      }

      if (this.impactLife[i] > 0) {
        this.impactLife[i] -= dt
        const material = this.impacts[i].material as THREE.MeshBasicMaterial
        if (this.impactLife[i] <= 0) {
          this.impacts[i].visible = false
          material.opacity = 0
        } else {
          // 最後の 1/3 でだけ消えていく。それまでは痕として見えていてほしい
          material.opacity = Math.min(1, (this.impactLife[i] / IMPACT_LIFE) * 3)
        }
      }
    }
  }

  dispose(): void {
    this.flash.geometry.dispose()
    ;(this.flash.material as THREE.Material).dispose()
    for (const line of this.tracers) {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    for (const impact of this.impacts) {
      ;(impact.material as THREE.Material).dispose()
    }
    this.impactGeometry.dispose()
    this.group.removeFromParent()
  }
}
