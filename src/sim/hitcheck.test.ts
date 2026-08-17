import { describe, expect, test } from 'bun:test'
import { verifyHit, type Pose } from './hitcheck'
import type { Stance } from './stance'

/**
 * 申告の検証。ここでは**ナイフが刺さる姿勢**だけを見る。
 *
 * 遮蔽や距離の判定はステージの形に依存するので、開けた場所 (箱なし) で
 * 間合いの内側に並べて、姿勢だけを動かす。
 */

const WINDOW = 400

/** 同じ場所に立っている 1 人ぶんの履歴。姿勢だけ差し替えられる */
function history(at: [number, number], stance: Stance, yaw = 0): Pose[] {
  const [x, z] = at
  return [0, 1, 2].map((i) => ({
    time: 100_000 + i * 16,
    x,
    y: 0,
    z,
    yaw,
    crouching: stance === 'crouch',
    boxed: stance === 'box',
    stance,
  }))
}

/** 刺せる間合いに並べて刺す */
function stab(targetStance: Stance) {
  return verifyHit(history([0, 0], 'stand'), history([0, 1], targetStance), { kind: 'melee' }, [], WINDOW)
}

describe('ナイフの刺さる姿勢', () => {
  test.each<[Stance, boolean]>([
    ['stand', true],
    ['crouch', true],
    // 箱は含める。被っただけで刃が通らないなら「被れば無敵」になる
    ['box', true],
    // 爆風で転んでいる間。立っている人が地面の的に同じ型で刺す絵にならないし、
    // 転ばせてから刺すのが安すぎる
    ['prone', false],
    ['down', false],
  ])('%s に刺さるか = %p', (stance, expected) => {
    expect(stab(stance).ok).toBe(expected)
  })

  test('弾は姿勢を問わない', () => {
    // 倒れている相手を撃って仕留めるのは通る。塞ぐのはナイフだけ
    const verdict = verifyHit(
      history([0, 0], 'stand'),
      history([0, 1], 'prone'),
      { kind: 'bullet', zone: 'BODY', distance: 1 },
      [],
      WINDOW,
    )
    expect(verdict.ok).toBe(true)
  })

  test('刺した時に立っていれば、その後で転んでも通る', () => {
    // **遡って照合するのが要**。「いまの姿勢」で見ると、刺した瞬間は立っていた
    // 相手が爆風で転んだ直後に届いた申告を弾いてしまう
    const target: Pose[] = [
      ...history([0, 1], 'stand').slice(0, 2),
      { ...history([0, 1], 'prone')[2], time: 100_032 },
    ]
    expect(verifyHit(history([0, 0], 'stand'), target, { kind: 'melee' }, [], WINDOW).ok).toBe(true)
  })

  test('ずっと倒れていれば、遡っても通らない', () => {
    const target = history([0, 1], 'prone')
    const verdict = verifyHit(history([0, 0], 'stand'), target, { kind: 'melee' }, [], WINDOW)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('姿勢')
  })
})
