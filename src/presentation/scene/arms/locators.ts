import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { materialOpacity, normalView, positionView } from 'three/tsl'

import { loadLocator } from '../assets'
import { TEAM_COLOR } from '../world/stage'
import { FIXED_STEP, stepProjectile, type Projectile } from '../../../sim/judge/ballistic'
import type { Water } from '../../../domain/stage'
import type { Team } from '../../../domain/player/player'
import type { SolidWorld } from '../../../sim/space/vision'
import { BLINK_ON, BLINK_SECONDS } from '../../../domain/item/locator'

/**
 * 投げられた E LOCATOR。
 *
 * --- 手榴弾と何が違うか ---
 * 飛び方は同じ (サーバーが飛ばし、こちらは同じ物理を解くレプリカ)。違うのは
 * **止まってからずっと在り続ける**ことで、爆ぜて消える物ではない。
 *
 * --- なぜ点滅させるか ---
 * 暴かれた側に**探す手掛かり**を渡すため。静かに置いてあると「どこかに在る」
 * ことしか分からず、壊しようが無い。光れば見つけられる — 代わりに投げた側は
 * 「光る物を隠せる場所」を選ぶことになる。**点滅そのものが読み合いの材料**。
 *
 * --- 波と光の玉は投げた本人にだけ ---
 * 球状の波と、灯に重ねる光の玉は**自分の画面にしか出さない**。「置いた物が
 * まだ働いている」ことを本人に返すための物で、敵に見せると**置いた場所を
 * そのまま教える**ことになる。敵に見えるのは装置そのものと灯の点滅、それに
 * 灯が周りの床や壁に落とす光だけ、という分担にしてある。
 *
 * 床に落ちる光は全員に見せる。**灯は本当に光っている物**なので、周りが
 * 照らされないと貼り付けた絵に見える。届く距離は短く、装置そのものが見える
 * 距離と同じくらいにしてあるので、光だけで壁の裏から割れることはない。
 *
 * --- 向きは物理ではない ---
 * 共有している弾道 (sim/judge/ballistic.ts) は**位置しか解かない**。サーバーと
 * 軌道を一致させるための物で、向きは当たり判定にも使わないので持っていない。
 * 飛んでいる間の回転も、止まったときの姿勢も、**ここで作っている見せかけ**。
 */

/**
 * 点滅させる部分の名前。**モデルの中の 1 オブジェクト。**
 *
 * 本体ごと消すと、点滅の消えている間だけ装置が見えなくなって「置いてある物」
 * ではなくなる。灯だけを出し入れする。
 *
 * **名前で引く。** 見つからなければ点滅しないだけで、装置そのものは出る
 * (光らない置物になる)。名前が変わったら、変わったことに気づけるように警告する。
 */
const LAMP_NAME = 'indicator'

/** モデルが間に合わなかったときの代役。大きさだけ合わせた箱 */
const FALLBACK_HALF = 0.06

/** 転がっている間の回転の速さ (rad/m)。進んだ距離に比例させる */
const SPIN = 5

/**
 * 灯の自己発光の強さ。
 *
 * **色は触らない。** 模型が持っている色をそのまま自己発光へ移して、強さだけ
 * 上げる。色をこちらで決めると、Blender で塗った物とずれる。
 */
const LAMP_GLOW = 2.5

/**
 * 灯に重ねる光の大きさ (m)。**板の一辺。**
 *
 * 灯そのものは 1cm ほどしかないので、離れると点にもならない。**探す手掛かり**
 * である以上、遠くから見えないと仕事をしない。
 *
 * 球ではなく**常にカメラを向く板**に、中心から外へ滲む絵を貼る。球は縁で
 * 硬く切れて、光ではなく**塗った玉**に見える (実際そう見えた)。
 */
const LAMP_HALO = 0.22

/** 光の濃さ。滲みの形は絵が持っているので、ここは全体の強さ */
const HALO_OPACITY = 0.8

/**
 * 灯が周りに落とす光の強さ (cd) と届く距離 (m)。
 *
 * 装置は 10cm ほどの物で、灯は LED 1 つ。床の**すぐ周りだけ**が薄く色付く
 * 程度にしてある。太陽 (3.6) の下では遠くまで見えず、日陰に置くと目立つ —
 * 置き場所で見つかりやすさが変わるのは、道具として素直。
 *
 * 1.2 cd で始めたら、露出 3 の下で床が 2m 四方白く飛んだ。0.15 で装置の
 * 足元だけに収まる。
 *
 * 影は落とさない。灯ごとに影の写しを描くと、置いた数だけ場面を描き直す。
 */
