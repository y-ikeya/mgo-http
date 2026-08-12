import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadKnife, loadRifle, loadSniper } from './assets'
import { isMesh } from './guards'

/**
 * 武器ごとの取り付け設定。モデルは convert_gun.py で正規化済みで、
 * どれも「刃/銃身が -Z、上が +Y、原点は後端付近」の座標系に揃っている。
 */
export interface WeaponConfig {
  /** 右手が握る位置。手ボーンは手首にあるので、実機で合わせた値になっている */
  grip: THREE.Vector3
  /** 向きの微調整。両手の位置からは手首のひねりが決まらないため */
  rotation: THREE.Euler
  /** しゃがみ姿勢での値。無ければ立ちと同じものを使う */
  crouchGrip?: THREE.Vector3
  crouchRotation?: THREE.Euler
  /** 先端 (銃口 / 刃先)。トレーサーや判定の基準 */
  tip: THREE.Vector3
  /** 左手を添える位置。片手武器は null で、その場合 IK を掛けない */
}

const degrees = (value: number) => THREE.MathUtils.degToRad(value)

/**
 * ライフルの値はすべて実機で詰めたもの。
 * ハンドガードは断面プロファイルで銃身とマガジンの間にあたる位置。
 */
/**
 * AK-47。実寸 870mm に合わせてある。
 *
 * tip は頂点から実測した銃口 (最も -Z の点)。
 * grip / rotation は目で合わせた値。左手はクリップ側が既にハンドガードを
 * 握った姿勢を持っているので、コードで動かしていない。
 */
const RIFLE: WeaponConfig = {
  grip: new THREE.Vector3(-0.095, 0.145, -0.165),
  rotation: new THREE.Euler(degrees(-10), degrees(-16), degrees(80)),
  // しゃがむと上半身の角度が変わるので、同じ握り方では銃が体から浮く。
  // 姿勢ごとに値を持って、切り替わりの間は補間する。
  crouchGrip: new THREE.Vector3(-0.105, 0.14, -0.2),
  crouchRotation: new THREE.Euler(degrees(-34), degrees(-3), degrees(80)),
  tip: new THREE.Vector3(0, 0.171, -0.845),
}

/**
 * ナイフ (銃剣) は全長 0.3m の片手武器。
 * 柄は原点付近なので握り位置はほぼ原点。
 */
const KNIFE: WeaponConfig = {
  grip: new THREE.Vector3(0.02, -0.07, 0.025),
  // 向きは肘から手首への線から導くので、補正は刃の傾き (roll) が主になる
  rotation: new THREE.Euler(0, 0, 0),
  tip: new THREE.Vector3(0, 0, -0.24),
}

/**
 * 狙撃銃。銃口の位置はライフルと揃えてあるので、握りの値も近い所から始まる。
 * (convert_gltf_gun.py が銃口を同じ座標へ持ってくる)
 *
 * 実際の見え方は調整パネルで詰める。ここは出発点。
 */
const SNIPER: WeaponConfig = {
  grip: new THREE.Vector3(-0.02, 0.27, 0.11),
  rotation: new THREE.Euler(degrees(0), degrees(-10), degrees(-172)),
  crouchGrip: new THREE.Vector3(-0.01, 0.3, 0.02),
  crouchRotation: new THREE.Euler(degrees(-37), degrees(3), degrees(173)),
  tip: new THREE.Vector3(0, 0.177, -0.845),
}

/**
 * 角度を近いほうへ回して補間する。
 *
 * 成分ごとに素直に混ぜると、-172° から 173° へ動かすときに 345° 回る
 * (逆回りに一周する)。角度は 360° で一周する量なので、差を ±180° に
 * 畳んでから足す。
 */
function lerpAngle(from: number, to: number, t: number): number {
  const diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
  return from + (diff < -Math.PI ? diff + Math.PI * 2 : diff) * t
}

export const WEAPON_CONFIGS = { rifle: RIFLE, sniper: SNIPER, knife: KNIFE } as const
export type WeaponKind = keyof typeof WEAPON_CONFIGS

/**
 * 調整パネルが指す対象。銃は姿勢ごとに別の値を持つ。
 *
 * 立ちとしゃがみで上半身の角度が変わるので、同じ握り方では銃が体から浮く。
 */
