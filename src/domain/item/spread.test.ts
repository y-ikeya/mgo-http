import { describe, expect, test } from 'bun:test'
import { Spread } from './spread'
import type { Skills } from '../player/skill'
import { WEAPONS } from './weapons'

/**
 * 散布と反動は「**止まって撃つほうが当たる**」を作るためにある。
 *
 * 長いあいだ presentation に居て three を import していたので、three 無しでは
 * 動かせず試験が 1 本も無かった。規則の側へ出したので、報せを入れて数字を見る
 * だけで済む。
 */
/** スキル無し。**素の値を見る試験**はこれを渡す */
const NONE: Skills = {}

const rifle = WEAPONS.rifle
const still = { speed: 0, stanceRate: 0, crouching: false, grounded: true }
const running = { speed: 3, stanceRate: 0, crouching: false, grounded: true }
const crouching = { speed: 0, stanceRate: 0, crouching: true, grounded: true }

describe('連射で広がる', () => {
  /**
   * **散布は「動いた・撃った」でだけ開く。**
   *
   * 止まって構えていても狙点は泳ぐが、それは散布ではなく手ブレ (sway) の側。
   * 散らすのと動かすのを分けてあるのは、**動くほうは撃つ前に見える**から。
   */
  test('止まっていれば散らない', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, still)
    expect(spread.degrees(rifle, NONE)).toBe(0)
  })

  test('撃つほど広がる', () => {
    const spread = new Spread()
    const first = spread.degrees(rifle, NONE)
    spread.fired(1, rifle, NONE)
    spread.fired(2, rifle, NONE)
    expect(spread.degrees(rifle, NONE)).toBeGreaterThan(first)
  })

  test('**上限がある。** 押しっぱなしでも無限には広がらない', () => {
    const spread = new Spread()
    for (let i = 0; i < 200; i++) spread.fired(i, rifle, NONE)
    expect(spread.degrees(rifle, NONE)).toBe(rifle.spreadMax)
  })

  test('撃たない時間が続けば頭に戻る。**バーストが手になる**', () => {
    const spread = new Spread()
    for (let i = 0; i < 5; i++) spread.fired(i, rifle, NONE)
    expect(spread.degrees(rifle, NONE)).toBeGreaterThan(0)
    // 間を置く
    spread.update(0.4, rifle, still)
    expect(spread.degrees(rifle, NONE)).toBe(0)
  })
})

describe('姿勢で広がる', () => {
  test('走れば散る', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    expect(spread.degrees(rifle, NONE)).toBeGreaterThan(0)
  })

  /**
   * **上がるのは即座、戻るのは遅い。** 均すと、止まった瞬間に撃つだけで
   * 精度が得られてしまう。一拍置く必要が、遮蔽に入る動作の意味になっている。
   */
  test('走り出した瞬間に上がりきる', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    expect(spread.degrees(rifle, NONE)).toBeCloseTo(3 * rifle.spreadPerSpeed, 5)
  })

  test('止まっても一拍は残る', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    const moving = spread.degrees(rifle, NONE)
    spread.update(0.05, rifle, still)
    const settling = spread.degrees(rifle, NONE)
    expect(settling).toBeLessThan(moving)
    expect(settling).toBeGreaterThan(0)
  })

  test('しゃがめば散りにくい', () => {
    const crouched = new Spread()
    crouched.update(0.016, rifle, { ...running, crouching: true })
    const standing = new Spread()
    standing.update(0.016, rifle, running)
    expect(crouched.degrees(rifle, NONE)).toBeLessThan(standing.degrees(rifle, NONE))
  })

  test('**姿勢を変えている間も散る。** しゃがみ連打を只にしない', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, { ...still, stanceRate: 1 })
    expect(spread.degrees(rifle, NONE)).toBeGreaterThan(0)
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
    expect(spread.degrees(rifle, NONE)).toBe(rifle.spreadMax)
  })

  test('拳銃だけは上限に届かない (spreadAirborne < spreadMax)', () => {
    const spread = new Spread()
    spread.update(0.016, WEAPONS.pistol, { ...still, grounded: false })
    expect(spread.degrees(WEAPONS.pistol, NONE)).toBeCloseTo(WEAPONS.pistol.spreadAirborne, 5)
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
    expect(a.fired(42, rifle, NONE)).toEqual(b.fired(42, rifle, NONE))
  })

  test('種が違えば違う値。**マクロで打ち消せない**', () => {
    const a = new Spread()
    const b = new Spread()
    expect(a.fired(1, rifle, NONE)).not.toEqual(b.fired(2, rifle, NONE))
  })

  test('1 発目が最も強い', () => {
    const spread = new Spread()
    const [first] = spread.fired(1, rifle, NONE)
    const [second] = spread.fired(2, rifle, NONE)
    expect(first).toBeGreaterThan(second)
  })

  test('表を超えても値が消えない', () => {
    const spread = new Spread()
    for (let i = 0; i < 50; i++) spread.fired(i, rifle, NONE)
    const [pitch] = spread.fired(50, rifle, NONE)
    expect(pitch).toBeGreaterThan(0)
  })

  test('散る場所も種から決まる', () => {
    const a = new Spread()
    const b = new Spread()
    a.fired(7, rifle, NONE)
    b.fired(7, rifle, NONE)
    expect(a.coneFor(rifle, 9, NONE)).toEqual(b.coneFor(rifle, 9, NONE))
  })
})

