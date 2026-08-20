import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CharacterAnimator } from './animation'

/**
 * 上半身と下半身は別々の面で流している。**その組み合わせを試験で押さえる。**
 *
 * 描画は要らない — three のアニメーションは GL 無しで動く。実際の soldier.glb を
 * 読んで、実際の CharacterAnimator を回して、どのクリップに重みが乗っているかを見る。
 *
 * ここが無かったので「上半身だけ銃を構えたまま脚が転がる」「死体が構え直す」を
 * 2 回続けて出した。どちらも**目で見れば一目**だが、目で見るには実機が要る。
 */
const gltf = await new GLTFLoader().parseAsync(
  await Bun.file('public/models/soldier.glb').arrayBuffer(),
  '',
)

function animator(): CharacterAnimator {
  return new CharacterAnimator(gltf.scene.clone(true), gltf.animations, 4.5)
}

/** 重みが乗っているクリップ (上半身 / 下半身) */
function playing(anim: CharacterAnimator, layer: 'upper' | 'lower'): string[] {
  const actions = (anim as unknown as Record<string, Map<string, THREE.AnimationAction>>)[layer]
  return [...actions]
    .filter(([, action]) => action.getEffectiveWeight() > 0.5)
    .map(([key]) => key)
}

function run(anim: CharacterAnimator, seconds: number, locomotion: string, aiming = false): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    anim.setLocomotion(locomotion as never)
    anim.setAiming(aiming)
    anim.update(1 / 60)
  }
}

describe('落下の受け身', () => {
  test('**上半身も一緒に転がる。** 銃を構えたまま脚だけ動かない', () => {
    const anim = animator()
    run(anim, 0.5, 'jump_loop', true)
    expect(playing(anim, 'upper')).toEqual(['aim'])

    anim.playFallRoll()
    run(anim, 0.2, 'fall_roll', true)
    expect(playing(anim, 'upper')).toEqual(['fall_roll'])
    expect(playing(anim, 'lower')).toEqual(['fall_roll'])
  })

  test('**受け身の途中で死んでも、死体は構え直さない。**', () => {
    const anim = animator()
    anim.playFallRoll()
    run(anim, 0.2, 'fall_roll', true)

    // player.setHealth(0) と同じ順で倒す
    anim.setAiming(false)
    anim.setFiring(false)
    anim.playDeath()
    run(anim, 0.2, 'death')
    expect(playing(anim, 'upper')).toEqual(['death'])

    // **受け身 (1.67 秒) が終わる時刻を跨ぐ。** ここで構えに戻っていた
    run(anim, 2.0, 'death')
    expect(playing(anim, 'upper')).toEqual(['death'])
    expect(playing(anim, 'lower')).toEqual(['death'])
  })
})
