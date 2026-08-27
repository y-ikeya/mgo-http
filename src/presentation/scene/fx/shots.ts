import * as THREE from 'three'

/** トレーサーの表示時間 (秒)。弾道を目で追える最低限だけ残す */
const TRACER_LIFE = 0.05
/**
 * 地形に付いた弾痕が残る時間 (秒)。
 *
 * --- 消していた頃 ---
 * 2.5 秒で消していた。撃たれた直後に振り向いた時しか見えないので、
 * **見た目の演出でしかなかった**。
 *
 * 弾痕は索敵の材料になる。壁に残っていれば「ここで撃ち合いがあった」が読めるし、
 * 向きから撃った側の方角も読める。**このゲームの核は情報**なので、残す価値が
 * 演出より大きい。
 *
 * 試合の間ずっと残すほどではない。誰も居なくなった通路の痕がいつまでも残ると、
 * 「さっき誰か居た」が「いつか誰か居た」に薄まって読めなくなる。
 */
const IMPACT_LIFE = 30

/**
 * 血の色。**弾痕とは別の意味を持たせる。**
 *
 * 弾痕は「ここへ弾が飛んだ」だが、血は「**ここで人が削られた**」。撃ち合いが
 * あったことだけでなく、当たっていたことまで分かる。
 *
 * 鮮やかに取ってある。地面 (コンクリート) の上で暗い赤は錆や汚れに見えて、
 * **人の血だと読めない**。**目に留まること**が仕事なので、写実より読みやすさ。
 */
const BLOOD_COLOR = 0x8a0a10

/**
 * 血の粒 1 つの半径 (m)。**弾痕より小さい。**
 *
 * 1 枚の大きな円だと「塗った」ように見える。細かい粒をたくさん散らすと
 * 飛び散った形になって、**そこで何かが起きた**ことが伝わる。
 */
const BLOOD_RADIUS = 0.022

/** 1 回削られるごとに散らす粒の数 */
const BLOOD_DROPS = 22

/** 粒を散らす広さ (m)。足元を中心に、この半径の中へ落とす */
const BLOOD_SPREAD = 0.35

/** 地面へ向ける法線。血は必ず真上を向く */
const UP = new THREE.Vector3(0, 1, 0)

/** トレーサーのプール数。使い切ったら古いものから再利用する */
const POOL_SIZE = 24

/**
 * 弾痕のプール数。**30 秒ぶん溜まるので、線より遥かに多く要る。**
 *
 * 8 人が撃ち合えば 30 秒で数百発になる。全部は残せないので、溢れたら古い
 * ものから消える — **新しい痕のほうが情報として価値がある**ので、その順で
 * よい (古いのは既に読まれているか、もう関係ない)。
 */
const IMPACT_POOL = 640
/**
 * 着弾痕の半径 (m)。
 *
 * 弾が当たった一点を示すものなので、小さいほうが「そこ」に見える。
 * 大きいと壁の模様のようになって、どこに当たったのかが読めない。
 */
const IMPACT_RADIUS = 0.05


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
  private readonly bloodGeometry = new THREE.CircleGeometry(BLOOD_RADIUS, 16)
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
    }

    // 弾痕は別のプール。**30 秒残るので線より遥かに多く要る**
    for (let i = 0; i < IMPACT_POOL; i++) {
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
   * @param normal 着弾面の法線。**null なら痕を出さない** — 何にも当たらずに
 *   飛び去ったときと、**人に当たったとき**。人の痕はワールドに置くことに
 *   なるので、当たった相手が動いた後もその場に浮いてしまう
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
    // 血と同じプールを使い回すので、形を戻してから貼る
    impact.geometry = this.impactGeometry
    ;(impact.material as THREE.MeshBasicMaterial).color.setHex(impactColor)
    // 面と完全に同一平面だと Z ファイティングするので法線方向へ僅かに浮かせる
    impact.position.copy(to).addScaledVector(normal, 0.01)
    impact.lookAt(this.lookTarget.copy(impact.position).add(normal))
    impact.visible = true
    this.impactLife[this.impactNext] = IMPACT_LIFE
    this.impactNext = (this.impactNext + 1) % IMPACT_POOL
  }

  /**
   * 削られた人の足元に血を落とす。
   *
   * --- なぜ人ではなく地面か ---
   * 体に痕を残すには、骨で動く頂点に沿って貼り直すか専用のシェーダが要る。
   * 地面なら弾痕と同じ仕掛けがそのまま使える。
   *
   * --- 何が読めるようになるか ---
   * **削られた場所が残る。** 撃ち合いがあったこと (弾痕) に加えて、当たって
   * いたことまで分かる。走りながら削られれば点が続くので、**手負いの相手が
   * どちらへ逃げたか**も読める。
   *
   * @param at 足元の位置 (体の原点)
   */
  blood(at: THREE.Vector3): void {
    for (let i = 0; i < BLOOD_DROPS; i++) {
      const impact = this.impacts[this.impactNext]
      impact.geometry = this.bloodGeometry
      ;(impact.material as THREE.MeshBasicMaterial).color.setHex(BLOOD_COLOR)

      /*
       * 足元を中心に散らす。**中心へ寄せる。**
       *
       * 半径を一様に引くと外周に偏る (面積は半径の 2 乗で増えるため)。
       * 2 乗すると中心が濃くなって、飛び散った形に見える。
       */
      const angle = Math.random() * Math.PI * 2
      const reach = Math.random() ** 2 * BLOOD_SPREAD
      // 地面と同一平面だと Z ファイティングするので僅かに浮かせる。
      // 粒ごとに高さを変えて、重なった所も潰れないようにする
      impact.position.set(
        at.x + Math.cos(angle) * reach,
        at.y + 0.02 + i * 0.001,
        at.z + Math.sin(angle) * reach,
      )
      impact.lookAt(this.lookTarget.copy(impact.position).add(UP))
      impact.visible = true
      this.impactLife[this.impactNext] = IMPACT_LIFE
      this.impactNext = (this.impactNext + 1) % IMPACT_POOL
    }
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

    }

    for (let i = 0; i < IMPACT_POOL; i++) {
      if (this.impactLife[i] <= 0) continue
      this.impactLife[i] -= dt
      const material = this.impacts[i].material as THREE.MeshBasicMaterial
      if (this.impactLife[i] <= 0) {
        this.impacts[i].visible = false
        material.opacity = 0
        continue
      }
      // 最後の 1/3 でだけ消えていく。それまでは痕として見えていてほしい
      material.opacity = Math.min(1, (this.impactLife[i] / IMPACT_LIFE) * 3)
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
