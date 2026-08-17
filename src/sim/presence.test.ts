import { describe, expect, test } from 'bun:test'
import { Presence } from './presence'

/**
 * 「相手が見えない」の試験。
 *
 * ここに並んでいるのは全部、**実際に本番で出た**不具合。1 日のうちに 4 つ出て、
 * どれも「サーバーは配っているのに画面に出ない」という形をしていた。
 * サーバー側の試験は「配ったか」しか見ていなかったので、毎回すり抜けた。
 *
 * 判断そのものは three にも DOM にも依存していないので、ここで単体で回せる。
 */

/** 一定の間隔で届いたことにする。sentAt と arrivedAt を分けて渡せる */
function feed(
  p: Presence,
  options: {
    /** 送り主の時計とこちらの時計の差 (ms)。+ なら相手が進んでいる */
    skew?: number
    /** 届く間隔 (ms) */
    gap: number
    /** 何通 */
    count: number
    /** 開始時刻 (こちらの時計) */
    from?: number
  },
): number {
  const { skew = 0, gap, count, from = 100_000 } = options
  let now = from
  for (let i = 0; i < count; i++) {
    p.push(now + skew, now)
    now += gap
  }
  return now - gap
}

describe('時計', () => {
  test('最後に届いた時刻は、こちらの時計で持つ', () => {
    // ここが**この一連の不具合の根**。送られてきた時刻は別の機械の時計なので、
    // こちらの Date.now() と引き算してよいものではない
    const p = new Presence()
    p.push(50_000, 100_020)
    expect(p.lastSeen).toBe(100_020)
  })

  test.each([-1200, -30_000, 45_000])(
    '相手の時計が %i ms ずれていても隠れない',
    (skew) => {
      // 実際に出た不具合: 相手の時計が 1.2 秒遅れていて、その人だけ一度も
      // 画面に出なかった。ずれが猶予の上限 (1.5 秒) を超えると、猶予が
      // 伸びて誤魔化されることもない
      const p = new Presence()
      p.setLife('alive')
      const last = feed(p, { skew, gap: 16, count: 60 })
      expect(p.visibleAt(last + 16)).toBe(true)
    },
  )

  test('相手の時計が進んでいても、途切れたら隠れる', () => {
    const p = new Presence()
    p.setLife('alive')
    const last = feed(p, { skew: 1200, gap: 16, count: 60 })
    expect(p.visibleAt(last + 16)).toBe(true)
    // 2 秒黙れば消える (時計のずれとは無関係に)
    expect(p.visibleAt(last + 2000)).toBe(false)
  })

  test('溜める時刻はこちらの時計に直る', () => {
    const p = new Presence()
    // 3 秒遅れた時計から、遅延 20ms で届く
    const time = p.push(100_000 - 3000, 100_020)
    // 直した時刻は「届いた時刻のあたり」に来る (送り主の時計のままではない)
    expect(Math.abs(time - 100_020)).toBeLessThan(50)
  })
})

describe('隠すまでの猶予', () => {
  test('64Hz の相手は 0.35 秒で隠れる', () => {
    const p = new Presence()
    p.setLife('alive')
    feed(p, { gap: 16, count: 60 })
    expect(p.hideAfter).toBe(350)
  })

  test('遅い相手ほど猶予が伸びる', () => {
    // 実際に出た不具合: 3〜13 通/秒 の相手が、固定 0.35 秒の猶予に引っかかって
    // 見えたり消えたりした
    const p = new Presence()
    p.setLife('alive')
    feed(p, { gap: 300, count: 30 })
    expect(p.hideAfter).toBeGreaterThan(350)
    // 300ms 空いても消えない
    const last = feed(p, { gap: 300, count: 2, from: 200_000 })
    expect(p.visibleAt(last + 300)).toBe(true)
  })

  test('どれだけ遅くても 1.5 秒で打ち切る', () => {
    const p = new Presence()
    p.setLife('alive')
    feed(p, { gap: 1400, count: 20 })
    expect(p.hideAfter).toBeLessThanOrEqual(1500)
  })
})

