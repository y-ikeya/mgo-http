import { describe, expect, test } from 'bun:test'
import { flagsOf } from './flags'

describe('投げた物を止めるか', () => {
  test('**既定は弾と同じ。** 壁は止め、弾を通す物は投げた物も通す', () => {
    expect(flagsOf('concrete_wall').thrown).toBe(true)
    expect(flagsOf('col_metal_barricade1_nobullet_noeye').thrown).toBe(false)
  })

  test('**金網 (blockthrow) は弾を通すが手榴弾は止める**', () => {
    const fence = flagsOf('metal_fence1_nobullet_noeye_nocamera_blockthrow')
    expect(fence.bullet).toBe(false)
    expect(fence.thrown).toBe(true)
    expect(fence.player).toBe(true)
    expect(fence.eye).toBe(false)
  })
})
