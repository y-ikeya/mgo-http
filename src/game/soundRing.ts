import * as THREE from 'three'
import { damp } from './math'
import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { Line2NodeMaterial } from 'three/webgpu'

/**
 * 音の輪。
 *
 * キャラの腰の高さに円を描き、音が聞こえた方向にだけ振幅が立つ。
 * HUD の枠ではなく世界の中に出るので、視線を照準から外さずに読める。
 * ワールド基準で描くため、画面のどちら側に山が出たかがそのまま向きになり、
 * 「レーダーの上が自分の前」といった読み替えが要らない。
 *
 * 情報として持たせるのは**方向と大きさだけ**。距離は出さない。
 * 「あっちで誰かが動いた」までは分かるが「どれだけ近いか」は分からない、
 * という程度に留めることで、音を聞いてから確かめに行く判断が残る。
 *
 * 通信には一切出さない。これは世界に在るものではなく、その人の知覚を
 * 可視化したもので、同じ場所に立っていても二人の輪は別のものを映す。
 *
 * 線は Line2 で描く。WebGL の素の線は太さが 1px に固定されていて、
 * LineBasicMaterial の linewidth が効かないため。
 */

/** 円の分割数。多いほど山が滑らかになる */
const SEGMENTS = 160
/** 円の半径 (m)。キャラの周りに置いても邪魔にならない大きさ */
const RADIUS = 1.7
/**
 * 山の最大の高さ (m)。強さ 1 の音でこれだけ上へ伸びる。
 *
 * 外へ広げるのではなく真上へ立てる。円の大きさが変わらないので、
 * どこに立ったかを円周上の位置で読める。外へ広げると、山が出た側だけ
 * 円が歪んで、方向と大きさが混ざって読みにくい。
 */
const PEAK_HEIGHT = 0.45
/**
 * 山の鋭さ (rad)。小さいほど尖る。
 *
 * 尖らせすぎると分割の粗さが見えてギザギザになり、鈍らせすぎると
 * 方向が読めなくなる。分割 160 なら 1 区間が 0.039 rad なので、
 * その 3 倍ほどを目安にする。
 */
const PEAK_WIDTH = 0.11
/** 印が消えるまで (秒) */
const PING_DURATION = 1.6
/** 線の太さ (px)。画面上の太さなので、離れても細らない */
const LINE_WIDTH = 2.6
/** 何も邪魔されていないときの濃さ */
const BASE_OPACITY = 0.95
/**
 * 最後に自分が音を出してから、塞がったままでいる時間 (秒)。
 *
 * 足音の間隔より長くしないと、一歩ごとに輪が戻って点滅する
 * (走りで 0.33 秒、しゃがみで 0.38 秒、ダンボールで 0.43 秒ごとに鳴る)。
 * 減衰だけで表そうとすると、合間に戻らないほど遅くした結果、
 * 止まってから聞こえるまでが何秒もかかることになる。保持と減衰を分ける。
 */
const NOISE_HOLD = 0.5
/** 保持が明けてから聞こえるようになる速さ。大きいほど早い */
const NOISE_RECOVERY = 9

export type PingKind = 'step' | 'roll' | 'shot' | 'hit'

/**
 * 山の色。基本は白。
 *
 * 音の種類で色を分けない。方向と大きさだけを伝える表示なので、そこに
 * 「何の音か」まで載せると読む情報が増える。撃たれたのか歩かれたのかは
 * 音そのもので分かる。
 *
 * 被弾だけは別。これは「音が聞こえた」ではなく「撃たれた」という別種の情報で、
 * 見た瞬間に他と区別できる必要がある。
 */
const PEAK_COLOR = new THREE.Color(0xffffff)
const HIT_COLOR = new THREE.Color(0xff3b24)

/**
 * 被弾の山が残る時間 (秒)。音の山より長い。
 *
 * 撃たれた方向は探しに行く必要があるので、向き直る余裕を見込んで長く残す。
 * ただし出るのは集中しているときだけ。撃たれた瞬間に走って逃げれば見えない。
 */
const ALERT_DURATION = 2

/**
 * 何も鳴っていないときの輪の色。
 *
 * 山と同じ白だが暗い。色相を変えず明るさだけで差を付けることで、
 * 「同じものが光った」ように見える。常時出ているものなので、
 * 静かなときは背景に沈んでいてほしい。
 */
const BASE_COLOR = new THREE.Color(0xb4b4b4)

