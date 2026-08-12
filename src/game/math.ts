/**
 * フレームレート非依存の指数補間。
 * lambda が大きいほど速く target に寄る。dt が変動しても結果が揺れない。
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/** -PI..PI に畳む */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** 角度用の damp。359°→1° を 358°分回らず最短経路で回す */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = wrapAngle(target - current)
  return wrapAngle(damp(0, delta, lambda, dt) + current)
}
