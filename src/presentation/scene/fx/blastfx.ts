import * as THREE from 'three'

import { asset } from '../assets'

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
 * --- 板は光を受けない ---
 * SpriteMaterial は無灯なので、日向でも日陰でも同じ明るさで浮く。煙が**塗った
 * 綿**に見えていた理由はこれで、置いた場所の光と無関係な明るさをしていた。
 *
 * 面を持たない板に本当の陰影は付けられないので、**粒の散らばりで陰影を作る**。
 * 爆心から見て太陽の側へ飛んだ粒は明るく、反対側へ飛んだ粒は暗くする。
 * 1 粒ずつは平らでも、雲の**太陽側が明るく陰側が暗い**ので塊として読める。
 * 色は場の光 (太陽と空) から借りる。ここで決めない。
 *
 * --- 破片 ---
 * 煙と閃光だけだと「空中で光った」にしか見えない。**重さのある物が飛んで落ちる**
 * ことで爆発に実体が付く。手榴弾の殻の破片を放物線で飛ばして、床で跳ねて
 * 止まらせる。
 *
 * **床の物は飛ばさない。** 土を飛ばしていたが、筏の床は木で、ガレージは
 * コンクリート。床から出る物は床の材質で変わるので、材質ごとに絵を持たないと
 * 嘘になる。手榴弾の殻なら、どこで爆ぜても同じ物が飛ぶ。
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

/** 爆風の届く距離 (m)。domain/item/grenade.ts の BLAST_RADIUS と揃える */
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
  /** 光を受けるか。閃光と炎は自分で光るので受けない */
  lit: boolean
}

/** 破片 1 つ */
interface Debris {
  position: THREE.Vector3
  velocity: THREE.Vector3
  /** 回る軸と速さ (rad/s) */
  axis: THREE.Vector3
  spin: number
  angle: number
  /** 大きさ (m)。3 軸で違う (丸い玉ではなく欠片) */
  size: THREE.Vector3
  life: number
  /** 床に落ち着いたか。落ち着いたら回さない */
  resting: boolean
}

/**
 * 白より明るく描く倍率。**発光 (Game.ts の bloom) はこれが無いと効かない。**
 *
 * 画像の一番明るい所は白 = 1.0 で頭打ちなので、閾値 0.9 を越える分が 0.1 しか
 * 残らない。それを広くぼかすので、目で見て何も変わらない。**眩しさは「白」では
 * 出せない** — 白より明るい値が要る。
 *
 * 2 まで。3.5 まで上げると閃光の形が飛んで、ただの白い丸になる。
 *
 * 色は変えない (白のまま明るさだけ上げる)。色は Blender と画像の領分。
 */
const FLASH_GAIN = 2

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

/**
 * 煙の明るさ。**太陽側と陰側。** 絵の明るさに掛ける倍率。
 *
 * 陰側を 0 に近づけるほど立体には見えるが、暗い床の上では雲の半分が消える。
 * 0.35 で、日向の床の上でも陰が黒くならず、それでいて丸みが読める。
 */
const SHADE_LIT = 1.0
const SHADE_DARK = 0.35

/**
 * 陰側の暗さを、太陽の側と反対側のどこで切り替えるか。
 *
 * 内積 (-1..1) をそのまま使うと、真横の粒が中間の明るさになって境が
 * ぼやける。少し太陽側へ寄せると、陰が雲の半分より狭くなって光が
 * 「当たっている」ように見える。
 */
const SHADE_BIAS = 0.1

/** 太陽が見つからないときの向き。world/stage.ts の buildLights と同じ */
const DEFAULT_SUN = new THREE.Vector3(72, 120, 48).normalize()

/** 破片の数 */
const DEBRIS_COUNT = 24
/** 破片が飛び続けてから消えるまで (秒) */
const DEBRIS_SPAN = 1.6
/** 消える前に縮み始める (秒)。消えた瞬間が分からないように */
const DEBRIS_FADE = 0.4
/**
 * 破片の大きさ (m)。この幅で散らす。
 *
 * 殻の欠片なので小さい。実物は 1〜3cm だが、それだと 20m 先で点にもならない
 * (試写でそうなった)。2〜5cm。これより大きいと石や土に見える。
 */
