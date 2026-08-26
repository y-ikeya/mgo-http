import type * as THREE from 'three'

/**
 * three.js のオブジェクト判定。
 *
 * `instanceof` を使わないのは意図的。ローダー等が別インスタンスの three を掴むと
 * クラスの同一性が崩れて `instanceof` が黙って偽になる。three.js 自身が内部判定に
 * 使っている `isMesh` / `isBone` フラグなら、その状況でも正しく判定できる。
 */

export function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}

export function isBone(object: THREE.Object3D): object is THREE.Bone {
  return (object as THREE.Bone).isBone === true
}
