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

describe('脱力の立ち姿', () => {
  /**
   * **素材どおりに立っているか。** 腰→首が前後どちらへ振れているかを測る。
   *
   * 正 = 前傾 / 負 = のけぞり。前方は腰のラインの法線から取るので、
   * モデルがどちらを向いていても同じ数字になる。
   */
  function neckTilt(root: THREE.Object3D): number {
    root.updateMatrixWorld(true)
    const at = (suffix: string): THREE.Vector3 => {
      const hits: THREE.Object3D[] = []
      root.traverse((o) => {
        if (o.name.endsWith(suffix) && !o.name.includes('End')) hits.push(o)
      })
      const found = hits[0]
      if (!found) throw new Error(suffix)
      return found.getWorldPosition(new THREE.Vector3())
    }
    const hips = at('Hips')
    const right = at('RightUpLeg').sub(at('LeftUpLeg')).setY(0).normalize()
    const forward = new THREE.Vector3(0, 1, 0).cross(right).normalize()
    const d = at('Neck').sub(hips)
    return (Math.atan2(d.dot(forward), d.y) * 180) / Math.PI
  }

  /** クリップを 1 本そのまま流したときの首の振れ */
  function clipTilt(name: string): number {
    const root = gltf.scene.clone(true)
    const mixer = new THREE.AnimationMixer(root)
    const clip = gltf.animations.find((a: THREE.AnimationClip) => a.name === name)
    if (!clip) throw new Error(name)
    mixer.clipAction(clip).play()
    mixer.update(clip.duration / 2)
    return neckTilt(root)
  }

  /**
   * **素材は relaxed_idle (Rifle Idle.fbx) のまま、コードが 15° 反らせていた。**
   *
   * 2 つ重なっていた。腰の載せ替えが「作られた向きの差」を丸ごと消していて、
   * その差には前後の傾きも混ざっていた (-6.8° → -15.5°)。その上に、前傾のはずの
   * relaxedLean が符号違いで後ろへ効いていた (-15.5° → -19.7°)。
   *
   * 目で見ると「ふんぞり返っている」としか言えず、2 つあることは測って分かった。
   */
  test('**脱力の立ち姿は素材から離れない**', () => {
    const root = gltf.scene.clone(true)
    const holder = new THREE.Group()
    holder.add(root)
    const anim = new CharacterAnimator(root, gltf.animations, 4.5)
    run(anim, 4, 'idle')

    const source = clipTilt('relaxed_idle')
    expect(Math.abs(neckTilt(root) - source)).toBeLessThan(6)
  })

  test('構えると素材の idle の姿勢へ寄る', () => {
    const root = gltf.scene.clone(true)
    const holder = new THREE.Group()
    holder.add(root)
    const anim = new CharacterAnimator(root, gltf.animations, 4.5)
    run(anim, 4, 'idle', true)

    expect(Math.abs(neckTilt(root) - clipTilt('idle'))).toBeLessThan(6)
  })
})