export type WeaponTarget =
  | 'rifle'
  | 'rifleCrouch'
  | 'sniper'
  | 'sniperCrouch'
  | 'knife'

/**
 * キャラクターが持つ武器。
 *
 * 手ボーンの子として付けるが、ボーンのローカル座標系は Mixamo の骨格依存で
 * 直感的に読めない。そこでオフセットを直接書かず、構えのポーズにおける
 * 右手と左手のワールド位置から取り付け姿勢を計算して求める。
 * (ライフルは右手がグリップ、左手がハンドガードなので、両手を結ぶ線がほぼ銃身の向きになる)
 *
 * この方式なら、モデルや構えのモーションを差し替えても数値を調整し直さずに済む。
 */
export class Weapon {
  readonly object: THREE.Object3D
  readonly config: WeaponConfig

  /** 実機調整で上書きできるよう、設定は複製して持つ */
  private readonly grip: THREE.Vector3
  private readonly rotation: THREE.Euler
  private readonly crouchGrip: THREE.Vector3
  private readonly crouchRotation: THREE.Euler
  /** 今どちらの姿勢に寄っているか (0 = 立ち, 1 = しゃがみ) */
  private stance = -1
  private readonly blendGrip = new THREE.Vector3()
  private readonly blendRotation = new THREE.Euler()

  /**
   * 取り付け時の状態。再調整のたびにこれを基準に計算し直す。
   *
   * 手ボーンのワールド行列は毎フレーム動くので、取り付けた瞬間 (構えのポーズ) の
   * ものを保持しておく必要がある。現在の行列で計算すると調整するたびに基準がずれる。
   */
  private context: {
    handWorldInverse: THREE.Matrix4
    /** グリップを重ねる先。取り付ける手ボーンそのものの位置 */
    anchor: THREE.Vector3
    baseRotation: THREE.Quaternion
  } | null = null

  private constructor(object: THREE.Object3D, config: WeaponConfig) {
    this.object = object
    this.config = config
    this.grip = config.grip.clone()
    this.rotation = config.rotation.clone()
    this.crouchGrip = (config.crouchGrip ?? config.grip).clone()
    this.crouchRotation = (config.crouchRotation ?? config.rotation).clone()
    this.object.traverse((obj) => {
      if (isMesh(obj)) obj.castShadow = true
    })
  }

  /** 読み込みは共有キャッシュ。持ち主ごとに複製して返す */
  static async load(kind: WeaponKind = 'rifle'): Promise<Weapon> {
    const gltf =
      kind === 'knife' ? await loadKnife() : kind === 'sniper' ? await loadSniper() : await loadRifle()
    return new Weapon(cloneSkinned(gltf.scene), WEAPON_CONFIGS[kind])
  }

  set visible(value: boolean) {
    this.object.visible = value
  }

  /**
   * 手ボーンに取り付ける。呼ぶ前にモデルのワールド行列が構えのポーズで
   * 更新されている必要がある (バインドポーズのままだと T ポーズ基準で計算してしまう)。
   *
   * 向きはオフセットを直接書かず、骨格上の 2 点を結ぶ線から導く。
   * ライフルなら「右手 -> 左手」が銃身、ナイフなら「肘 -> 手首」が刃の向きになる。
   * こうしておくと、モデルや構えのモーションを差し替えても値の調整が要らない。
   *
   * @param axisFrom 向きの基準の始点
   * @param axisTo 向きの基準の終点。ここへ向かう方向が武器の -Z になる
   * @param handMatrix 手ボーンのワールド行列。省略すると今の姿勢から読む。
   *
   *   持ち替えのときは**最初に取り付けたときの行列**を渡す。その場の姿勢から
   *   取り直すと、しゃがんで構えている最中に持ち替えたときの手の向きが基準に
   *   なってしまい、銃が下を向く。基準は姿勢によらず 1 つでなければならない。
   */
  attachTo(
    hand: THREE.Bone,
    axisFrom: THREE.Vector3,
    axisTo: THREE.Vector3,
    handMatrix?: THREE.Matrix4,
  ): void {
    const forward = new THREE.Vector3().subVectors(axisTo, axisFrom)
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1)
    forward.normalize()

