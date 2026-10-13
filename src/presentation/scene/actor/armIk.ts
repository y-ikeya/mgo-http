import * as THREE from 'three'

/**
 * 腕を曲げ直して、手首を目標へ届かせる (2 関節の IK)。
 *
 * 構えの補正 (weapon.ts の aimTrim) で銃を握りを支点に回すと、ハンドガードを
 * 支えている左手が置いていかれる。**左手は銃の同じ所を握ったまま付いてくる**
 * べきなので、型が置いた腕を、肩と肘で曲げ直す。
 *
 * 肘の曲がる向き (肘がどちらへ張り出すか) は元の姿勢のまま残す。長さは変えない
 * — 届かない所へは、伸ばし切った所で止める。
 *
 * @param upper 肩から肘の骨 (LeftArm)
 * @param lower 肘から手首の骨 (LeftForeArm)
 * @param end 手首 (LeftHand)
 * @param target 手首を持っていく先 (世界)
 * @param endRotation 手首の向き (世界)。省略すると型のまま
 */
export function reachTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  endRotation?: THREE.Quaternion,
): void {
  upper.updateWorldMatrix(true, true)
  const shoulder = new THREE.Vector3().setFromMatrixPosition(upper.matrixWorld)
  const elbow = new THREE.Vector3().setFromMatrixPosition(lower.matrixWorld)
  const wrist = new THREE.Vector3().setFromMatrixPosition(end.matrixWorld)

  const a = elbow.distanceTo(shoulder)
  const b = wrist.distanceTo(elbow)
  if (a < 1e-5 || b < 1e-5) return
  const toTarget = target.clone().sub(shoulder)
  const reach = THREE.MathUtils.clamp(toTarget.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4)
  const along = toTarget.lengthSq() < 1e-10 ? wrist.clone().sub(shoulder).normalize() : toTarget.normalize()

  // 肘の張り出す向き = 元の肘の、肩→手首の線からの外れ
  const reference = wrist.clone().sub(shoulder).normalize()
  const pole = elbow.clone().sub(shoulder)
  pole.addScaledVector(reference, -pole.dot(reference))
  // 新しい線に直交させる。真っすぐ伸びていて向きが無ければ、下へ張り出す
  pole.addScaledVector(along, -pole.dot(along))
  if (pole.lengthSq() < 1e-10) pole.set(0, -1, 0).addScaledVector(along, -along.y)
  pole.normalize()

  // 余弦定理で肘の位置を決める
  const cosA = THREE.MathUtils.clamp((a * a + reach * reach - b * b) / (2 * a * reach), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  const newElbow = shoulder.clone().addScaledVector(along, a * cosA).addScaledVector(pole, a * sinA)

  // 上腕: 元の肩→肘を新しい肩→肘へ回す
  rotateBoneWorld(upper, elbow.clone().sub(shoulder), newElbow.clone().sub(shoulder))
  upper.updateWorldMatrix(false, true)

  // 前腕: 回した後の肘→手首を、肘→目標へ回す
  const elbowNow = new THREE.Vector3().setFromMatrixPosition(lower.matrixWorld)
  const wristNow = new THREE.Vector3().setFromMatrixPosition(end.matrixWorld)
  const goal = shoulder.clone().addScaledVector(along, reach)
  rotateBoneWorld(lower, wristNow.sub(elbowNow), goal.sub(elbowNow))
  lower.updateWorldMatrix(false, true)

  if (endRotation) setWorldQuaternion(end, endRotation)
}

/** 骨を世界の向きで from → to へ回す (親の空間へ直して書く) */
function rotateBoneWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return
  const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize())
  const world = bone.getWorldQuaternion(new THREE.Quaternion())
  setWorldQuaternion(bone, delta.multiply(world))
}

function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion): void {
  const parent = bone.parent
  const parentWorld = parent ? parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
  bone.quaternion.copy(parentWorld.invert().multiply(world))
  bone.updateWorldMatrix(false, true)
}

/** 銃の補正 (Weapon.aimCorrection) を受け取れる物 */
interface Corrected {
  aimCorrection(outDelta: THREE.Quaternion, outPivot: THREE.Vector3): boolean
  leftHandTarget(outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): boolean
  readonly aimAmount: number
}

/**
 * **銃が構えの補正で回った分だけ、左手を付いていかせる。** 自機 (Soldier) と
 * 相手 (RemoteSoldier) が同じ物を使う。
 *
 * 左手が銃のどこを握っているかは書かない — 回す前に手首があった所を、握りを
 * 支点に同じだけ回した所へ運ぶ。手首の向きも同じだけ回す。骨は最初に 1 度だけ探す
 */