/**
 * 手ブレ。**散らすのではなく、狙点そのものを動かす。**
 *
 * 散布は撃った結果でしか分からないので、撃つ前の判断に使えない。こちらは
 * 照準が泳いで見えるので、**折り返しを読んで撃つ**という手が成立する。
 */
describe('手ブレ', () => {
  /** 構えたまま 40 秒ぶん進めて、振れ幅と軌跡を集める */
  function trace(weapon = rifle, posture = still, skills: Skills = NONE) {
    const spread = new Spread()
    const points: [number, number][] = []
    for (let i = 0; i < 60 * 40; i++) {
      spread.update(1 / 60, weapon, posture)
      points.push(spread.sway(weapon, skills, posture))
    }
    return points
  }

  const reach = (points: [number, number][]) =>
    Math.max(...points.map(([r, u]) => Math.max(Math.abs(r), Math.abs(u))))

  test('止まって構えていても動く', () => {
    expect(reach(trace())).toBeGreaterThan(0)
  })

  /**
   * **1 度は超えない。** 肩越しの画角では 1 度が 25 画素ほどで、それ以上
   * 泳ぐと狙う行為そのものが成立しない (25m で 44cm ずれる)。
   */
  test('振れ幅は銃の値の内側に収まる', () => {
    expect(reach(trace())).toBeLessThanOrEqual(rifle.sway)
    expect(reach(trace())).toBeLessThan(1)
  })

  /**
   * **跳ばない。** 乱数で毎フレーム跳ばすと震えるだけで、次にどちらへ行くかが
   * 読めない。読めなければ待つ意味が無く、結局は運になる。
   */
  test('滑らかに動く。1 フレームで飛ばない', () => {
    const points = trace()
    for (let i = 1; i < points.length; i++) {
      const step = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
      expect(step).toBeLessThan(rifle.sway * 0.1)
    }
  })

  /** 直線を往復するだけだと、折り返しが 2 か所しか無くて読み切られる */
  test('直線ではなく円を描く。**2 軸が揃っていない**', () => {
    const points = trace()
    // 右と上の相関。揃っていれば ±1 に寄る
    const n = points.length
    const mr = points.reduce((a, p) => a + p[0], 0) / n
    const mu = points.reduce((a, p) => a + p[1], 0) / n
    let cov = 0
    let vr = 0
    let vu = 0
    for (const [r, u] of points) {
      cov += (r - mr) * (u - mu)
      vr += (r - mr) ** 2
      vu += (u - mu) ** 2
    }
    expect(Math.abs(cov / Math.sqrt(vr * vu))).toBeLessThan(0.5)
  })

  test('しゃがめば締まる', () => {
    expect(reach(trace(rifle, crouching))).toBeLessThan(reach(trace(rifle, still)))
  })

  /** **極めた銃だけ。** 拾った銃は素のまま泳ぐ */
  test('MASTERY で締まる', () => {
    expect(reach(trace(rifle, still, { rifleMastery: 3 }))).toBeLessThan(reach(trace()))
    expect(reach(trace(rifle, still, { sniperMastery: 3 }))).toBeCloseTo(reach(trace()), 10)
  })

  /**
   * **Lv3 で完全に止まる。** 極めた銃は構えれば泳がない。
   *
   * 「その銃を極めた」ことが手触りで分かる形がここにしか無い — 散布も装填も
   * 数字は動くが、撃った結果でしか分からない。照準が止まることは構えた瞬間に見える。
   */
  test('MASTERY Lv3 なら泳がない', () => {
    expect(reach(trace(rifle, still, { rifleMastery: 3 }))).toBe(0)
  })

  test('Lv2 まではまだ泳ぐ', () => {
    expect(reach(trace(rifle, still, { rifleMastery: 2 }))).toBeGreaterThan(0)
  })

  /**
   * **止まっても必中にはならない。** 消えるのは構えている間の泳ぎだけで、
   * 動けば散り、連射すれば開く。撃ち方の巧拙はそのまま残る。
   */
  test('Lv3 でも、動けば散る / 連射すれば開く', () => {
    const spread = new Spread()
    spread.update(0.016, rifle, running)
    expect(spread.degrees(rifle, { rifleMastery: 3 })).toBeGreaterThan(0)
    for (let i = 0; i < 5; i++) spread.fired(i, rifle, { rifleMastery: 3 })
    expect(spread.degrees(rifle, { rifleMastery: 3 })).toBeGreaterThan(0)
  })

  /**
   * **走っても増えない。** 走りながらの乱れは散布 (degrees) が持っている。
   * 二重に掛けると、動いたことの代償を 2 回払うことになる。
   */
  test('動いても振れ幅は変わらない', () => {
    expect(reach(trace(rifle, running))).toBeCloseTo(reach(trace(rifle, still)), 10)
  })

  /**
   * **主武器は 3 挺とも同じ。** 銃の性格は威力の帯・連射・弾倉・重さで既に
   * 分かれていて、そこへ泳ぎ方の差を足すと何が効いているのか分からなくなる。
   */
  test('主武器の振れ幅は揃っている', () => {
    expect(WEAPONS.smg.sway).toBe(WEAPONS.rifle.sway)
    expect(WEAPONS.rifle.sway).toBe(WEAPONS.sniper.sway)
  })

  /** **主武器のほうが大きく泳ぐ。** 遠くを狙うなら極める動機が要る */
  test('拳銃は主武器より泳がない', () => {
    expect(WEAPONS.pistol.sway).toBeLessThan(WEAPONS.rifle.sway)
  })
})
