import { describe, expect, test } from 'bun:test'
import { MOVES, blocker, can, type BodyState, type Move } from './moves'

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

describe('できること', () => {
  test('立っていれば一通りできる (もがくのは眠っている間だけ、叩くのはしゃがんでいる時だけ、下がるのは構えている時だけ)', () => {
    for (const move of Object.keys(MOVES) as Move[]) {
      if (move === 'struggle' || move === 'pat' || move === 'step' || move === 'fire') continue
      expect(can(standing, move)).toBe(true)
    }
  })

  test('猫に釘付けの間は何もできない (眠らされることはある)', () => {
    const trapped = { ...standing, trapped: true }
    for (const move of Object.keys(MOVES) as Move[]) {
      if (move === 'sleep' || move === 'struggle') continue
      expect(can(trapped, move)).toBe(false)
    }
    expect(can(trapped, 'sleep')).toBe(true)
  })

  test('眠っている人を叩けるのは、しゃがんで構えていない時だけ', () => {
    expect(can(standing, 'pat')).toBe(false)
    expect(can({ ...standing, crouching: true }, 'pat')).toBe(true)
    expect(can({ ...standing, crouching: true, aiming: true }, 'pat')).toBe(false)
    expect(can({ ...standing, crouching: true, sleeping: true }, 'pat')).toBe(false)
  })

  test('もがけるのは眠っている間だけ。倒れていたら眠っていても無理', () => {
    expect(can(standing, 'struggle')).toBe(false)
    expect(can({ ...standing, sleeping: true }, 'struggle')).toBe(true)
    expect(can({ ...standing, sleeping: true, downed: true }, 'struggle')).toBe(false)
  })

  test('倒れたら何もできない (眠るだけは「もう倒れている」で弾く)', () => {
    const dead = { ...standing, dead: true }
    for (const move of Object.keys(MOVES) as Move[]) expect(can(dead, move)).toBe(false)
  })

  test('全身の型の最中は、他の全身の動作を始められない', () => {
    for (const busy of ['rolling', 'vaulting', 'hanging', 'stabbing'] as const) {
      const body = { ...standing, [busy]: true }
      expect(can(body, 'roll')).toBe(false)
      expect(can(body, 'vault')).toBe(false)
      expect(can(body, 'box')).toBe(false)
    }
  })

  test('空中では転がれず跳べず伏せられない。刺すのと構えるのは空中でも通す', () => {
    const air = { ...standing, onGround: false }
    expect(can(air, 'roll')).toBe(false)
    expect(can(air, 'vault')).toBe(false)
    expect(can(air, 'prone')).toBe(false)
    expect(can(air, 'stab')).toBe(true)
    expect(can(air, 'aim')).toBe(true)
  })

  test('伏せからは転がれない (起き上がる一手を挟む) が、刺せる (prone_stab)', () => {
    const prone = { ...standing, prone: true }
    expect(can(prone, 'roll')).toBe(false)
    expect(can(prone, 'stab')).toBe(true)
  })

  test('梯子の上では両手が塞がっている。投げられず、置けず、刺せない', () => {
    const ladder = { ...standing, onGround: false, onLadder: true }
    expect(can(ladder, 'throw')).toBe(false)
    expect(can(ladder, 'place')).toBe(false)
    expect(can(ladder, 'stab')).toBe(false)
  })

  test('何に阻まれたかが分かる', () => {
    expect(blocker({ ...standing, boxed: true }, 'roll')).toBe('boxed')
    expect(blocker({ ...standing, onGround: false }, 'roll')).toBe('onGround')
    expect(blocker(standing, 'roll')).toBeNull()
  })
})

describe('持ち替え', () => {
  test('**CQC の最中は持ち替えられない** (投げている間に長物へ替えて、倒した相手へすぐ構えられないように)', () => {
    expect(can({ ...standing, cqc: true }, 'swap')).toBe(false)
    expect(can(standing, 'swap')).toBe(true)
  })
})

