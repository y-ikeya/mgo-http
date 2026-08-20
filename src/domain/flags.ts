/**
 * 面が何を止めるか。
 *
 * --- なぜ分けるか ---
 * これまで札は `col_` (判定だけ) と `vis_` (描画だけ) の 2 種類しか無く、
 * 1 つの札が複数のことを同時に決めていた。だから
 *
 *   - 見えない `col_` の箱が**視線まで止める** (壁の向こうの敵が消える)
 *   - 金網のように「人は止めるが弾は通す」物が作れない
 *   - 爆風を足すと、同じ札が 3 つ目の意味を持つ
 *
 * MGO2 (MGS4 エンジン) は面ごとに別々のビットを持っていた。Player / Bullet /
 * StopEye / Camera / Sound … と、止める対象を独立に指定できる。
 * その形をそのまま借りる。
 *
 * three.js に依存しない。サーバー (bun) がそのまま読む。
 */

/** 何を止めるか。既定は全部止めて、名前で個別に外す */
export interface SurfaceFlags {
  /** 描画する */
  draw: boolean
  /** 人を止める (移動の判定) */
  player: boolean
  /** 弾を止める */
  bullet: boolean
  /** 視線を止める (見えている相手だけ配る判定) */
  eye: boolean
  /** カメラを止める (寄せて壁抜けを防ぐ) */
  camera: boolean
}

export const SOLID: SurfaceFlags = {
  draw: true,
  player: true,
  bullet: true,
  eye: true,
  camera: true,
}

/**
 * 名前から属性を読む。
 *
 *   wall                 何も付けなければ全部止める
 *   fence_nobullet       弾だけ通す
 *   bush_noplayer_nobullet  人と弾は通し、視線は止める
 *   glass_noeye          見通せるが弾は止める
 *   trigger_nodraw       描画しない
 *
 * 昔の 2 つの札も受ける。意味は今の挙動に合わせてあるので、
 * ステージを書き直さなくても振る舞いは変わらない — ただし `col_` が
 * 視線を止めていた点だけは直る (見えない壁で敵が消えるのはバグなので)。
 */
export function flagsOf(name: string): SurfaceFlags {
  const flags = { ...SOLID }

  // 旧: 判定だけ (見えない)。見えない物が視線を止めるのはおかしいので eye は外す
  if (name.includes('col_')) {
    flags.draw = false
    flags.eye = false
  }
  // 旧: 描画だけ。飾りなので人も弾もカメラも通す
  if (name.includes('vis_')) {
    flags.player = false
    flags.bullet = false
    flags.camera = false
  }

  if (name.includes('nodraw')) flags.draw = false
  if (name.includes('noplayer')) flags.player = false
  if (name.includes('nobullet')) flags.bullet = false
  if (name.includes('noeye')) flags.eye = false
  if (name.includes('nocamera')) flags.camera = false

  return flags
}

/** 何も止めず描画もしないなら、持っている意味が無い */
export function isInert(flags: SurfaceFlags): boolean {
  return !flags.draw && !flags.player && !flags.bullet && !flags.eye && !flags.camera
}
