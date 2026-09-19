/**
 * 「攻撃された」の幾何。TARGET ALERT (domain/player/skill.ts) が読む事実。
 *
 * ここが返すのは**事実だけ** — 弾道が体のそばを通ったか、照準が体を捉えて
 * いるか。それを何秒光らせるか、どの段で数えるかは domain。
 *
 * 体は**足元から頭までの線分**として扱う。部位まで見る必要は無い (当たったか
 * ではなく、狙われたかを見ている)。
 */

/** 点から線分までの距離 */
function distanceToSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const length2 = dx * dx + dy * dy + dz * dz
  let t = 0
  if (length2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / length2
    t = Math.max(0, Math.min(1, t))
  }
  const cx = ax + dx * t - px
  const cy = ay + dy * t - py
  const cz = az + dz * t - pz
  return Math.sqrt(cx * cx + cy * cy + cz * cz)
}

/** 体の線分の上で、弾道の判定に使う点。足元・胸・頭 */
const BODY_SAMPLES = [0.2, 0.55, 0.9] as const

/**
 * 弾道が体のそばを通ったか。
 *
 * 線分どうしの距離をきちんと解く代わりに、体の線分の上の 3 点から弾道までの
 * 距離を見る。体は 1.8m しかなく、半径 (1.2m) はその 3 分の 2 なので、
 * 3 点で取りこぼす隙間は無い。
 *
 * @param head その人の頭の高さ (足元から)。屈んでいれば低い
 * @param radius これより近ければ「撃たれた」
 */
export function shotPassesNear(
  from: readonly number[],
  to: readonly number[],
  target: { x: number; y: number; z: number },
  head: number,
  radius: number,
): boolean {
  for (const at of BODY_SAMPLES) {
    const distance = distanceToSegment(
      target.x, target.y + head * at, target.z,
      from[0] ?? 0, from[1] ?? 0, from[2] ?? 0,
      to[0] ?? 0, to[1] ?? 0, to[2] ?? 0,
    )
    if (distance <= radius) return true
  }
  return false
}

/**
 * 照準が体を捉えているか。
 *
 * 見ている点 (eye) から視線の向きへ引いた線が、胸から **width 以内**を通るか。
 * 距離に依らない幅で見る — 角度で見ると遠いほど幅が広がって、遠くから
 * 「こっちを見た」だけで入る。遮蔽は見ない — **見えているかは呼ぶ側が別に問う**
 * (壁越しに構えても狙ったことにはならない)。
 *
 * @param dir 視線の向き (単位ベクトル)
 * @param width 胸から線までの距離がこれ以内なら「狙われた」(m)
 * @param range これより遠ければ数えない
 */
export function aimedAt(
  eye: { x: number; y: number; z: number },
  dir: readonly [number, number, number],
  target: { x: number; y: number; z: number },
  head: number,
  width: number,
  range: number,
): boolean {
  const tx = target.x - eye.x
  const ty = target.y + head * 0.55 - eye.y
  const tz = target.z - eye.z
  const distance = Math.sqrt(tx * tx + ty * ty + tz * tz)
  if (distance <= 0 || distance > range) return false
  // 視線の上への射影。後ろに居れば負
  const along = tx * dir[0] + ty * dir[1] + tz * dir[2]
  if (along <= 0) return false
  // 胸から視線までの距離 (直交する成分)
  const off = Math.sqrt(Math.max(0, distance * distance - along * along))
  return off <= width
}
