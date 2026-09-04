import { describe, expect, test } from 'bun:test'
import { Spread } from '../item/spread'
import { carrySpeedScale, WEAPONS } from '../item/weapons'
import { THROW_SPEED, throwSpeedOf } from '../item/grenade'
import { isLeakedTo, leakTag, newMatchPlayer, refill, type MatchPlayer } from './player'
import { masteryRecoveryScale, masteryReloadScale, runnerScale, type Skills } from './skill'

/**
 * スキルが**効いているか**の試験。
 *
 * skill.test.ts が見ているのは表そのもの (段が上がれば倍率が動くか)。あちらは
 * 8 つとも緑だったが、**倍率を読む場所が 1 つも無かった** — 選べて、保存されて、
 * 画面に出るのに、走る速さも散布も全員同じだった。
 *
 * 「値がある」と「効いている」は別の問いなので、繋ぎ目のほうをここで見る。
 * 速さだけは presentation (actor/player.ts) に居るので、掛け算の形だけレプリカて
 * 確かめる — そこが崩れたらこの試験も一緒に直す。
 */

const NONE: Skills = {}
const still = { speed: 0, stanceRate: 0, crouching: false, grounded: true }
const running = { speed: 3, stanceRate: 0, crouching: false, grounded: true }

/** 落ち着くまで進める。手ブレは即座に上がるが、戻りは遅い */
function settled(weapon = WEAPONS.rifle, posture = still): Spread {
  const spread = new Spread()
  for (let i = 0; i < 180; i++) spread.update(1 / 60, weapon, posture)
  return spread
}

describe('MASTERY が散布に効く', () => {
  /**
   * **ここが本命。** 止まって撃つ限り、極めた人と素の人の差が 1 ミリも
   * 無かった (散布の合計が 0 で、倍率が掛かる先が無かった)。手ブレを
   * 入れたので、止まっていても差が出る。
   */
  test('止まって構えていても、極めた銃は泳ぎが小さい (Lv3 で止まる)', () => {
    const spread = settled()
    const swayOf = (skills: Skills) => {
      const [r, u] = spread.sway(WEAPONS.rifle, skills, still)
      return Math.hypot(r, u)
    }
    // **Lv3 は完全に止まる**
    expect(swayOf({ rifleMastery: 3 })).toBe(0)
    expect(swayOf({ rifleMastery: 1 })).toBeLessThan(swayOf(NONE))
    expect(swayOf({ rifleMastery: 1 })).toBeGreaterThan(0)
  })

  test('動きながらも締まる', () => {
    const spread = settled(WEAPONS.rifle, running)
    expect(spread.degrees(WEAPONS.rifle, { rifleMastery: 3 })).toBeLessThan(
      spread.degrees(WEAPONS.rifle, NONE),
    )
  })

  test('連射で開いた分も締まる', () => {
    const spread = new Spread()
    for (let i = 0; i < 6; i++) spread.fired(i, WEAPONS.rifle, NONE)
    expect(spread.degrees(WEAPONS.rifle, { rifleMastery: 3 })).toBeLessThan(
      spread.degrees(WEAPONS.rifle, NONE),
    )
  })

  /**
   * **拾った銃は素のまま。** 予算 4 では 2 挺を極められないので、
   * 主武器を決めることがスキルの 1 枠を決めることになる。
   */
  test('極めていない銃には効かない', () => {
    const spread = settled(WEAPONS.sniper)
    expect(spread.degrees(WEAPONS.sniper, { rifleMastery: 3 })).toBeCloseTo(
      spread.degrees(WEAPONS.sniper, NONE),
      10,
    )
  })

  /** 極めても銃の限界は動かない。上限は上限のまま */
  test('連射し切れば、極めても上限で頭打ち', () => {
    const spread = new Spread()
    for (let i = 0; i < 200; i++) spread.fired(i, WEAPONS.rifle, NONE)
    expect(spread.degrees(WEAPONS.rifle, { rifleMastery: 3 })).toBe(WEAPONS.rifle.spreadMax)
  })
})

