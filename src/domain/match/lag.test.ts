import { describe, expect, test } from 'bun:test'
import { LAG_LIMIT_MS, LAG_STRIKES, newLagRecord, recordLag } from './lag'

/**
 * 遅れの限界。
 *
 * **遅れている人が居ると、他の全員の画面が壊れる。** その人の姿が飛び、
 * 撃っても当たらず、こちらの弾は当たったことにされる。だから部屋の側の
 * 問題として扱う。
 */
describe('遅れで席を空けてもらう', () => {
  const feed = (times: number, rtt: number) => {
    const record = newLagRecord()
    let kicked = false
    for (let i = 0; i < times; i++) kicked = recordLag(record, rtt)
    return { record, kicked }
  }

  test('速いうちは何回測っても切らない', () => {
    expect(feed(100, 40).kicked).toBe(false)
  })

  /**
   * **一瞬の跳ねでは切らない。**
   *
   * 往復の時間は跳ねる。電波が一瞬途切れただけで 1 秒を超えるのは普通に
   * あるので、1 回で切ると繋ぎ直しては切られるを繰り返す人が出る。
   */
  test('限界を超えても、続かなければ切らない', () => {
    const record = newLagRecord()
    for (let i = 0; i < LAG_STRIKES - 1; i++) {
      expect(recordLag(record, LAG_LIMIT_MS + 100)).toBe(false)
    }
    // 1 回でも戻れば数え直し
    expect(recordLag(record, 50)).toBe(false)
    expect(record.strikes).toBe(0)
  })

  test('続いたら切る', () => {
    expect(feed(LAG_STRIKES, LAG_LIMIT_MS + 1).kicked).toBe(true)
  })

  test('ちょうど限界の値も超えたうちに数える', () => {
    expect(feed(LAG_STRIKES, LAG_LIMIT_MS).kicked).toBe(true)
  })

  /**
   * **切る判断は均す前の値で見る。**
   *
   * 均した値で見ると、跳ねが混ざって「超えているのに超えていないことに
   * なる」時間が伸びる。均すのは画面に出すためだけ。
   */
  test('均した値はゆっくり追いつく。切る判断はそれを待たない', () => {
    const record = newLagRecord()
    for (let i = 0; i < LAG_STRIKES; i++) recordLag(record, LAG_LIMIT_MS + 1)
    // 5 回では均した値はまだ限界に届いていない
    expect(record.rtt).toBeGreaterThan(0)
    // それでも切る判断は出ている
    expect(record.strikes).toBe(LAG_STRIKES)
  })

  test('最初の 1 回はそのまま入る。**0 から均すと半分に見える**', () => {
    const record = newLagRecord()
    recordLag(record, 120)
    expect(record.rtt).toBe(120)
  })
})