const DEBRIS_MIN = 0.02
const DEBRIS_MAX = 0.05
/**
 * 飛び出す速さ (m/s) と、上へ持ち上げる分。
 *
 * 本物の破片は音速に近く、目に映らない。見せるための速さにしてあるが、
 * **煙より遠くへは飛ばさない。** 雲の外まで散ると紙吹雪に見える (実際そう
 * 見えた)。雲の中から出て、雲の縁の少し先で落ちる速さ。
 */
const DEBRIS_SPEED = 5
const DEBRIS_SPEED_SPREAD = 7
const DEBRIS_RISE = 3
/** 床に当たったときの跳ね返り。縦と横で別。金属なのでよく跳ねる */
const DEBRIS_BOUNCE = 0.4
const DEBRIS_FRICTION = 0.6
/** これより遅く床に当たれば跳ねずに止まる (m/s) */
const DEBRIS_REST_SPEED = 1.2
/** 重力 (m/s²)。弾道と同じ実値 */
const GRAVITY = 9.8
/**
 * 破片の材質。**手榴弾の殻**なので、床が何であっても同じ。
 *
 * 暗い金属。粗さを半分にして、太陽の下で欠片の面が光るようにしてある —
 * 小さい物が見えるのは、動きと**面の光り**のおかげ。
 */
const DEBRIS_COLOR = 0x2b2c2e
const DEBRIS_ROUGHNESS = 0.45
const DEBRIS_METALNESS = 0.8

export class BlastFx {
  private readonly group = new THREE.Group()
  private readonly puffs: Puff[] = []
  private readonly ring: THREE.Mesh
  private readonly ringMaterial: THREE.MeshBasicMaterial
  private ringLife = 0
  /** 今回の爆発の大きさ (1 = 手榴弾)。輪と光に掛ける */
  private size = 1
  private readonly light: THREE.PointLight
  private lightLife = 0
  private readonly at = new THREE.Vector3()
  private readonly scene: THREE.Scene
  private readonly debris: THREE.InstancedMesh
  private readonly clods: Debris[] = []
  /** 床の高さ (m)。爆ぜた所の高さ。破片はここで跳ねる */
  private floorY = 0
  /** 使い回す控え */
  private readonly matrix = new THREE.Matrix4()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly sunDirection = new THREE.Vector3()
  private readonly litColor = new THREE.Color()
  private readonly darkColor = new THREE.Color()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    scene.add(this.group)