describe('MASTERY が反動の乱れに効く', () => {
  /** 同じ種で撃ち比べる。**跳ね上がりの中心は動かず、ばらつきだけ縮む** */
  function kick(skills: Skills, seed: number): [number, number] {
    return new Spread().fired(seed, WEAPONS.rifle, skills)
  }

  test('極めた人のほうが、種ごとの散らばりが小さい', () => {
    const seeds = [1, 7, 13, 29, 44, 61, 98, 123]
    const spreadOf = (skills: Skills) => {
      const pitches = seeds.map((s) => kick(skills, s)[0])
      return Math.max(...pitches) - Math.min(...pitches)
    }
    expect(spreadOf({ rifleMastery: 3 })).toBeLessThan(spreadOf(NONE))
  })

  test('乱れの無い左右でも縮む (パターン 1 発目の左右は 0)', () => {
    const plain = kick(NONE, 5)[1]
    const master = kick({ rifleMastery: 3 }, 5)[1]
    expect(Math.abs(master)).toBeLessThan(Math.abs(plain))
    // 向きは変わらない。**押さえ戻す方向が段で反転したら覚え直しになる**
    expect(Math.sign(master)).toBe(Math.sign(plain))
  })
})

/**
 * 跳ね上がりそのもの。**控えめに削る。**
 *
 * 大きく削ると押さえ戻せない人が一番得をする。表を覚えて押さえ戻す対象を
 * 消すと、上手さの効く余地がそのまま減る。
 */
describe('MASTERY が跳ね上がりに効く', () => {
  /** 連射したときの累積の上がり幅 (度) */
  function climb(skills: Skills, shots: number): number {
    const spread = new Spread()
    let total = 0
    for (let n = 0; n < shots; n++) total += spread.fired(n, WEAPONS.rifle, skills)[0]
    return (total * 180) / Math.PI
  }

  test('極めた銃は跳ねる丈が縮む', () => {
    expect(climb({ rifleMastery: 3 }, 10)).toBeLessThan(climb(NONE, 10))
  })

  test('**削るのは 12% まで。** 消してしまわない', () => {
    const ratio = climb({ rifleMastery: 3 }, 10) / climb(NONE, 10)
    expect(ratio).toBeGreaterThan(0.85)
    expect(ratio).toBeLessThan(0.92)
  })

  test('段が上がるほど縮む', () => {
    const lv1 = climb({ rifleMastery: 1 }, 10)
    const lv3 = climb({ rifleMastery: 3 }, 10)
    expect(lv3).toBeLessThan(lv1)
    expect(lv1).toBeLessThan(climb(NONE, 10))
  })

  test('**別の銃には効かない。** 極めたのはその銃だけ', () => {
    const spread = new Spread()
    const other = spread.fired(3, WEAPONS.smg, { rifleMastery: 3 })[0]
    const plain = new Spread().fired(3, WEAPONS.smg, NONE)[0]
    expect(other).toBe(plain)
  })
})

/**
 * 戻る速さ。**指を離した人だけが得をする。**
 *
 * 戻り始めるまでの猶予 (0.1 秒) より AK の発射間隔 (0.09 秒) のほうが短いので、
 * 押しっぱなしの間は一度も戻らない。区切って撃つ判断がここで太る。
 */
describe('MASTERY が反動の戻りに効く', () => {
  test('極めた銃ほど早く狙点へ帰る', () => {
    expect(masteryRecoveryScale({ rifleMastery: 3 }, 'rifle')).toBeGreaterThan(
      masteryRecoveryScale(NONE, 'rifle'),
    )
  })

  test('取っていなければ素のまま', () => {
    expect(masteryRecoveryScale(NONE, 'rifle')).toBe(1)
  })

  test('別の銃には効かない', () => {
    expect(masteryRecoveryScale({ rifleMastery: 3 }, 'smg')).toBe(1)
  })
})

describe('MASTERY が装填に効く', () => {
  /** Game.ts が `weapon.reload * masteryReloadScale(...)` で使っている形 */
  test('極めた銃だけ速い', () => {
    const rifle = WEAPONS.rifle
    const plain = rifle.reload * masteryReloadScale(NONE, rifle.id)
    const master = rifle.reload * masteryReloadScale({ rifleMastery: 3 }, rifle.id)
    expect(master).toBeLessThan(plain)
    expect(plain).toBe(rifle.reload)
  })

  test('銃ごとの尺の差は残る。**どの銃も同じ時間にはならない**', () => {
    const skills: Skills = { smgMastery: 3, rifleMastery: 3 }
    const smg = WEAPONS.smg.reload * masteryReloadScale(skills, 'smg')
    const rifle = WEAPONS.rifle.reload * masteryReloadScale(skills, 'rifle')
    expect(smg).toBeGreaterThan(rifle)
  })
})

