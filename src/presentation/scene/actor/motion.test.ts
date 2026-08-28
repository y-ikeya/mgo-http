import { describe, expect, test } from 'bun:test'
import { WHOLE_BODY, crawlSurge, resolveLocomotion, type StanceInput } from './motion'
import { stanceOf } from '../../../domain/player/stance'

/**
 * しゃがんだまま刺す。
 *
 * 立ちの刺突は**全身の型**なので、しゃがんでいても流すと立ち上がる。倒れている
 * 相手を刺すには見下ろす必要がある (damage.ts の STAB_DOWN_PITCH) のに、
 * 立ち上がってしまうと見下ろせない。
 */

const base: StanceInput = {
  previous: 'idle',
  down: false,
  boxed: false,
  crouching: false,
  aiming: false,
  saluting: false,
  stabbing: false,
  setting: null,
  downed: false,
  standingUp: false,
  prone: false,
  proneShift: null,
  rolling: false,
  onGround: true,
  landing: 0,
  hardLand: 0,
  airborneFor: 0,
  stairFor: 0,
  stairDown: false,
  forward: 0,
  strafe: 0,
  speed: 0,
  dirX: 0,
  dirZ: 0,
  actualSpeed: 0,
  yaw: 0,
  sprinting: false,
} as unknown as StanceInput

describe('刺す姿勢', () => {
  test('立って刺せば立ちの型', () => {
    expect(resolveLocomotion({ ...base, stabbing: true })).toBe('stab')
  })

  test('しゃがんで刺せば、しゃがんだままの型', () => {
    expect(resolveLocomotion({ ...base, stabbing: true, crouching: true })).toBe('crouch_stab')
  })

  test('しゃがんだままなので、構えもしゃがみのまま', () => {
    expect(stanceOf('crouch_stab')).toBe('crouch')
  })

  test('全身の型ではない。下半身はしゃがみ、上半身だけが刺す', () => {
    expect(WHOLE_BODY.has('stab')).toBe(true)
    expect(WHOLE_BODY.has('crouch_stab')).toBe(false)
  })
})

describe('堪える着地', () => {
  test('削られる高さから落ちたら堪える型。ただの着地とは別', () => {
    expect(resolveLocomotion({ ...base, hardLand: 1.6 })).toBe('hard_land')
    expect(resolveLocomotion({ ...base, landing: 0.1 })).toBe('jump_down')
  })

  test('堪えている間は移動の型に戻らない。**堪え切るまで続く**', () => {
    expect(
      resolveLocomotion({ ...base, hardLand: 0.4, actualSpeed: 5, dirZ: -1 } as StanceInput),
    ).toBe('hard_land')
  })

  test('堪えるのは着いてから。**空中では立たないフラグ**なので、そもそも来ない', () => {
    // hardLand は着地した瞬間に立てる (player.ts)。空中で立っていることは無い
    expect(resolveLocomotion({ ...base, hardLand: 0 } as StanceInput)).not.toBe('hard_land')
  })
})

describe('階段', () => {
  test('段差を上がっている間は専用の型', () => {
    expect(resolveLocomotion({ ...base, stairFor: 0.3 } as StanceInput)).toBe('up_stair')
  })

  test('**下りは別の型。** 同じ型の逆再生では下りに見えない', () => {
    expect(resolveLocomotion({ ...base, stairFor: 0.3, stairDown: true } as StanceInput)).toBe(
      'down_stair',
    )
  })

  test('**落ちている間は移動の型のまま。** 滞空のループは出さない', () => {
    const falling = { ...base, onGround: false, velocityY: -6, airborneFor: 0.5 } as StanceInput
    expect(resolveLocomotion(falling)).not.toBe('jump_loop')
    // 走って落ちれば走ったまま (前へ倒していれば前進の型)
    expect(
      resolveLocomotion({ ...falling, actualSpeed: 5, dirZ: -1, yaw: 0 } as StanceInput),
    ).toBe('run_f')
  })

  test('上がっている間だけ跳躍の型', () => {
    expect(
      resolveLocomotion({ ...base, onGround: false, velocityY: 4, airborneFor: 0.3 } as StanceInput),
    ).toBe('jump_up')
  })

  test('跳ぶほうが先。**階段を上って跳んだら跳躍の型**', () => {
    expect(
      resolveLocomotion({
        ...base, onGround: false, velocityY: 4, airborneFor: 0.3, stairFor: 0.3,
      } as StanceInput),
    ).toBe('jump_up')
  })
})

