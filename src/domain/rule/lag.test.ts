import { describe, expect, test } from 'bun:test'
import { HIT_LIMIT_MS, LAG_WINDOW_MS } from './lag'
import { LAG_LIMIT_MS } from '../match/lag'
import { DELAY_LIMIT } from '../../sim/space/presence'

/**
 * **遡れる長さと、弾が通らなくなる境目を突き合わせる。**
 *
 * HIT_LIMIT_MS は「補間の上限」から出るが、その上限は sim の値なので
 * ドメインからは読めない (層が逆)。**数字を写しているので、写し間違いと
 * 片方だけの変更をここで捕まえる。**
 *
 * 遡れる長さを広げたのに境目が古いまま、という形で静かに壊れる。
 */
describe('遅れの軸', () => {
  test('弾が通らなくなる境目は、遡れる長さと補間の上限から出る', () => {
    // 遡る必要 = 補間の遅れ + 往復の半分。それが遡れる長さに収まる境目
    expect(HIT_LIMIT_MS).toBe((LAG_WINDOW_MS - DELAY_LIMIT * 1000) * 2)
  })

  /**
   * **席を空けてもらう境目は、その倍。**
   *
   * 境目そのもので切らないのは、300ms は遠い回線なら普通に出る値だから。
   * 当たりにくいだけの人は自分で判断すればよい (PING は画面に出ている)。
   */
  test('席を空けてもらう境目は、壊れ始める境目より遠い', () => {
    expect(LAG_LIMIT_MS).toBeGreaterThan(HIT_LIMIT_MS)
  })
})
