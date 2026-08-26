import { describe, expect, test } from 'bun:test'
import {
  MASTERY_OF, SKILLS, SKILL_BUDGET, boxMoveScale, canChooseSkills, costOf, exposeSeconds,
  isAffordable, levelOf, masteryJitterScale, masteryReloadScale, masterySpreadScale,
  runnerScale, throwScale,
  type SkillId, type Skills,
} from './skill'
import { newPlayer, refill } from './player'

/**
 * **予算であることが要。** 枠だと「いくつ取れるか」しか決められないが、
 * コストなら段の重さがそのまま値段になる (docs/design.md の 3)。
 */
describe('4 コストの予算', () => {
  test('何も取らなければ 0', () => {
    expect(costOf({})).toBe(0)
  })

  test('**段がそのまま値段**', () => {
    expect(costOf({ runner: 1 })).toBe(1)
    expect(costOf({ runner: 3 })).toBe(3)
    expect(costOf({ runner: 2, exposure: 1 })).toBe(3)
  })

  test('極める + 1 つ齧る、で使い切る', () => {
    expect(costOf({ sniperMastery: 3, runner: 1 })).toBe(SKILL_BUDGET)
    expect(isAffordable({ sniperMastery: 3, runner: 1 })).toBe(true)
  })

  test('浅く広く 4 つ、も同じ買い物', () => {
    const wide: Skills = { runner: 1, boxMove: 1, throwing: 1, exposure: 1 }
    expect(costOf(wide)).toBe(SKILL_BUDGET)
    expect(isAffordable(wide)).toBe(true)
  })

  test('1 段でも超えたら買えない', () => {
    expect(isAffordable({ sniperMastery: 3, runner: 2 })).toBe(false)
    expect(isAffordable({ runner: 2, boxMove: 2, throwing: 1 })).toBe(false)
  })

  test('表に無い名前は弾く。**申告を鵜呑みにしない**', () => {
    expect(isAffordable({ aimbot: 1 } as never)).toBe(false)
  })

  test('段の外れた値も弾く', () => {
    expect(isAffordable({ runner: 0 } as never)).toBe(false)
    expect(isAffordable({ runner: 9 } as never)).toBe(false)
  })

  test('**8 つある。** 2 つだと全員が両方取って選択が生まれない', () => {
    expect(Object.keys(SKILLS)).toHaveLength(8)
  })
})

describe('FAST MOVE', () => {
  test('取っていなければ等倍', () => {
    expect(runnerScale({})).toBe(1)
  })

  test('段が上がるほど速い', () => {
    expect(runnerScale({ runner: 1 })).toBeLessThan(runnerScale({ runner: 2 }))
    expect(runnerScale({ runner: 2 })).toBeLessThan(runnerScale({ runner: 3 }))
  })

  /**
   * **掛け算であること。** 足すと重い銃の不利が薄まり、武器の棲み分けが潰れる。
   * 狙撃銃を提げた FAST MOVE Lv3 が、拳銃の素の人に追いついてはいけない。
   */
  test('重さの不利は割合として残る', () => {
    const sniper = 0.88 // carrySpeedScale(XM2010)
    const pistol = 1.15 // carrySpeedScale(M9)
    expect(sniper * runnerScale({ runner: 3 })).toBeLessThan(pistol * runnerScale({}))
  })
})

describe('CBOX MOVE', () => {
  /** presentation の BOX_SPEED_SCALE。ここを変えたら下の数字も動く */
  const BOX = 0.7

  test('取っていなければ素のまま', () => {
    expect(boxMoveScale({})).toBe(1)
  })

  /**
   * **箱が隠れ場所から移動手段に変わる。** 被ると頭が 0.94m まで下がるので、
   * 遮蔽越しの視線を切ったまま動けるようになる。
   */
  test('段が上がるほど速い', () => {
    expect(boxMoveScale({ boxMove: 1 })).toBeLessThan(boxMoveScale({ boxMove: 3 }))
  })

  /**
   * **いまは Lv2 で走りを追い越す。要判断。**
   *
   *     Lv0  0.70
   *     Lv1  0.875
   *     Lv2  1.05   ← ここで走りより速くなる
   *     Lv3  1.26
   *
   * 追い越すと「隠れながら誰より速い」になって、**箱を被らない理由が無くなる** —
   * 遅いことが隠れることの代償だったのが消える。走りの手前で止めたいなら
   * BOX_MOVE_SCALE を [1, 1.15, 1.3, 1.4] あたりへ (Lv3 で 0.98)。
   *
   * 事実として書いてある。直したらこの試験も一緒に直す。
   */
  test('Lv2 から走りを追い越す (要判断)', () => {
    expect(BOX * boxMoveScale({ boxMove: 1 })).toBeLessThan(1)
    expect(BOX * boxMoveScale({ boxMove: 2 })).toBeGreaterThan(1)
    expect(BOX * boxMoveScale({ boxMove: 3 })).toBeGreaterThan(1)
  })
})

