import * as THREE from 'three'

/** トレーサーの表示時間 (秒)。弾道を目で追える最低限だけ残す */
const TRACER_LIFE = 0.05
/** 着弾痕の表示時間 (秒) */
const IMPACT_LIFE = 2.5
/** それぞれのプール数。使い切ったら古いものから再利用する */
const POOL_SIZE = 24
/** 着弾痕の半径 (m) */
const IMPACT_RADIUS = 0.07


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


  constructor(scene: THREE.Scene) {
    scene.add(this.group)


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

    update(dt: number): void {
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