describe('姿勢が震えない', () => {
  /**
   * **1 コマあたり手がどれだけ動くか。** 立ち止まっている姿は動かないはず。
   *
   * 姿勢だけを切り出した短いクリップ (kneeAim の両端、0.067 秒) を普通に
   * 流すと、0.067 秒で頭へ戻る = 15Hz で震える。実測で手が 1 コマ 6.8mm
   * 動いていた (立ちは 0.12mm)。下半身にそれを引いてしまった回もある。
   *
   * 見た目には「なんか震えてる」としか分からず、原因が上か下かも分からない。
   * 数字にすれば一発で出る。
   */
  function jitter(locomotion: string, aiming: boolean): number {
    const root = gltf.scene.clone(true)
    const holder = new THREE.Group()
    holder.add(root)
    const anim = new CharacterAnimator(root, gltf.animations, 4.5)
    const at = (suffix: string): THREE.Vector3 => {
      const hits: THREE.Object3D[] = []
      root.traverse((o) => {
        if (o.name.endsWith(suffix) && !o.name.includes('End')) hits.push(o)
      })
      return hits[0]!.getWorldPosition(new THREE.Vector3())
    }
    let previous: THREE.Vector3 | null = null
    let worst = 0
    for (let i = 0; i < 180; i++) {
      anim.setLocomotion(locomotion as never)
      anim.setAiming(aiming)
      anim.update(1 / 60)
      // 混ざり切ってから測る。切り替えの補間そのものは震えではない
      if (i < 120) continue
      holder.updateWorldMatrix(true, true)
      const hand = at('RightHand').sub(at('Hips'))
      if (previous) worst = Math.max(worst, hand.distanceTo(previous))
      previous = hand
    }
    return worst * 1000
  }

  test('**しゃがんで止まっていれば手も止まる**', () => {
    expect(jitter('crouch_idle', false)).toBeLessThan(1)
    expect(jitter('crouch_idle', true)).toBeLessThan(1)
  })

  test('立ちも同じ', () => {
    expect(jitter('idle', false)).toBeLessThan(1)
    expect(jitter('idle', true)).toBeLessThan(1)
  })
})

describe('止めておく型', () => {
  /**
   * **作った直後から止まっていること。**
   *
   * 伏せて止まっている姿は、這う型 (crawl_f) の再生を止めて作っている。
   * その「止める」を下半身しか掛けていない時期があった — 速度を当てる処理を
   * 上半身を揃える前に呼んでいて、そのとき上半身の action がまだ無かった。
   *
   * **自機では出ない。** Soldier は速度が変わるたびに setMoveSpeed を呼び、
   * そこで掛け直されて止まる。呼ばない RemoteSoldier にだけ残るので、
   * 「自分の画面では止まっているのに、相手の画面では腕を掻き続ける」になる。
   * 自機だけ見ていても気づけないので、ここで押さえる。
   */
  function timeScales(anim: CharacterAnimator): { lower: number; upper: number } {
    const layer = anim as unknown as Record<string, Map<string, THREE.AnimationAction>>
    return {
      lower: layer.lower.get('prone_idle')?.getEffectiveTimeScale() ?? NaN,
      upper: layer.upper.get('relaxed:prone_idle')?.getEffectiveTimeScale() ?? NaN,
    }
  }

  test('**伏せて止まる型は上下とも止まっている。** 速度を当て直さなくても', () => {
    const fresh = timeScales(animator())
    expect(fresh.lower).toBe(0)
    expect(fresh.upper).toBe(0)
  })

  test('速度を当て直しても止まったまま', () => {
    const anim = animator()
    anim.setMoveSpeed(4.5)
    const after = timeScales(anim)
    expect(after.lower).toBe(0)
    expect(after.upper).toBe(0)
  })

  test('伏せて止まっていれば手も動かない', () => {
    const root = gltf.scene.clone(true)
    const holder = new THREE.Group()
    holder.add(root)
    const anim = new CharacterAnimator(root, gltf.animations, 4.5)
    const at = (suffix: string): THREE.Vector3 => {
      const hits: THREE.Object3D[] = []
      root.traverse((o) => {
        if (o.name.endsWith(suffix) && !o.name.includes('End')) hits.push(o)
      })
      return hits[0]!.getWorldPosition(new THREE.Vector3())
    }
    let previous: THREE.Vector3 | null = null
    let worst = 0
    for (let i = 0; i < 180; i++) {
      anim.setLocomotion('prone_idle' as never)
      anim.update(1 / 60)
      if (i < 120) continue
      holder.updateWorldMatrix(true, true)
      const hand = at('RightHand').sub(at('Hips'))
      if (previous) worst = Math.max(worst, hand.distanceTo(previous))
      previous = hand
    }
    // 1 コマ 1mm 未満。這っていれば桁が変わる
    expect(worst * 1000).toBeLessThan(1)
  })
})

