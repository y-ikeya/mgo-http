/**
 * 空のダンボール (審判側)。触れた人を見つけて揺らす。
 *
 * 箱そのものは地形 (stage.json の fx と、人の層の三角) で、ここは「誰かが
 * 触ったか」を見るだけ。decoy の bumpDecoys と同じ形だが、箱は**向きがある**
 * ので、体の中心を箱の向きに直してから面との距離を見る。
 */
import { canAct } from '../../src/domain/player/lifecycle'
import { connected } from '../../src/domain/match/match'
import { BUMP_COOLDOWN, BUMP_SLACK, CBOX_DEPTH, CBOX_HEIGHT, CBOX_WIDTH } from '../../src/domain/item/cbox'
import { PLAYER_RADIUS } from '../../src/domain/player/moving'
import { type RoomWorld, broadcast } from '../world'

/** 箱ごとの、次に揺れてよい時刻 (部屋ごと)。箱は地形なので部屋の外に持つ */
const bumpAt = new WeakMap<RoomWorld, number[]>()

export function bumpCboxes(room: RoomWorld, now: number): void {
  const cboxes = room.stage.cboxes
  if (cboxes.length === 0) return
  let at = bumpAt.get(room)
  if (!at) {
    at = new Array<number>(cboxes.length).fill(0)
    bumpAt.set(room, at)
  }
  for (let i = 0; i < cboxes.length; i++) {
    if (now < at[i]!) continue
    const box = cboxes[i]!
    const hw = (CBOX_WIDTH / 2) * box.size
    const hd = (CBOX_DEPTH / 2) * box.size
    const reach = PLAYER_RADIUS + BUMP_SLACK
    const cos = Math.cos(box.yaw)
    const sin = Math.sin(box.yaw)
    for (const player of connected(room)) {
      if (!canAct(player.life)) continue
      // 高さ。上の階を歩いている人で揺れると意味が反転する
      if (player.y < box.y - 0.5 || player.y > box.y + CBOX_HEIGHT * box.size) continue
      const dx = player.x - box.x
      const dz = player.z - box.z
      // 箱の向きに直す (three の Y 回りの逆)
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos
      if (Math.abs(lx) > hw + reach || Math.abs(lz) > hd + reach) continue
      at[i] = now + BUMP_COOLDOWN * 1000
      // 押された向き: 触った人から箱へ
      const len = Math.hypot(dx, dz) || 1
      broadcast(room, { type: 'cboxBumped', index: i, dirX: -dx / len, dirZ: -dz / len })
      break
    }
  }
}
