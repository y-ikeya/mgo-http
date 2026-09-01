import { describe, expect, test } from 'bun:test'
import { zoomLookScale } from './camera'

/**
 * 覗いている間の見る速さ。
 *
 * --- なぜここを試すか ---
 * 「16 倍と書いてあるのにそこまで寄っている気がしない」から辿り着いた。
 * 画角は本当に 4 度まで下がっていたが、**感度が倍率に付いてきていなかった**。
 * 画面に映る角度が 1/15 なのに手の動きはそのままなので、狙いが飛んで
 * 「寄れていない」ように感じる。
 *
 * 見たいのは倍率そのものではなく、**画面上で同じ距離だけ動くか**。
 */

/** その画角で、画面の端までが何ラジアンか (tan の比で効く) */
const spanOf = (fov: number) => Math.tan((fov * Math.PI) / 360)

describe('覗いたときの見る速さ', () => {
  test('肩越しは 1 倍。**覗いていない間の手触りは変えない**', () => {
    expect(zoomLookScale(38)).toBe(1)
  })

  test('肩越しより広い武器も 1 倍で頭打ち。速くはしない', () => {
    // 拳銃や散弾銃は 42〜44 度。比で言えば 1 を超えるが、上げる理由はない
    expect(zoomLookScale(44)).toBe(1)
    expect(zoomLookScale(60)).toBe(1)
  })

  test('**画面上で動く距離が段によらず揃う**', () => {
    // 狙撃銃の 3 段。画角が狭いほど、同じ px で回る角も狭くなる
    for (const fov of [16, 8, 4]) {
      const moved = zoomLookScale(fov) * spanOf(38)
      expect(moved).toBeCloseTo(spanOf(fov), 6)
    }
  })

  test('16 倍では肩越しの 1/10 まで落ちる', () => {
    // tan(2°) / tan(19°) = 0.1014
    expect(zoomLookScale(4)).toBeCloseTo(0.101, 3)
  })
})
