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

/** 溜まり 1 枚の大きさ (m)。足元に残る本体 */
const BLOOD_POOL_SIZE = 0.16
/** 飛沫 1 粒の大きさ (m) */
const BLOOD_DROP_SIZE = 0.05

/**
 * 1 回削られるごとに置く枚数。**溜まりと飛沫を分ける。**
 *
 * 同じ物を 22 枚散らすと、重なっても「点描の柄」にしかならない。中心に
 * 不定形の溜まりを置き、その周りへ小さく鋭い飛沫を飛ばすと、**着弾の衝撃で
 * 弾けた**形になる。
 */
const BLOOD_POOLS = 2
const BLOOD_DROPS = 18

/** 粒を散らす広さ (m)。足元を中心に、この半径の中へ落とす */
const BLOOD_SPREAD = 0.35

/**
 * 粒の大きさのばらつき。**同じ大きさが並ぶと模様に見える。**
 *
 * 飛び散った物は大小が混ざる。全部同じだと点描のようになって、
 * 「誰かが削られた」ではなく「そういう柄」に読めてしまう。
 *
 * 小さいほうへ寄せる (2 乗で引く)。大粒がたまに混ざるくらいが飛沫らしい。
 */
const BLOOD_SCALE_MIN = 0.45
const BLOOD_SCALE_MAX = 1.9

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
const IMPACT_POOL = 256

/**
 * 血のプール数。**弾痕とは別に持つ。**
 *
 * 同じ輪を使い回していたら、撃ち合いが続くと**外した弾が血を押し出していた**。
 * 血は「ここで当たった」で、弾痕の「ここへ飛んだ」より重い。外した弾に
 * 消されるのはおかしい。
 *
 * 1 回の被弾で 20 枚使うので、これで 19 回ぶん残る。
 */