describe('勝手に構えない', () => {
  /**
   * **非構えの型が無い姿勢は、構えの型で代用される。**
   *
   * `resolveUpperKey` の最後がそうなっていて、それ自体は正しい (どこにも
   * 当たらないより構えのほうがまし)。ただし**代用されていることに気づけない**
   * ので、抜けているとその姿勢の間ずっと銃を構える。
   *
   * 実際、階段 (up_stair / down_stair) が抜けていた。坂を上り切って板に乗る
   * 継ぎ目の段差を踏むたびに、押していないのに構える形で出た。
   *
   * 全身の型 (倒れる・眠る・転がる・刺す) は別の口を通るので、ここでは
   * **移動している姿勢だけ**を見る。
   */
  /**
   * **どの姿勢でも、構えていなければ構えの型は出ない。**
   *
   * 一部だけ並べると、次に姿勢を足したときにまた抜ける。**下半身が持っている
   * 姿勢を全部**回す。表に無いものは下半身と同じクリップで埋まるので、
   * ここは「埋め忘れが無い」ことの見張りになる。
   */
  function allLocomotions(anim: CharacterAnimator): string[] {
    const lower = (anim as unknown as Record<string, Map<string, unknown>>).lower
    /*
     * **@ を含む鍵は姿勢ではない。**
     *
     * 脱力中に流す別クリップの枝 (run_f@relaxed_run など)。姿勢として渡すと
     * 表に無い名前になって、上半身が構えの型で埋められる。
     */
    return [...lower.keys()].filter((key) => !key.includes('@'))
  }

  test('**どの姿勢でも、構えていなければ構えの型が出ない**', () => {
    const guilty: string[] = []
    for (const locomotion of allLocomotions(animator())) {
      const anim = animator()
      run(anim, 1.2, locomotion)
      if (playing(anim, 'upper').includes('aim')) guilty.push(locomotion)
    }
    expect(guilty).toEqual([])
  })

  /**
   * **走っている間、構えていなければ上下が同じクリップから来る。**
   *
   * 素材は 2 つの家系に分かれている。8 方向の走りは腰を振って作られていて
   * (run_f −39.3°、run_r −66.6°)、その振れを**自分の上半身が戻している。**
   * 脱力の型 (relaxed_run −6.9° / run_unarmed −0.0°) は正面向き。
   *
   * 混ぜると戻しだけが消えて、上半身が振れた角度そのまま捻れる。**走ると
   * 上半身が右へ 45° 向く**という形で出ていた。ライフルでも手榴弾でも同じ
   * だったのは、振れているのが脚側だから。
   */
  test('**脱力して走る間は、上下が同じクリップ**', () => {
    for (const pistol of [false, true]) {
      const anim = animator()
      anim.setPistol(pistol)
      run(anim, 1.2, 'run_f')
      const lower = playing(anim, 'lower')
      const clips = (anim as unknown as Record<string, Map<string, string>>).lowerClipNames
      const uppers = (anim as unknown as Record<string, Map<string, string>>).upperClipNames
      const upper = playing(anim, 'upper')
      expect(lower.length).toBe(1)
      expect(upper.length).toBe(1)
      expect(clips.get(lower[0]!)).toBe(uppers.get(upper[0]!)!)
    }
  })

  /**
   * **構えている間は 8 方向のまま。**
   *
   * 体が照準を向いたまま横へ動くので、方向ごとの型が要る。上下が別のクリップ
   * になるが、そちらは家系が揃っている (どちらも振れた側)。
   */
  /**
   * **立っている間も上下を揃える。**
   *
   * 腰の傾きが家系で違う (idle X −103.1 / pistol_relaxed X −94.5)。打ち消しは
   * 縦軸まわりの捻れだけを消して傾きは残すので、差の 8.6° がそのまま上体の
   * 傾きになる — **立っているだけで右へ傾いて**見えた。
   */
  test('**脱力して立つ間も、上下が同じクリップ**', () => {
    for (const pistol of [false, true]) {
      const anim = animator()
      anim.setPistol(pistol)
      run(anim, 1.2, 'idle')
      const lower = playing(anim, 'lower')
      const upper = playing(anim, 'upper')
      const clips = (anim as unknown as Record<string, Map<string, string>>).lowerClipNames
      const uppers = (anim as unknown as Record<string, Map<string, string>>).upperClipNames
      expect(clips.get(lower[0]!)).toBe(uppers.get(upper[0]!)!)
    }
  })

  test('構えて走る間は、方向ごとの型を使う', () => {
    const anim = animator()
    run(anim, 1.2, 'run_r', true)
    expect(playing(anim, 'lower')).toEqual(['run_r'])
  })

  /**
   * **伏せたまま倒されたら、伏せたまま崩れる。**
   *
   * 立ちの型で倒れると、伏せていた体が一度立ち上がってから崩れる。撃たれた
   * 瞬間に姿勢が飛ぶので、見ている側は何が起きたか読めない。
   */
  test('伏せたまま倒されたら、伏せたまま崩れる', () => {
    for (const from of ['prone_idle', 'crawl_f', 'crawl_b']) {
      const anim = animator()
      run(anim, 1.2, from)
      anim.playDeath(true)
      run(anim, 0.6, from)
      expect(playing(anim, 'lower')).toEqual(['prone_death'])
    }
  })

  test('立っていれば、いままでどおり向きで倒れる', () => {
    const anim = animator()
    run(anim, 1.2, 'idle')
    anim.playDeath(true)
    run(anim, 0.6, 'idle')
    expect(playing(anim, 'lower')).toEqual(['death_front'])
  })

  /**
   * **伏せたまま後ろへ下がれる。**
   *
   * 這う型が前しか無かった頃は、伏せたら前へ進むしかなかった。覗いた縁から
   * 下がれないので、**伏せること自体が引き返せない選択**になっていた。
   */
  test('伏せたまま後ろへ下がる型が出る', () => {
    const anim = animator()
    run(anim, 1.2, 'crawl_b')
    expect(playing(anim, 'lower')).toEqual(['crawl_b'])
  })

  test('構えれば構える', () => {
    const anim = animator()
    run(anim, 1.2, 'idle', true)
    expect(playing(anim, 'upper')).toEqual(['aim'])
  })
})

