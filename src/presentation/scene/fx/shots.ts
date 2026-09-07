import * as THREE from 'three'
import { asset } from '../assets'
import type { Surface } from '../../../domain/stage'

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
 *
 * --- 1 枚ずつ色と濃さを変える ---
 * 全部が同じ色・同じ濃さだと、大きさを散らしても**版画のように平ら**に見える。
 * 本物は厚い所ほど暗く、薄く伸びた所ほど明るく、しかも触れた瞬間から酸化して
 * 褐色へ寄っていく。1 滴ずつばらすと、重なった所が自然に濃くなって**滲みに
 * 見える**。
 *
 * 新しい色と、酸化した色の間で 1 枚ずつ引く。
 */
const BLOOD_FRESH = 0x8a1418
/**
 * 酸化した色。**褐色寄り。**
 *
 * 鉄が錆びる方向。ここへ寄せすぎると土や錆と区別が付かなくなるので、
 * 赤みは残す — 読めなくなっては仕事にならない。
 */
const BLOOD_OXIDISED = 0x521010

/**
 * 濃さの幅。**薄いほうへ寄せる。**
 *
 * 濃い物ばかりだと塗り絵になる。薄い滴が多く、たまに濃い滴が混ざるほうが、
 * 重なった所だけが濃くなって深さが出る。
 */
const BLOOD_ALPHA_MIN = 0.32
const BLOOD_ALPHA_MAX = 1

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

/*
 * 煙。**銃口と着弾の両方で同じ物を使う。**
 *
 * 弾そのものは見えない (曳光は 1 フレームの線)。**撃った跡が残らない**ので、
 * 撃ったかどうかも当たったかどうかも音でしか分からなかった。
 *
 * 粒の絵は爆発と同じ 1 枚 (public/textures/particles.png)。行 0 が煙。
 */
const SMOKE_POOL = 48
/** 粒の絵の格子。blastfx.ts と同じ物を見ているので、割り方を変えたら両方直す */
const SMOKE_COLS = 4
const SMOKE_ROWS = 4
const SMOKE_ROW = 0

/** 銃口の煙。**短い。** 残ると連射で銃口が煙に埋まる */
const MUZZLE_LIFE = 0.22
const MUZZLE_SIZE = 0.18
const MUZZLE_GROW = 2.6
/** 銃口から前へ流れる速さ (m/s)。撃った方向へ薄く伸びる */
const MUZZLE_DRIFT = 1.4
/** 濃さ。**手元なので薄くてよい** — 濃いと自分の照準が煙で埋まる */
const MUZZLE_DENSE = 0.55

/*
 * 着弾の煙。**銃口より長く、大きい。** 当たった場所を目で追えるように。
 *
 * 撃ち合う間合い (5〜20m) で見えないと意味がない。小さく出して大きく広げる
 * より、**出た瞬間から読める大きさで出す**。広がりきる頃には薄くなっていて、
 * どのみち形は残らない。
 */
const IMPACT_SMOKE_LIFE = 0.5
const IMPACT_SMOKE_SIZE = 0.3
const IMPACT_SMOKE_GROW = 3.0
/** 面から立ち上がる速さ (m/s) */
const IMPACT_SMOKE_DRIFT = 0.9
/** 濃さ。**銃口より濃い** — 10m 先の 20cm を見せるのに薄い煙では足りない */
const IMPACT_SMOKE_DENSE = 0.95

/*
 * 火花。**金属に当たったときだけ。**
 *
 * 当たった物で見え方が変わらないと、**何に当たったかは音でしか分からない。**
 * 音は既に面で分けてある (hitMetal) ので、目のほうも揃える。
 *
 * 木や石は削れて粉が出る (煙)。金属は削れずに弾ける (火花)。
 */
const SPARK_POOL = 160
/** 1 発で散る数 */
const SPARK_BURST = 9
const SPARK_LIFE = 0.28
/** 弾ける速さ (m/s)。面の法線を中心に散らす */
const SPARK_SPEED = 4.5
/** どれだけ広がるか (0 = 法線どおり、1 = 半球いっぱい) */
const SPARK_SPREAD = 0.65
/** 落ちる速さ (m/s²)。短命なので効きは僅かだが、真っ直ぐ飛ぶと線香花火に見えない */
const SPARK_GRAVITY = 9.8
const SPARK_SIZE = 0.055