/**
 * ダンボールで敵にぶつかった。**箱が落ちて棒立ちになる。**
 *
 * 箱はぶつかった瞬間に落ちているので boxed はもう false。その状態でも
 * 反応の型が出続けないと、落とした所だけが飛んで普通に走り出す。
 */
describe('箱でぶつかった反応', () => {
  test('残り時間があるうちは反応の型', () => {
    expect(resolveLocomotion({ ...base, bumped: 0.4 })).toBe('bump')
  })

  test('**箱が落ちた後でも出る。** boxed が解けても型は続く', () => {
    expect(resolveLocomotion({ ...base, bumped: 0.4, boxed: false })).toBe('bump')
  })

  test('走っていても止まって見える。方向も速さも見ない', () => {
    const running = { ...base, bumped: 0.4, dirZ: 1, actualSpeed: 5 }
    expect(resolveLocomotion(running)).toBe('bump')
  })

  test('**棒立ち。** 頭は立ちの高さに戻っている', () => {
    expect(stanceOf('bump')).toBe('stand')
  })

  test('終われば普段の型へ戻る', () => {
    expect(resolveLocomotion({ ...base, bumped: 0 })).toBe('idle')
  })

  test('倒されたらそちらが勝つ。**死んだのに驚いていられない**', () => {
    expect(resolveLocomotion({ ...base, bumped: 0.4, down: true })).toBe('death')
  })

  test('全身の型。上半身だけ構えに戻らない', () => {
    expect(WHOLE_BODY.has('bump')).toBe(true)
  })
})

/**
 * 伏せ。**しゃがみの下にもう一段。**
 *
 * 這う型が前進の 1 本しかないので、8 方向には分けない。動いているかだけ見て、
 * 止まったら伏せたまま静止する (箱の sneak / sit と同じ形)。
 */
describe('伏せと匍匐', () => {
  const prone = { ...base, prone: true }

  test('止まっていれば伏せたまま', () => {
    expect(resolveLocomotion(prone)).toBe('prone_idle')
  })

  test('動いていれば這う', () => {
    expect(resolveLocomotion({ ...prone, dirZ: -1, actualSpeed: 0.85 })).toBe('crawl_f')
  })

  test('**8 方向に分けない。** 横入力でも同じ型', () => {
    const sideways = { ...prone, dirX: 1, actualSpeed: 0.85 }
    expect(resolveLocomotion(sideways)).toBe('crawl_f')
  })

  test('**構えは伏せ。** 頭が下がる', () => {
    expect(stanceOf('prone_idle')).toBe('prone')
    expect(stanceOf('crawl_f')).toBe('prone')
  })

  test('しゃがみの旗が立っていても、伏せが勝つ', () => {
    expect(resolveLocomotion({ ...prone, crouching: true })).toBe('prone_idle')
  })

  test('倒されたらそちらが勝つ', () => {
    expect(resolveLocomotion({ ...prone, down: true })).toBe('death')
  })

  test('爆風で転んだらそちらが勝つ。**自分で伏せたのではない**', () => {
    expect(resolveLocomotion({ ...prone, downed: true })).toBe('sweep')
  })

  /**
   * 止まる / 動き出すのしきい値は入りと出で違う。1 つだと境目で毎フレーム
   * 切り替わって、その場で這いと静止を往復する。
   */
  test('這っている途中は、少し遅くなっても這いのまま', () => {
    const slowing = { ...prone, previous: 'crawl_f' as const, dirZ: -1, actualSpeed: 0.3 }
    expect(resolveLocomotion(slowing)).toBe('crawl_f')
    // 止まっている所からは、同じ速さでは動き出さない
    expect(resolveLocomotion({ ...prone, dirZ: -1, actualSpeed: 0.3 })).toBe('prone_idle')
  })

  test('全身の型ではない。**伏せたまま構えられる**', () => {
    expect(WHOLE_BODY.has('crawl_f')).toBe(false)
    expect(WHOLE_BODY.has('prone_idle')).toBe(false)
  })
})