const LAMP_LIGHT = 0.15
const LAMP_LIGHT_REACH = 1.5

/** 光の絵の一辺 (px)。滲みだけなので大きく要らない */
const GLOW_PIXELS = 128

/** 十字の筋の長さ。板の半分に対する割合 */
const FLARE_REACH = 0.95

/** 十字の筋の太さ (px)。細いほど鋭い光に見える */
const FLARE_WIDTH = 3.5

/**
 * 筋のぼかし (px)。
 *
 * 筋の縁が硬いと、光ではなく**貼った十字**に見える (実際そう見えた)。
 * 太さの違う筋を重ねるだけでは縁が残るので、描いた後に全体を滲ませる。
 */
const FLARE_BLUR = 6

/**
 * 倒れ込むのにかける時間 (秒)。
 *
 * 止まった瞬間に姿勢を差し替えると、**転がっていた物が瞬間移動したように**
 * 見える。短く倒れ込ませれば、勢いが尽きて倒れたように読める。
 */
const SETTLE_SECONDS = 0.35

/**
 * 波を出す間隔 (秒)。
 *
 * **走査の間隔 (1 秒) とは別**にしてある。毎秒広がると画面が休まらず、
 * 「働いている」ではなく「うるさい」になる。
 */
const WAVE_SECONDS = 5

/**
 * 広がり切るまで (秒)。速すぎると衝撃波、遅すぎると霧に見える。
 *
 * **半径と釣り合わせる。** 見えるのは広がる速さ (半径 ÷ 時間) で、時間そのもの
 * ではない。15m を 1.8 秒 (約 8m/秒) で広げていたので、半径だけ 5m に縮めると
 * **3 倍遅く**なって、霧が滲み出しているように見える。
 */
const WAVE_GROW = 0.7

/** 一番濃い層の濃さ。前後へ薄くなり、時間でも薄れる */
const WAVE_OPACITY = 0.14

/**
 * 球の縁の消し方。**輪郭を出さない。**
 *
 * 球面をそのまま描くと、面のどこも同じ濃さなので**輪郭が硬い円で切れる**。
 * 光ではなく色を塗った玉に見えた (灯の光を球で描いたときと同じ失敗)。
 * カメラへ正対する所を濃く、縁 (視線と面が平行になる所) へ向けて 0 まで
 * 落とすと、輪郭が消えて滲んだ玉になる。指数が大きいほど縁が広く消える。
 */
const WAVE_EDGE = 4

/** 出た瞬間の半径 (m)。0 から始めると点が弾けたように見える */
const WAVE_START = 0.4

/**
 * 波が広がり切る半径 (m)。**暴ける半径 (15m) とは別。**
 *
 * 揃えていた頃は、広がり切る頃に**画面を丸ごと覆って**前が見えなくなった。
 * 見せたいのは「働いている」ことであって、どこまで届くかの物差しではない。
 *
 * 暴く範囲はサーバーが持っている数 (domain/item/locator.ts の SCAN_RADIUS) の
 * ままで、**ここを縮めても届く距離は変わらない**。
 */
const WAVE_RADIUS = 5

/**
 * 波の厚み (m)。**先端から内側へこれだけ。**
 *
 * 面を 1 枚広げるだけだと、濃さが一様な球が膨らむので「膜」に見える。
 * 厚みを持たせて先端を濃くすると、**広がっていく波**として読める。
 */
const WAVE_THICKNESS = 0.5

/**
 * 厚みを何枚の球で作るか。
 *
 * **1 枚の球面では半径方向の濃淡を作れない** — 面のどの点も同じ半径に在る
 * ので、面の中で「先端」と「後ろ」が分かれない。厚みのぶんだけ球を重ねて、
 * 先頭を濃く、内側ほど薄くする。
 *
 * 8 枚で 0.06m 刻み。増やすほど滑らかになるが、その分だけ描く回数が増える。
 */
const WAVE_LAYERS = 8

/**
 * 層ごとの濃さの分布 (0..1)。**先端は薄く始めて、3 枚目で一番濃く、後ろへ
 * 直線で薄れる。**
 *
 * 先頭を一番濃くしていた頃は、先端の球の輪郭がそのまま波の外縁になって
 * 硬く見えた。外側へも 2 枚ぶん薄れさせると、外縁が溶ける。
 *
 * @param i 0 が一番外
 */
function waveProfile(i: number): number {
  const peak = 2
  return i < peak ? (i + 1) / (peak + 1) : 1 - (i - peak) / (WAVE_LAYERS - peak)
}

/** 倒す軸。**世界の X。** 向き (yaw) は後から掛ける */
const TIP_AXIS = new THREE.Vector3(1, 0, 0)