    // 粒ごとに別のマテリアルを持たせる。
    //
    // 濃さを 1 つずつ変えるので共有できない。格子のどのコマを出すかは
    // テクスチャの offset で決まるので、テクスチャも粒ごとに複製する
    // (画像は共有されるので、複製しても中身は増えない)。
    //
    // **読み込む先を粒ごとに分ける。** 1 枚を読んで複製すると、複製した時点では
    // 画像がまだ無く、届いた瞬間に 25 個ぶんの作り直しが走る。three r185 の
    // WebGPU では、それが提出中のバッファの破棄になって以後ずっと描画が崩れる
    // (箱の影が出ず、人の影が置き去りになる)。同じ URL なので HTTP は 1 回で済む。
    const loader = new THREE.TextureLoader()
    for (const kind of RECIPE) {
      for (let i = 0; i < kind.count; i++) {
        const texture = loader.load(
          asset.texture('particles.png'),
          undefined,
          undefined,
          (error) => console.warn('[爆発] particles.png が読めない', error),
        )
        texture.colorSpace = THREE.SRGBColorSpace
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
          // 閃光だけ白より明るく。発光が拾えるのはここを越えた分だけ
          color:
            kind.row === ROW_FLASH
              ? new THREE.Color(FLASH_GAIN, FLASH_GAIN, FLASH_GAIN)
              : undefined,
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
          lit: kind.row === ROW_SMOKE || kind.row === ROW_DUST,
        })
      }
    }

    /*
     * 破片。**1 つの網で全部を描く** (InstancedMesh)。
     *
     * 形は 12 面体を 3 軸で別々に潰した物。同じ形でも潰し方と向きが違えば
     * 別の欠片に見える。影を落とす — 実体であることが、板との差になる。
     */
    this.debris = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({
        color: DEBRIS_COLOR,
        roughness: DEBRIS_ROUGHNESS,
        metalness: DEBRIS_METALNESS,
      }),
      DEBRIS_COUNT,
    )
    this.debris.castShadow = true
    this.debris.frustumCulled = false
    this.debris.visible = false
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.debris)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      this.clods.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        axis: new THREE.Vector3(0, 1, 0),
        spin: 0,
        angle: 0,
        size: new THREE.Vector3(),
        life: 0,
        resting: false,
      })
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

  /**
   * 場の光を読む。**太陽の向きと、太陽・空の色。**
   *
   * 毎回探す。光は場面に 1 組しか無く、爆発は秒に何度も起きない。
   * 見つからなければ既定の向きと白で済ませる (試写など、光を置かない場)。
   */
  private readLighting(): void {
    const sun = this.scene.getObjectByProperty('isDirectionalLight', true) as
      | THREE.DirectionalLight
      | undefined
    const sky = this.scene.getObjectByProperty('isHemisphereLight', true) as
      | THREE.HemisphereLight
      | undefined
    if (sun) {
      this.sunDirection.copy(sun.position).sub(sun.target.position).normalize()
      this.litColor.copy(sun.color)
    } else {
      this.sunDirection.copy(DEFAULT_SUN)
      this.litColor.setScalar(1)
    }
    // 陰は空の光だけが届く場所。空の色で暗くする
    if (sky) this.darkColor.copy(sky.color)
    else this.darkColor.setScalar(1)
  }

  /** 爆ぜる。ダメージはサーバーが決めるので、ここは見せるだけ */
  /**
   * 爆ぜる。ダメージはサーバーが決めるので、ここは見せるだけ。
   *
   * @param scale 大きさ (1 = 手榴弾)。E LOCATOR が寿命で弾けるときは 0.2 —
   *   雲も破片も輪も同じ比で縮め、破片の数もその分だけ減らす
   */
  explode(at: THREE.Vector3, scale = 1): void {
    this.at.copy(at)
    this.floorY = at.y
    this.size = scale
    this.readLighting()

    let index = 0
    for (const kind of RECIPE) {
      for (let i = 0; i < kind.count; i++, index++) {
        const puff = this.puffs[index]
        // 球状にばらまく。土埃だけは地面に沿わせたいので上下を潰す
        const dir = randomDirection(kind.row === ROW_DUST ? 0.25 : 1)
        if (puff.lit) {
          /*
           * 太陽の側へ飛ぶ粒ほど明るい。**飛ぶ向きで決めて、以後変えない。**
           *
           * 雲は膨らみながら形を保つので、飛び出した向きがそのまま雲の中の
           * 位置になる。毎フレーム測り直しても同じ答えになる。
           */
          const facing = THREE.MathUtils.clamp(
            dir.dot(this.sunDirection) * 0.5 + 0.5 + SHADE_BIAS,
            0,
            1,
          )
          const shade = SHADE_DARK + (SHADE_LIT - SHADE_DARK) * facing
          puff.material.color
            .copy(this.darkColor)
            .lerp(this.litColor, facing)
            .multiplyScalar(shade)
        }
        puff.sprite.position
          .copy(at)
          .addScaledVector(dir, kind.spread * scale * 0.35 * Math.random())
        puff.velocity.copy(dir).multiplyScalar(kind.spread * scale * (0.6 + Math.random() * 0.8))
        puff.velocity.y += kind.rise * scale * (0.5 + Math.random())
        // 小さい爆発は早く消える。大きさの平方根で縮める (0.3 → 0.55)
        puff.span = kind.span * Math.sqrt(scale) * (0.8 + Math.random() * 0.4)
        puff.life = puff.span
        puff.delay = kind.delay * Math.random()
        puff.from = kind.from * scale * (0.8 + Math.random() * 0.4)
        puff.to = kind.to * scale * (0.8 + Math.random() * 0.4)
        puff.peak = kind.peak
        // 板ごとに回しておく。同じ向きで並ぶと 1 枚の絵に見える
        puff.material.rotation = Math.random() * Math.PI * 2
        puff.sprite.visible = true
        puff.material.opacity = 0
      }
    }

    // 輪は爆ぜた高さに寝かせる。0 に置くと、台の上で爆ぜたとき床下に隠れる
    this.ring.position.set(at.x, at.y + 0.03, at.z)
    this.ring.visible = true
    this.ringLife = RING_SPAN

    for (const [i, clod] of this.clods.entries()) {
      // 小さい爆発は破片も少ない。余った分は出さない
      if (i >= Math.round(this.clods.length * scale)) {
        clod.life = 0
        continue
      }
      // 上半球に散らす。下へ飛んでもすぐ床に埋まる
      const dir = randomDirection(1)
      dir.y = Math.abs(dir.y)
      clod.position.copy(at).addScaledVector(dir, 0.2)
      clod.velocity
        .copy(dir)
        .multiplyScalar((DEBRIS_SPEED + Math.random() * DEBRIS_SPEED_SPREAD) * Math.sqrt(scale))
      clod.velocity.y += DEBRIS_RISE * Math.sqrt(scale) * Math.random()
      clod.axis.copy(randomDirection(1))
      clod.spin = (Math.random() * 2 - 1) * 24
      clod.angle = Math.random() * Math.PI * 2
      const base = DEBRIS_MIN + Math.random() * (DEBRIS_MAX - DEBRIS_MIN)
      // 殻の欠片。1 軸を薄く潰して板状にする
      clod.size.set(
        base * (0.7 + Math.random() * 0.8),
        base * (0.25 + Math.random() * 0.3),
        base * (0.7 + Math.random() * 0.8),
      )
      clod.life = DEBRIS_SPAN * (0.7 + Math.random() * 0.3)
      clod.resting = false
    }
    this.debris.visible = true
    this.placeDebris()

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
        const size = RADIUS * this.size * (1 - left * left)
        this.ring.scale.setScalar(Math.max(0.01, size))
        this.ringMaterial.opacity = left * left * 0.55
      }
    }

    if (this.lightLife > 0) {
      this.lightLife -= dt
      const left = Math.max(0, this.lightLife) / 0.45
      if (left <= 0) this.light.visible = false
      else this.light.intensity = left * left * 70 * this.size
    }

    if (this.debris.visible) {
      let alive = false
      for (const clod of this.clods) {
        if (clod.life <= 0) continue
        clod.life -= dt
        if (clod.life <= 0) continue
        alive = true
        if (clod.resting) continue

        clod.velocity.y -= GRAVITY * dt
        clod.position.addScaledVector(clod.velocity, dt)
        clod.angle += clod.spin * dt

        /*
         * 床に当たった。**床は爆ぜた高さの平面。**
         *
         * 地形は見ていない。破片は 1.6 秒で消える上に小さいので、段差の
         * 向こうへ飛んだ 1 つが空中で止まっていても目に付かない。
         */
        const bottom = this.floorY + clod.size.y * 0.5
        if (clod.position.y < bottom && clod.velocity.y < 0) {
          clod.position.y = bottom
          if (-clod.velocity.y < DEBRIS_REST_SPEED) {
            clod.velocity.set(0, 0, 0)
            clod.resting = true
          } else {
            clod.velocity.y = -clod.velocity.y * DEBRIS_BOUNCE
            clod.velocity.x *= DEBRIS_FRICTION
            clod.velocity.z *= DEBRIS_FRICTION
            clod.spin *= DEBRIS_FRICTION
          }
        }
      }
      if (alive) this.placeDebris()
      else this.debris.visible = false
    }
  }

  /** 破片の位置と向きを網へ書き込む */
  private placeDebris(): void {
    for (let i = 0; i < this.clods.length; i++) {
      const clod = this.clods[i]!
      // 消える前に縮める。消えた瞬間が分からないように
      const fade = Math.min(1, Math.max(0, clod.life) / DEBRIS_FADE)
      if (fade <= 0) {
        this.scale.setScalar(0)
      } else {
        this.scale.copy(clod.size).multiplyScalar(fade)
      }
      this.quaternion.setFromAxisAngle(clod.axis, clod.angle)
      this.matrix.compose(clod.position, this.quaternion, this.scale)
      this.debris.setMatrixAt(i, this.matrix)
    }
    this.debris.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    for (const puff of this.puffs) {
      puff.material.map?.dispose()
      puff.material.dispose()
    }
    this.ring.geometry.dispose()
    this.ringMaterial.dispose()
    this.debris.geometry.dispose()
    ;(this.debris.material as THREE.Material).dispose()
    this.debris.dispose()
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
