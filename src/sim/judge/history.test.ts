import { describe, expect, test } from 'bun:test'
import { framesFor, PoseTrack, type Timed } from './history'

interface Sample extends Timed {
  x: number
}
const track = (size: number) => new PoseTrack<Sample>(size, () => ({ time: 0, x: 0 }))

describe('遡れる幅からコマ数を出す', () => {
  /**
   * **数を直に書かない。** 送る間隔を変えたとき片方だけ古くなる。
   *
   * 20Hz の頃に「12 個」と書いてあったのを 64Hz へ上げたとき直し忘れて、
   * 0.4 秒の幅に対して 0.19 秒しか遡れなくなっていた前科がある。
   */
  test('幅を覆えるだけ持つ', () => {
    // 64Hz (15.6ms) で 0.4 秒ぶん
    expect(framesFor(400, 1000 / 64)).toBe(28)
    // 送る間隔が伸びれば、要るコマ数は減る
    expect(framesFor(400, 1000 / 20)).toBe(10)
  })

  test('端で足りなくならないよう余分に持つ', () => {
    // ちょうど 10 コマぶんでも、境目と書き込み途中のぶんで 2 つ多い
    expect(framesFor(100, 10)).toBe(12)
  })
})

describe('過去の姿の輪', () => {
  test('新しいものが末尾に並ぶ', () => {
    const t = track(4)
    for (let i = 0; i < 3; i++) t.write((s) => { s.time = i; s.x = i * 10 })
    expect(t.frames.map((f) => f.x)).toEqual([0, 10, 20])
  })

  test('**溢れたら古いものから捨てる。** 数は増えない', () => {
    const t = track(3)
    for (let i = 0; i < 6; i++) t.write((s) => { s.time = i; s.x = i })
    expect(t.length).toBe(3)
    expect(t.frames.map((f) => f.x)).toEqual([3, 4, 5])
  })

  /**
   * **中身を知らない。** 何が入っているかは遊びの決めごと。
   *
   * 部品が触るのは time だけ。姿勢も箱も、この輪からは見えない。
   */
  test('姿の中身には触らない', () => {
    const t = new PoseTrack<Timed & { 好きな物: string }>(2, () => ({ time: 0, 好きな物: '' }))
    t.write((s) => { s.time = 1; s.好きな物 = 'ダンボール' })
    expect(t.frames[0]?.好きな物).toBe('ダンボール')
  })

  test('空にすると、前の姿は残らない', () => {
    const t = track(4)
    t.write((s) => { s.time = 1; s.x = 1 })
    t.clear()
    expect(t.length).toBe(0)
    expect(t.frames).toEqual([])
  })
})
