import { describe, expect, test } from 'bun:test'
import { emptyHanded, type Locomotion } from './locomotion'

/**
 * **手が空いている型では武器を出さない。**
 *
 * 型は素材から取ってきた物で、多くは手に何も持っていない人の動き。その上に
 * 銃を出すと、握っていない手の傍に浮く。敬礼だけを名指しして隠していたので、
 * 転がりも受け身も浮いていた。
 *
 * ここで押さえたいのは**出したままにする側**のほう。隠しすぎると、撃つための
 * 姿勢のはずが「銃を持っていない人」に見える。
 */
describe('手が空いている型', () => {
  test('素材に武器が無い型では隠す', () => {
    const hidden: Locomotion[] = ['salute', 'roll', 'hard_land', 'bump', 'sleep', 'away']
    for (const locomotion of hidden) expect(emptyHanded(locomotion)).toBe(true)
  })

  /**
   * **倒れたら消す。** 手から離れた物を握り続けている絵にしない。
   */
  test('倒れた型では隠す', () => {
    const dead: Locomotion[] = ['death', 'death_front', 'death_back', 'prone_death']
    for (const locomotion of dead) expect(emptyHanded(locomotion)).toBe(true)
  })

  /**
   * **伏せへの出入りは撃つ動作の一部。**
   *
   * 伏せ撃ちへ入る道なので、入るたびに銃が消えると狙いが途切れる。手が
   * 空いているように見える型だが、次に撃つための姿勢。
   */
  test('伏せへの出入りでは出したまま', () => {
    const shown: Locomotion[] = ['prone_down', 'prone_rise', 'prone_roll_down']
    for (const locomotion of shown) expect(emptyHanded(locomotion)).toBe(false)
  })

  /**
   * **爆風で倒れている間も撃てる** (下半身だけ倒れた姿勢で留める)。
   */
  test('爆風で倒れている間は出したまま', () => {
    for (const locomotion of ['sweep', 'stand'] as Locomotion[]) {
      expect(emptyHanded(locomotion)).toBe(false)
    }
  })

  test('普通に動いている間は出したまま', () => {
    const shown: Locomotion[] = ['idle', 'run_f', 'crouch_idle', 'prone_idle', 'crawl_f', 'sneak']
    for (const locomotion of shown) expect(emptyHanded(locomotion)).toBe(false)
  })

  /**
   * **置く動作でも出したまま。** クレイモアも decoy も手に持って置く。
   */
  test('置いている間は出したまま', () => {
    for (const locomotion of ['claymore_windup', 'claymore_place'] as Locomotion[]) {
      expect(emptyHanded(locomotion)).toBe(false)
    }
  })
})
