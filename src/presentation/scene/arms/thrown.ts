import * as THREE from 'three'

/**
 * 投げた物。
 *
 * 落ちた場所で音を出すためだけにある。ダメージは無い。
 *
 * これが入るまで、音の出どころは全部自分の足元だった。つまり「待つ」は
 * 座って運を待つことでしかなく、仕掛ける手段が無かった。落ちる場所を選べると、
 * 相手の輪に**嘘の方向**を映せる。音は情報だが、その情報は騙せる、という段に進む。
 *
 * --- 通信の形 ---
 * 送るのは**投げ出す位置と向きだけ**。落下点も跳ねる場所も送らない。
 * 受け取った側が同じ物理を同じ地形に対して解くので、結果は一致する。
 *
 * この形にした理由が 2 つある。
 *
 *  1. 音の場所を捏造できない。落下点を直接送る形だと、壁の中でも地図の反対側でも
 *     好きな場所で音を鳴らせてしまう。囮は嘘をつくための道具なので、
 *     嘘のつき方こそ地形に縛られていてほしい。
 *  2. 跳ねるたびに通信しなくて済む。1 回の投擲で 3〜4 回音が鳴るが、送るのは 1 通。
 *
 * サーバーで解くのが本来だが、サーバーは地形を持っていない。持たせるのは
 * 選択的可視化と同じ準備作業なので、そこまでは各クライアントが解く。
 *
 * --- 見え方 ---
 * 飛んでいる姿は投げた本人にしか見えない。軌跡が見えると、囮のはずが
 * 「そこから投げた奴が居る」という手掛かりになって逆効果になる。
 * 落ちて止まった物は全員に見える。確かめに行けば囮だと分かる、という手を残す。
 */

/** 投げ出す速さ (m/s)。水平に投げて 7〜8m、少し上向きで 20m ほど */
const THROW_SPEED = 15
/** 重力 (m/s²) */
const GRAVITY = 9.8
/** 手を離れる位置を銃口から少し前へ (m) */
const RELEASE_FORWARD = 0.3
/** ぶつかった面から浮かせる量 (m)。めり込んで見えないようにする */
const SURFACE_OFFSET = 0.02

/**
 * 物理を進める刻み (秒)。
 *
 * フレーム間隔ではなく固定値で解く。各クライアントが自分のフレームレートで
 * 解くと軌道が少しずつ食い違い、跳ねるたびに差が開いて別の場所へ落ちる。
 * 刻みを固定すれば、誰が解いても同じ道を通る。
 */
const FIXED_STEP = 1 / 60

/**
 * 跳ね返りの強さ。面に垂直な速度がどれだけ残るか。
 *
 * 金属をコンクリートへ落としたときの跳ね方に寄せてある。よく跳ねると
 * どこへ行くか読めなくなり、狙って落とす道具として使えなくなる。
 */
const RESTITUTION = 0.36
/** 面に沿う速度がどれだけ残るか。1 なら滑り続ける */
const FRICTION = 0.72
/** これ以下の速さになったら止まったとみなす (m/s) */
const REST_SPEED = 1.1
/** 跳ねる回数の上限。無限に細かく跳ね続けるのを防ぐ */
const MAX_BOUNCES = 3

/** 落ちてから消えるまで (秒)。確かめに行く時間を見込んだ長さ */
const LINGER = 10

/** 予測線の分割数。最初に当たるところまでしか描かないので、長い放物線が収まれば足りる */
const PREVIEW_STEPS = 90

interface Item {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  bounces: number
  /** 止まったか。止まったら物理を切って、消えるまで置いておく */
  resting: boolean
  /** 止まってからの経過 (秒) */
  age: number
  /** 他人が投げたものか。音を輪に出すかどうかが変わる */
  remote: boolean
}

/** 面に当たったときに渡す情報 */
export interface Impact {
  position: THREE.Vector3
  /** 当たりの強さ (0..1)。垂直に叩きつけるほど大きい */
  strength: number
  /** 他人が投げたものか */
  remote: boolean
}

export class ThrownItems {
  private readonly scene: THREE.Scene
  private readonly geometry: THREE.BoxGeometry
  private readonly material: THREE.MeshStandardMaterial
  private readonly items: Item[] = []
  /** 固定刻みで進めるための余り */
  private accumulator = 0