interface Live {
  id: number
  group: THREE.Group
  /** 灯。モデルに無ければ null (点滅しないだけ) */
  lamp: THREE.Object3D | null
  /**
   * 灯が周りに落とす光。灯が無ければ null。
   *
   * **灯の子にしない。** 灯の出し入れ (visible) に光を巻き込むと、場面の光の
   * 数が点滅のたびに変わって、材質の組み直しが走る。袋 (group) に置いて、
   * 強さを 0 にして消す。
   */
  light: THREE.PointLight | null
  body: Projectile
  /** 点滅の位相 (秒)。**物ごとにずらさない** — 揃って光るほうが「走査」に見える */
  blink: number
  /** いま灯っているか。消えている状態から点いた刻みを 1 度だけ音にする */
  lit: boolean
  /** 投げたのが自分か。**波を出すかどうかだけに使う** */
  mine: boolean
  /**
   * 水しぶきを返したか。
   *
   * 沈み始めると `sunk` は立ちっぱなしになるので、**入った瞬間**を捕まえる
   * ための控え。持たないと、沈んでいる間ずっと輪が出続ける。
   */
  splashed: boolean
  /** 波を入れる袋。自分の物でなければ null */
  wave: THREE.Group | null
  /** 波の層。先頭 (添字 0) が一番外で、一番濃い */
  layers: THREE.Mesh<THREE.SphereGeometry, MeshBasicNodeMaterial>[]
  /**
   * 波が出てからの時間 (秒)。
   *
   * 次の波までの待ちも同じ数で数える (WAVE_SECONDS を越えたら 0 に戻す)。
   * 別々に持つと、広がっている最中に次が始まって二重に出る。
   */
  waveAt: number
  /** 倒れ込みを始めたか。**止まった刻みを 1 度だけ捉える**ため */
  settled: boolean
  /** 倒れ込みの残り (秒)。0 で落ち着き切る */
  settling: number
  /** 倒れ込みの始めと終わりの姿勢 */
  restFrom: THREE.Quaternion
  restTo: THREE.Quaternion
  /** 倒れたぶんの持ち上げ (m)。始めと終わり、いまの値 */
  liftFrom: number
  liftTo: number
  lift: number
}

export class Locators {
  private readonly scene: THREE.Scene
  private readonly live: Live[] = []
  private model: THREE.Object3D | null = null
  /**
   * 模型を袋の中でどれだけずらすか。
   *
   * **原点が接地面とは限らない。** 書き出された模型は原点が中ほどに在ることが
   * あり、そのまま置くと**地面へ埋まる / 浮く**。読み込んだ時に 1 度だけ測って、
   * 底が y=0、中心が x=z=0 に来るようにずらす (decoy が模型の腰を足元へ
   * 下ろしているのと同じ手当て)。
   */
  private readonly offset = new THREE.Vector3()
  /** 模型の半径 (m)。**倒したときの持ち上げ量**になる */
  private halfWidth = FALLBACK_HALF
  /**
   * 灯が本体のどちら向きに付いているか (rad)。
   *
   * 倒したときに**灯を上へ向ける**のに要る。地面を向くと点滅が見えず、
   * 敵は装置を見つけられない — 壊せることがこの道具の裏側なので、
   * 見つけられないのは作りとして壊れている。
   */
  private lampAzimuth = 0
  /** 固定刻みで進めるための余り */
  private accumulator = 0
  /** 転がる軸。**使い回す** — 毎フレーム作ると捨てる物が増える */
  private readonly tumble = new THREE.Vector3()
  /** 水に入った所を返すための控え。**使い回す** (受けた側はその場で使い切る) */
  private readonly splashPoint = new THREE.Vector3()
  /** 姿勢を組むための控え。**使い回す** */
  private readonly spin = new THREE.Quaternion()
  private readonly tip = new THREE.Quaternion()
  private readonly roll = new THREE.Quaternion()
  /**
   * 波の形。**1 つを全部で使い回す。**
   *
   * 大きさは scale で変える。物ごと・層ごとに作ると、投げるたびに球の形が増える。
   */
  private readonly waveShape = new THREE.SphereGeometry(1, 24, 16)
  /**
   * 光。**1 つの材質を全部で使い回す。**
   *
   * 出し入れは灯の側 (親) でやるので、物ごとに濃さが変わることはない。
   * 色は模型の灯から写す (brighten)。
   *
   * 深さは読むが書かない。**壁の裏なら隠れてほしい**が、光どうしが互いを
   * 切り抜いてはいけない。
   */
  private readonly haloMaterial = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: HALO_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  /**
   * 自分の陣営の色。**基地の枠と同じ物を引く** (world/stage.ts)。
   *
   * 名簿が届くまでは分からないので、届いたら塗り直す (setSelfTeam)。
   */
  private teamColor: number = TEAM_COLOR.blue
  /**
   * 灯の色。**模型の灯の材質から写す** (brighten)。床に落ちる光の色になる。
   *
   * 陣営の色ではない。灯は装置が持っている物で、誰が投げても同じ色に光る。
   * 誰の物かは、本人にだけ出す光の玉 (陣営色) が答える。
   */
  private readonly lampColor = new THREE.Color(0xffffff)

