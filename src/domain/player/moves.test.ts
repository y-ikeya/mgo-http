import { describe, expect, test } from 'bun:test'
import { AXES, MOVES, axesOf, blocker, can, type Axis, type BodyState, type Move } from './moves'

/** 何もしていない、地面に立った体 */
const standing: BodyState = {
  onGround: true,
  dead: false,
  downed: false,
  standingUp: false,
  sleeping: false,
  boxed: false,
  bumping: false,
  saluting: false,
  stabbing: false,
  rolling: false,
  vaulting: false,
  hanging: false,
  onLadder: false,
  prone: false,
  landing: false,
  inWater: false,
  aiming: false,
  crouching: false,
  cqc: false,
  trapped: false,
  stepping: false,
  flinching: false,
  crawling: false,
  proneShifting: false,
}

/**
 * **シートの写しと表が同じ。** 正はシートの軸のタブ (tools/moves_sheet.ts)。シートを取り込んだのに
 * 作り直し忘れた / 表を手で直した、をここで捕まえる (2026-11-03 本人「星取表を実装に落とす」)
 */
describe('シートと表', () => {
  test('moves.csv (シートの写し) を読んだ表と、コードの表が同じ', async () => {
    const { parseCsv, readSheet } = await import('../../../tools/moves_sheet')
    const csv = await Bun.file(new URL('./moves.csv', import.meta.url)).text()
    const fromSheet = Object.fromEntries(readSheet(parseCsv(csv)).map((m) => [m.id, m.rule]))
    const fromCode = Object.fromEntries(
      Object.entries(MOVES).map(([id, rule]) => [
        id,
        Object.fromEntries(Object.entries(rule).map(([axis, values]) => [axis, [...(values as readonly string[])]])),
      ]),
    )
    expect(fromCode).toEqual(fromSheet)
  })
})

describe('旗から軸の値へ', () => {
  test('何もしていなければ 立ち / なし / なし / 構えていない', () => {
    expect(axesOf(standing)).toEqual({ posture: 'stand', action: 'none', down: 'none', hand: 'relaxed' })
  })

  test('**強い方を取る。** 死は眠りより、梯子は空中より、CQC は転がりより', () => {
    expect(axesOf({ ...standing, dead: true, sleeping: true }).down).toBe('dead')
    expect(axesOf({ ...standing, onLadder: true, onGround: false }).posture).toBe('ladder')
    expect(axesOf({ ...standing, cqc: true, rolling: true }).action).toBe('cqc')
  })

  test('各軸の値はどれも AXES のどれか 1 つ', () => {
    for (const flag of Object.keys(standing) as (keyof BodyState)[]) {
      const axes = axesOf({ ...standing, [flag]: !standing[flag] })
      for (const axis of Object.keys(AXES) as Axis[]) expect(AXES[axis] as readonly string[]).toContain(axes[axis])
    }
  })
})

/** 表の中身そのものはシートが決める。ここは**遊びとして外したくない所**だけ見る (シートを変えて落ちたら、それは意図か確かめる合図) */
describe('外したくない決まり', () => {
  test('**眠っている間 (スタン・麻酔) は撃てず、弾倉も替えられない** (2026-11-03 本人「stun 中に reload できた」)', () => {
    const asleep = { ...standing, sleeping: true, aiming: true }
    expect(can(asleep, 'reload')).toBe(false)
    expect(can(asleep, 'fire')).toBe(false)
    expect(blocker(asleep, 'reload')).toBe('down:sleep')
  })

  test('もがくのは眠っている間だけ', () => {
    expect(can({ ...standing, sleeping: true }, 'struggle')).toBe(true)
    expect(can(standing, 'struggle')).toBe(false)
  })

  test('倒されたら何もできない', () => {
    const dead = { ...standing, dead: true }
    for (const move of Object.keys(MOVES) as Move[]) expect(can(dead, move)).toBe(false)
  })

  test('**構えている間は転がらず、後ろへ一歩下がる** (2026-10-30 本人)', () => {
    const aiming = { ...standing, aiming: true }
    expect(can(aiming, 'roll')).toBe(false)
    expect(can(aiming, 'step')).toBe(true)
    // しゃがんでいても構えていれば下がれる (しゃがみの型)
    expect(can({ ...aiming, crouching: true }, 'step')).toBe(true)
  })

  test('**CQC の最中は持ち替えられない** (2026-10-30 本人)', () => {
    expect(can({ ...standing, cqc: true }, 'swap')).toBe(false)
  })

  test('撃たれて怯んでいる間は転がれず、箱も被れず、撃てない', () => {
    const flinching = { ...standing, flinching: true, aiming: true }
    for (const move of ['roll', 'box', 'fire'] as Move[]) expect(can(flinching, move)).toBe(false)
  })

  test('**Space の短押しは、その時の姿で行き先が違う** — 伏せから起き上がる・倒れから立ち直る・箱を脱ぐ', () => {
    expect(can({ ...standing, prone: true }, 'rise')).toBe(true)
    expect(can({ ...standing, downed: true }, 'standUp')).toBe(true)
    expect(can({ ...standing, boxed: true }, 'unbox')).toBe(true)
    // 立っている体には、どれも当てはまらない (しゃがむの方)
    expect(can(standing, 'rise')).toBe(false)
    expect(can(standing, 'crouch')).toBe(true)
  })

  test('這いながらでも起き上がれる (移動を押したまま Space で、止まらずにしゃがみへ)', () => {
    expect(can({ ...standing, prone: true, crawling: true }, 'rise')).toBe(true)
  })
})