describe('武器の mastery', () => {
  test('**主武器ごとに別のスキル。** 予算 4 では 2 挺を極められない', () => {
    const ids = new Set<SkillId>(Object.values(MASTERY_OF))
    expect(ids.size).toBe(4)
    expect(costOf({ smgMastery: 3, sniperMastery: 3 })).toBeGreaterThan(SKILL_BUDGET)
  })

  test('極めた銃だけ締まる。**拾った銃は素のまま**', () => {
    const smgGuy: Skills = { smgMastery: 3 }
    expect(masterySpreadScale(smgGuy, 'smg')).toBeLessThan(1)
    expect(masterySpreadScale(smgGuy, 'sniper')).toBe(1)
  })

  test('装填も速くなる', () => {
    expect(masteryReloadScale({ rifleMastery: 2 }, 'rifle')).toBeLessThan(1)
    expect(masteryReloadScale({}, 'rifle')).toBe(1)
  })

  test('段が上がるほど締まる', () => {
    expect(masterySpreadScale({ pistolMastery: 3 }, 'pistol'))
      .toBeLessThan(masterySpreadScale({ pistolMastery: 1 }, 'pistol'))
  })

  /**
   * **反動そのものは動かさず、乱れだけ小さくする。**
   *
   * 表を覚えた人がその通りに押さえ戻せる度合いが上がる = 上手さが効く余地が
   * 増える。反動自体を弱めると「上手くなくても当たる」になって逆になる。
   */
  test('連射のばらつきが減る', () => {
    expect(masteryJitterScale({}, 'smg')).toBe(1)
    expect(masteryJitterScale({ smgMastery: 1 }, 'smg')).toBeLessThan(1)
    expect(masteryJitterScale({ smgMastery: 3 }, 'smg'))
      .toBeLessThan(masteryJitterScale({ smgMastery: 1 }, 'smg'))
  })

  test('ばらつきは 0 にしない。**完全に固定だとマクロで打ち消せる**', () => {
    expect(masteryJitterScale({ smgMastery: 3 }, 'smg')).toBeGreaterThan(0)
  })
})

describe('THROWING MASTERY', () => {
  test('遠くへ投げられる', () => {
    expect(throwScale({})).toBe(1)
    expect(throwScale({ throwing: 3 })).toBeGreaterThan(throwScale({ throwing: 1 }))
  })
})

describe('ENEMY EXPOSURE', () => {
  test('取っていなければ光らない', () => {
    expect(exposeSeconds({})).toBe(0)
  })

  test('段が上がるほど長い', () => {
    expect(exposeSeconds({ exposure: 1 })).toBeLessThan(exposeSeconds({ exposure: 2 }))
    expect(exposeSeconds({ exposure: 2 })).toBeLessThan(exposeSeconds({ exposure: 3 }))
  })

  /**
   * **追跡の道具にしない。** 長いと「当てさえすれば追える」になって、
   * 撃ち合いを迂回する手より安くなる。
   */
  test('一番長くても追い切れる長さにしない', () => {
    expect(exposeSeconds({ exposure: 3 })).toBeLessThanOrEqual(10)
  })
})

describe('段', () => {
  test('取っていなければ 0', () => {
    expect(levelOf({}, 'runner')).toBe(0)
  })
})

/**
 * **装備とは粒度が違う。**
 *
 *     装備 (主武器・支援)  1 つの命ごと
 *     スキル                1 試合に 1 度
 *
 * 倒されるたびに組み替えられると、相手を見てから後出しするゲームになる。
 * 試合の間ずっとその選択を背負うから、役割になる。
 */
describe('選び直せる窓', () => {
  test('始まる前は選べる', () => {
    expect(canChooseSkills('waiting')).toBe(true)
    expect(canChooseSkills('countdown')).toBe(true)
  })

  test('**始まったら固定。** 倒されても組み替えられない', () => {
    expect(canChooseSkills('playing')).toBe(false)
  })

  test('決着したら開く。**試合をまたげば組み替えてよい**', () => {
    expect(canChooseSkills('over')).toBe(true)
  })

  /**
   * **途中参加は前の選択のまま戦う。**
   *
   * 選ばせると「劣勢の側を見てから強い組み合わせで入り直す」ができ、空にすると
   * 抜けて入り直しただけの人が丸腰になる。持ち越すのがどちらにも寄らない形。
   *
   * 規則は**起きないこと**で表れている — 湧き直しでも仕切り直しでもスキルを
   * 消さない。消す行が足された日にここが落ちる。
   */
  test('湧き直してもスキルは消えない', () => {
    const player = newPlayer({ id: 'a', name: 'a', team: 'blue', slot: 0, now: 0 })
    player.skills = { runner: 2, exposure: 1 }
    refill(player)
    expect(player.skills).toEqual({ runner: 2, exposure: 1 })
  })

  test('**光っている札のほうは湧き直しで消える。** 死が漏洩を止める', () => {
    const player = newPlayer({ id: 'a', name: 'a', team: 'blue', slot: 0, now: 0 })
    player.leakedUntil = Date.now() + 5000
    refill(player)
    expect(player.leakedUntil).toBe(0)
  })
})
