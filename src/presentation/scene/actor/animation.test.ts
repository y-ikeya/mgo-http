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
  /**
   * **前の型が残ったまま終わっても、いま流れている型は畳まれない。**
   *
   * 「終わった」の受け口が、終わったのが何かを見ずに畳んでいた。回避ローリング
   * (1.6 秒) の直後に着地すると、その 0.22 秒後に前の roll が終わり、その通知で
   * **受け身の上半身だけが構えへ戻る**。下半身は locomotion で決まるので受け身の
   * まま残り、腰から上だけが銃を構え直して見えた。
   *
   * 実機で骨を測って初めて掴めた (手元の模擬では前の型が残らないので出ない)。
   */
  test('**前のローリングが終わっても、受け身は畳まれない**', () => {
    const anim = animator()
    // 回避ローリングの途中で着地して受け身へ移る。**前の roll はまだ流れている**
    anim.playRoll()
    run(anim, 0.9, 'roll', true)
    anim.playFallRoll()

    // 混ざり切るまで待つ
    run(anim, 0.3, 'fall_roll', true)
    expect(playing(anim, 'upper')).toEqual(['fall_roll'])

    // 受け身の残りを通して、**前の roll が終わる瞬間を跨ぐ**。
    // どの時点でも上半身は受け身のまま
    for (let i = 0; i < Math.round(1.2 * 60); i++) {
      run(anim, 1 / 60, 'fall_roll', true)
      expect(playing(anim, 'upper')).toEqual(['fall_roll'])
    }
    expect(playing(anim, 'lower')).toEqual(['fall_roll'])
  })

  /**
   * **受け身も前へ流れる。** 焼かれた移動を誰も読んでいなくて、腰が 179 度
   * 振れるだけの「その場でくるりと回る」絵になっていた。
   *
   * 落ちた勢いが前へ流れて消えるのが受け身なので、動かないと**なぜ転がったのか**
   * が絵から抜ける。
   */
  /**
   * **1 周して頭へ戻っても、進んだぶんを引き戻さない。**
   *
   * 下半身の受け身がループしていて (一度きりの一覧から漏れていた)、尺とロックが
   * ほぼ同時なので競り合っていた。先にクリップが頭へ戻った回だけ、根元の位置も
   * 先頭へ跳んで **1 フレームで 3m 戻る**。毎回は出ないので絵では掴みにくい。
   */
  test('**一度きりで流す。** 頭へ戻って引き戻されない', () => {
    const anim = animator()
    anim.playFallRoll()
    const step = new THREE.Vector3()
    let back = 0
    // 尺 (1.67 秒) より長く回して、1 周を跨がせる
    for (let i = 0; i < Math.round(3 * 60); i++) {
      anim.setLocomotion('fall_roll' as never)
      anim.update(1 / 60)
      if (anim.consumeRootMotion(step)) back = Math.max(back, Math.hypot(step.x, step.z))
    }
    // 1 フレームで大きく跳ぶことが無い (3m を 100 フレームで進むので 1 歩は数 cm)
    expect(back).toBeLessThan(0.5)
  })

  test('焼かれた移動を辿る。**その場では回らない**', () => {
    const anim = animator()
    anim.playFallRoll()
    const step = new THREE.Vector3()
    let travelled = 0
    for (let i = 0; i < Math.round(1.6 * 60); i++) {
      anim.setLocomotion('fall_roll' as never)
      anim.update(1 / 60)
      if (anim.consumeRootMotion(step)) travelled += Math.hypot(step.x, step.z)
    }
    expect(travelled).toBeGreaterThan(2)
  })

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

