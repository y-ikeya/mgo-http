import { describe, expect, test } from 'bun:test'
import { Trigger } from './trigger'
import { Inventory, type ShootContext } from './inventory'
import { WEAPONS } from './weapons'

/**
 * 引き金。**押しっぱなしで撃ち続けられるか。**
 *
 * 以前は presentation の 3,000 行の中に離れた 3 行として置かれていて、
 * 試験が書けなかった。表に auto があるのに誰も読まず、M9 が押しっぱなしで
 * 撃ち続けられていたのもそのため。
 */

const AUTO = true
const SEMI = false

describe('引き金', () => {
  test('連射できる物は、押しっぱなしで引き続けられる', () => {
    const trigger = new Trigger()
    trigger.update(true)
    expect(trigger.pulled(AUTO)).toBe(true)
    trigger.fired(AUTO)
    trigger.update(true)
    expect(trigger.pulled(AUTO)).toBe(true)
  })

  /**
   * **離した瞬間に撃てる、ではない。** 離してから押し直すまで待たせる。
   * 「離した瞬間」にすると、押しっぱなしのまま連打の速さを稼げてしまう。
   */
  test('連射できない物は、離して押し直すまで引けない', () => {
    const trigger = new Trigger()
    trigger.update(true)
    expect(trigger.pulled(SEMI)).toBe(true)

    trigger.fired(SEMI)
    // 押したまま
    trigger.update(true)
    expect(trigger.pulled(SEMI)).toBe(false)

    // 離す
    trigger.update(false)
    expect(trigger.pulled(SEMI)).toBe(true)
  })

  /** 持ち替えた直後や湧いた直後に、一度離させる理由が無い */
  test('作った直後は引ける', () => {
    expect(new Trigger().pulled(SEMI)).toBe(true)
  })

  test('戻せば、押したままでも引けるようになる', () => {
    const trigger = new Trigger()
    trigger.update(true)
    trigger.fired(SEMI)
    expect(trigger.pulled(SEMI)).toBe(false)
    trigger.reset()
    expect(trigger.pulled(SEMI)).toBe(true)
  })
})

/**
 * 撃てるか。**撃つ前に立つ条件を 1 つの問いにまとめたもの。**
 *
 * 以前は presentation に 9 個の && として並んでいた。ドメインルールと、
 * 装置の話と、単発の再現が同じ行に混ざり、**どれを変えると遊びが変わるのかが
 * 読めなかった**。
 */
describe('撃てるか', () => {
  const ready: ShootContext = {
    held: true,
    aiming: true,
    life: 'alive',
    reloading: false,
    stabbing: false,
    rolling: false,
    crawling: false,
    landing: false,
    ammo: 30,
  }

  function make(): Inventory {
    return new Inventory({ primary: 'rifle', secondary: 'm9', support: 'grenade' })
  }

  /** 持ち替えが終わるまで進める (SWITCH_TIME は 0.3 秒)。引き金は離したまま */
  function settle(inv: Inventory): void {
    for (let i = 0; i < 30; i++) inv.update(1 / 60, false)
  }

  test('条件がそろえば撃てる', () => {
    expect(make().canShoot(WEAPONS.rifle, ready)).toBe(true)
  })

  test('引き金を引いていなければ撃てない', () => {
    expect(make().canShoot(WEAPONS.rifle, { ...ready, held: false })).toBe(false)
  })

  test('構えていなければ撃てない', () => {
    expect(make().canShoot(WEAPONS.rifle, { ...ready, aiming: false })).toBe(false)
  })

  test('倒れていれば撃てない', () => {
    expect(make().canShoot(WEAPONS.rifle, { ...ready, life: 'downed' })).toBe(false)
  })

  /**
   * **装填・刺突・転がり・匍匐は、撃つことと排他。** そこが選択の代償になる。
   *
   * 匍匐だけ毛色が違う。あちらは「動作の最中だから」ではなく、**伏せは
   * 動きながら撃てる姿勢ではない**という決めごと — 一番見つかりにくく一番
   * 安定して撃てる姿勢が動き撃ちまでできると、低いまま詰めるのが常に最善になる。
   */
  for (const busy of ['reloading', 'stabbing', 'rolling', 'crawling', 'landing'] as const) {
    test(`${busy} の間は撃てない`, () => {
      expect(make().canShoot(WEAPONS.rifle, { ...ready, [busy]: true })).toBe(false)
    })
  }

  test('弾が無ければ撃てない。**自動では装填しない**', () => {
    expect(make().canShoot(WEAPONS.rifle, { ...ready, ammo: 0 })).toBe(false)
  })

  /**
   * **投げると決めた瞬間に撃つ手段を手放す。** 持ち替えの代償がここに出る。
   */
  test('撃てない物を手にしていれば撃てない', () => {
    const inv = make()
    inv.switchTo('grenade')
    settle(inv)
    expect(inv.canShoot(WEAPONS.rifle, ready)).toBe(false)
  })

  /** **持ち替えている最中も撃てない。** そこが投げると決めた代償になる */
  test('持ち替えの最中は撃てない', () => {
    const inv = make()
    inv.switchTo('m9')
    expect(inv.canShoot(WEAPONS.m9, ready)).toBe(false)
  })

  /** 単発の銃。**押しっぱなしでは 1 発** */
  test('M9 は押しっぱなしでは 1 発しか撃てない', () => {
    const inv = make()
    inv.switchTo('m9')
    settle(inv)
    expect(inv.canShoot(WEAPONS.m9, ready)).toBe(true)

    inv.fired(WEAPONS.m9)
    inv.update(0.016, true) // 押したまま
    expect(inv.canShoot(WEAPONS.m9, ready)).toBe(false)

    inv.update(0.016, false) // 離す
    expect(inv.canShoot(WEAPONS.m9, ready)).toBe(true)
  })

  /** AK47 は押しっぱなしで撃ち続けられる。間隔で塞ぐのは presentation */
  test('AK47 は押しっぱなしで撃ち続けられる', () => {
    const inv = make()
    expect(inv.canShoot(WEAPONS.rifle, ready)).toBe(true)
    inv.fired(WEAPONS.rifle)
    inv.update(0.016, true)
    expect(inv.canShoot(WEAPONS.rifle, ready)).toBe(true)
  })
})

/** ナイフ。**表を持たない物も同じ引き金に乗る** */
describe('押した瞬間だけ効く物', () => {
  test('押しっぱなしでは 1 回だけ', () => {
    const inv = new Inventory({ primary: 'rifle', secondary: 'm9', support: 'grenade' })
    expect(inv.pressedOnce).toBe(true)
    inv.consumePress()
    inv.update(0.016, true)
    expect(inv.pressedOnce).toBe(false)
    inv.update(0.016, false)
    expect(inv.pressedOnce).toBe(true)
  })
})