describe('片手の物を持っている姿', () => {
  /**
   * **拳銃や道具を持っている間、小銃の型へ落ちない。**
   *
   * 上半身は「持っている物 × 移動状態」で引く。表に無い状態は
   * 両手 (小銃) の表へ落ちる作りなので、**抜けているとその状態の間だけ
   * 小銃を提げて見える。**
   *
   * 実際、階段と跳躍が抜けていた。クレイモアを持って坂を下りると一瞬
   * down_stair に入り、その間だけ小銃を両手で構える形で出た。
   *
   * 全身の型 (倒れる・転がる・刺す) は別の口を通るので、ここでは
   * **移動している姿勢だけ**を見る。
   */
  const MOVING = [
    'idle', 'crouch_idle', 'sneak',
    'up_stair', 'down_stair',
    'jump_up', 'jump_loop', 'jump_down',
    'run_f', 'run_b', 'crouch_f', 'crouch_b',
  ] as const

  function upperFor(locomotion: string, pistol: boolean): string {
    const anim = animator()
    anim.setPistol(pistol)
    run(anim, 1.5, locomotion)
    return (anim as unknown as { resolveUpperKey(): string }).resolveUpperKey()
  }

  test('**移動している間は、片手の表から引く**', () => {
    const guilty: string[] = []
    for (const locomotion of MOVING) {
      if (!upperFor(locomotion, true).startsWith('pistol_relaxed:')) guilty.push(locomotion)
    }
    expect(guilty).toEqual([])
  })

  test('両手のときは今までどおり', () => {
    for (const locomotion of MOVING) {
      expect(upperFor(locomotion, false)).toBe(`relaxed:${locomotion}`)
    }
  })
})