export class LeftArmFollow {
  private bones: { upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D } | null = null
  private searched: THREE.Object3D | null = null
  private readonly delta = new THREE.Quaternion()
  private readonly pivot = new THREE.Vector3()
  private readonly wrist = new THREE.Vector3()
  private readonly turn = new THREE.Quaternion()
  private readonly hold = new THREE.Vector3()
  private readonly holdTurn = new THREE.Quaternion()
  /**
   * 曲げる前の骨の向き。**次のコマで型を当てる前に戻す** (restore)。
   * 型は骨を毎コマ書き直すとは限らないので、戻さないと曲げがコマごとに積もって
   * 手首が回り続けた (2026-10-10 本人: M4 のしゃがみ構えで左手がクルクル回る)
   */
  private saved: THREE.Quaternion[] | null = null

  /** 前のコマで曲げた骨を元へ戻す。**型を当てる (animator.update) 前に呼ぶ** */
  restore(): void {
    if (!this.saved || !this.bones) return
    const { upper, lower, end } = this.bones
    upper.quaternion.copy(this.saved[0])
    lower.quaternion.copy(this.saved[1])
    end.quaternion.copy(this.saved[2])
    this.saved = null
  }

  /** 型を当てて銃を置いた**後**に呼ぶ (骨の世界行列が新しいこと) */
  /**
   * @param moved 右手をずらした量 (世界、RightArmShift.moved)。銃が一緒に動いたので、
   *   置き場所 (leftHand) の無い銃では左手も同じだけ動かす
   */
  apply(model: THREE.Object3D, weapon: Corrected | null, moved?: THREE.Vector3): void {
    if (!weapon) return
    if (this.searched !== model) {
      this.searched = model
      const find = (suffix: string) => {
        let hit: THREE.Object3D | null = null
        model.traverse((o) => {
          if (!hit && o.name.endsWith(suffix) && (o as THREE.Bone).isBone) hit = o
        })
        return hit as THREE.Object3D | null
      }
      const upper = find('LeftArm')
      const lower = find('LeftForeArm')
      const end = find('LeftHand')
      this.bones = upper && lower && end ? { upper, lower, end } : null
    }
    if (!this.bones) return
    const { upper, lower, end } = this.bones
    /*
     * 銃に左手の置き場所 (leftHand) があればそこへ。構えの掛かり具合で寄せる
     */
    if (weapon.leftHandTarget(this.hold, this.holdTurn)) {
      const weight = weapon.aimAmount
      this.saved = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()]
      end.updateWorldMatrix(true, false)
      this.wrist.setFromMatrixPosition(end.matrixWorld)
      const target = this.wrist.lerp(this.hold, weight)
      this.turn.copy(end.getWorldQuaternion(new THREE.Quaternion())).slerp(this.holdTurn, weight)
      reachTwoBone(upper, lower, end, target, this.turn)
      return
    }
    const rotated = weapon.aimCorrection(this.delta, this.pivot)
    const shifted = moved !== undefined && moved.lengthSq() > 1e-8
    if (!rotated && !shifted) return
    this.saved = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()]
    end.updateWorldMatrix(true, false)
    this.wrist.setFromMatrixPosition(end.matrixWorld)
    if (!rotated) {
      this.delta.identity()
      this.pivot.copy(this.wrist)
    }
    /*
     * 銃が回った分を回す (支点は握り)。右手をずらした分は、その支点ごと動いている —
     * 回す前の手首の位置を「ずらす前の銃」に対して取っているので、ずらした量を足す
     */
    // 支点 (握り) はずらした後の銃から取っているので、ずらす前へ戻してから回す
    if (rotated && shifted) this.pivot.sub(moved)
    const target = this.wrist.sub(this.pivot).applyQuaternion(this.delta).add(this.pivot)
    if (shifted) target.add(moved)
    this.turn.copy(this.delta).multiply(end.getWorldQuaternion(new THREE.Quaternion()))
    reachTwoBone(upper, lower, end, target, this.turn)
  }
}

/**
 * **構えている間、右手首を体の空間でずらす** (weapon.ts の rightShift)。銃は右手に
 * 付いているので一緒に動く。手首の向きは変えないので、銃口の向きは変わらない。
 * 左手は後で LeftArmFollow が銃の決まった所へ運び直す。
 *
 * 曲げた骨は次のコマで型を当てる前に戻す (restore)。LeftArmFollow と同じ
 */
export class RightArmShift {
  private bones: { upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D } | null = null
  private searched: THREE.Object3D | null = null
  private saved: THREE.Quaternion[] | null = null

  restore(): void {
    if (!this.saved || !this.bones) return
    const { upper, lower, end } = this.bones
    upper.quaternion.copy(this.saved[0])
    lower.quaternion.copy(this.saved[1])
    end.quaternion.copy(this.saved[2])
    this.saved = null
  }