describe('一歩下がる', () => {
  test('**構えている時だけ。** 構えていなければ転がる (呼ぶ側)、伏せ・箱からは出ない', () => {
    expect(can({ ...standing, aiming: true }, 'step')).toBe(true)
    expect(can(standing, 'step')).toBe(false)
    // しゃがんでいればしゃがみの型で下がる
    expect(can({ ...standing, aiming: true, crouching: true }, 'step')).toBe(true)
    expect(can({ ...standing, aiming: true, prone: true }, 'step')).toBe(false)
    expect(can({ ...standing, aiming: true, boxed: true }, 'step')).toBe(false)
  })

  test('下がっている間は転がれず、もう一度下がれず、CQC も掛けられず、構えられない (銃を下ろす)', () => {
    const body = { ...standing, aiming: true, stepping: true }
    expect(can(body, 'step')).toBe(false)
    expect(can(body, 'roll')).toBe(false)
    expect(can(body, 'cqc')).toBe(false)
    expect(can(body, 'aim')).toBe(false)
  })

  test('**構えている間は転がらない** (後ろを押していれば下がる、押していなければ何も起きない)', () => {
    expect(can({ ...standing, aiming: true }, 'roll')).toBe(false)
    expect(can(standing, 'roll')).toBe(true)
  })
})

describe('撃たれて仰け反っている間', () => {
  test('**動けず (呼ぶ側)、構えられず、転がれず、箱も被れず、刺せず、掛けられない**', () => {
    const body = { ...standing, flinching: true }
    for (const move of ['aim', 'roll', 'vault', 'box', 'stab', 'cqc'] as Move[]) expect(can(body, move)).toBe(false)
    expect(can({ ...body, aiming: true }, 'step')).toBe(false)
  })
})

describe('撃つ・弾倉を替える (体の側の条件)', () => {
  test('**構えていなければ撃てない。** 転がり・跳び越え・ぶら下がり・CQC・這い・着地・刺している間も', () => {
    expect(can({ ...standing, aiming: true }, 'fire')).toBe(true)
    expect(can(standing, 'fire')).toBe(false)
    for (const busy of ['rolling', 'vaulting', 'hanging', 'cqc', 'crawling', 'landing', 'stabbing'] as const) {
      expect(can({ ...standing, aiming: true, [busy]: true }, 'fire')).toBe(false)
    }
  })

  test('**爆風で倒れている間は撃てる** (伏せ撃ち)', () => {
    expect(can({ ...standing, aiming: true, downed: true }, 'fire')).toBe(true)
  })

  test('弾倉は、這い・伏せへの出入り・転がり・箱の中では替えられない', () => {
    expect(can(standing, 'reload')).toBe(true)
    for (const busy of ['crawling', 'proneShifting', 'rolling', 'boxed', 'vaulting', 'hanging', 'cqc', 'stabbing'] as const) {
      expect(can({ ...standing, [busy]: true }, 'reload')).toBe(false)
    }
  })
})

describe('シートと表', () => {
  test('**moves.csv (シートの写し) と表が同じ。** シートを取り込んだのに作り直し忘れた / 表を手で直した、を捕まえる', async () => {
    const { parseCsv, readSheet } = await import('../../../tools/moves_sheet')
    const csv = await Bun.file(new URL('./moves.csv', import.meta.url)).text()
    const sheet = readSheet(parseCsv(csv))
    const fromSheet = Object.fromEntries(sheet.moves.map((m) => [m.id, { needs: [...m.needs].sort(), not: [...m.not].sort() }]))
    const fromCode: Record<string, { needs: string[]; not: string[] }> = Object.fromEntries(
      Object.entries(MOVES).map(([id, r]) => [id, { needs: [...r.needs].sort(), not: [...r.not].sort() }]),
    )
    expect(fromCode).toEqual(fromSheet)
    // 体の状態の行は、BodyState の旗と同じだけある
    expect(sheet.flags.map((f) => f.id).sort()).toEqual(Object.keys(standing).sort())
  })
})