const BLOOD_POOL = 384
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

  /** 血。**弾痕とは別の輪** — 外した弾に押し出させない */
  private readonly bloods: THREE.Mesh[] = []
  private readonly bloodLife: number[] = []
  /** その 1 枚の濃さ。飛沫は溜まりより薄い */
  private readonly bloodAlpha: number[] = []
  private bloodNext = 0

  private readonly impactGeometry = new THREE.CircleGeometry(IMPACT_RADIUS, 12)
  /**
   * 血の粒。**四角に貼って、形はテクスチャで決める。**
   *
   * 円のメッシュだと**真円しか作れない**。真円が並ぶと「そういう柄」に見えて、
   * 液体に読めない。四角へ不定形のアルファを貼れば、形も濃淡も絵の側で決まる。
   */
  /**
   * 血は**四角に貼って、形はテクスチャで決める。**
   *
   * 円のメッシュだと真円しか作れない。真円が並ぶと「そういう柄」に見えて、
   * 液体に読めない。形も濃淡も絵の側に持たせれば、メッシュは四角 2 種類で済む。
   */
  private readonly poolGeometry = new THREE.PlaneGeometry(BLOOD_POOL_SIZE, BLOOD_POOL_SIZE)
  private readonly dropGeometry = new THREE.PlaneGeometry(BLOOD_DROP_SIZE, BLOOD_DROP_SIZE)
  /** 型紙。**何枚か作って選ぶ** — 1 枚だと回しても同じ輪郭だと分かる */
  private readonly poolTextures = [splatTexture(128, true), splatTexture(128, true), splatTexture(128, true)]
  private readonly dropTextures = [
    splatTexture(64, false),
    splatTexture(64, false),
    splatTexture(64, false),
    splatTexture(64, false),
  ]
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

    // 血。**弾痕とは別の輪。** 色は 1 度決めれば変わらない
    for (let i = 0; i < BLOOD_POOL; i++) {
      const blood = new THREE.Mesh(
        this.dropGeometry,
        new THREE.MeshBasicMaterial({
          color: BLOOD_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      blood.visible = false
      this.group.add(blood)
      this.bloods.push(blood)
      this.bloodLife.push(0)
      this.bloodAlpha.push(1)
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
    // 溜まりを先に、飛沫を後に。重なったとき飛沫が上に来る
    this.splat(at, BLOOD_POOLS, this.poolGeometry, this.poolTextures, 0.18, 1)
    this.splat(at, BLOOD_DROPS, this.dropGeometry, this.dropTextures, BLOOD_SPREAD, 0.9)
  }

  /** 同じ足元へ、1 種類ぶんを撒く */
  private splat(
    at: THREE.Vector3,
    count: number,
    geometry: THREE.BufferGeometry,
    textures: THREE.Texture[],
    spread: number,
    alpha: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const impact = this.bloods[this.bloodNext]
      impact.geometry = geometry
      const material = impact.material as THREE.MeshBasicMaterial
      material.map = textures[Math.floor(Math.random() * textures.length)]
      material.needsUpdate = true

      /*
       * 足元を中心に散らす。**中心へ寄せる。**
       *
       * 半径を一様に引くと外周に偏る (面積は半径の 2 乗で増えるため)。
       * 2 乗すると中心が濃くなって、飛び散った形に見える。
       */
      const angle = Math.random() * Math.PI * 2
      const reach = Math.random() ** 2 * spread
      // 大きさもばらす。小さいほうへ寄せて、たまに大粒が混ざる
      impact.scale.setScalar(
        BLOOD_SCALE_MIN + Math.random() ** 2 * (BLOOD_SCALE_MAX - BLOOD_SCALE_MIN),
      )
      // 地面と同一平面だと Z ファイティングするので僅かに浮かせる。
      // 1 枚ごとに高さを変えて、重なった所も潰れないようにする
      impact.position.set(
        at.x + Math.cos(angle) * reach,
        at.y + 0.02 + (this.bloodNext % 32) * 0.0006,
        at.z + Math.sin(angle) * reach,
      )
      impact.lookAt(this.lookTarget.copy(impact.position).add(UP))
      // 面の中で回す。**同じ型紙でも向きが違えば別の形に見える**
      impact.rotateZ(Math.random() * Math.PI * 2)
      impact.visible = true
      this.bloodLife[this.bloodNext] = IMPACT_LIFE
      this.bloodAlpha[this.bloodNext] = alpha
      this.bloodNext = (this.bloodNext + 1) % BLOOD_POOL
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

    for (let i = 0; i < BLOOD_POOL; i++) {
      if (this.bloodLife[i] <= 0) continue
      this.bloodLife[i] -= dt
      const material = this.bloods[i].material as THREE.MeshBasicMaterial
      if (this.bloodLife[i] <= 0) {
        this.bloods[i].visible = false
        material.opacity = 0
        continue
      }
      material.opacity = Math.min(1, (this.bloodLife[i] / IMPACT_LIFE) * 3) * this.bloodAlpha[i]
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
    for (const blood of this.bloods) {
      ;(blood.material as THREE.Material).dispose()
    }
    // 形は共有しているので 1 回ずつ。型紙も同じ
    this.impactGeometry.dispose()
    this.poolGeometry.dispose()
    this.dropGeometry.dispose()
    for (const texture of [...this.poolTextures, ...this.dropTextures]) texture.dispose()
    this.group.removeFromParent()
  }
}


/**
 * 飛沫の型紙を 1 枚こしらえる。**起動時に数枚だけ。**
 *
 * --- なぜ絵にするか ---
 * 円のメッシュを並べると真円しか作れない。真円が揃うと「そういう柄」に見えて、
 * 液体に読めない。形と濃淡を絵に持たせれば、メッシュは四角のままで、
 * **回して大きさを変えるだけで別の形**になる。
 *
 * --- 縁を立てる ---
 * 最初は中心から端まで滑らかに薄くしていた。**水彩のにじみにしか見えなかった。**
 * 液体の縁は鋭い。中はほぼ不透明のままにして、外側の 15% だけで落とす。
 *
 * --- 尾を引かせる ---
 * 波を重ねただけだと花びらになる。何本かだけ外へ長く伸ばすと、**飛んできて
 * 着地した**形になる。
 *
 * 描くのは白だけ。色は材質の color が掛ける (BLOOD_COLOR) ので、これは
 * 形と濃さの型紙として働く。
 *
 * @param size 一辺の画素数
 * @param pool 溜まりか。false なら飛沫 (小さく、少し伸ばす)
 */
function splatTexture(size: number, pool: boolean): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()

  const centre = size / 2
  // 縁が切れて見えないよう余白を残す。尾が伸びるぶん溜まりは小さめに取る
  const base = size * (pool ? 0.28 : 0.3)

  const a = Math.random() * Math.PI * 2
  const b = Math.random() * Math.PI * 2
  const c = Math.random() * Math.PI * 2

  // 外へ伸びる尾。溜まりだけが持つ
  const spikes: { at: number; len: number; width: number }[] = []
  if (pool) {
    const count = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      spikes.push({
        at: Math.random() * Math.PI * 2,
        len: 0.35 + Math.random() * 0.75,
        width: 0.1 + Math.random() * 0.14,
      })
    }
  }

  const radiusAt = (angle: number): number => {
    let r = 1 + Math.sin(angle * 3 + a) * 0.16 + Math.sin(angle * 5 + b) * 0.11
    r += Math.sin(angle * 11 + c) * 0.05
    for (const spike of spikes) {
      // 角度の差を -π..π に畳んでから、尾の中心からの近さで持ち上げる
      let gap = Math.abs(((angle - spike.at + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      gap = Math.PI - gap
      if (gap < spike.width) r += spike.len * (1 - gap / spike.width) ** 2
    }
    return r
  }

  ctx.save()
  ctx.translate(centre, centre)
  ctx.rotate(Math.random() * Math.PI * 2)
  // 飛沫は飛んできた向きへ少し伸びる
  if (!pool) ctx.scale(1 + Math.random() * 0.9, 1)
  ctx.translate(-centre, -centre)

  const steps = pool ? 96 : 48
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const r = base * radiusAt(angle)
    const x = centre + Math.cos(angle) * r
    const y = centre + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()

  // **中はほぼ不透明のまま。** 端だけで落とす
  const fill = ctx.createRadialGradient(centre, centre, 0, centre, centre, base * 1.15)
  fill.addColorStop(0, 'rgba(255,255,255,1)')
  fill.addColorStop(pool ? 0.82 : 0.85, 'rgba(255,255,255,1)')
  fill.addColorStop(0.95, 'rgba(255,255,255,0.85)')
  fill.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}
