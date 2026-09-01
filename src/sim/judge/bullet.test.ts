import { describe, expect, test } from 'bun:test'
import { bulletDrop, bulletOffset, bulletSag, flightTime } from './bullet'
import { WEAPONS } from '../../domain/item/weapons'

/**
 * **武器ごとに弾の落ち方が違うことを押さえる。**
 *
 * 速さと重力を持っているのは domain (武器の性能)、放物線を引くのがここ。
 * 長らく**クライアントが全部の銃を 420 m/s で撃っていた** — 武器ごとに初速を
 * 決めてあるのに、画面には一度も出ていなかった。
 */
describe('弾の落ち', () => {
  test('近距離では読み取れない。撃ち合いの大半は今までどおり', () => {
    const ak = WEAPONS.rifle
    expect(bulletDrop(25, ak.bulletSpeed, ak.bulletGravity)).toBeLessThan(0.05)
  })

  test('小銃は遠くでもほとんど落ちない。実銃の初速を採っている', () => {
    const ak = WEAPONS.rifle
    const drop = bulletDrop(80, ak.bulletSpeed, ak.bulletGravity)
    expect(drop).toBeGreaterThan(0.02)
    expect(drop).toBeLessThan(0.1)
  })

  test('**拳銃だけは目に見えて落ちる。** 遠くを撃つ道具ではない', () => {
    const m9 = WEAPONS.m9
    // 80m で 20cm 以上 — 頭 1 つぶん下に着く
    expect(bulletDrop(80, m9.bulletSpeed, m9.bulletGravity)).toBeGreaterThan(0.2)
  })

  test('**速い弾ほど落ちない。** 速さの順と落差の順は必ず逆になる', () => {
    const bySpeed = Object.values(WEAPONS).sort((a, b) => a.bulletSpeed - b.bulletSpeed)
    const drops = bySpeed.map((w) => bulletDrop(80, w.bulletSpeed, w.bulletGravity))
    // 遅い順に並べたら、落差は多い順に並ぶ
    for (let i = 1; i < drops.length; i++) expect(drops[i]).toBeLessThanOrEqual(drops[i - 1])
  })

  /**
   * **近い間合いの銃ほど遅い。**
   *
   * 拳銃と散弾銃が一番落ちて、狙撃銃が一番落ちない。落差そのものが
   * 「どこまで狙う物か」を体で示している — 遠くを撃つ物ほど素直に飛ぶ。
   */
  test('近い物ほど落ちる。遠くを撃つ物ではない', () => {
    const near = ['m9', 'shotgun']
    const slowest = Object.values(WEAPONS).reduce((a, b) =>
      a.bulletSpeed <= b.bulletSpeed ? a : b,
    )
    expect(near).toContain(slowest.id)
    // 遠くを撃つ物は必ず速い
    for (const id of near) {
      expect(WEAPONS[id as keyof typeof WEAPONS].bulletSpeed).toBeLessThan(
        WEAPONS.sniper.bulletSpeed,
      )
      expect(WEAPONS[id as keyof typeof WEAPONS].bulletSpeed).toBeLessThan(
        WEAPONS.rifle.bulletSpeed,
      )
    }
  })

  test('横には曲がらない。落ちるのは下だけ', () => {
    const out = bulletOffset({ x: 0, y: 0, z: -1 }, 0.2, 420, 9.8, { x: 0, y: 0, z: 0 })
    expect(out.x).toBe(0)
    expect(out.z).toBeCloseTo(-84, 5)
    expect(out.y).toBeLessThan(0)
  })

  test('重力 0 ならまっすぐ (調整パネルの端)', () => {
    const out = bulletOffset({ x: 0, y: 0, z: -1 }, 0.5, 420, 0, { x: 0, y: 0, z: 0 })
    expect(out.y).toBe(0)
  })

  test('時間は距離を速さで割ったもの', () => {
    expect(flightTime(210, 420)).toBeCloseTo(0.5, 6)
  })
})

/**
 * 撃った側は放物線、検算は直線。**その差が判定を変えないことを押さえる。**
 */
describe('検算との食い違い', () => {
  /** hitcheck.ts が肩幅として許しているぶれ (m) */
  const SHOULDER_ALLOWANCE = 0.55

  /**
   * 麻酔銃が当てにいける距離 (m)。
   *
   * これより先は落差が 1m を超えて、頭の位置から目測で合わせられない。
   * **撃てないのではなく、狙って当てる道具ではなくなる。**
   */
  const TRANQ_RANGE = 40

  test('**殺傷の銃は端から端まで撃っても、許容の 1/10 に収まる**', () => {
    const lethal = Object.values(WEAPONS).filter((spec) => !spec.tranquilizer)
    const worst = lethal.reduce((a, b) =>
      bulletDrop(80, a.bulletSpeed, a.bulletGravity) >= bulletDrop(80, b.bulletSpeed, b.bulletGravity)
        ? a
        : b,
    )
    const sag = bulletSag(80, worst.bulletSpeed, worst.bulletGravity)
    expect(sag).toBeLessThan(SHOULDER_ALLOWANCE / 10)
  })

  /*
   * 麻酔銃は膨らみが埋もれない。**だから検算のほうを弧にした。**
   *
   * 弧は弦より上を通るので、直線で見ると低い遮蔽を越えて届いた弾を弾く。
   * 頭 1 発で眠らせる銃なので、遠くから狙う手は成立させないといけない
   * (judge/hitcheck.ts の isArcClear)。
   */
  test('**麻酔銃の膨らみは肩幅のぶれに埋もれない。** 直線では足りない', () => {
    const m9 = WEAPONS.m9
    expect(bulletSag(80, m9.bulletSpeed, m9.bulletGravity))
      .toBeGreaterThan(SHOULDER_ALLOWANCE / 10)
    // 当てにいける距離でも、無視できる大きさではない
    expect(bulletSag(TRANQ_RANGE, m9.bulletSpeed, m9.bulletGravity))
      .toBeGreaterThan(0.1)
  })

  test('**麻酔銃は落ちる。** 遠くを狙うなら頭より上へ置く', () => {
    const m9 = WEAPONS.m9
    // 20m で 14cm、40m で 54cm。肩ひとつぶん上へ置く見当
    expect(bulletDrop(20, m9.bulletSpeed, m9.bulletGravity)).toBeCloseTo(0.14, 2)
    expect(bulletDrop(40, m9.bulletSpeed, m9.bulletGravity)).toBeCloseTo(0.54, 2)
    // 殺傷の拳銃はほとんど落ちない。**同じ間合いでも当て方が違う**
    expect(bulletDrop(40, WEAPONS.m1911.bulletSpeed, WEAPONS.m1911.bulletGravity))
      .toBeLessThan(0.06)
  })
})