describe('遡る量', () => {
  test('64Hz の相手は既定の 50ms', () => {
    const p = new Presence()
    feed(p, { gap: 16, count: 60 })
    expect(p.renderDelay).toBe(50)
  })

  test('遅い相手ほど深く遡る', () => {
    // 実際に出た不具合: 50ms しか遡らないので、間隔 300ms の相手は補間の
    // 材料が片側にしか無く、位置が飛んだ (瞬間移動に見えた)
    const p = new Presence()
    feed(p, { gap: 300, count: 30 })
    expect(p.renderDelay).toBeGreaterThan(50)
  })

  test('サーバーが遡れる長さ (400ms) の内側に収まる', () => {
    // これを超えると、当てたと申告しても照合の窓から外れて却下される
    const p = new Presence()
    feed(p, { gap: 2000, count: 20 })
    expect(p.renderDelay).toBeLessThan(400)
  })
})

describe('状態', () => {
  test('状態を知らないうちは出さない', () => {
    // 既定は joining = まだ位置を知らせていない人。戦場に居ない
    const p = new Presence()
    const last = feed(p, { gap: 16, count: 60 })
    expect(p.visibleAt(last + 16)).toBe(false)
  })

  test('名簿で状態を受け取れば出る', () => {
    // 実際に出た不具合: life は「変わった時」にしか配られないので、後から
    // 繋いだ人は既に居る人の状態を知らないまま joining で居続けた。
    // 名簿に載せて setLife を通せば出る
    const p = new Presence()
    p.setLife('alive')
    const last = feed(p, { gap: 16, count: 60 })
    expect(p.visibleAt(last + 16)).toBe(true)
  })

  test('支度中の人は出さない', () => {
    const p = new Presence()
    p.setLife('alive')
    feed(p, { gap: 16, count: 60 })
    p.setLife('choosing')
    expect(p.visibleAt(100_960)).toBe(false)
  })

  test('接続が切れた人は体が残る', () => {
    // 消すと、撃ち合いで不利になったらブラウザを閉じる、が逃げ道になる
    const p = new Presence()
    p.setLife('alive')
    const last = feed(p, { gap: 16, count: 60 })
    p.setLife('dropped')
    // **知らせを受けた時点で消えてはいけない。** 次の体が届くのを待つ間に
    // 消えると、そこで一瞬ちらつく
    expect(p.visibleAt(last + 16)).toBe(true)
    // サーバーが体を配り直してくる
    const later = feed(p, { gap: 100, count: 5, from: 200_000 })
    expect(p.visibleAt(later + 50)).toBe(true)
  })
})

describe('サーバーからの知らせ', () => {
  test('hidden で即座に消える', () => {
    const p = new Presence()
    p.setLife('alive')
    const last = feed(p, { gap: 16, count: 60 })
    p.hide()
    expect(p.visibleAt(last + 16)).toBe(false)
  })

  test('位置が来たらまた出る', () => {
    const p = new Presence()
    p.setLife('alive')
    feed(p, { gap: 16, count: 60 })
    p.hide()
    const last = feed(p, { gap: 16, count: 3, from: 200_000 })
    expect(p.visibleAt(last + 16)).toBe(true)
  })

  test('隠れていた間の空白は、送る速さに混ぜない', () => {
    // 混ぜると、物陰に居ただけで猶予が伸びていく
    const p = new Presence()
    p.setLife('alive')
    feed(p, { gap: 16, count: 60 })
    const before = p.hideAfter
    p.hide()
    feed(p, { gap: 16, count: 5, from: 200_000 })
    expect(p.hideAfter).toBe(before)
  })
})

describe('通/秒', () => {
  // 表示用。最悪の間隔を覚える推定器 (hideAfter 用) から割り出すと
  // 悲観側に張り付き、57 通/秒 届いていても 37 と出た
  test.each([
    [64, 16],
    [33, 30],
    [20, 50],
    [10, 100],
  ])('%i 通/秒 で届けば、そう出る', (hz, gap) => {
    const p = new Presence()
    feed(p, { gap, count: Math.max(20, hz * 2) })
    expect(p.rate).toBeGreaterThan(hz * 0.8)
    expect(p.rate).toBeLessThan(hz * 1.25)
  })
})
