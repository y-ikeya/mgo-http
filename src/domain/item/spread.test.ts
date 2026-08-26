import { describe, expect, test } from 'bun:test'
import { Spread } from './spread'
import { WEAPONS } from './weapons'

/**
 * 散布と反動は「**止まって撃つほうが当たる**」を作るためにある。
 *
 * 長いあいだ presentation に居て three を import していたので、three 無しでは
 * 動かせず試験が 1 本も無かった。規則の側へ出したので、報せを入れて数字を見る
 * だけで済む。
 */
const rifle = WEAPONS.rifle
const still = { speed: 0, stanceRate: 0, crouching: false, grounded: true }
const running = { speed: 3, stanceRate: 0, crouching: false, grounded: true }

describe('連射で広がる', () => {
  test('止まっていれば散らない', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, still)
    expect(spread.degrees(rifle)).toBe(0)
  })

  test('撃つほど広がる', () => {
    const spread = new Spread()
    const first = spread.degrees(rifle)
    spread.fired(1)
    spread.fired(2)
    expect(spread.degrees(rifle)).toBeGreaterThan(first)
  })

  test('**上限がある。** 押しっぱなしでも無限には広がらない', () => {
    const spread = new Spread()
    for (let i = 0; i < 200; i++) spread.fired(i)
    expect(spread.degrees(rifle)).toBe(rifle.spreadMax)
  })

  test('撃たない時間が続けば頭に戻る。**バーストが手になる**', () => {
    const spread = new Spread()
    for (let i = 0; i < 5; i++) spread.fired(i)
    expect(spread.degrees(rifle)).toBeGreaterThan(0)
    // 間を置く
    spread.update(0.4, rifle, still)
    expect(spread.degrees(rifle)).toBe(0)
  })
})

describe('姿勢で広がる', () => {
  test('走れば散る', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    expect(spread.degrees(rifle)).toBeGreaterThan(0)
  })

  /**
   * **上がるのは即座、戻るのは遅い。** 均すと、止まった瞬間に撃つだけで
   * 精度が得られてしまう。一拍置く必要が、遮蔽に入る動作の意味になっている。
   */
  test('走り出した瞬間に上がりきる', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    expect(spread.degrees(rifle)).toBeCloseTo(3 * rifle.spreadPerSpeed, 5)
  })

  test('止まっても一拍は残る', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    const moving = spread.degrees(rifle)
    spread.update(0.05, rifle, still)
    const settling = spread.degrees(rifle)
    expect(settling).toBeLessThan(moving)
    expect(settling).toBeGreaterThan(0)
  })

  test('しゃがめば散りにくい', () => {
    const crouched = new Spread()
    crouched.update(0.016, rifle, { ...running, crouching: true })
    const standing = new Spread()
    standing.update(0.016, rifle, running)
    expect(crouched.degrees(rifle)).toBeLessThan(standing.degrees(rifle))
  })

  test('**姿勢を変えている間も散る。** しゃがみ連打を只にしない', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, { ...still, stanceRate: 1 })
    expect(spread.degrees(rifle)).toBeGreaterThan(0)
  })

  /**
   * **空中では上限まで散る。**
   *
   * 4 挺のうち 3 挺 (smg / rifle / sniper) は spreadAirborne が spreadMax を
   * 超えているので、実際には上限に張り付く。跳んで撃つのは只では済まない、
   * という規則としては効いているが、**超えた分の数字は効いていない** —
   * 空中の散り方を挺ごとに変えたいなら spreadMax のほうを見る必要がある。
   */
  test('空中は上限まで散る', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, { ...still, grounded: false })
    expect(spread.degrees(rifle)).toBe(rifle.spreadMax)
  })

  test('拳銃だけは上限に届かない (spreadAirborne < spreadMax)', () => {
    const spread = new Spread()
    spread.update(0.016, WEAPONS.pistol, { ...still, grounded: false })
    expect(spread.degrees(WEAPONS.pistol)).toBeCloseTo(WEAPONS.pistol.spreadAirborne, 5)
  })
})

describe('反動', () => {
  /**
   * **同じ種なら同じ跳ね上がり。** これが成り立たないと、サーバーが独立に
   * 同じ弾を再現できず、散布は「当てた側の申告」になる。
   */
  test('種が同じなら同じ値', () => {
    const a = new Spread()
    const b = new Spread()
    expect(a.fired(42)).toEqual(b.fired(42))
  })

  test('種が違えば違う値。**マクロで打ち消せない**', () => {
    const a = new Spread()
    const b = new Spread()
    expect(a.fired(1)).not.toEqual(b.fired(2))
  })

  test('1 発目が最も強い', () => {
    const spread = new Spread()
    const [first] = spread.fired(1)
    const [second] = spread.fired(2)
    expect(first).toBeGreaterThan(second)
  })

  test('表を超えても値が消えない', () => {
    const spread = new Spread()
    for (let i = 0; i < 50; i++) spread.fired(i)
    const [pitch] = spread.fired(50)
    expect(pitch).toBeGreaterThan(0)
  })

  test('散る場所も種から決まる', () => {
    const a = new Spread()
    const b = new Spread()
    a.fired(7)
    b.fired(7)
    expect(a.coneFor(rifle, 9)).toEqual(b.coneFor(rifle, 9))
  })
})