describe('構えを解く', () => {
  /** 動いている型の重みの合計。**1 に届かない分は T ポーズが埋める** */
  function total(anim: CharacterAnimator, layer: 'upper' | 'lower'): number {
    const actions = (anim as unknown as Record<string, Map<string, THREE.AnimationAction>>)[layer]
    let sum = 0
    for (const [, action] of actions) {
      if (action.isRunning()) sum += action.getEffectiveWeight()
    }
    return sum
  }

  test('**振りかぶりを解いても T ポーズを挟まない**', () => {
    const anim = animator()
    run(anim, 0.5, 'idle', true)
    anim.playThrow()
    run(anim, 0.3, 'idle', true)
    expect(total(anim, 'upper')).toBeGreaterThan(0.99)

    // Shift を離してやめる。**ここで一瞬 T ポーズになっていた**
    anim.cancelThrow()
    for (let i = 0; i < 30; i++) {
      anim.setLocomotion('idle')
      anim.setAiming(true)
      anim.update(1 / 60)
      expect(total(anim, 'upper')).toBeGreaterThan(0.99)
    }
  })
})

describe('弾倉を替える', () => {
  /** その型の再生速度 */
  function scaleOf(anim: CharacterAnimator, key: string): number {
    const actions = (anim as unknown as Record<string, Map<string, THREE.AnimationAction>>).upper
    return actions.get(key)?.getEffectiveTimeScale() ?? 0
  }

  test('**銃ごとの時間に型を合わせる。** どの銃も同じ尺にしない', () => {
    const anim = animator()
    const clip = (anim as unknown as { reloadDuration: number }).reloadDuration
    expect(clip).toBeGreaterThan(0)

    // P90 は 3.0 秒 (domain/item/weapons.ts)
    anim.playReload(3)
    expect(scaleOf(anim, 'reload')).toBeCloseTo(clip / 3, 3)

    // AK47 は 2.5 秒。**同じ型が速く回る**
    anim.playReload(2.5)
    expect(scaleOf(anim, 'reload')).toBeCloseTo(clip / 2.5, 3)
  })
})

/**
 * 転がりの「ロック」と「絵」は別。
 *
 * ロック (rolling) は終盤 (ROLL_EXIT_PHASE = 0.78) で先に解ける — 最終ポーズに
 * 固まった所からブレンドすると一拍止まって見えるため。**クリップはまだ 2 割
 * 残っている。**
 *
 * 同じ getter で兼ねていたせいで、手榴弾の振りかぶりが**転がりの尻尾の中で
 * 始まって終わり**、画面には一度も映らないのに投げられる状態になっていた。
 */
describe('転がりのロックと絵', () => {
  /** 1 フレームずつ進めて、それぞれが偽になった時刻を測る */
  function transitions(): { rolling: number; showing: number } {
    const anim = animator()
    anim.playRoll()
    let t = 0
    let rolling = Infinity
    let showing = Infinity
    for (let i = 0; i < 240; i++) {
      anim.setLocomotion('roll' as never)
      anim.setAiming(false)
      anim.update(1 / 60)
      t += 1 / 60
      if (rolling === Infinity && !anim.rolling) rolling = t
      if (showing === Infinity && !anim.rollShowing) showing = t
    }
    return { rolling, showing }
  }

  test('始めた直後はどちらも真', () => {
    const anim = animator()
    anim.playRoll()
    expect(anim.rolling).toBe(true)
    expect(anim.rollShowing).toBe(true)
  })

  /**
   * **ここが要。** ロックが先に解けて、絵はしばらく残る。
   *
   * この隙間 (実測 0.25 秒) に二段の型を始めると、振りかぶりが転がりの尻尾の
   * 中で終わって画面に映らない。**定数ではなく関係を留める** — 尺も時間倍率も
   * ROLL_EXIT_PHASE も調整される値なので、数字で書くと調整のたびに落ちる。
   */
  test('**ロックのほうが先に解ける。** そこで絵はまだ流れている', () => {
    const { rolling, showing } = transitions()
    expect(rolling).toBeLessThan(showing)
    // 隙間が潰れたら、二段の型を始めてよい判断が rolling で足りることになる。
    // そのときはこの試験ごと消す (getter を 1 つに戻せる)
    expect(showing - rolling).toBeGreaterThan(0.05)
  })

  test('絵が終われば両方とも偽', () => {
    const { showing } = transitions()
    expect(showing).toBeLessThan(2)
  })

  test('転がっていなければ最初から偽', () => {
    const anim = animator()
    run(anim, 0.5, 'idle')
    expect(anim.rolling).toBe(false)
    expect(anim.rollShowing).toBe(false)
  })
})