    // 銃の上方向はワールドの上を銃身と直交させたもの。両手だけでは軸回りの回転が決まらない。
    const up = new THREE.Vector3(0, 1, 0)
    if (Math.abs(up.dot(forward)) > 0.99) up.set(0, 0, 1)

    // 銃のローカル軸: -Z が forward なので +Z は逆向き
    const axisZ = forward.clone().negate()
    const axisX = new THREE.Vector3().crossVectors(up, axisZ).normalize()
    const axisY = new THREE.Vector3().crossVectors(axisZ, axisX)

    const baseRotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(axisX, axisY, axisZ),
    )

    hand.updateWorldMatrix(true, false)
    const reference = handMatrix ?? hand.matrixWorld
    this.context = {
      handWorldInverse: new THREE.Matrix4().copy(reference).invert(),
      // 基準は「取り付ける手」の位置。軸の始点/終点とは別物で、
      // 混同するとライフルが左手の位置を基準に付いてしまう。
      anchor: new THREE.Vector3().setFromMatrixPosition(reference),
      baseRotation,
    }

    hand.add(this.object)
    this.stance = -1
    this.applyStance(0)
  }

  /**
   * 姿勢に合わせて持ち方を変える。
   *
   * しゃがむと上半身の角度が変わるぶん、立ちと同じ握り方では銃が体から浮く。
   * 姿勢ごとの値の間を補間して、切り替わりで銃が跳ねないようにする。
   *
   * @param blend 0 = 立ち、1 = しゃがみ
   */
  applyStance(blend: number): void {
    // 変化が無ければ作り直さない。毎フレーム呼ばれる想定なので
    if (Math.abs(blend - this.stance) < 0.002) return
    this.stance = blend
    this.rebuild(blend)
  }

  /** 調整用に、姿勢ごとの値を差し替える。今の姿勢のまま反映する */
  setStanceValues(
    crouching: boolean,
    grip: THREE.Vector3,
    rotation: THREE.Euler,
  ): void {
    if (crouching) {
      this.crouchGrip.copy(grip)
      this.crouchRotation.copy(rotation)
    } else {
      this.grip.copy(grip)
      this.rotation.copy(rotation)
    }
    this.rebuild(Math.max(this.stance, 0))
  }

  private rebuild(blend: number): void {
    this.blendGrip.lerpVectors(this.grip, this.crouchGrip, blend)
    this.blendRotation.set(
      lerpAngle(this.rotation.x, this.crouchRotation.x, blend),
      lerpAngle(this.rotation.y, this.crouchRotation.y, blend),
      lerpAngle(this.rotation.z, this.crouchRotation.z, blend),
    )
    this.calibrate(this.blendGrip, this.blendRotation)
  }

  /**
   * 握り位置と追加回転を指定して取り付け姿勢を作り直す。
   * 調整用に毎フレーム呼んでも問題ない程度には軽い。
   */
  calibrate(grip: THREE.Vector3, extraRotation: THREE.Euler): void {
    const ctx = this.context
    if (!ctx) return

    const rotation = ctx.baseRotation
      .clone()
      .multiply(new THREE.Quaternion().setFromEuler(extraRotation))
    // グリップが手に重なるよう、原点を逆算する
    const origin = grip.clone().applyQuaternion(rotation).negate().add(ctx.anchor)
    const world = new THREE.Matrix4().compose(origin, rotation, new THREE.Vector3(1, 1, 1))

    // ボーンのローカルへ変換する。骨格側のスケール (Armature の 0.01) もここで相殺される
    const local = new THREE.Matrix4().copy(ctx.handWorldInverse).multiply(world)
    local.decompose(this.object.position, this.object.quaternion, this.object.scale)
  }

  /** 先端 (銃口 / 刃先) のワールド座標 */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.config.tip).applyMatrix4(this.object.matrixWorld)
  }

  /** 左手を持っていく先のワールド座標。片手武器なら null */


  dispose(): void {
    this.object.traverse((obj) => {
      if (!isMesh(obj)) return
      obj.geometry.dispose()
      const material = obj.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material.dispose()
    })
    this.object.removeFromParent()
  }
}