interface Ping {
  /** ワールド基準の方位 (rad)。0 が -Z 方向 */
  bearing: number
  strength: number
  kind: PingKind
  /** 経過時間 (秒) */
  age: number
}

export class SoundRing {
  private readonly line: Line2
  private readonly material: Line2NodeMaterial
  /** 各点の座標と色。区間の配列へ詰め替える前の作業用 */
  private readonly points = new Float32Array((SEGMENTS + 1) * 3)
  private readonly pointColors = new Float32Array((SEGMENTS + 1) * 3)
  /**
   * Line2 が実際に読む区間の配列。
   *
   * 毎フレーム setPositions を呼ぶと、そのたびにバッファを作り直してゴミが出る。
   * 1 回だけ作って、以降は中身を直接書き換える。
   */
  private readonly positionBuffer: THREE.InstancedInterleavedBuffer
  private readonly colorBuffer: THREE.InstancedInterleavedBuffer

  private readonly pings: Ping[] = []
  /**
   * 自分が出している音の大きさ (0..1)。
   *
   * 自分の足音や銃声で耳が塞がる、という扱い。走れば何も聞こえず、
   * しゃがんで動けば薄く残り、止まれば全部聞こえる。
   * 「静かに動く」ことが、隠れるためだけでなく**聞くため**にも要るようになる。
   */
  private selfNoise = 0
  /** 塞がったままでいる残り時間 (秒) */
  private noiseHold = 0

  constructor(scene: THREE.Scene) {
    const geometry = new LineGeometry()
    // 中身は毎フレーム書き換えるので、ここでは形だけ確保する
    this.buildPoints()
    geometry.setPositions(this.points)
    geometry.setColors(this.pointColors)

    this.material = new Line2NodeMaterial({
      linewidth: LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      // Line2NodeMaterial は既定で合成を切っている (線は端の処理で抜くため)。
      // ここは半透明で重ねたいので明示的に戻す
      blending: THREE.NormalBlending,
      // キャラの体に隠れる。腰の高さに置いてあるので、輪の手前半分だけが見え、
      // 背中側は体の向こうに回り込む。奥行きが出て、地面に描かれた図ではなく
      // 体の周りを取り巻いているものとして読める。
      depthTest: true,
      // 露出には左右させない。画面の明るさを変えても読みやすさが変わらないように。
      toneMapped: false,
    })

    this.line = new Line2(geometry, this.material)
    this.line.frustumCulled = false
    scene.add(this.line)

    // Line2 の頂点属性は 1 本のインターリーブされたバッファを共有している。
    // その実体を掴んでおいて、以降は中身だけを書き換える。
    this.positionBuffer = (
      geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
    ).data as THREE.InstancedInterleavedBuffer
    this.colorBuffer = (
      geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
    ).data as THREE.InstancedInterleavedBuffer
  }

  /**
   * 音が聞こえたことを記録する。
   *
   * @param bearing ワールド基準の方位 (rad)
   * @param strength 聞こえた強さ (0..1)
   */
  ping(bearing: number, strength: number, kind: PingKind): void {
    this.pings.push({ bearing, strength, kind, age: 0 })
  }

  /**
   * 撃たれた方向を記録する。距離では減衰しない。
   *
   * 見えるのは集中しているときだけ。撃たれてすぐ走り出せば方向は分からず、
   * 屈んで止まれば分かる。撃たれた直後にどう動くかが判断になる。
   *
   * @param bearing ワールド基準の方位 (rad)
   */
  hitFrom(bearing: number): void {
    this.pings.push({ bearing, strength: 1, kind: 'hit', age: 0 })
  }

  /**
   * 自分が音を出したことを知らせる。輪がその大きさぶん見えなくなる。
   *
   * @param level 0..1。走りの足音や銃声が 1、しゃがみは小さい
   */
  suppress(level: number): void {
    this.selfNoise = Math.max(this.selfNoise, level)
    this.noiseHold = NOISE_HOLD
  }