  private readonly next = new THREE.Vector3()
  private readonly step = new THREE.Vector3()
  private readonly normal = new THREE.Vector3()
  private readonly tangent = new THREE.Vector3()
  private readonly normalMatrix = new THREE.Matrix3()
  private readonly raycaster = new THREE.Raycaster()
  private readonly impact: Impact = {
    position: new THREE.Vector3(),
    strength: 0,
    remote: false,
  }

  /** 構えている間に出す予測線と、落下点の印 */
  private readonly preview: THREE.Line
  private readonly marker: THREE.Mesh
  private readonly previewPoints: Float32Array
  private readonly cursor = new THREE.Vector3()
  private readonly previewVelocity = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    // 弾倉くらいの大きさ。細かい形は要らない
    this.geometry = new THREE.BoxGeometry(0.03, 0.11, 0.06)
    this.material = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.5,
      metalness: 0.8,
    })

    this.previewPoints = new Float32Array(PREVIEW_STEPS * 3)
    const previewGeometry = new THREE.BufferGeometry()
    previewGeometry.setAttribute('position', new THREE.BufferAttribute(this.previewPoints, 3))
    this.preview = new THREE.Line(
      previewGeometry,
      // 露出に左右されない。狙いを付けるための線なので、明るさが変わっても読めてほしい
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7,
        toneMapped: false,
      }),
    )
    this.preview.visible = false
    this.preview.frustumCulled = false
    scene.add(this.preview)

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        toneMapped: false,
      }),
    )
    this.marker.visible = false
    scene.add(this.marker)
  }

  /**
   * 投げる。
   *
   * @param direction 投げる向き (正規化済み)。照準の向きをそのまま渡す
   * @param remote 他人が投げたものか。飛んでいる間は隠す
   */
  throwFrom(origin: THREE.Vector3, direction: THREE.Vector3, remote = false): void {
    const mesh = new THREE.Mesh(this.geometry, this.material)
    mesh.castShadow = true
    mesh.position.copy(origin).addScaledVector(direction, RELEASE_FORWARD)
    // 他人の投擲は軌跡を見せない。投げた場所が割れると囮にならない
    mesh.visible = !remote
    this.scene.add(mesh)

    this.items.push({
      mesh,
      velocity: direction.clone().multiplyScalar(THROW_SPEED),
      bounces: 0,
      resting: false,
      age: 0,
      remote,
    })
  }

  /**
   * 飛ばして、跳ねさせて、止める。
   *
   * @param collidables 地形。弾と同じ対象を渡す
   * @param onImpact 面に当たるたびに呼ぶ。音を鳴らすのは呼び出し側の仕事
   */
  update(
    dt: number,
    collidables: readonly THREE.Object3D[],
    onImpact: (impact: Impact) => void,
  ): void {
    // 消える処理だけは実時間で進める。見た目の話なので刻みを揃える必要がない
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      if (!item.resting) continue
      item.age += dt
      if (item.age >= LINGER) {
        item.mesh.removeFromParent()
        this.items.splice(i, 1)
      }
    }

    // 物理は固定刻み。フレームレートで軌道が変わらないようにする。
    // 溜めすぎると復帰時に一気に進むので、上限を切る。
    this.accumulator = Math.min(this.accumulator + dt, FIXED_STEP * 8)
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP
      for (const item of this.items) {
        if (!item.resting) this.advance(item, collidables, onImpact)
      }
    }
  }

  /** 1 刻みぶん進める */
  private advance(
    item: Item,
    collidables: readonly THREE.Object3D[],
    onImpact: (impact: Impact) => void,
  ): void {
    item.velocity.y -= GRAVITY * FIXED_STEP
    this.next.copy(item.mesh.position).addScaledVector(item.velocity, FIXED_STEP)

    // 進む線分で地形を見る。速いので、位置だけ見ていると薄い床をすり抜ける
    this.step.subVectors(this.next, item.mesh.position)
    const distance = this.step.length()
    if (distance <= 1e-6) return
    this.step.divideScalar(distance)

    this.raycaster.set(item.mesh.position, this.step)
    this.raycaster.far = distance
    const hit = this.raycaster.intersectObjects(collidables as THREE.Object3D[], false)[0]
    if (!hit) {
      item.mesh.position.copy(this.next)
      // 回りながら飛ぶ。落ちるまでの目印にしかならないので向きは適当でよい
      item.mesh.rotation.x += FIXED_STEP * 12
      item.mesh.rotation.z += FIXED_STEP * 7
      return
    }

    this.surfaceNormal(hit)
    item.mesh.position.copy(hit.point).addScaledVector(this.normal, SURFACE_OFFSET)

    // 面に垂直な成分と、面に沿う成分に分ける
    const into = item.velocity.dot(this.normal)
    this.tangent.copy(item.velocity).addScaledVector(this.normal, -into)

    this.impact.position.copy(item.mesh.position)
    // 音の強さは面へ叩きつけた速さで決まる。垂直に落ちるほど大きい
    this.impact.strength = Math.min(Math.abs(into) / THROW_SPEED, 1)
    this.impact.remote = item.remote
    onImpact(this.impact)

    item.bounces++
    if (item.bounces > MAX_BOUNCES) {
      this.rest(item)
      return
    }

    // 跳ね返す。垂直成分を反転して減らし、沿う成分は摩擦で削る
    item.velocity.copy(this.tangent).multiplyScalar(FRICTION)
    item.velocity.addScaledVector(this.normal, -into * RESTITUTION)
    if (item.velocity.length() < REST_SPEED) this.rest(item)
  }

  private rest(item: Item): void {
    item.velocity.set(0, 0, 0)
    item.resting = true
    item.age = 0
    // 止まったら誰にでも見える。音を確かめに来た相手に「物だった」と分からせる
    item.mesh.visible = true
    item.mesh.rotation.set(Math.PI / 2, 0, 0)
  }

  /** 当たった面の法線をワールド空間で求める */
  private surfaceNormal(hit: THREE.Intersection): void {
    this.normal.set(0, 1, 0)
    if (!hit.face) return
    this.normalMatrix.getNormalMatrix(hit.object.matrixWorld)
    this.normal.copy(hit.face.normal).applyNormalMatrix(this.normalMatrix).normalize()
  }

  /**
   * 落ちる場所を前もって見せる。
   *
   * 実際に飛ばすときと同じ式・同じ定数・同じ刻みで解く。別々に書くと、線と着弾が
   * 少しずつ食い違って、予測が信用できなくなる。
   *
   * 見せるのは**最初に当たる場所まで**。跳ね返った先まで描くと線が長く折れ曲がって、
   * 肝心の「どこへ当てるか」が読みにくくなる。跳ねた先は狙って当てるものではなく、
   * 投げた後に起きることなので、構えている間に知る必要がない。
   */
  showPreview(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    collidables: readonly THREE.Object3D[],
  ): void {
    this.cursor.copy(origin).addScaledVector(direction, RELEASE_FORWARD)
    this.previewVelocity.copy(direction).multiplyScalar(THROW_SPEED)

    let count = 0
    for (let i = 0; i < PREVIEW_STEPS - 1; i++) {
      this.previewPoints[count * 3] = this.cursor.x
      this.previewPoints[count * 3 + 1] = this.cursor.y
      this.previewPoints[count * 3 + 2] = this.cursor.z
      count++

      this.previewVelocity.y -= GRAVITY * FIXED_STEP
      this.next.copy(this.cursor).addScaledVector(this.previewVelocity, FIXED_STEP)

      this.step.subVectors(this.next, this.cursor)
      const distance = this.step.length()
      if (distance <= 1e-6) break
      this.step.divideScalar(distance)

      this.raycaster.set(this.cursor, this.step)
      this.raycaster.far = distance
      const hit = this.raycaster.intersectObjects(collidables as THREE.Object3D[], false)[0]
      if (!hit) {
        this.cursor.copy(this.next)
        continue
      }

      // 最初に当たったところで止める
      this.surfaceNormal(hit)
      this.cursor.copy(hit.point).addScaledVector(this.normal, SURFACE_OFFSET)
      break
    }

    // 止まる場所を必ず含める
    this.previewPoints[count * 3] = this.cursor.x
    this.previewPoints[count * 3 + 1] = this.cursor.y
    this.previewPoints[count * 3 + 2] = this.cursor.z
    count++

    this.preview.geometry.setDrawRange(0, count)
    this.preview.geometry.attributes.position.needsUpdate = true
    this.preview.visible = true
    this.marker.position.copy(this.cursor)
    this.marker.visible = true
  }

  hidePreview(): void {
    this.preview.visible = false
    this.marker.visible = false
  }

  dispose(): void {
    for (const item of this.items) item.mesh.removeFromParent()
    this.items.length = 0
    this.geometry.dispose()
    this.material.dispose()
    this.preview.geometry.dispose()
    ;(this.preview.material as THREE.Material).dispose()
    this.preview.removeFromParent()
    this.marker.geometry.dispose()
    ;(this.marker.material as THREE.Material).dispose()
    this.marker.removeFromParent()
  }
}