  constructor(scene: THREE.Scene) {
    this.scene = scene
    // 名簿が届くまでの分。届いたら塗り直す (setSelfTeam)
    this.haloMaterial.color.setHex(this.teamColor)

    void loadLocator().then((gltf) => {
      const model = gltf.scene
      model.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(model)
      const centre = box.getCenter(new THREE.Vector3())
      this.offset.set(-centre.x, -box.min.y, -centre.z)
      this.halfWidth = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2
      model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) obj.castShadow = true
      })
      const lamp = model.getObjectByName(LAMP_NAME)
      if (lamp) {
        // 灯の向き。**袋の中心から見た向き**なので、ずらした後の座標で測る
        const at = lamp.getWorldPosition(new THREE.Vector3()).add(this.offset)
        this.lampAzimuth = Math.atan2(at.x, at.z)
        this.brighten(lamp)
      } else {
        // **点滅しないだけで遊べる。** 止めるほどのことではないが、
        // 気づけないと「光らない理由」を探すことになる
        console.warn(`[E LOCATOR] 模型に ${LAMP_NAME} が無い。点滅しない`)
      }
      this.model = model
      // 読み込みの前に投げられた分を模型へ入れ替える。**姿勢も測り直す** —
      // 模型が無い間に置かれた物は、半径も灯の向きも分からないまま落ち着いている
      for (const item of this.live) {
        this.dress(item)
        if (item.settled) this.layDown(item, 0)
      }
    })
  }

  /**
   * 自分の陣営が分かった / 変わった。**波の色はこれで決まる。**
   *
   * 陣営は試合の仕切り直しで切り替わる (shuffleTeams) ので、置いてある物も
   * 塗り直す。置いた時の色のまま残すと、**前の試合の色の波**が出る。
   */
  setSelfTeam(team: Team): void {
    this.teamColor = TEAM_COLOR[team]
    // 灯の光も陣営の色。**誰の装置か**が、見つけた瞬間に読める
    this.haloMaterial.color.setHex(this.teamColor)
    for (const item of this.live) {
      for (const layer of item.layers) layer.material.color.setHex(this.teamColor)
    }
  }

  has(id: number): boolean {
    return this.live.some((item) => item.id === id)
  }

  /**
   * 投げられた。**位置も速度もサーバーが決めたものをそのまま使う。**
   *
   * 自分が投げた物も例外にしない — 手元で先に飛ばして後から合わせると、
   * 見えている場所と暴く場所がずれる (手榴弾と同じ)。
   */
  spawn(id: number, from: readonly number[], velocity: readonly number[], mine: boolean): void {
    if (this.has(id)) return
    this.add(
      id,
      {
        x: from[0] ?? 0,
        y: from[1] ?? 0,
        z: from[2] ?? 0,
        vx: velocity[0] ?? 0,
        vy: velocity[1] ?? 0,
        vz: velocity[2] ?? 0,
        bounces: 0,
        resting: false,
      },
      mine,
    )
  }

  /**
   * 既に置かれている物を出す。**飛ぶところを見ていない人に要る。**
   *
   * 途中から入った人と、画面を読み直した人はここから受け取る。見えないと
   * 壊せないので、飛ぶところを見ていないことが「壊せない」に化けてはいけない。
   *
   * **倒れ込みは見せない。** 落ちた所を見ていないので、既に落ち着いた姿で出す。
   */
  place(id: number, at: readonly number[], mine: boolean): void {
    if (this.has(id)) return
    const item = this.add(
      id,
      {
        x: at[0] ?? 0,
        y: at[1] ?? 0,
        z: at[2] ?? 0,
        vx: 0,
        vy: 0,
        vz: 0,
        bounces: 0,
        resting: true,
      },
      mine,
    )
    item.settled = true
    this.layDown(item, 0)
  }

  private add(id: number, body: Projectile, mine: boolean): Live {
    const group = new THREE.Group()
    group.position.set(body.x, body.y, body.z)
    this.scene.add(group)
    const item: Live = {
      id,
      group,
      lamp: null,
      light: null,
      body,
      blink: 0,
      lit: false,
      mine,
      splashed: false,
      wave: null,
      layers: [],
      waveAt: 0,
      settled: false,
      settling: 0,
      restFrom: new THREE.Quaternion(),
      restTo: new THREE.Quaternion(),
      liftFrom: 0,
      liftTo: 0,
      lift: 0,
    }
    if (mine) this.buildWave(item)
    this.live.push(item)
    this.dress(item)
    return item
  }

  /**
   * 倒れ込む先を決める。**横向きに寝かせる。**
   *
   * --- なぜ立たせないか ---
   * 縦長の物が転がってきて、最後にきちんと立つのは不自然に見える。倒れるほうが
   * 素直で、**置いた場所の地形に馴染む**。
   *
   * --- なぜ id から決めるか ---
   * 飛んでいる間の回転は見せかけなので、そこから姿勢を取ると**人ごとに違う
   * 向き**で落ち着く。同じ物が画面によって別の向きに寝ているのは、位置が
   * ずれているのと同じ種類の嘘になる。id から決めれば全員一致する。
   *
   * --- なぜ灯を上へ向けるか ---
   * 地面を向くと点滅が見えず、敵が見つけられない。**壊せることがこの道具の
   * 裏側**なので、見つけられないのは作りとして壊れている。重りが底に入って
   * いて灯の側が上を向く、という理屈にしてある。
   *
   * @param seconds 倒れ込みにかける時間。0 ならその場で落ち着かせる
   */
  private layDown(item: Live, seconds: number): void {
    /*
     * 向き。**id から決まる 0〜2π。**
     *
     * 掛ける数は大きな素数。連番の id でも隣どうしが似た向きにならない。
     */
    const scattered = ((item.id * 2654435761) % 1000) / 1000
    this.spin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), scattered * Math.PI * 2)
    // 横に倒す。**本体の上向きが水平になる**
    this.tip.setFromAxisAngle(TIP_AXIS, Math.PI / 2)
    /*
     * 倒した後、本体の軸まわりに回して灯を上へ向ける。
     *
     * 倒す前の灯の向き (lampAzimuth) を π へ持っていくと、倒した後に真上を
     * 向く — 倒す回転が「後ろ向き (−Z) を上へ」持ち上げるため。
     */
    this.roll.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - this.lampAzimuth)

    item.restFrom.copy(item.group.quaternion)
    item.restTo.copy(this.spin).multiply(this.tip).multiply(this.roll)
    item.liftFrom = item.lift
    // 倒れたぶん、半径だけ持ち上げる。**しないと半分が地面に埋まる**
    item.liftTo = this.halfWidth
    item.settling = seconds

    if (seconds <= 0) {
      item.group.quaternion.copy(item.restTo)
      item.lift = item.liftTo
    }
  }

  /**
   * 波を組む。**厚みのぶんだけ球を重ねる。**
   *
   * 深さを書かない (depthWrite: false) — 書くと、重なった層が互いを切り抜く。
   * 加算で重ねるので、重なったところだけが濃くなる。
   *
   * 両面を描く。広がった波は**カメラを追い越す**ので、内側からも見えないと
   * 「通り過ぎた」ことが分からない。
   */
  private buildWave(item: Live): void {
    const wave = new THREE.Group()
    for (let i = 0; i < WAVE_LAYERS; i++) {
      const material = new MeshBasicNodeMaterial({
        color: this.teamColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        // 露出に左右されない。位置を示すための印なので、明るさが変わっても読めてほしい
        toneMapped: false,
      })
      // 縁を消す (WAVE_EDGE)。濃さ (opacity) は毎フレーム外から入れるので掛け合わせる
      material.opacityNode = materialOpacity.mul(
        normalView.dot(positionView.normalize()).abs().pow(WAVE_EDGE),
      )
      const layer = new THREE.Mesh(this.waveShape, material)
      layer.visible = false
      layer.frustumCulled = false
      wave.add(layer)
      item.layers.push(layer)
    }
    item.group.add(wave)
    item.wave = wave
  }

  /**
   * 袋へ中身を入れる。**模型が届いていなければ代役の箱。**
   *
   * 読み込みを待ってから出すと、投げた本人にも「投げた」が伝わらない間ができる
   * (decoy が台だけ先に出しているのと同じ)。
   */
  private dress(item: Live): void {
    for (const child of [...item.group.children]) {
      // 波は袋の物ではない。入れ替えで消さない
      if (child === item.wave) continue
      child.removeFromParent()
    }
    item.lamp = null
    item.light = null

    if (!this.model) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(FALLBACK_HALF * 2, FALLBACK_HALF * 2, FALLBACK_HALF * 2),
        new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: 0.6, metalness: 0.4 }),
      )
      box.castShadow = true
      item.group.add(box)
      return
    }

    // **色も材質も触らない。** 書き出された物をそのまま出す
    const model = this.model.clone(true)
    model.position.copy(this.offset)
    item.group.add(model)
    item.lamp = model.getObjectByName(LAMP_NAME) ?? null
    if (item.lamp) {
      /*
       * 光の玉を灯にぶら下げる。**自分の物にだけ。** 敵に見せると置いた場所を
       * そのまま教えることになる (頭の説明)。
       *
       * **灯の子にする**ので、点滅で灯を消せば玉も一緒に消える (2 か所で
       * 出し入れしない)。灯の節には縮尺が掛かっている。そのまま付けると玉まで
       * 潰れるので、割り戻してから大きさを決める。
       */
      if (item.mine) {
        const halo = new THREE.Sprite(this.haloMaterial)
        halo.scale.set(
          LAMP_HALO / (item.lamp.scale.x || 1),
          LAMP_HALO / (item.lamp.scale.y || 1),
          1,
        )
        item.lamp.add(halo)
      }
      item.lamp.visible = false

      /*
       * 周りに落とす光。**全員に見せる。** 袋に置いて、灯の位置へ合わせる。
       *
       * 灯の位置は模型の中の節なので、袋から見た座標へ直す。倒れても袋ごと
       * 回るので、光は灯に付いて回る。
       */
      const light = new THREE.PointLight(this.lampColor, 0, LAMP_LIGHT_REACH, 2)
      light.castShadow = false
      item.group.updateMatrixWorld(true)
      light.position.copy(item.lamp.getWorldPosition(new THREE.Vector3()))
      item.group.worldToLocal(light.position)
      item.group.add(light)
      item.light = light
    }
  }

  /**
   * 灯を強く光らせる。**色は模型の物をそのまま使う。**
   *
   * 自己発光へ移して、露出の影響も外す (toneMapped: false)。暗い所に置かれた
   * 装置ほど見つけにくくなると、置き場所ではなく明るさが効き目を決めてしまう。
   *
   * 材質は模型の実体が持っていて、複製 (clone) どうしで共有している。
   * **1 度だけ触れば、置いた全部に効く。**
   */
  private brighten(lamp: THREE.Object3D): void {
    lamp.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        const lit = material as THREE.MeshStandardMaterial
        // 色はそのまま、**強さだけ**上げる。床に落とす光も同じ色
        if (lit.emissive && lit.color) {
          lit.emissive.copy(lit.color)
          this.lampColor.copy(lit.color)
        }
        if ('emissiveIntensity' in lit) lit.emissiveIntensity = LAMP_GLOW
        lit.toneMapped = false
        lit.needsUpdate = true
      }
    })
  }

  /** 壊れた / 消えた。**音を鳴らすのは呼び出し側の仕事** */
  remove(id: number): THREE.Vector3 | null {
    const index = this.live.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [item] = this.live.splice(index, 1)
    const at = item.group.position.clone()
    this.drop(item)
    return at
  }

  /**
   * 飛ばして、倒して、光らせて、波を広げる。
   *
   * @param onSplash 水に入った。**輪を出すのは呼ぶ側の仕事** (手榴弾と同じ形)。
   *   ここで出さないのは、水面の判定も音の大きさも Game 側が握っているため。
   */
  update(
    dt: number,
    world: SolidWorld,
    water: Water | null,
    onSplash?: (at: THREE.Vector3) => void,
    onBlink?: (at: THREE.Vector3) => void,
  ): void {
    this.onBlink = onBlink
    // 刻みはサーバーと同じ固定値。フレーム間隔で解くと軌道がずれる
    this.accumulator = Math.min(this.accumulator + dt, 0.25)
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP
      for (const item of this.live) {
        if (item.body.resting) continue
        stepProjectile(item.body, world, undefined, water)
        /*
         * 水に入った瞬間を 1 度だけ返す。
         *
         * **入った時しか分からない。** 沈み始めると `sunk` は立ちっぱなしに
         * なるので、控えを持って立ち上がりを捕まえる。水に入ったことを
         * 返さないと、**落ちた所に何も起きない** — 音も輪も出ないので、
         * 投げた本人にも「水に落ちた」が伝わらない。
         */
        if (item.body.sunk && !item.splashed) {
          item.splashed = true
          onSplash?.(this.splashPoint.set(item.body.x, item.body.y, item.body.z))
        }
      }
    }

    for (const item of this.live) {
      const previous = item.group.position.clone()
      item.group.position.set(item.body.x, item.body.y, item.body.z)
      if (!item.body.resting) {
        /*
         * 進んだぶんだけ転がす。速度から角速度を作ると、跳ねた瞬間に不自然に回る。
         *
         * **軸は進む向きと直角** (上 × 進む向き)。縦に転がる。
         *
         * `rotateX` / `rotateZ` を毎フレーム重ねてはいけない。あれは**物体の
         * 座標系**での回転なので、2 軸を交互に掛けると横回り (Y 軸) が溜まる
         * — 球 (手榴弾) では分からないが、縦長の物は**独楽のように横回転**する。
         * 世界の軸で回せば溜まらない。
         */
        const moved = item.group.position.distanceTo(previous)
        if (moved > 1e-4) {
          const dx = item.group.position.x - previous.x
          const dz = item.group.position.z - previous.z
          const flat = Math.hypot(dx, dz)
          // 真下へ落ちている間は向きが決まらない。回さずに落とす
          if (flat > 1e-5) {
            this.tumble.set(dz / flat, 0, -dx / flat)
            item.group.rotateOnWorldAxis(this.tumble, moved * SPIN)
          }
        }
        // **飛んでいる間は光らない。** 止まって初めて周りを見る
        this.lamp(item, false)
        continue
      }

      // 止まった刻みを 1 度だけ捉えて、そこから倒れ込ませる
      if (!item.settled) {
        item.settled = true
        this.layDown(item, SETTLE_SECONDS)
      }
      if (item.settling > 0) {
        item.settling = Math.max(0, item.settling - dt)
        const done = 1 - item.settling / SETTLE_SECONDS
        // 倒れ込みは**終わりほどゆっくり**。地面に当たって止まる動き
        const eased = 1 - (1 - done) * (1 - done)
        item.group.quaternion.slerpQuaternions(item.restFrom, item.restTo, eased)
        item.lift = item.liftFrom + (item.liftTo - item.liftFrom) * eased
      }
      // 倒れたぶんの持ち上げ。**位置を置き直した後に足す**
      item.group.position.y = item.body.y + item.lift

      /*
       * 水に沈んだら隠す。手榴弾と同じ — 水は不透明なので、本来なら水中の
       * 物は見えない。**沈んでも暴くのは止まらない** (それを決めるのは
       * サーバー) ので、見えないだけになる。
       */
      if (item.body.sunk) {
        item.group.visible = false
        continue
      }
      item.blink = (item.blink + dt) % BLINK_SECONDS
      this.lamp(item, item.blink < BLINK_ON)
      this.ripple(item, dt)
    }
  }

  /** 灯った刻みに呼ぶ。update() のたびに差し替える */
  private onBlink: ((at: THREE.Vector3) => void) | undefined

  /**
   * 灯を点ける / 消す。**灯と、床に落ちる光を一緒に。**
   *
   * 消えていた灯が点いた刻みだけ音にする (onBlink)。光と音が同じ刻みなので、
   * 音を聞いた側は「いま暴かれた」と読める。**灯の無いモデルでも鳴らす** —
   * 走査は灯ではなく物が行っている。
   */
  private lamp(item: Live, on: boolean): void {
    if (item.lamp) item.lamp.visible = on
    if (item.light) item.light.intensity = on ? LAMP_LIGHT : 0
    if (on && !item.lit) this.onBlink?.(item.group.position)
    item.lit = on
  }

  /**
   * 波を広げる。**自分の物だけ。**
   *
   * 中心から球で広がって、少し離れた所 (WAVE_RADIUS) で消える。
   * **暴ける端までは広げない** — 15m まで広げると画面を覆って前が見えない。
   *
   * 濃さは**先端が最も濃く、内側へ向かって薄れる**。時間でも薄れるので、
   * 大きく広がった頃には画面にほとんど残らない。
   */
  private ripple(item: Live, dt: number): void {
    if (!item.wave) return

    item.waveAt += dt
    if (item.waveAt >= WAVE_SECONDS) item.waveAt = 0

    if (item.waveAt > WAVE_GROW) {
      for (const layer of item.layers) layer.visible = false
      return
    }

    const grown = item.waveAt / WAVE_GROW
    /*
     * 端ほどゆっくり広がる。**等速だと最後に消える所が一番速く見える** —
     * 広がり切る瞬間に画面から弾け飛ぶような動きになる。
     */
    const eased = 1 - (1 - grown) * (1 - grown)
    const lead = WAVE_START + (WAVE_RADIUS - WAVE_START) * eased
    /*
     * 時間で薄れる分。**終わりほど速く消す。**
     *
     * 直線で引くと、一番大きく広がった所 (画面を覆う大きさ) にまだ濃さが
     * 残っていて、**画面に膜が張ったまま**に見える。広がりと同じ曲線で
     * 引けば、大きくなる頃にはほとんど消えている。
     */
    const fading = 1 - eased

    const step = WAVE_THICKNESS / WAVE_LAYERS
    for (let i = 0; i < item.layers.length; i++) {
      const layer = item.layers[i]!
      // 先頭 (i=0) が一番外。内側ほど後ろに下がる
      const radius = lead - i * step
      // 広がり始めは内側の層が中心を突き抜ける。出てくるまで隠す
      if (radius <= WAVE_START * 0.5) {
        layer.visible = false
        continue
      }
      layer.scale.setScalar(radius)
      layer.material.opacity = WAVE_OPACITY * fading * waveProfile(i)
      layer.visible = true
    }
  }

  /** 試合が切り替わったら全部消す */
  clear(): void {
    for (const item of this.live) this.drop(item)
    this.live.length = 0
  }

  /**
   * 場から外す。**模型の実体は捨てない。**
   *
   * clone(true) は形と材質を共有している。ここで dispose すると、**次に置いた
   * 装置が消える** (共有している物を壊してしまう)。袋から外すだけでよく、
   * 実体は読み込みの控え (this.model) が 1 つ持ち続ける。
   *
   * 波の材質だけは**その物のためだけに作った**ので、ここで捨てる。形
   * (waveShape) は使い回しているので捨てない。
   */
  private drop(item: Live): void {
    for (const layer of item.layers) layer.material.dispose()
    item.layers.length = 0
    item.group.removeFromParent()
  }
}