describe('転がりの後半', () => {
  /**
   * **絵が流れている間は、ずっと転がりの型。**
   *
   * ロックは終盤 0.78 で先に解ける — 立ち上がりに入った時点で操作を返さないと、
   * 最終ポーズに固まった所からブレンドが始まって一拍止まって見える。
   *
   * そこで上半身まで戻すと、下半身は立ち上がりの途中なのに**上半身だけ銃を
   * 提げた型**へ移る。持ち武器に関わらず、転がりの後半で銃を構えて見えていた。
   *
   * 姿勢の表 (relaxed:roll) で埋めるのでは駄目だった。あちらは常時繰り返し
   * 再生なので、下半身が終わりで止まっている間に頭へ戻り、**立ち上がりながら
   * 腕だけ転がり始めの形 (手を挙げた姿)** になる。playRoll が下半身と揃えて
   * 流し直した action をそのまま使う。
   */
  function traceRoll(pistol: boolean): string[] {
    const anim = animator()
    anim.setPistol(pistol)
    anim.playRoll()
    const seen: string[] = []
    for (let i = 0; i < 140; i++) {
      // Soldier と同じ判じ方 (姿勢はロックで決める)
      anim.setLocomotion((anim.rolling ? 'roll' : 'idle') as never)
      anim.setAiming(false)
      anim.update(1 / 60)
      const key = (anim as unknown as { resolveUpperKey(): string }).resolveUpperKey()
      if (seen[seen.length - 1] !== key) seen.push(key)
    }
    return seen
  }

  test('**転がりの間に別の型が挟まらない**', () => {
    // 転がり → 立ち姿。**間に何も入らない**
    expect(traceRoll(false)).toEqual(['roll', 'relaxed:idle'])
    expect(traceRoll(true)).toEqual(['roll', 'pistol_relaxed:idle'])
  })

  test('ロックが解けても、絵が流れている間は転がりの型', () => {
    const anim = animator()
    anim.playRoll()
    let afterUnlock = ''
    for (let i = 0; i < 140; i++) {
      anim.setLocomotion((anim.rolling ? 'roll' : 'idle') as never)
      anim.update(1 / 60)
      if (!anim.rolling && anim.rollShowing) {
        afterUnlock = (anim as unknown as { resolveUpperKey(): string }).resolveUpperKey()
      }
    }
    expect(afterUnlock).toBe('roll')
  })
})

describe('置く動作の待ち', () => {
  /**
   * **振りかぶりの残りは実時間で返す。**
   *
   * 呼ぶ側は待ち時間として足すので (Game の setupRelease)、クリップの秒のまま
   * だと**速めたぶんだけ長く待つ**。クレイモアの振りかぶりは 1.8 倍で流して
   * いるので、1.77 秒のクリップの残りをそのまま返すと 1.8 倍の待ちになる。
   */
  test('**振りかぶりの残りは、流す速さで割った実時間**', () => {
    const anim = animator()
    anim.playSetup()
    run(anim, 1 / 30, 'claymore_windup')

    const upper = (anim as unknown as Record<string, Map<string, THREE.AnimationAction>>).upper
    const windup = upper.get('claymore_windup')!
    const clip = windup.getClip()
    const rate = windup.getEffectiveTimeScale()

    // クリップの残りではなく、それを速さで割った値。
    // **速さを変えても壊れない形**にしておく (いまの振りかぶりは等速)
    expect(rate).toBeGreaterThan(0)
    expect(anim.throwWindupLeft).toBeCloseTo((clip.duration - windup.time) / rate, 2)
  })

  /** 置く型も同じ。**尺ではなく流れる秒数**を持つ */
  test('置く型の長さも流す速さで割った実時間', () => {
    const anim = animator()
    const upper = (anim as unknown as Record<string, Map<string, THREE.AnimationAction>>).upper
    const place = upper.get('claymore_place')!
    expect(anim.setupReleaseDuration).toBeCloseTo(
      place.getClip().duration / place.getEffectiveTimeScale(),
      2,
    )
  })
})

