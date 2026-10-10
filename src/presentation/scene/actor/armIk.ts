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
  apply(model: THREE.Object3D, weapon: Corrected | null): void {
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
    if (!this.bones || !weapon.aimCorrection(this.delta, this.pivot)) return
    const { upper, lower, end } = this.bones
    this.saved = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()]
    end.updateWorldMatrix(true, false)
    this.wrist.setFromMatrixPosition(end.matrixWorld)
    const target = this.wrist.sub(this.pivot).applyQuaternion(this.delta).add(this.pivot)
    this.turn.copy(this.delta).multiply(end.getWorldQuaternion(new THREE.Quaternion()))
    reachTwoBone(upper, lower, end, target, this.turn)
  }
}
