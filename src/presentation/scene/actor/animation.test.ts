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

describe('堪える着地', () => {
  /**
   * **前の型が残ったまま終わっても、いま流れている型は畳まれない。**
   *
   * 「終わった」の受け口が、終わったのが何かを見ずに畳んでいた。回避ローリング
   * (1.6 秒) の直後に着地すると、その 0.22 秒後に前の roll が終わり、その通知で
   * **着地の上半身だけが構えへ戻る**。下半身は locomotion で決まるので着地の
   * まま残り、腰から上だけが銃を構え直して見えた。
   *
   * 実機で骨を測って初めて掴めた (手元の模擬では前の型が残らないので出ない)。
   */
  test('**前のローリングが終わっても、着地は畳まれない**', () => {
    const anim = animator()
    // 回避ローリングの途中で着地して堪える型へ移る。**前の roll はまだ流れている**
    anim.playRoll()
    run(anim, 0.9, 'roll', true)
    anim.playHardLand()

    // 混ざり切るまで待つ
    run(anim, 0.3, 'hard_land', true)
    expect(playing(anim, 'upper')).toEqual(['hard_land'])

    // 着地の残りを通して、**前の roll が終わる瞬間を跨ぐ**。
    // どの時点でも上半身は着地のまま
    for (let i = 0; i < Math.round(1.2 * 60); i++) {
      run(anim, 1 / 60, 'hard_land', true)
      expect(playing(anim, 'upper')).toEqual(['hard_land'])
    }
    expect(playing(anim, 'lower')).toEqual(['hard_land'])
  })

  /**
   * **1 周して頭へ戻っても、進んだぶんを引き戻さない。**
   *
   * 下半身の着地がループしていて (一度きりの一覧から漏れていた)、尺とロックが
   * ほぼ同時なので競り合っていた。先にクリップが頭へ戻った回だけ、根元の位置も
   * 先頭へ跳んで **1 フレームで 3m 戻る**。毎回は出ないので絵では掴みにくい。
   */
  test('**一度きりで流す。** 頭へ戻って引き戻されない', () => {
    const anim = animator()
    anim.playHardLand()
    const step = new THREE.Vector3()
    let back = 0
    // 尺 (1.67 秒) より長く回して、1 周を跨がせる
    for (let i = 0; i < Math.round(3 * 60); i++) {
      anim.setLocomotion('hard_land' as never)
      anim.update(1 / 60)
      if (anim.consumeRootMotion(step)) back = Math.max(back, Math.hypot(step.x, step.z))
    }
    // 1 フレームで大きく跳ぶことが無い (3m を 100 フレームで進むので 1 歩は数 cm)
    expect(back).toBeLessThan(0.5)
  })

  /**
   * **その場で堪える。転がらない。**
   *
   * 転がる型だった頃は 3m 進む必要があって、焼かれた移動を辿る仕掛けに
   * 載せていた。膝を突いて堪えるだけの型に差し替えたので、その仕掛けからは
   * 外してある — 残したままだと、着地した所から前へ滑る。
   */
  test('移動しない。**着地した所で堪える**', () => {
    const anim = animator()
    anim.playHardLand()
    const step = new THREE.Vector3()
    let travelled = 0
    for (let i = 0; i < Math.round(2.1 * 60); i++) {
      anim.setLocomotion('hard_land' as never)
      anim.update(1 / 60)
      if (anim.consumeRootMotion(step)) travelled += Math.hypot(step.x, step.z)
    }
    expect(travelled).toBe(0)
  })

  test('**上半身も一緒に転がる。** 銃を構えたまま脚だけ動かない', () => {
    const anim = animator()
    run(anim, 0.5, 'jump_loop', true)
    expect(playing(anim, 'upper')).toEqual(['aim'])

    anim.playHardLand()
    run(anim, 0.2, 'hard_land', true)
    expect(playing(anim, 'upper')).toEqual(['hard_land'])
    expect(playing(anim, 'lower')).toEqual(['hard_land'])
  })

  test('**受け身の途中で死んでも、死体は構え直さない。**', () => {
    const anim = animator()
    anim.playHardLand()
    run(anim, 0.2, 'hard_land', true)

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


/**
 * 床へ行く型は、**頭から流さないと床に着かない。**
 *
 * 姿勢を切り替えるだけ (setLocomotion) だと、上半身が構えのままで、しかも
 * 重みの補間で入るので型が頭から流れない。**立ったまま寝ている**という形で
 * 出た — 実測すると腰が 1.01m で、立ち姿 (0.97m) とほとんど変わらない。
 *
 * 倒れる型は元から専用の道 (playDeath) を通していて、そちらは着く。眠りも
 * 同じ道 (playSleep) にした。**目で見れば一目**だが、目で見るには実機が要る。
 */
describe('床へ行く型', () => {
  /** その型を流し切ったあとの、腰と頭の高さ (m) */
  function settle(play: (anim: CharacterAnimator) => void): { hips: number; head: number } {
    const root = gltf.scene.clone(true)
    const anim = new CharacterAnimator(root, gltf.animations, 4.5)
    play(anim)
    for (let i = 0; i < 240; i++) anim.update(1 / 60)
    root.updateMatrixWorld(true)
    let hips = NaN
    let head = NaN
    root.traverse((o) => {
      if (o.name.endsWith('Hips')) hips = o.getWorldPosition(new THREE.Vector3()).y
      if (o.name.endsWith('Head')) head = o.getWorldPosition(new THREE.Vector3()).y
    })
    return { hips, head }
  }

  test('**倒れたら床に着く。** 立ち姿の高さに残らない', () => {
    const down = settle((anim) => anim.playDeath(true))
    expect(down.head).toBeLessThan(0.5)
    expect(down.hips).toBeLessThan(0.4)
  })

  test('**麻酔で眠っても床に着く。** 倒れるのと同じ道を通す', () => {
    const asleep = settle((anim) => anim.playSleep())
    expect(asleep.head).toBeLessThan(0.5)
    expect(asleep.hips).toBeLessThan(0.4)
  })

  test('姿勢を切り替えるだけでは着かない。**この差が不具合だった**', () => {
    const only = settle((anim) => {
      for (let i = 0; i < 240; i++) {
        anim.setLocomotion('sleep')
        anim.update(1 / 60)
      }
    })
    // 立ったまま。playSleep との差がそのまま「立ちながら寝ている」の正体
    expect(only.head).toBeGreaterThan(1.2)
  })
})
