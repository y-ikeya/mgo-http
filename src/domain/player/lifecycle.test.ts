import { describe, expect, test } from 'bun:test'
import {
  advanceLife,
  canAct,
  canTransition,
  CHOOSE_TIMEOUT,
  DOWN_DURATION,
  SPAWN_PROTECT,
  type Life,
} from './lifecycle'

/**
 * 時間だけで進む遷移。
 *
 * **サーバーを立てずに確かめられる。** ここが server/index.ts の tick の中に
 * switch として在った頃は、倒れてから支度に移るまでを確かめるのに実際の
 * サーバーを立てて 5 秒待つしかなかった (統合試験が実時間で待つのはこれが理由)。
 *
 * 数字も遷移先も遊びの規則なので、規則の側で押さえる。回す (毎 tick 全員を
 * 見る) のと、やる (配る・装備を配り直す) のは server の仕事で、そちらには
 * 分岐が残っていない。
 */
describe('時間で進む遷移', () => {
  /** 秒で書いて ms で渡す。定数と同じ単位で読めるように */
  const at = (life: Life, seconds: number) => advanceLife(life, seconds * 1000)

  test('**倒れたら支度へ。** 尺が終わるまでは動かない', () => {
    expect(at('downed', DOWN_DURATION - 0.1)).toBeNull()
    expect(at('downed', DOWN_DURATION)).toEqual({ kind: 'life', to: 'choosing' })
  })

  test('**選ばないままなら打ち切って湧かせる。** 相手の試合を止めない', () => {
    expect(at('choosing', CHOOSE_TIMEOUT - 0.1)).toBeNull()
    // 状態を書き換えるだけでは足りない (装備を配り直す) ので spawn を返す
    expect(at('choosing', CHOOSE_TIMEOUT)).toEqual({ kind: 'spawn' })
  })

  test('湧いてしばらくで無敵が切れる', () => {
    expect(at('spawning', SPAWN_PROTECT - 0.1)).toBeNull()
    expect(at('spawning', SPAWN_PROTECT)).toEqual({ kind: 'life', to: 'alive' })
  })

  /**
   * **時計では動かない状態がある。**
   *
   * `alive` は撃たれるまで続くし、`joining` は位置が届くまで待つ。
   * `dropped` は席を畳む判断で、これは部屋の側が持っている
   * (RECONNECT_GRACE_MS)。どれだけ経っても null を返す。
   */
  test('時計で動かない状態は、いくら経っても何も起きない', () => {
    for (const life of ['alive', 'joining', 'dropped'] as Life[]) {
      expect(at(life, 0)).toBeNull()
      expect(at(life, 3600)).toBeNull()
    }
  })

  /**
   * **返す遷移は表が通す物だけ。**
   *
   * ここが表 (canTransition) と食い違うと、返ってきたとおりに動かした側が
   * enterLife に弾かれて、**何も起きないまま毎 tick 呼ばれ続ける**。
   * 気づけるのは「倒れたまま支度に移らない」という形で、原因から遠い。
   */
  test('返す遷移は、通ってよい遷移の表と食い違わない', () => {
    const froms: Life[] = ['downed', 'choosing', 'spawning']
    for (const from of froms) {
      const effect = advanceLife(from, 60 * 1000)
      if (effect?.kind !== 'life') continue
      expect(canTransition(from, effect.to)).toBe(true)
    }
  })

  /**
   * **止まっている人を飛ばす条件と、遷移の集合が噛み合っている。**
   *
   * server の tick は advanceLife の後に `canAct` で足切りして、残りだけ
   * 眠り・スタミナ・溺れを見る。**時計待ちの状態が canAct に混ざると**、
   * 支度の画面を開いている人が水に落ちて死ぬ。
   */
  test('支度中と倒れている間は、戦場の処理に進まない', () => {
    expect(canAct('choosing')).toBe(false)
    expect(canAct('downed')).toBe(false)
    expect(canAct('joining')).toBe(false)
    expect(canAct('spawning')).toBe(true)
    expect(canAct('alive')).toBe(true)
  })
})