/**
 * 水しぶき。**弾や物が水面を叩いたときだけ。**
 *
 * 弾痕は残せない — 水面に穴は開かないし、痕を残すと堀が弾痕だらけになる。
 * その場限りの動きで「そこへ落ちた」を見せる。撃った場所が一瞬だけ見える
 * ので、外した弾がどこへ行ったかは分かる。
 *
 * --- 3 つ重ねる ---
 * 長らく**平らな輪が 1 枚**広がって消えるだけだった。輪は水面を上から見た
 * ときの形でしかなく、**上へ上がる水が無い**ので、水に落ちたというより
 * 白い図形が現れて消えるように見えていた。
 *
 * 実際に起きるのは 3 つで、時間の尺度がそれぞれ違う。
 *
 *   1. 水の柱 (〜0.4 秒)  叩かれた水が跳ね上がり、崩れて落ちる。**一番速い**
 *   2. しぶき (〜0.6 秒)  柱から飛び散る粒。落ちて水面に触れた所で消える
 *   3. 波紋   (〜1.2 秒)  遅れて 2 本、外へ広がる。**一番長く残る**
 *
 * 速い物ほど明るく、遅い物ほど薄い。まとめて 1 つの寿命にすると、輪が消える
 * まで柱が立ったままになるか、柱に合わせて輪が一瞬で消えるかのどちらかになる。
 */
const SPLASH_POOL = 48

/**
 * 水の色。**白ではない。**
 *
 * しぶきは泡なので確かに白いが、真っ白で塗ると紙に見える。空を映している
 * 水の中に置くので、**空側へ寄せた薄い青**にして、白さは不透明度で出す。
 */
const FOAM_COLOR = 0xd6e6f2
const DROP_COLOR = 0xdfecf6

/** 水の柱。立ち上がってから崩れるまで */
const COLUMN_LIFE = 0.38
/** 立ち上がり切った高さ (m) と、根元の太さ */
const COLUMN_HEIGHT = 0.42
const COLUMN_RADIUS = 0.1
/** 上ほど開く。杯の形にすると、崩れながら広がる水に見える */
const COLUMN_FLARE = 2.4
/** 開き方の曲がり。1 で円錐、大きいほど根元が締まって上で開く */
const COLUMN_CURVE = 1.9
/** 上端の消え方。大きいほど上のほうだけ薄くなる */
const COLUMN_FADE = 1.15
/** 形の分割。縦は輪郭の滑らかさ、横は円としての角の見えなさ */
const COLUMN_STEPS = 12
const COLUMN_SIDES = 16
/** 立ち上がりに使う割合。残りで崩れる。**上がるほうが速い** */
const COLUMN_RISE = 0.28

/** 根元の泡。柱の下の硬い縁を隠す */
const FOAM_LIFE = 0.5
const FOAM_RADIUS = 0.3

/**
 * 飛び散る粒。**小さいものを多く。**
 *
 * 大きい玉を 7 個にしていたが、1 粒ずつが読めてしまって水ではなく物が飛んで
 * いるように見えた。血 (1 回 20 枚) と同じで、**粒が細かく散らばっているほど
 * 液体に見える**。1 つ 1 つを追えない数にする。
 *
 * 描く負担は増えない — 1 つの塊にまとめてあるので、増えるのは姿勢の数だけ。
 */
const DROPS_PER_SPLASH = 18
const DROP_POOL = SPLASH_POOL * DROPS_PER_SPLASH
const DROP_RADIUS = 0.013
/** 粒ごとの大きさのばらつき (倍)。揃うと粒に見えない */
const DROP_SIZE_MIN = 0.55
const DROP_SIZE_MAX = 1.8
/** 上へ跳ねる速さと、外へ散る速さ (m/s) */
const DROP_RISE = 3.3
const DROP_SPREAD = 1.9
/**
 * 落ちる速さ。**実際より重くする。**
 *
 * 本物の重力で投げると、粒が 1 秒近く空に浮いたままになる。粒は水の一部で
 * あって放物線を見せる物ではないので、**さっと上がってすぐ戻る**ほうがいい。
 */
const DROP_GRAVITY = 11

/** 波紋。1 回あたり 2 本、遅らせて出す */
const RIPPLES_PER_SPLASH = 2
const RIPPLE_POOL = SPLASH_POOL * RIPPLES_PER_SPLASH
const RIPPLE_LIFE = 1.2
/** 広がり切ったときの半径 (m) */
const RIPPLE_RADIUS = 1.25
/** 2 本目が遅れて出るまで (秒) */
const RIPPLE_DELAY = 0.17

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
 * 水の柱の形。**高さ 1、底が原点。**
 *
 * 使い回すので 1 つだけ作る (48 本すべてが同じ形を指す)。大きさと寿命は
 * それぞれの姿勢で持つ。
 */