describe('置く動作へ移る継ぎ目', () => {
  /** 腰の高さ。**立ち上がったかどうかがそのまま出る** */
  function hipsHeight(anim: CharacterAnimator): number {
    const root = (anim as unknown as { root: THREE.Object3D }).root
    root.updateMatrixWorld(true)
    let y = 0
    root.traverse((o) => {
      if (o.name.endsWith('Hips')) y = o.getWorldPosition(new THREE.Vector3()).y
    })
    return y
  }

  /**
   * **かがんだまま置く。立ち上がって座り直さない。**
   *
   * 振りかぶりを `stop()` で即座に消していた。置く型は重み 0 から上げるので、
   * その間**どの型にも重みが乗らず素の姿勢が透ける** — 実測で腰が 0.41m から
   * 0.90m へ跳ねていた。2 つのクリップは繋がっている (継ぎ目で腰も頭も差 0.00m)
   * ので、重ねたまま入れ替えれば穴が開かない。
   */
  test('**かがみから置きへ移る間、腰が上がらない**', () => {
    const anim = animator()
    anim.playSetup()
    // 振りかぶりは 1.77 秒。**かがみ切るまで待つ** — 途中だと腰がまだ高い
    run(anim, 2, 'claymore_windup')
    const crouched = hipsHeight(anim)
    expect(crouched).toBeLessThan(0.5)

    anim.releaseSetup()
    let highest = 0
    for (let i = 0; i < 40; i++) {
      anim.setLocomotion((anim.setupLocomotion ?? 'idle') as never)
      anim.update(1 / 60)
      highest = Math.max(highest, hipsHeight(anim))
    }
    // かがんだ高さから 10cm 以上跳ねない (直す前は 0.41 → 0.90 だった)
    expect(highest).toBeLessThan(crouched + 0.1)
  })
})

describe('置き切るまで構え直さない', () => {
  /**
   * **振りかぶりを流し直すと、立ち姿から始まる。**
   *
   * 振りかぶりのクリップは腰 1.00m (立ち) から 0.41m (かがみ) へ下りる。
   * 置く型の途中で流し直すと、**立ち上がってしゃがみ直す**ように見える。
   *
   * 手榴弾には同じ罠への関門が既にあった (Game の grenadeRelease > 0)。
   * クレイモアだけ抜けていて、引き金を引いた次のフレームに「構え始め」と
   * 読まれて流し直していた。
   *
   * ここでは**クリップがそういう形であること**を押さえる。関門そのものは
   * Game 側にあるが、この形が変われば関門の要否も変わる。
   */
  test('**振りかぶりは立ち姿から始まる。** 途中で流し直せない', () => {
    const anim = animator()
    const lower = (anim as unknown as Record<string, Map<string, THREE.AnimationAction>>).lower
    const clip = lower.get('claymore_windup')!.getClip()

    const root = (anim as unknown as { root: THREE.Object3D }).root
    const hipsAt = (phase: number): number => {
      const mixer = new THREE.AnimationMixer(root)
      const action = mixer.clipAction(clip)
      action.play()
      action.time = clip.duration * phase
      mixer.update(0)
      root.updateMatrixWorld(true)
      let y = 0
      root.traverse((o) => {
        if (o.name.endsWith('Hips')) y = o.getWorldPosition(new THREE.Vector3()).y
      })
      mixer.stopAllAction()
      return y
    }

    // 頭は立ち、終わりはかがみ。**この差が「流し直すと立ち上がる」の正体**
    expect(hipsAt(0)).toBeGreaterThan(0.8)
    expect(hipsAt(1)).toBeLessThan(0.5)
  })
})