  /**
   * @param body 体の根 (向きを持つ物)。ずらす量はこの空間 (+X が右、+Y が上、-Z が前)
   * @param shift ずらす量 (m)。重みは掛けた後の値を渡す
   */
  /** ずらした量 (世界)。左手を同じだけ動かすのに使う (LeftArmFollow.apply の moved) */
  readonly moved = new THREE.Vector3()

  apply(model: THREE.Object3D, body: THREE.Object3D, shift: THREE.Vector3): void {
    this.moved.set(0, 0, 0)
    if (shift.lengthSq() < 1e-8) return
    if (this.searched !== model) {
      this.searched = model
      const find = (suffix: string) => {
        let hit: THREE.Object3D | null = null
        model.traverse((o) => {
          if (!hit && o.name.endsWith(suffix) && (o as THREE.Bone).isBone) hit = o
        })
        return hit as THREE.Object3D | null
      }
      const upper = find('RightArm')
      const lower = find('RightForeArm')
      const end = find('RightHand')
      this.bones = upper && lower && end ? { upper, lower, end } : null
    }
    if (!this.bones) return
    const { upper, lower, end } = this.bones
    this.saved = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()]
    end.updateWorldMatrix(true, false)
    const wrist = new THREE.Vector3().setFromMatrixPosition(end.matrixWorld)
    const offset = shift.clone().applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()))
    const keep = end.getWorldQuaternion(new THREE.Quaternion())
    reachTwoBone(upper, lower, end, wrist.add(offset), keep)
    this.moved.copy(offset)
  }
}

/**
 * 梯子を登り切る型 (climb_top、ClimbingToTop 30fps 121 コマ) で、**手を掴んだ所に留める**区間。
 *
 * 素材の手は掴んでいる間も止まっていない — 右手首は 25〜69 コマで上へ 0.27m、前へ
 * 0.24m 動く (Mixamo の素材の実測)。そのまま流すと手すりの上を手が滑るので、掴んだ
 * 瞬間の位置に留めて腕を曲げ直す (HandPin)。掴む / 離す前後は数コマかけて型の手へ戻す
 *
 *     grab   この コマで掴む (位置を取る)
 *     full   ここから留め切る
 *     loose  ここから離し始める
 *     free   ここで型の手に戻り切る
 */
export const CLIMB_TOP_GRIPS = {
  // 右手: 上端の上の手すりを掴んで体を引き上げる。73 コマから押し上げて離す
  Right: { grab: 25, full: 28, loose: 66, free: 72 },
  // 左手: 上端の桟を押さえて登る。45 コマから屋上へ手を移す
  Left: { grab: 2, full: 5, loose: 40, free: 46 },
} as const

/** その手を留める重み (0..1)。frame は型の中のコマ (1〜121) */
export function climbGripWeight(side: 'Left' | 'Right', frame: number): number {
  const g = CLIMB_TOP_GRIPS[side]
  if (frame < g.grab || frame >= g.free) return 0
  const smooth = (t: number) => t * t * (3 - 2 * t)
  if (frame < g.full) return smooth((frame - g.grab) / (g.full - g.grab))
  if (frame < g.loose) return 1
  return 1 - smooth((frame - g.loose) / (g.free - g.loose))
}

/**
 * **手を世界の 1 点に留める** (梯子の手すりを掴んでいる間)。
 *
 * 重みが 0 から上がった最初のコマの手首の位置と向きを覚え、そこへ腕を曲げ直す。
 * 重みが 0 に戻ったら忘れる (次に掴む時に取り直す)。曲げた骨は次のコマで型を
 * 当てる前に戻す (restore)。LeftArmFollow と同じ
 */
export class HandPin {
  private bones: { upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D } | null = null
  private searched: THREE.Object3D | null = null
  private saved: THREE.Quaternion[] | null = null
  private holding = false
  private readonly target = new THREE.Vector3()
  private readonly targetTurn = new THREE.Quaternion()
  private readonly wrist = new THREE.Vector3()
  private readonly turn = new THREE.Quaternion()

  private readonly side: 'Left' | 'Right'

  constructor(side: 'Left' | 'Right') {
    this.side = side
  }

  restore(): void {
    if (!this.saved || !this.bones) return
    const { upper, lower, end } = this.bones
    upper.quaternion.copy(this.saved[0])
    lower.quaternion.copy(this.saved[1])
    end.quaternion.copy(this.saved[2])
    this.saved = null
  }

