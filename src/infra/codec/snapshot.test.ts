import { describe, expect, test } from 'bun:test'
import { decodeSnapshot, encodeSnapshot } from './snapshot'
import { WEAPONS, type WeaponId } from '../../domain/item/weapons'
import { HELD, type HeldId } from '../../domain/item/held'

/**
 * 位置の符号。**番号の表に漏れがあると、別の物として読まれる。**
 *
 * 手にある物も提げている銃も 1 バイトの番号で送っていて、表に無い物は 0 番
 * (rifle) に落ちる。落ちても型は通り、通信も成立するので、**気づくのは遊んで
 * いるとき**になる。
 *
 * 実際に起きた: 麻酔の狙撃銃を足したとき表へ入れ忘れて、サーバーは「突撃銃を
 * 持っている」と読んでいた。撃つと突撃銃の弾が減り、狙撃銃の弾は満タンのまま
 * 送り返されるので、**撃っても弾が戻る**という形で出た。
 */
const SNAPSHOT: Parameters<typeof encodeSnapshot>[0] = {
  id: 'me',
  x: 1,
  y: 2,
  z: 3,
  yaw: 0.5,
  pitch: -0.2,
  state: 'idle',
  held: 'rifle',
  weapon: 'rifle',
  aiming: false,
  crouching: false,
  concentrating: false,
  salute: false,
  reloading: false,
  protected: false,
  holdingGrenade: false,
  prone: false,
  seat: 0,
  health: 100,
  time: 0,
} as never

describe('位置の符号', () => {
  test('**撃てる物は全部**番号を持っている', () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const packet = encodeSnapshot({ ...SNAPSHOT, weapon: id } as never)
      const read = decodeSnapshot(new DataView(packet), 'me')
      expect(read.weapon, `番号の表に無い銃: ${id}`).toBe(id)
    }
  })

  test('**手に持てる物は全部**番号を持っている', () => {
    for (const id of Object.keys(HELD) as HeldId[]) {
      const packet = encodeSnapshot({ ...SNAPSHOT, held: id } as never)
      const read = decodeSnapshot(new DataView(packet), 'me')
      expect(read.held, `番号の表に無い持ち物: ${id}`).toBe(id)
    }
  })
})
