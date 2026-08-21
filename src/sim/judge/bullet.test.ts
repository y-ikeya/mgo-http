import { describe, expect, test } from 'bun:test'
import { bulletDrop, bulletOffset, bulletSag, flightTime } from './bullet'
import { WEAPONS } from '../../domain/item/weapons'

/**
 * **武器ごとに弾の落ち方が違うことを押さえる。**
 *
 * 速さと重力を持っているのは domain (武器の性能)、放物線を引くのがここ。
 * 長らく**クライアントが全部の銃を 420 m/s で撃っていた** — 狙撃銃の弾が
 * 速いという設計が、画面には一度も出ていなかった。
 */
describe('弾の落ち', () => {
  test('近距離では読み取れない。撃ち合いの大半は今までどおり', () => {
    const ak = WEAPONS.rifle
    expect(bulletDrop(25, ak.bulletSpeed, ak.bulletGravity)).toBeLessThan(0.05)
  })

  test('遠距離では狙点より下に当たる。ステージの端で 20cm ほど', () => {
    const ak = WEAPONS.rifle
    const drop = bulletDrop(80, ak.bulletSpeed, ak.bulletGravity)
    expect(drop).toBeGreaterThan(0.1)
    expect(drop).toBeLessThan(0.4)
  })

  test('**速い弾ほど落ちない。** 狙撃銃は同じ距離で AK の 1/3 以下', () => {
    const ak = WEAPONS.rifle
    const sniper = WEAPONS.sniper
    const akDrop = bulletDrop(80, ak.bulletSpeed, ak.bulletGravity)
    const sniperDrop = bulletDrop(80, sniper.bulletSpeed, sniper.bulletGravity)
    // 落差は速さの 2 乗で効く。820 と 420 なら (420/820)² = 0.26 倍
    expect(sniperDrop).toBeLessThan(akDrop / 3)
  })

  test('拳銃は一番落ちる。遠くを撃つ物ではない', () => {
    const slowest = Object.values(WEAPONS).reduce((a, b) =>
      a.bulletSpeed <= b.bulletSpeed ? a : b,
    )
    expect(slowest.id).toBe('pistol')
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

  test('一番落ちる銃で端から端まで撃っても、許容の 1/10 に収まる', () => {
    const worst = Object.values(WEAPONS).reduce((a, b) =>
      bulletDrop(80, a.bulletSpeed, a.bulletGravity) >= bulletDrop(80, b.bulletSpeed, b.bulletGravity)
        ? a
        : b,
    )
    const sag = bulletSag(80, worst.bulletSpeed, worst.bulletGravity)
    expect(sag).toBeLessThan(SHOULDER_ALLOWANCE / 10)
  })
})