  /** 型を当てた**後**に呼ぶ (骨の世界行列が新しいこと) */
  apply(model: THREE.Object3D, weight: number): void {
    if (weight <= 0) {
      this.holding = false
      return
    }
    if (this.searched !== model) {
      this.searched = model
      const find = (suffix: string) => {
        let hit: THREE.Object3D | null = null
        model.traverse((o) => {
          if (!hit && o.name.endsWith(suffix) && (o as THREE.Bone).isBone) hit = o
        })
        return hit as THREE.Object3D | null
      }
      const upper = find(`${this.side}Arm`)
      const lower = find(`${this.side}ForeArm`)
      const end = find(`${this.side}Hand`)
      this.bones = upper && lower && end ? { upper, lower, end } : null
    }
    if (!this.bones) return
    const { upper, lower, end } = this.bones
    end.updateWorldMatrix(true, false)
    this.wrist.setFromMatrixPosition(end.matrixWorld)
    end.getWorldQuaternion(this.turn)
    if (!this.holding) {
      this.holding = true
      this.target.copy(this.wrist)
      this.targetTurn.copy(this.turn)
    }
    this.saved = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()]
    reachTwoBone(upper, lower, end, this.wrist.lerp(this.target, weight), this.turn.slerp(this.targetTurn, weight))
  }
}

/**
 * **背骨を曲げて、銃身の上下を照準に合わせる。** 構えている間だけ。
 *
 * 照準の上下は型の上に手続きで足している (animation.ts の AIM_PITCH_GAIN 倍、
 * MAX_AIM_BEND で打ち切り)。倍率は見た目で合わせた値で、銃身の角度を測っていない —
 * 上を向くと行き過ぎ (照準 +30° で銃身 +42.6°)、下は -29° で止まる (照準 -60° で
 * 銃身 -26.6°)。ここで**実際の銃身の角度を測って、ずれた分を背骨で曲げ直す。**
 * 上限は掛けない (2026-10-13 本人: おかしくなってもいいから背骨を折る方向で)
 *
 * 曲げた骨は次のコマで型を当てる前に戻す (restore)
 */
export class SpineAim {
  private bones: THREE.Object3D[] | null = null
  private searched: THREE.Object3D | null = null
  private saved: THREE.Quaternion[] | null = null
  private readonly barrel = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly turn = new THREE.Quaternion()
  private readonly twist = new THREE.Quaternion()
  private readonly world = new THREE.Quaternion()
  private static readonly UP = new THREE.Vector3(0, 1, 0)

  restore(): void {
    if (!this.saved || !this.bones) return
    this.bones.forEach((bone, i) => bone.quaternion.copy(this.saved![i]))
    this.saved = null
  }

  /**
   * @param gun 銃の模型。ローカル -Z が銃身の向き
   * @param yaw 体の向き (soldier と同じ決めごと: 前は (-sin, 0, -cos))
   * @param pitch 合わせたい上下 (rad、上が正)
   * @param weight 構えの掛かり具合
   */
  apply(model: THREE.Object3D, gun: THREE.Object3D, yaw: number, pitch: number, weight: number): void {
    if (weight <= 1e-3) return
    if (this.searched !== model) {
      this.searched = model
      const found: THREE.Object3D[] = []
      for (const suffix of ['Spine', 'Spine1', 'Spine2']) {
        let hit: THREE.Object3D | null = null
        model.traverse((o) => {
          if (!hit && o.name.endsWith(suffix) && !o.name.endsWith(`${suffix}1`) && !o.name.endsWith(`${suffix}2`) && (o as THREE.Bone).isBone) hit = o
        })
        if (hit) found.push(hit)
      }
      this.bones = found.length === 3 ? found : null
    }
    if (!this.bones) return
    this.saved = this.bones.map((b) => b.quaternion.clone())
    // 体の右と前。右の軸で回すと前が上へ起きる
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    /*
     * 3 回で詰める (曲げると肩の位置も動くので 1 回では残る)。
     *
     * **左右も合わせる。** 銃身は体の正面の面に無いので、大きく曲げると横へ逃げる
     * (照準 -60° で右へ 10〜12°)。背骨を縦の軸でひねって戻す
     */
    for (let pass = 0; pass < 3; pass++) {
      gun.updateWorldMatrix(true, false)
      this.barrel.set(0, 0, -1).transformDirection(gun.matrixWorld)
      const now = Math.asin(THREE.MathUtils.clamp(this.barrel.y, -1, 1))
      const error = (pitch - now) * weight
      // 横のずれ (右が正)。真上・真下に近いと読めないので水平の成分で測る
      const side = Math.atan2(this.barrel.dot(this.right), this.barrel.dot(this.forward)) * weight
      if (Math.abs(error) < 1e-3 && Math.abs(side) < 1e-3) break
      this.turn.setFromAxisAngle(this.right, error / this.bones.length)
      // 縦の軸で +θ 回すと左へ向く。右へずれた分だけ左へ
      this.twist.setFromAxisAngle(SpineAim.UP, side / this.bones.length)
      this.turn.premultiply(this.twist)
      for (const bone of this.bones) {
        bone.getWorldQuaternion(this.world)
        setWorldQuaternion(bone, this.world.premultiply(this.turn))
      }
    }
  }
}