  /**
   * 円を組み直す。毎フレーム呼ぶ。
   *
   * @param height 足元からの高さ (m)。腰のあたりに置く。姿勢に追従させると、
   *   しゃがめば輪も下がるので、姿勢が変わったことが自分でも分かる
  /**
   * @param listening 耳を澄ませている度合い (0..1)。しゃがんでいないときは 0。
   *   自分の音による目減りとは別に掛かる
   */
  update(dt: number, center: THREE.Vector3, height: number, listening: number): void {
    this.line.position.set(center.x, center.y + height, center.z)

    // 鳴らしている間は塞がったまま。鳴り止んでから戻る。
    if (this.noiseHold > 0) this.noiseHold -= dt
    else this.selfNoise = damp(this.selfNoise, 0, NOISE_RECOVERY, dt)

    this.material.opacity = BASE_OPACITY * (1 - this.selfNoise) * listening
    // 完全に消えているなら描かない
    this.line.visible = this.material.opacity > 0.02
    if (!this.line.visible) {
      // 見えていない間も時間は進める。戻ったときに古い山が残っていると、
      // もう鳴り終わった音がそこにあるように見える。
      for (let i = this.pings.length - 1; i >= 0; i--) {
        this.pings[i].age += dt
        if (this.pings[i].age >= durationOf(this.pings[i])) this.pings.splice(i, 1)
      }
      return
    }

    // 古いものから落とす
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].age += dt
      if (this.pings[i].age >= durationOf(this.pings[i])) this.pings.splice(i, 1)
    }

    this.buildPoints()
    this.uploadSegments()
  }

  dispose(): void {
    this.line.geometry.dispose()
    this.material.dispose()
    this.line.removeFromParent()
  }

  /** 円周上の各点の座標と色を決める */
  private buildPoints(): void {
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2

      let amplitude = 0
      let hitWeight = 0
      for (const ping of this.pings) {
        // 鳴った瞬間が最も高く、そこから緩やかに落ちる。
        // 消えるまでに向き直る余裕がある長さにしてある。
        const duration = ping.kind === 'hit' ? ALERT_DURATION : PING_DURATION
        const life = 1 - ping.age / duration
        if (life <= 0) continue
        const fade = life * life
        const bump = gaussian(angleDelta(angle, ping.bearing)) * ping.strength * fade
        if (bump <= 0) continue
        amplitude += bump
        if (ping.kind === 'hit') hitWeight += bump
      }

      const index = i * 3
      // ワールドの向きで置く。円は回転させないので、山の出た方向が
      // そのまま音のした方向になる。半径は変えず、高さだけを立てる。
      this.points[index] = Math.sin(angle) * RADIUS
      this.points[index + 1] = Math.min(amplitude, 1.6) * PEAK_HEIGHT
      this.points[index + 2] = -Math.cos(angle) * RADIUS

      // 山が立った部分ほど明るくなる。被弾の寄与が大きいところは赤へ寄る。
      const mix = Math.min(amplitude, 1)
      const hit = amplitude > 0 ? hitWeight / amplitude : 0
      const pr = PEAK_COLOR.r + (HIT_COLOR.r - PEAK_COLOR.r) * hit
      const pg = PEAK_COLOR.g + (HIT_COLOR.g - PEAK_COLOR.g) * hit
      const pb = PEAK_COLOR.b + (HIT_COLOR.b - PEAK_COLOR.b) * hit
      this.pointColors[index] = BASE_COLOR.r + (pr - BASE_COLOR.r) * mix
      this.pointColors[index + 1] = BASE_COLOR.g + (pg - BASE_COLOR.g) * mix
      this.pointColors[index + 2] = BASE_COLOR.b + (pb - BASE_COLOR.b) * mix
    }
  }

  /**
   * 点の列を区間の列へ詰め替える。
   *
   * Line2 は 1 区間あたり「始点 xyz / 終点 xyz」の 6 要素で持つ。
   * 隣り合う点を重複して書くことになるが、そのぶん線に太さを持たせられる。
   */
  private uploadSegments(): void {
    const positions = this.positionBuffer.array
    const colors = this.colorBuffer.array

    for (let i = 0; i < SEGMENTS; i++) {
      const to = i * 6
      const from = i * 3
      for (let k = 0; k < 3; k++) {
        positions[to + k] = this.points[from + k]
        positions[to + 3 + k] = this.points[from + 3 + k]
        colors[to + k] = this.pointColors[from + k]
        colors[to + 3 + k] = this.pointColors[from + 3 + k]
      }
    }
    this.positionBuffer.needsUpdate = true
    this.colorBuffer.needsUpdate = true
  }
}

/** 被弾の印だけは長く残す。向き直って探すのに時間が要る */
function durationOf(ping: Ping): number {
  return ping.kind === 'hit' ? ALERT_DURATION : PING_DURATION
}

/** 2 つの角度の差。-π..π に収める */
function angleDelta(a: number, b: number): number {
  return ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI
}

/** 山の形。中心で 1、離れるほど 0 に近づく */
function gaussian(delta: number): number {
  const t = delta / PEAK_WIDTH
  return Math.exp(-t * t)
}