function buildColumnGeometry(): THREE.LatheGeometry {
  const profile: THREE.Vector2[] = []
  for (let i = 0; i <= COLUMN_STEPS; i++) {
    const t = i / COLUMN_STEPS
    // 上へ行くほど急に開く。直線だと円錐の輪郭が出る
    profile.push(new THREE.Vector2(COLUMN_RADIUS * (1 + COLUMN_FLARE * t ** COLUMN_CURVE), t))
  }
  const geometry = new THREE.LatheGeometry(profile, COLUMN_SIDES)

  /*
   * 上端を透かす。**縁を線にしない。**
   *
   * 濃さを頂点で持たせると、面の途中で滑らかに 0 へ落ちる。切り落とした縁が
   * 見えなくなるので、崩れた水が空気に散っているように見える。
   */
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 4)
  for (let v = 0; v < position.count; v++) {
    const t = position.getY(v)
    colors[v * 4] = 1
    colors[v * 4 + 1] = 1
    colors[v * 4 + 2] = 1
    colors[v * 4 + 3] = (1 - t) ** COLUMN_FADE
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return geometry
}

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
  /** 煙の粒。銃口と着弾で共用する */
  private readonly smoke: THREE.Sprite[] = []
  private readonly smokeLife: number[] = []
  private readonly smokeSpan: number[] = []
  private readonly smokeSize: number[] = []
  private readonly smokeGrow: number[] = []
  /** 出た瞬間の濃さ。銃口は薄く、着弾は濃く */
  private readonly smokeDense: number[] = []
  private readonly smokeVelocity: THREE.Vector3[] = []
  private smokeNext = 0
  /** 散らす向きの置き場。毎フレーム作らない */
  private readonly scatter = new THREE.Vector3()
  /** 銃口から着弾へ向かう向きの置き場 */
  private readonly muzzleDir = new THREE.Vector3()
  /** 火花。金属に当たったときだけ散る */
  private readonly sparks: THREE.Sprite[] = []
  private readonly sparkLife: number[] = []
  private readonly sparkVelocity: THREE.Vector3[] = []
  private sparkNext = 0
  /** 水の柱。1 回に 1 本 */
  private readonly columns: THREE.Mesh[] = []
  private readonly columnLife: number[] = []
  private readonly columnBase: number[] = []
  private readonly columnReach: number[] = []
  private columnNext = 0

  /** 根元の泡 */
  private readonly foams: THREE.Mesh[] = []
  private readonly foamLife: number[] = []
  private readonly foamReach: number[] = []
  private foamNext = 0

  /** 飛び散る粒。1 つの塊にまとめて描く (1 回 7 個 × 48 回) */
  private drops!: THREE.InstancedMesh
  private readonly dropLife = new Float32Array(DROP_POOL)
  private readonly dropAt = new Float32Array(DROP_POOL * 3)
  private readonly dropVelocity = new Float32Array(DROP_POOL * 3)
  private readonly dropFloor = new Float32Array(DROP_POOL)
  private readonly dropSize = new Float32Array(DROP_POOL)
  private dropNext = 0
  private readonly dropMatrix = new THREE.Matrix4()
  private readonly dropScale = new THREE.Vector3()

  /** 波紋。1 回に 2 本 */
  private readonly ripples: THREE.Mesh[] = []
  private readonly rippleLife: number[] = []
  private readonly rippleDelay: number[] = []
  private readonly rippleReach: number[] = []
  private rippleNext = 0
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
  /** 酸化した色。1 枚ずつ混ぜるので使い回しの入れ物として持つ */
  private readonly oxidised = new THREE.Color(BLOOD_OXIDISED)

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
        // 色は 1 枚ずつ差し替えるので、材質も 1 枚ずつ持つ
        new THREE.MeshBasicMaterial({
          color: BLOOD_FRESH,
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

    /*
     * 煙と火花。**弾が飛んだ跡と、当たった跡。**
     *
     * 粒の絵は爆発と同じ 1 枚を使い回す (blastfx.ts と同じ格子)。粒ごとに
     * テクスチャを複製するのは、格子のどのコマを出すかを offset で決めるため
     * (共有すると全部が同じコマになる)。画像は共有されるので中身は増えない。
     */
    const loader = new THREE.TextureLoader()
    for (let i = 0; i < SMOKE_POOL; i++) {
      const texture = loader.load(asset.texture('particles.png'))
      texture.colorSpace = THREE.SRGBColorSpace
      texture.repeat.set(1 / SMOKE_COLS, 1 / SMOKE_ROWS)
      texture.offset.set((i % SMOKE_COLS) / SMOKE_COLS, 1 - (SMOKE_ROW + 1) / SMOKE_ROWS)
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      )
      sprite.visible = false
      this.group.add(sprite)
      this.smoke.push(sprite)
      this.smokeLife.push(0)
      this.smokeSpan.push(1)
      this.smokeSize.push(1)
      this.smokeGrow.push(1)
      this.smokeDense.push(1)
      this.smokeVelocity.push(new THREE.Vector3())
    }

    for (let i = 0; i < SPARK_POOL; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: 0xffd08a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          // 露出に左右されない。**火花が明るく見えないと弾けて見えない**
          toneMapped: false,
        }),
      )
      sprite.visible = false
      this.group.add(sprite)
      this.sparks.push(sprite)
      this.sparkLife.push(0)
      this.sparkVelocity.push(new THREE.Vector3())
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

    /*
     * 水の柱。**上ほど開いて、上ほど薄い。**
     *
     * 円錐 (下が太い) だと水滴が落ちてくるように見える。叩かれた水は逆で、
     * 根元が細く上が開く。蓋を付けないので中が抜けて、**水の膜**に見える。
     *
     * 真っ直ぐな筒だと縁が直線になって、水ではなく紙コップに見えた。
     * 母線を曲げて (t^COLUMN_CURVE) 上へ行くほど急に開かせ、**上端を頂点の
     * 色で透かして**輪郭を溶かす。上が切り落とされていないので、崩れながら
     * 空気に散っていく形になる。
     */
    const columnGeometry = buildColumnGeometry()
    for (let i = 0; i < SPLASH_POOL; i++) {
      const column = new THREE.Mesh(
        columnGeometry,
        new THREE.MeshBasicMaterial({
          color: FOAM_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          // 上端を消すための頂点ごとの濃さ
          vertexColors: true,
        }),
      )
      column.visible = false
      this.group.add(column)
      this.columns.push(column)
      this.columnLife.push(0)
      this.columnBase.push(0)
      this.columnReach.push(COLUMN_HEIGHT)
    }

    /*
     * 根元の泡。**柱の下の縁を隠す。**
     *
     * 筒をそのまま置くと、水面と交わる所に硬い輪郭が出て「置いた物」に見える。
     * 泡を 1 枚重ねると水が乱れている面になり、柱がそこから生えて見える。
     */
    for (let i = 0; i < SPLASH_POOL; i++) {
      const foam = new THREE.Mesh(
        new THREE.CircleGeometry(1, 20),
        new THREE.MeshBasicMaterial({
          color: FOAM_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      )
      foam.rotation.x = -Math.PI / 2
      foam.visible = false
      this.group.add(foam)
      this.foams.push(foam)
      this.foamLife.push(0)
      this.foamReach.push(FOAM_RADIUS)
    }

    /*
     * 飛び散る粒。**1 つの塊にまとめる。**
     *
     * 1 回で 7 個、48 回ぶんで 336 個。別々の Mesh にすると描く回数がそのまま
     * 増えるので、姿勢だけ差し替える InstancedMesh にする。
     *
     * 玉は 5 面。粒は 1cm ほどで、しかも動いているので、丸さは要らない。
     */
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(DROP_RADIUS, 5, 3),
      new THREE.MeshBasicMaterial({ color: DROP_COLOR, transparent: true, opacity: 0.8, depthWrite: false }),
      DROP_POOL,
    )
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.drops.frustumCulled = false
    // 使っていない粒は潰して隠す。visible は塊ごとにしか効かない
    for (let i = 0; i < DROP_POOL; i++) this.hideDrop(i)
    this.drops.instanceMatrix.needsUpdate = true
    this.group.add(this.drops)

    /*
     * 波紋。**平らに寝かせた細い輪。**
     *
     * 面を持たない輪 (RingGeometry) にしてあるのは、水面と同じ高さで塗り潰すと
     * 水の色が消えるから。縁だけなら、広がっていく波として読める。
     *
     * 分割を 48 にしてあるのは、**広がると多角形の角が見える**ため。半径 1m を
     * 超えるので、16 では輪ではなく十六角形に見えていた。
     */
    for (let i = 0; i < RIPPLE_POOL; i++) {
      const ripple = new THREE.Mesh(
        new THREE.RingGeometry(0.88, 1, 48),
        new THREE.MeshBasicMaterial({
          color: FOAM_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      ripple.rotation.x = -Math.PI / 2
      ripple.visible = false
      this.group.add(ripple)
      this.ripples.push(ripple)
      this.rippleLife.push(0)
      this.rippleDelay.push(0)
      this.rippleReach.push(RIPPLE_RADIUS)
    }
  }

  /** 使っていない粒を潰して隠す */
  private hideDrop(index: number): void {
    this.dropMatrix.makeScale(0, 0, 0)
    this.drops.setMatrixAt(index, this.dropMatrix)
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
  /**
   * 1 発ぶんの絵。曳光・弾痕・銃口の煙・着弾の跡。
   *
   * @param surface 当たった面。**金属は火花、それ以外は粉。** 音は既に面で
   *   分けてある (hitMetal) ので、目のほうも揃える。分からなければ省く
   */
  fire(
    from: THREE.Vector3,
    to: THREE.Vector3,
    normal: THREE.Vector3 | null,
    impactColor = 0xffd9a0,
    surface?: Surface,
  ): void {
    const line = this.tracers[this.tracerNext]
    const position = line.geometry.getAttribute('position') as THREE.BufferAttribute
    position.setXYZ(0, from.x, from.y, from.z)
    position.setXYZ(1, to.x, to.y, to.z)
    position.needsUpdate = true
    line.visible = true
    this.tracerLife[this.tracerNext] = TRACER_LIFE
    this.tracerNext = (this.tracerNext + 1) % POOL_SIZE

    // 銃口の煙。**当たったかどうかに関わらず出る** — 撃った事実の絵
    this.muzzle(from, this.muzzleDir.subVectors(to, from))

    if (!normal) return

    const impact = this.impacts[this.impactNext]
    ;(impact.material as THREE.MeshBasicMaterial).color.setHex(impactColor)
    // 面と完全に同一平面だと Z ファイティングするので法線方向へ僅かに浮かせる
    impact.position.copy(to).addScaledVector(normal, 0.01)
    impact.lookAt(this.lookTarget.copy(impact.position).add(normal))
    impact.visible = true
    this.impactLife[this.impactNext] = IMPACT_LIFE
    this.impactNext = (this.impactNext + 1) % IMPACT_POOL

    /*
     * 当たった跡。**金属は弾け、それ以外は削れる。**
     *
     * 既定は粉。**面が分からないときに火花を出すと、土や木でも弾けて見える** —
     * 出しすぎるより出さないほうが誤解が少ない。
     */
    if (surface === 'metal') this.sparkBurst(to, normal)
    else {
      this.puff(
        to,
        normal,
        IMPACT_SMOKE_SIZE,
        IMPACT_SMOKE_GROW,
        IMPACT_SMOKE_LIFE,
        IMPACT_SMOKE_DRIFT,
        IMPACT_SMOKE_DENSE,
      )
    }
  }

  /**
   * 煙を 1 粒。**銃口と着弾で共用する。**
   *
   * @param at どこから
   * @param dir どちらへ流れるか (長さは無視して向きだけ使う)
   * @param size 出始めの大きさ (m)
   * @param grow 消えるまでに何倍になるか
   * @param span 生きている時間 (秒)
   * @param drift 流れる速さ (m/s)
   * @param dense 出た瞬間の濃さ (0〜1)。**遠くの物ほど濃くないと見えない** —
   *   銃口は手元なので薄くてよいが、着弾は 10m 先にある
   */
  private puff(
    at: THREE.Vector3,
    dir: THREE.Vector3,
    size: number,
    grow: number,
    span: number,
    drift: number,
    dense: number,
  ): void {
    const i = this.smokeNext
    this.smokeNext = (this.smokeNext + 1) % SMOKE_POOL
    const sprite = this.smoke[i]
    if (!sprite) return
    sprite.position.copy(at)
    sprite.scale.setScalar(size)
    sprite.visible = true
    // 向きは揃えず、少し散らす。同じ向きへ並ぶと 1 枚の板に見える
    this.smokeVelocity[i]!.copy(dir)
      .normalize()
      .multiplyScalar(drift)
      .addScaledVector(
        this.scatter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        drift * 0.5,
      )
    this.smokeLife[i] = span
    this.smokeSpan[i] = span
    this.smokeSize[i] = size
    this.smokeGrow[i] = grow
    this.smokeDense[i] = dense
  }

  /**
   * 銃口の煙。**撃った本人にも、見ている側にも出す。**
   *
   * 弾そのものは見えない (曳光は 1 フレームの線) ので、**撃ったことが絵に
   * 残らなかった。** 短くしてあるのは、連射で銃口が煙に埋まらないようにするため。
   */
  muzzle(at: THREE.Vector3, dir: THREE.Vector3): void {
    this.puff(at, dir, MUZZLE_SIZE, MUZZLE_GROW, MUZZLE_LIFE, MUZZLE_DRIFT, MUZZLE_DENSE)
  }

  /**
   * 金属を弾いた火花。**面の法線を中心に散らす。**
   *
   * 木や石は削れて粉が出る (煙) が、金属は削れずに弾ける。音は既に面で
   * 分けてあるので (hitMetal)、目のほうも揃える。
   */
  private sparkBurst(at: THREE.Vector3, normal: THREE.Vector3): void {
    for (let n = 0; n < SPARK_BURST; n++) {
      const i = this.sparkNext
      this.sparkNext = (this.sparkNext + 1) % SPARK_POOL
      const sprite = this.sparks[i]
      if (!sprite) continue
      sprite.position.copy(at)
      sprite.scale.setScalar(SPARK_SIZE)
      sprite.visible = true
      this.sparkVelocity[i]!.copy(normal)
        .normalize()
        .addScaledVector(
          this.scatter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
          SPARK_SPREAD * 2,
        )
        .normalize()
        // 勢いを揃えない。**同じ速さだと輪になって広がる**
        .multiplyScalar(SPARK_SPEED * (0.5 + Math.random()))
      this.sparkLife[i] = SPARK_LIFE * (0.6 + Math.random() * 0.4)
    }
  }

  /**
   * 水面を叩いた。**柱が立ち、粒が散り、波紋が広がる。**
   *
   * 痕は残さない。水面に穴は開かないし、残すと撃ち合った跡が水に溜まる。
   *
   * @param at 叩いた場所
   * @param surfaceY 水面の高さ。粒が**ここまで落ちたら消える**
   * @param strength 叩いた強さ (1 = 銃弾)。手榴弾のような重い物は大きく出す
   */
  splash(at: THREE.Vector3, surfaceY: number, strength = 1): void {
    const scale = Math.min(3, Math.max(0.5, strength))
    /*
     * **勢いは重さの平方根で効かせる。**
     *
     * 高さをそのまま倍にすると、手榴弾のしぶきが人の背丈を越えて噴水になる。
     * 落ちた物のエネルギーは重さに比例し、上がる高さはその平方根で効く。
     */
    const push = Math.sqrt(scale)

    // --- 水の柱 ---
    const column = this.columns[this.columnNext]
    column.position.set(at.x, surfaceY, at.z)
    column.scale.set(scale, 0, scale)
    // 回しておく。同じ所へ撃ち込んでも同じ形が並ばない
    column.rotation.y = Math.random() * Math.PI * 2
    column.visible = true
    this.columnLife[this.columnNext] = COLUMN_LIFE
    this.columnBase[this.columnNext] = surfaceY
    this.columnReach[this.columnNext] = COLUMN_HEIGHT * push
    this.columnNext = (this.columnNext + 1) % SPLASH_POOL

    // --- 根元の泡 ---
    const foam = this.foams[this.foamNext]
    foam.position.set(at.x, surfaceY + 0.008, at.z)
    foam.scale.setScalar(0.001)
    foam.visible = true
    this.foamLife[this.foamNext] = FOAM_LIFE
    this.foamReach[this.foamNext] = FOAM_RADIUS * scale
    this.foamNext = (this.foamNext + 1) % SPLASH_POOL

    // --- 飛び散る粒 ---
    for (let n = 0; n < DROPS_PER_SPLASH; n++) {
      const i = this.dropNext
      this.dropNext = (this.dropNext + 1) % DROP_POOL
      /*
       * 向きは円周に散らす。**等間隔にしない** — 揃うと花火の形になる。
       * 半端な角を足して回すと、続けて撃っても同じ形が並ばない。
       */
      const angle = (n / DROPS_PER_SPLASH + i * 0.137) * Math.PI * 2 + Math.random() * 0.35
      // 中心ほど高く、外ほど低く飛ぶ。柱から剥がれて散る形になる
      const outward = (0.35 + Math.random() * 0.65) * DROP_SPREAD * push
      const up = (0.6 + Math.random() * 0.7) * DROP_RISE * push
      this.dropAt[i * 3] = at.x
      this.dropAt[i * 3 + 1] = surfaceY + 0.03
      this.dropAt[i * 3 + 2] = at.z
      this.dropVelocity[i * 3] = Math.cos(angle) * outward
      this.dropVelocity[i * 3 + 1] = up
      this.dropVelocity[i * 3 + 2] = Math.sin(angle) * outward
      this.dropFloor[i] = surfaceY
      this.dropSize[i] = DROP_SIZE_MIN + Math.random() * (DROP_SIZE_MAX - DROP_SIZE_MIN)
      // 上がって落ちるまで。落ちた所で消えるので、これは切り上げの保険
      this.dropLife[i] = 0.9
    }

    // --- 波紋 ---
    for (let n = 0; n < RIPPLES_PER_SPLASH; n++) {
      const i = this.rippleNext
      this.rippleNext = (this.rippleNext + 1) % RIPPLE_POOL
      const ripple = this.ripples[i]
      // 水面と同じ高さだと奥行きで競るので僅かに浮かせる
      ripple.position.set(at.x, surfaceY + 0.012, at.z)
      ripple.scale.setScalar(0.001)
      ripple.visible = false
      this.rippleLife[i] = RIPPLE_LIFE
      this.rippleDelay[i] = n * RIPPLE_DELAY
      // 後から出る輪ほど届かない。**外側が先行する**ので追い越さない
      this.rippleReach[i] = RIPPLE_RADIUS * scale * (n === 0 ? 1 : 0.62)
    }
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
      /*
       * 色を 1 枚ずつ引く。**濃い滴ほど酸化した色へ寄せる。**
       *
       * 厚く溜まった所は暗く、薄く伸びた所は明るい。濃さと色を別々に引くと
       * 「濃いのに明るい」滴ができて、絵の具を散らしたように見える。
       */
      const oxidised = Math.random()
      material.color.setHex(BLOOD_FRESH).lerp(this.oxidised, oxidised * 0.85)
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
      /*
       * 濃さも 1 枚ずつ。**薄いほうへ寄せる** (2 乗で引く)。
       *
       * 溜まりは飛沫より濃くしてある (alpha が上限を決める)。同じ濃さを並べる
       * と版画になるので、幅の中で散らす。
       */
      this.bloodAlpha[this.bloodNext] =
        alpha * (BLOOD_ALPHA_MIN + (1 - Math.random() ** 2) * (BLOOD_ALPHA_MAX - BLOOD_ALPHA_MIN))
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

    /*
     * 煙。**膨らみながら薄れる。**
     *
     * 出た瞬間が一番濃い。実際の煙は少し遅れて濃くなるが、**銃口のものは
     * 0.2 秒で消える**ので立ち上がりを作る余地がない。
     */
    for (let i = 0; i < SMOKE_POOL; i++) {
      if (this.smokeLife[i]! <= 0) continue
      this.smokeLife[i]! -= dt
      const sprite = this.smoke[i]!
      const material = sprite.material as THREE.SpriteMaterial
      if (this.smokeLife[i]! <= 0) {
        sprite.visible = false
        material.opacity = 0
        continue
      }
      const left = this.smokeLife[i]! / this.smokeSpan[i]!
      sprite.position.addScaledVector(this.smokeVelocity[i]!, dt)
      // 広がるほど遅くなる。空気に押し返される感じ
      this.smokeVelocity[i]!.multiplyScalar(1 - Math.min(1, dt * 3))
      sprite.scale.setScalar(this.smokeSize[i]! * (1 + (this.smokeGrow[i]! - 1) * (1 - left)))
      // 二乗で落とす。**線形だと最後まで見えていて、消えた瞬間が分かる**
      material.opacity = left * left * this.smokeDense[i]!
    }

    /*
     * 火花。**落ちながら消える。**
     *
     * 真っ直ぐ飛ばすと線香花火にならない。短命なので重力の効きは僅かだが、
     * 曲がっているかどうかで弾けて見えるかが変わる。
     */
    for (let i = 0; i < SPARK_POOL; i++) {
      if (this.sparkLife[i]! <= 0) continue
      this.sparkLife[i]! -= dt
      const sprite = this.sparks[i]!
      const material = sprite.material as THREE.SpriteMaterial
      if (this.sparkLife[i]! <= 0) {
        sprite.visible = false
        material.opacity = 0
        continue
      }
      const velocity = this.sparkVelocity[i]!
      velocity.y -= SPARK_GRAVITY * dt
      sprite.position.addScaledVector(velocity, dt)
      const left = this.sparkLife[i]! / SPARK_LIFE
      // 消え際に細くする。**大きさが変わらないと、消えるのが唐突に見える**
      sprite.scale.setScalar(SPARK_SIZE * (0.35 + left * 0.65))
      material.opacity = Math.min(1, left * 1.6)
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

    /*
     * 水の柱。**上がるのは速く、崩れるのは遅い。**
     *
     * 立ち上がりと崩れを 1 本の曲線にすると、上がった高さでそのまま消えるか、
     * 上がりきる前に消えるかになる。頂点を持たせるために 2 つに割る。
     */
    for (let i = 0; i < SPLASH_POOL; i++) {
      if (this.columnLife[i] <= 0) continue
      this.columnLife[i] -= dt
      const column = this.columns[i]
      const material = column.material as THREE.MeshBasicMaterial
      if (this.columnLife[i] <= 0) {
        column.visible = false
        material.opacity = 0
        continue
      }
      const age = 1 - this.columnLife[i] / COLUMN_LIFE
      // 立ち上がり (0..1)。頭を丸めて、頂点で止まって見えるようにする
      const rise = Math.min(1, age / COLUMN_RISE) ** 0.55
      // 崩れ (0..1)。頂点を過ぎてから効く
      const fall = Math.max(0, (age - COLUMN_RISE) / (1 - COLUMN_RISE))
      const height = this.columnReach[i] * rise * (1 - fall * fall)
      // 崩れながら横に広がる。落ちる水が外へ逃げる
      const spread = column.scale.x
      column.scale.y = Math.max(0.001, height)
      // 形の底が原点。水面へそのまま置く
      column.position.y = this.columnBase[i]
      column.scale.z = spread
      material.opacity = (1 - age * age) * 0.55
    }

    /*
     * 根元の泡。**広がりながら薄れる。**柱より少し長く残って、崩れた水が
     * 水面に散っている間を埋める。
     */
    for (let i = 0; i < SPLASH_POOL; i++) {
      if (this.foamLife[i] <= 0) continue
      this.foamLife[i] -= dt
      const foam = this.foams[i]
      const material = foam.material as THREE.MeshBasicMaterial
      if (this.foamLife[i] <= 0) {
        foam.visible = false
        material.opacity = 0
        continue
      }
      const age = 1 - this.foamLife[i] / FOAM_LIFE
      foam.scale.setScalar(this.foamReach[i] * (0.45 + age * 0.85))
      material.opacity = (1 - age) ** 1.4 * 0.45
    }

    /*
     * 飛び散る粒。**水面に触れた所で消す。**
     *
     * 薄れて消すと空中で溶けるので、落ちた粒がどこへ行ったか分からない。
     * 水に戻った所で消えれば、それ自体が「水面はここ」を示す。
     */
    let dropsMoved = false
    for (let i = 0; i < DROP_POOL; i++) {
      if (this.dropLife[i] <= 0) continue
      this.dropLife[i] -= dt
      const p = i * 3
      this.dropVelocity[p + 1] -= DROP_GRAVITY * dt
      this.dropAt[p] += this.dropVelocity[p] * dt
      this.dropAt[p + 1] += this.dropVelocity[p + 1] * dt
      this.dropAt[p + 2] += this.dropVelocity[p + 2] * dt
      dropsMoved = true
      if (this.dropLife[i] <= 0 || this.dropAt[p + 1] <= this.dropFloor[i]) {
        this.dropLife[i] = 0
        this.hideDrop(i)
        continue
      }
      /*
       * 落ちるほど細長くする。**速さの向きに伸ばす**のではなく縦に伸ばす —
       * 粒は小さすぎて向きが読めないので、伸びだけが速さとして伝わる。
       */
      const stretch = 1 + Math.min(0.9, Math.abs(this.dropVelocity[p + 1]) * 0.13)
      const size = this.dropSize[i]
      this.dropScale.set((size / Math.sqrt(stretch)), size * stretch, (size / Math.sqrt(stretch)))
      this.dropMatrix.makeScale(this.dropScale.x, this.dropScale.y, this.dropScale.z)
      this.dropMatrix.setPosition(this.dropAt[p], this.dropAt[p + 1], this.dropAt[p + 2])
      this.drops.setMatrixAt(i, this.dropMatrix)
    }
    if (dropsMoved) this.drops.instanceMatrix.needsUpdate = true

    /*
     * 波紋。**広がるほど遅く、薄く。**
     *
     * 等速で広げると輪が外へ飛んでいくように見える。実際の波は最初に一番速く
     * 動いて、あとは惰性で伸びる。1 - (1-t)^2 がその形になる。
     */
    for (let i = 0; i < RIPPLE_POOL; i++) {
      if (this.rippleLife[i] <= 0) continue
      if (this.rippleDelay[i] > 0) {
        this.rippleDelay[i] -= dt
        continue
      }
      this.rippleLife[i] -= dt
      const ripple = this.ripples[i]
      const material = ripple.material as THREE.MeshBasicMaterial
      if (this.rippleLife[i] <= 0) {
        ripple.visible = false
        material.opacity = 0
        continue
      }
      const age = 1 - this.rippleLife[i] / RIPPLE_LIFE
      const eased = 1 - (1 - age) * (1 - age)
      ripple.visible = true
      ripple.scale.setScalar(0.1 + eased * this.rippleReach[i])
      // 消え際を長く引く。輪が「散る」より「薄れる」ほうが水に見える
      material.opacity = (1 - age) ** 1.6 * 0.5
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
 * 描くのは白だけ。色は材質の color が掛ける (BLOOD_FRESH / BLOOD_OXIDISED) ので、これは
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