describe('THROWING MASTERY が投擲に効く', () => {
  test('取っていなければ素の速さ', () => {
    expect(throwSpeedOf(NONE)).toBe(THROW_SPEED)
  })

  test('段が上がるほど速く出る', () => {
    expect(throwSpeedOf({ throwing: 1 })).toBeGreaterThan(THROW_SPEED)
    expect(throwSpeedOf({ throwing: 3 })).toBeGreaterThan(throwSpeedOf({ throwing: 1 }))
  })

  /**
   * **サーバーと予測線が同じ関数を呼ぶ。** 別々に掛けると、見えている落下点と
   * 落ちる場所がずれる。手榴弾は「そこへ落とす」判断そのものが手なので、
   * ずれた時点で武器が壊れる。
   */
  test('同じスキルなら必ず同じ速さ', () => {
    const skills: Skills = { throwing: 2 }
    expect(throwSpeedOf(skills)).toBe(throwSpeedOf({ ...skills }))
  })
})

describe('走る速さ (掛け算の形)', () => {
  /**
   * 実際に掛けているのは presentation/scene/actor/player.ts:
   *
   *     carrying = carrySpeedScale(銃) * runnerScale(skills)
   *
   * **足し算にすると重い銃の不利が薄まる。** ここで見るのは形のほうで、
   * 数字は skill.test.ts が持っている。
   */
  test('狙撃銃 + FAST MOVE Lv3 は、拳銃の素の人に追いつかない', () => {
    // skill.test.ts と同じ事実を、こちらは表から引いて確かめる
    const sniper = carrySpeedScale(WEAPONS.sniper) * runnerScale({ runner: 3 })
    const pistol = carrySpeedScale(WEAPONS.m9) * runnerScale(NONE)
    expect(sniper).toBeLessThan(pistol)
  })
})

describe('ENEMY EXPOSURE の宛先', () => {
  function player(id: string, team: 'blue' | 'red'): MatchPlayer {
    return newMatchPlayer({ id, name: id, team, slot: 0, now: 0 })
  }

  const now = 1_000_000

  /** 陣営のある部屋。**味方に渡せるからチーム戦で 1 枠割く価値が出る** */
  test('陣営のある部屋では、当てた側の陣営ぜんぶに見える', () => {
    const alice = player('alice', 'blue')
    const mate = player('mate', 'blue')
    const bob = player('bob', 'red')
    bob.leakedUntil = now + 5000
    bob.leakedTo = leakTag(alice, true)

    expect(isLeakedTo(bob, alice, now)).toBe(true)
    expect(isLeakedTo(bob, mate, now)).toBe(true)
  })

  /**
   * **抜かれた側には見えない。** 自分が光っていると分かると
   * 「いま位置が漏れている」まで確定して、抜いた側の利が消える。
   */
  test('抜かれた側の陣営には見えない', () => {
    const alice = player('alice', 'blue')
    const bob = player('bob', 'red')
    const bobMate = player('bobMate', 'red')
    bob.leakedUntil = now + 5000
    bob.leakedTo = leakTag(alice, true)

    expect(isLeakedTo(bob, bobMate, now)).toBe(false)
  })

  /** 陣営が無い部屋 (個人戦)。渡す相手が居ないので、同じドメインルールが本人だけに落ちる */
  test('陣営の無い部屋では、当てた本人だけ', () => {
    const alice = player('alice', 'blue')
    const carol = player('carol', 'blue')
    const bob = player('bob', 'blue')
    bob.leakedUntil = now + 5000
    bob.leakedTo = leakTag(alice, false)

    expect(isLeakedTo(bob, alice, now)).toBe(true)
    // **同じ色でも見えない。** 個人戦では陣営が味方を意味しない
    expect(isLeakedTo(bob, carol, now)).toBe(false)
  })

  test('時間で切れる', () => {
    const alice = player('alice', 'blue')
    const bob = player('bob', 'red')
    bob.leakedUntil = now + 5000
    bob.leakedTo = leakTag(alice, true)

    expect(isLeakedTo(bob, alice, now + 4999)).toBe(true)
    expect(isLeakedTo(bob, alice, now + 5000)).toBe(false)
  })

  test('光っていない人は誰にも見えない', () => {
    const alice = player('alice', 'blue')
    const bob = player('bob', 'red')
    expect(isLeakedTo(bob, alice, now)).toBe(false)
  })

  /** **死ねば漏洩が止まる。** 死が情報を切る手段になっている */
  test('湧き直すと宛先ごと消える', () => {
    const alice = player('alice', 'blue')
    const bob = player('bob', 'red')
    bob.leakedUntil = now + 5000
    bob.leakedTo = leakTag(alice, true)

    refill(bob)
    expect(bob.leakedTo).toBe('')
    expect(isLeakedTo(bob, alice, now)).toBe(false)
  })
})
