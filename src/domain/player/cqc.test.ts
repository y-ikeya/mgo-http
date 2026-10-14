import { describe, expect, test } from 'bun:test'
import { canBeThrown, canThrowWith } from './cqc'

describe('CQC', () => {
  test('片手で持つ物 (拳銃・ナイフ・投げる物・置く物) なら掛けられる。長物と箱では掛けられない', () => {
    for (const held of ['m9', 'm1911', 'knife', 'grenade', 'locator', 'claymore', 'decoy'] as const) {
      expect(canThrowWith(held)).toBe(true)
    }
    for (const held of ['rifle', 'm4', 'smg', 'sniper', 'mosin', 'shotgun', 'box'] as const) {
      expect(canThrowWith(held)).toBe(false)
    }
  })

  test('立っている相手にだけ掛かる。しゃがみ・箱・伏せ・倒れには掛からない', () => {
    for (const l of ['idle', 'walk', 'run_f', 'run_bl', 'salute'] as const) expect(canBeThrown(l)).toBe(true)
    for (const l of ['crouch_idle', 'crouch_f', 'sneak', 'sit', 'prone_idle', 'crawl_f', 'sweep', 'climb', 'jump_loop', 'cqc_thrown'] as const) {
      expect(canBeThrown(l)).toBe(false)
    }
  })
})
