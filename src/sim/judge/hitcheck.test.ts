import { describe, expect, test } from 'bun:test'
import { verifyHit, type Pose } from './hitcheck'
import type { Stance } from '../../domain/player/stance'
import type { StageBox } from '../space/vision'

/**
 * 申告の検証。ここでは**ナイフが刺さる姿勢**だけを見る。
 *
 * 遮蔽や距離の判定はステージの形に依存するので、開けた場所 (箱なし) で
 * 間合いの内側に並べて、姿勢だけを動かす。
 */

const WINDOW = 400

/** 同じ場所に立っている 1 人ぶんの履歴。姿勢だけ差し替えられる */
function history(at: [number, number], stance: Stance, yaw = 0, pitch = 0): Pose[] {
  const [x, z] = at
  return [0, 1, 2].map((i) => ({
    time: 100_000 + i * 16,
    x,
    y: 0,
    z,
    yaw,
    pitch,
    crouching: stance === 'crouch',
    boxed: stance === 'box',
    stance,
  }))
}

/**
 * **検算に渡すドメインルールは、この試験が決める。** 遊びの側 (domain) の値を持ち出さない
 * — 間合いを 0.1m 動かしただけで幾何の試験が動くのはおかしい。ここで見たいのは
 * 「渡されたドメインルールどおりに弾くか」だけ。
 */
/** 倒れている相手に刃が通る見下ろしの角度 (rad) */
const DOWN_PITCH = -0.35

const RULES = {
  // 伏せだけ低い。**本物の数字は持ち込まない** — 判定の形だけを見る
  headHeight: (stance: string) =>
    stance === 'prone' ? 0.4 : stance === 'crouch' || stance === 'box' ? 0.94 : 1.47,
  // 立ち・しゃがみ・箱は刺さる。倒れている相手は見下ろしたときだけ
  canBeStabbed: (stance: string, aimPitch: number) =>
    stance === 'stand' || stance === 'crouch' || stance === 'box' || aimPitch <= DOWN_PITCH,
  meleeRange: 2,
  meleeSlack: 1.2,
  backstabDot: 0.34,
  distanceSlack: 3,
  distanceSlackRate: 0.06,
}

/** 刺せる間合いに並べて刺す */
function stab(targetStance: Stance) {
  return verifyHit(history([0, 0], 'stand'), history([0, 1], targetStance), { kind: 'melee' }, [], WINDOW, RULES)
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
      WINDOW, RULES)
    expect(verdict.ok).toBe(true)
  })

  test('刺した時に立っていれば、その後で転んでも通る', () => {
    // **遡って照合するのが要**。「いまの姿勢」で見ると、刺した瞬間は立っていた
    // 相手が爆風で転んだ直後に届いた申告を弾いてしまう
    const target: Pose[] = [
      ...history([0, 1], 'stand').slice(0, 2),
      { ...history([0, 1], 'prone')[2], time: 100_032 },
    ]
    expect(verifyHit(history([0, 0], 'stand'), target, { kind: 'melee' }, [], WINDOW, RULES).ok).toBe(true)
  })

  test('ずっと倒れていれば、遡っても通らない', () => {
    const target = history([0, 1], 'prone')
    const verdict = verifyHit(history([0, 0], 'stand'), target, { kind: 'melee' }, [], WINDOW, RULES)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('姿勢')
  })
})

describe('倒れている相手を刺す', () => {
  /** 刺せる間合いに並べて、見下ろす角度を変える */
  const stab = (targetStance: Stance, pitch: number) =>
    verifyHit(
      history([0, 0], 'stand', 0, pitch),
      history([0, 1], targetStance),
      { kind: 'melee' },
      [],
      WINDOW, RULES)

  test('真っ直ぐ前を刺しても、倒れている相手には届かない', () => {
    expect(stab('prone', 0).ok).toBe(false)
  })

  test('見下ろせば通る。しゃがんで下を狙う手間が要る', () => {
    expect(stab('prone', DOWN_PITCH).ok).toBe(true)
    expect(stab('prone', -0.8).ok).toBe(true)
  })

  test('少し下を向いた程度では通らない', () => {
    expect(stab('prone', -0.1).ok).toBe(false)
  })

  test('立っている相手は見下ろさなくても刺さる', () => {
    expect(stab('stand', 0).ok).toBe(true)
  })
})

/**
 * 伏せている相手の頭の位置。
 *
 * **構えごとに頭の高さが違う。** 長らく「しゃがみか / 箱か」の 2 つの真偽から
 * 引いていて、伏せを足した途端に穴が開いた — 這っている人は屈みの旗が
 * 立っているので 0.94m の所に頭があることになり、実際に頭がある 0.4m を
 * 撃っても遮蔽の裏と判定されて通らなかった。
 *
 * 姿勢が増えるたびに増える引数ではなく、**姿勢を 1 つ**渡す形にしてある。
 */
describe('伏せている相手の高さ', () => {
  /*
   * 相手の手前に置いた高さ 0.7m の壁。
   *
   * 撃つ側は立っている (目線 1.47m) ので、**壁は相手のすぐ手前に置く** —
   * 遠くに置くと見下ろす線が壁を越えてしまい、伏せていても見えてしまう。
   * この位置なら、しゃがんだ頭 (0.94m) は越えて見え、伏せた頭 (0.4m) は隠れる。
   */
  const LOW_WALL: StageBox[] = [
    { name: 'concrete_low', min: [-2, 0, 2.7], max: [2, 0.7, 2.9] },
  ]

  function headShot(stance: Stance) {
    return verifyHit(
      history([0, 0], 'stand'),
      history([0, 3], stance),
      { kind: 'bullet', zone: 'HEAD', distance: 3 },
      LOW_WALL,
      WINDOW,
      RULES,
    )
  }

  test('しゃがんだ頭は壁から出ているので通る', () => {
    expect(headShot('crouch').ok).toBe(true)
  })

  test('**伏せた頭は壁の裏。** 屈みの高さで見ていた頃はここが通っていた', () => {
    expect(headShot('prone').ok).toBe(false)
  })

  test('壁が無ければ伏せていても通る。**低いこと自体は盾ではない**', () => {
    const verdict = verifyHit(
      history([0, 0], 'stand'),
      history([0, 3], 'prone'),
      { kind: 'bullet', zone: 'HEAD', distance: 3 },
      [],
      WINDOW,
      RULES,
    )
    expect(verdict.ok).toBe(true)
  })
})
