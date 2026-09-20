import { describe, expect, test } from 'bun:test'
import { aimedAt, shotPassesNear } from './alert'
import { viewDirection } from '../space/eyepoint'

const HEAD = 1.7

describe('撃たれた (shotPassesNear)', () => {
  const body = { x: 0, y: 0, z: 0 }

  test('体を通る弾道', () => {
    expect(shotPassesNear([0, 1.4, 10], [0, 1.0, -10], body, HEAD, 1.2)).toBe(true)
  })

  test('肩の横をかすめる弾道', () => {
    expect(shotPassesNear([1.0, 1.4, 10], [1.0, 1.4, -10], body, HEAD, 1.2)).toBe(true)
  })

  test('半径の外を通る弾道は数えない', () => {
    expect(shotPassesNear([2.0, 1.4, 10], [2.0, 1.4, -10], body, HEAD, 1.2)).toBe(false)
  })

  /** 線分で見る。**向こうへ届かない弾** (手前の壁で止まった) は通っていない */
  test('手前で止まった弾道は数えない', () => {
    expect(shotPassesNear([0, 1.4, 10], [0, 1.4, 3], body, HEAD, 1.2)).toBe(false)
  })

  /** 頭の上を抜ける弾。屈んでいれば頭が低いので、立っていたときより外れやすい */
  test('屈んだ頭の上を抜ける弾は数えない', () => {
    expect(shotPassesNear([0, 2.4, 10], [0, 2.4, -10], body, 0.9, 1.2)).toBe(false)
    expect(shotPassesNear([0, 2.4, 10], [0, 2.4, -10], body, HEAD, 1.2)).toBe(true)
  })
})

describe('狙われた (aimedAt)', () => {
  // -Z を向いている (yaw 0)
  const eye = { x: 0, y: 1.5, z: 0 }
  const ahead = viewDirection(0, 0)

  test('照準の中心に居る', () => {
    expect(aimedAt(eye, ahead, { x: 0, y: 0.6, z: -30 }, HEAD, 1, 80)).toBe(true)
  })

  /** **幅は距離に依らない。** 30m 先でも 80m 先でも、胸から 1m 以内なら入る */
  test('30m 先で 0.9m ずれていれば内、1.2m ずれていれば外', () => {
    expect(aimedAt(eye, ahead, { x: 0.9, y: 0.6, z: -30 }, HEAD, 1, 80)).toBe(true)
    expect(aimedAt(eye, ahead, { x: 1.2, y: 0.6, z: -30 }, HEAD, 1, 80)).toBe(false)
  })

  test('80m 先でも幅は同じ。1.2m ずれていれば外 (角度だと 4m まで入っていた)', () => {
    expect(aimedAt(eye, ahead, { x: 0.9, y: 0.6, z: -79 }, HEAD, 1, 80)).toBe(true)
    expect(aimedAt(eye, ahead, { x: 1.2, y: 0.6, z: -79 }, HEAD, 1, 80)).toBe(false)
  })

  test('後ろに居る人は狙っていない', () => {
    expect(aimedAt(eye, ahead, { x: 0, y: 0.6, z: 30 }, HEAD, 1, 80)).toBe(false)
  })

  test('届く距離の外は数えない', () => {
    expect(aimedAt(eye, ahead, { x: 0, y: 0.6, z: -100 }, HEAD, 1, 80)).toBe(false)
  })

  /** 見下ろしている。pitch が負で下を向く (camera.ts の向き) */
  test('見下ろした先に居る', () => {
    const down = viewDirection(0, -Math.atan2(5, 10))
    expect(aimedAt({ x: 0, y: 5.9, z: 0 }, down, { x: 0, y: 0, z: -10 }, HEAD, 1, 80)).toBe(true)
  })
})