/**
 * 光の絵を描く。**中心から外へ滲んで消える滲みと、十字の筋。**
 *
 * --- なぜ絵にするか ---
 * 形のある物 (球) で光を作ると、**縁で硬く切れて塗った玉に見える**。光は
 * 縁が無いものなので、外へ向かって消えていく絵を板に貼るほうが近い。
 *
 * --- 十字は何か ---
 * 強い点光源を見たときに目やレンズの中で伸びる筋。**これが有ると「光って
 * いる」と読め、無いと「明るい点」に留まる**。細く鋭いほど強い光に見える。
 *
 * --- なぜ描いて作るか ---
 * 画像を 1 枚置けば済むが、滲み方を変えるたびに描き直して差し替えることに
 * なる。ここで作れば、数字を触るだけで形が変わる。
 */
function glowTexture(): THREE.CanvasTexture {
  const size = GLOW_PIXELS
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const mid = size / 2

  /*
   * 滲み。**中心の白い芯から、外へ急に落として長く尾を引く。**
   *
   * 直線で落とすと円盤に見える。近くを急に、遠くを緩く落とすと、芯が締まって
   * 周りだけがぼんやり残る — 光を見たときの見え方に近い。
   */
  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.12, 'rgba(255,255,255,0.72)')
  glow.addColorStop(0.3, 'rgba(255,255,255,0.26)')
  glow.addColorStop(0.6, 'rgba(255,255,255,0.06)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // 筋は滲みの上に重ねる。**加算** — 交わる中心だけが白く飛ぶ
  ctx.globalCompositeOperation = 'lighter'
  const reach = mid * FLARE_REACH
  /*
   * 太さの違う筋を 3 本重ねて、**太さの方向にも滲ませる。**
   *
   * 1 本だけだと、長さの方向は滲んでいるのに横は直線で切れる — 光の筋
   * ではなく細い棒になる。太く薄い物の上に細く濃い物を重ねる。
   */
  const passes = [
    { width: FLARE_WIDTH * 3, alpha: 0.2 },
    { width: FLARE_WIDTH * 1.6, alpha: 0.45 },
    { width: FLARE_WIDTH * 0.7, alpha: 0.8 },
  ]
  ctx.filter = `blur(${FLARE_BLUR}px)`
  for (const vertical of [false, true]) {
    for (const pass of passes) {
      const gradient = vertical
        ? ctx.createLinearGradient(0, mid - reach, 0, mid + reach)
        : ctx.createLinearGradient(mid - reach, 0, mid + reach, 0)
      // 端は 0。**根元から先へ向かって消える**ので、切れ目が出ない
      gradient.addColorStop(0, 'rgba(255,255,255,0)')
      gradient.addColorStop(0.5, `rgba(255,255,255,${pass.alpha})`)
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient
      if (vertical) ctx.fillRect(mid - pass.width, mid - reach, pass.width * 2, reach * 2)
      else ctx.fillRect(mid - reach, mid - pass.width, reach * 2, pass.width * 2)
    }
  }

  ctx.filter = 'none'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
