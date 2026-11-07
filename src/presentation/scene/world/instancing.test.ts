import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { instanceRepeats } from './instancing'

/** 同じ形・同じ材質の土嚢を n 個、x = 位置 に並べたモデル */
function modelWithBags(values: number[]): { model: THREE.Group; bags: THREE.Mesh[] } {
  const model = new THREE.Group()
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial()
  const bags = values.map((x) => {
    const bag = new THREE.Mesh(geometry, material)
    bag.name = 'sand_bag'
    bag.position.set(x, 0, 0)
    model.add(bag)
    return bag
  })
  return { model, bags }
}

function instancedOf(model: THREE.Group): THREE.InstancedMesh {
  const found = model.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh)
  if (!found) throw new Error('InstancedMesh が無い')
  return found as THREE.InstancedMesh
}

describe('instanceRepeats の置き場所ごとの明るさ', () => {
  test('brightness があれば、コピーごとにその値が色として掛かる', () => {
    const { model, bags } = modelWithBags([0, 10, 20])
    const merged = instanceRepeats(model, (m) => m.name, (m) => 1 - m.position.x / 25)
    expect(merged).toBe(3)
    const instanced = instancedOf(model)
    const color = instanced.instanceColor
    expect(color).not.toBeNull()
    // x=0 → 1.0、x=10 → 0.6、x=20 → 0.2 (白黒なので 3 成分とも同じ)
    expect(color!.getX(0)).toBeCloseTo(1.0)
    expect(color!.getX(1)).toBeCloseTo(0.6)
    expect(color!.getX(2)).toBeCloseTo(0.2)
    expect(color!.getY(2)).toBeCloseTo(0.2)
    // 元の物は判定のために見えないまま残る
    expect(bags.every((b) => !b.visible)).toBe(true)
  })

  test('brightness が無ければ色は付かない (今まで通り)', () => {
    const { model } = modelWithBags([0, 10, 20])
    expect(instanceRepeats(model, (m) => m.name)).toBe(3)
    expect(instancedOf(model).instanceColor).toBeNull()
  })

  test('範囲外の値は 0〜1 に丸める', () => {
    const { model } = modelWithBags([0, 10, 20])
    instanceRepeats(model, (m) => m.name, () => 7)
    expect(instancedOf(model).instanceColor!.getX(0)).toBeCloseTo(1)
  })
})