/**
 * 伏せへの出入り。**繋ぎを見せる。**
 *
 * 姿勢が繋がっていないと、立った姿から 1 フレームで腹這いになる。倒れる /
 * 起き上がると同じで、間を見せることが代償になる。
 */
describe('伏せへの出入り', () => {
  test('入っている最中は、まだ伏せの型ではない', () => {
    const going = { ...base, prone: false, proneShift: 'prone_down' as const }
    expect(resolveLocomotion(going)).toBe('prone_down')
  })

  test('出ている最中も同じ。**もう伏せていない**', () => {
    const rising = { ...base, prone: false, proneShift: 'prone_rise' as const }
    expect(resolveLocomotion(rising)).toBe('prone_rise')
  })

  test('**動いても止まらない。** 繋ぎは終わるまで続く', () => {
    const moving = {
      ...base,
      proneShift: 'prone_down' as const,
      dirZ: -1,
      actualSpeed: 3,
    }
    expect(resolveLocomotion(moving)).toBe('prone_down')
  })

  test('倒されたらそちらが勝つ', () => {
    expect(resolveLocomotion({ ...base, proneShift: 'prone_down', down: true })).toBe('death')
  })

  /**
   * **高いほうで採る。** 頭は 0.84m から 0.34m まで動く。低いほうで採ると、
   * まだ立っている体が遮蔽の裏に居ることになる。
   */
  test('繋ぎの間の構えはしゃがみ', () => {
    expect(stanceOf('prone_down')).toBe('crouch')
    expect(stanceOf('prone_rise')).toBe('crouch')
  })

  test('全身の型。上半身だけ構えに戻らない', () => {
    expect(WHOLE_BODY.has('prone_down')).toBe(true)
    expect(WHOLE_BODY.has('prone_rise')).toBe(true)
  })
})

/**
 * 這う進み方。**蹴った瞬間だけ前へ出る。**
 *
 * 等速で滑らせると、手足を動かしているのに一定の速さで運ばれる形になる。
 * 腕で這う動きなので、足が地面を掻いた瞬間に体が出るのが自然。
 */
describe('這う脈', () => {
  /** 1 周期を均した倍率 */
  function mean(steps = 720): number {
    let total = 0
    for (let i = 0; i < steps; i++) total += crawlSurge(i / steps)
    return total / steps
  }

  test('**均せば 1。** 進む距離も間合いも変わらない', () => {
    expect(mean()).toBeCloseTo(1, 2)
  })

  test('蹴る所で速く、間で遅い', () => {
    // 山は位相 0.19 と 0.69 (実測 0.31 から前へ寄せてある)
    expect(crawlSurge(0.19)).toBeGreaterThan(2)
    expect(crawlSurge(0.69)).toBeGreaterThan(2)
    // 山と山の間
    expect(crawlSurge(0.44)).toBeLessThan(0.5)
    expect(crawlSurge(0.94)).toBeLessThan(0.5)
  })

  test('**実測より少し早い。** 蹴り終わりではなく掻き始めに合わせる', () => {
    expect(crawlSurge(0.19)).toBeGreaterThan(crawlSurge(0.31))
  })

  test('**止まりはしない。** 引っ掛かって見えないよう下限を残す', () => {
    for (let i = 0; i < 100; i++) expect(crawlSurge(i / 100)).toBeGreaterThan(0)
  })

  test('1 周期に 2 回。位相が 1 周れば元へ戻る', () => {
    expect(crawlSurge(0.19)).toBeCloseTo(crawlSurge(0.69), 5)
    expect(crawlSurge(0.2)).toBeCloseTo(crawlSurge(1.2), 5)
  })
})
