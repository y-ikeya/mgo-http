import { describe, expect, test } from 'bun:test'
import { ROOM_NAMES, ROOMS } from './room'
import { STAGES, inWater, isStageName, nextStage, only, waterOf, type Rotation, type StageName } from './stage'

/**
 * ステージと、その回し方。
 *
 * いまはどの部屋も 1 枚だけを回しているので、**表として動くこと**をここで
 * 押さえておく。部屋を作った人が並びと順を選べるようになったとき、
 * 変わるのは表を作る場所だけで、このドメインルールは動かない。
 */

describe('回す順', () => {
  const two: StageName[] = ['mall', 'training']

  test('fixed は先頭 1 枚。**ずっと同じ**', () => {
    const rotation: Rotation = { stages: two, order: 'fixed' }
    expect(nextStage(rotation, null, 0.9)).toBe('mall')
    expect(nextStage(rotation, 'mall', 0.9)).toBe('mall')
  })

  test('cycle は並べた順に 1 枚ずつ', () => {
    const rotation: Rotation = { stages: two, order: 'cycle' }
    expect(nextStage(rotation, null, 0)).toBe('mall')
    expect(nextStage(rotation, 'mall', 0)).toBe('training')
    // **一周したら頭へ戻る**
    expect(nextStage(rotation, 'training', 0)).toBe('mall')
  })

  /**
   * **表を組み替えた直後も止まらない。** 前のステージが並びから消えていても、
   * 先頭から始めれば済む。
   */
  test('cycle は、前が表に無ければ先頭から', () => {
    const rotation: Rotation = { stages: ['training'], order: 'cycle' }
    expect(nextStage(rotation, 'mall', 0)).toBe('training')
  })

  test('random は引いた目で決まる', () => {
    const rotation: Rotation = { stages: two, order: 'random' }
    expect(nextStage(rotation, null, 0)).toBe('mall')
    expect(nextStage(rotation, null, 0.99)).toBe('training')
  })

  /** 1.0 が来ても表の外を指さない */
  test('random で目が 1 でも落ちない', () => {
    const rotation: Rotation = { stages: two, order: 'random' }
    expect(nextStage(rotation, null, 1)).toBe('training')
  })

  /** **空の表でも遊べる。** 設定を間違えた部屋が繋がらない、にはしない */
  test('空の表でもステージは返る', () => {
    expect(isStageName(nextStage({ stages: [], order: 'cycle' }, null, 0))).toBe(true)
  })

  test('only は 1 枚だけの fixed', () => {
    expect(only('training')).toEqual({ stages: ['training'], order: 'fixed' })
  })
})

describe('部屋の割り当て', () => {
  test('**練習は訓練場。** 遮蔽が無いので、外したのが腕か地形かが分かれる', () => {
    expect(nextStage(ROOMS.echo.stages, null, 0)).toBe('training')
  })

  test('全部の部屋に表がある', () => {
    for (const room of ROOM_NAMES) {
      expect(ROOMS[room].stages.stages.length).toBeGreaterThan(0)
    }
  })

  test('表に載っているのは実在するステージだけ', () => {
    for (const room of ROOM_NAMES) {
      for (const stage of ROOMS[room].stages.stages) expect(isStageName(stage)).toBe(true)
    }
  })
})

describe('ステージの点', () => {
  const names = Object.keys(STAGES) as StageName[]

  test('どのステージにも陣営の基地が 2 つある', () => {
    for (const name of names) {
      expect(STAGES[name].bases.blue).toBeDefined()
      expect(STAGES[name].bases.red).toBeDefined()
    }
  })

  /** 1 か所だと湧いた所で撃ち合いになって「湧き待ち」が成立する */
  test('陣営の無い部屋の湧き地点は散らしてある', () => {
    for (const name of names) expect(STAGES[name].solo.length).toBeGreaterThan(1)
  })

  /**
   * **同じ距離に並べない。** 並べても確かめられるのが 1 つの間合いだけになる。
   * 銃ごとの帯 (P90 は 12m まで頭 1 発、30m から 4 発) を跨いで置く。
   */
  test('練習の的は、基地からの距離がばらけている', () => {
    // 的を置かないステージもある (モールは撃ち合う地形)
    for (const name of names.filter((n) => STAGES[n].targets.length > 0)) {
      const base = STAGES[name].bases.blue
      const reach = STAGES[name].targets.map((t) => Math.hypot(t.x - base.x, t.z - base.z))
      expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(20)
    }
  })

  /** **練習部屋のステージには的が要る。** 無いと撃つ物が何も無い */
  test('練習を回す部屋のステージには的がある', () => {
    for (const stage of ROOMS.echo.stages.stages) {
      expect(STAGES[stage].targets.length).toBeGreaterThan(0)
    }
  })

  test('名前は自分自身を指している', () => {
    for (const name of names) expect(STAGES[name].name).toBe(name)
  })
})


/**
 * 溺れる。**人が死ぬ判定なので、境目を数字で押さえる。**
 *
 * 庭園は水がアリーナ全体を覆っていて、歩けるのは水に浮いている板の上だけ。
 * 板の縁で 1cm の差が生死を分けるので、**立っているだけで死なない**ことと、
 * **落ちたら必ず死ぬ**ことの両方を見る。
 */
describe('水に沈んでいるか', () => {
  const garden = waterOf('garden')

  test('**湧き地点はどれも水の上ではない。** 湧いた瞬間に溺れない', () => {
    expect(garden).not.toBeNull()
    const spots = [...Object.values(STAGES.garden.bases), ...STAGES.garden.solo]
    for (const spot of spots) {
      expect(inWater(spot.x, spot.y ?? 0, spot.z, garden)).toBe(false)
    }
  })

  test('水面と同じ高さでは沈まない。数え落ちで死なせない', () => {
    expect(inWater(0, garden!.y, 0, garden)).toBe(false)
  })

  test('**板から落ちたら沈む。** 水の下の地面は歩く床ではない', () => {
    // 底は y=0 (コードが敷いている地面)。底上げしたぶんがそのまま水深になる
    expect(inWater(0, 0, 0, garden)).toBe(true)
    expect(garden!.y).toBeGreaterThan(5)
  })

  test('水の外は沈まない。塀の向こうまで水にしない', () => {
    expect(inWater(garden!.half + 1, 0, 0, garden)).toBe(false)
    expect(inWater(0, 0, -garden!.half - 1, garden)).toBe(false)
  })

  test('水の無いステージでは沈まない', () => {
    expect(waterOf('mall')).toBeNull()
    expect(inWater(0, -100, 0, waterOf('mall'))).toBe(false)
  })
})
