import * as THREE from 'three'

/**
 * ダンボールの持ち手の穴。
 *
 * --- なぜ画像に焼いてから読み込むのか ---
 * 描いた canvas をそのまま `CanvasTexture` として渡すと、three r185 の WebGPU で
 * **毎フレーム描画物が作り直しになる**。提出中のバッファが破棄されて
 * 「used in submit while destroyed」が出続け、影の描画物も一緒に捨てられるので、
 * 箱の影が出ず、人の影がその場に取り残される。
 *
 * 実測で切り分けた。canvas で描いた模様を貼っている間は出続け、全部外すと止まり、
 * jpg を TextureLoader で読む形にすると出ない。
 *
 * そこで、描くのは canvas のままにして **PNG に焼いてから TextureLoader で読む**。
 * 読み込んだ画像は写真と同じ経路に乗るので、この問題を踏まない。
 * 寸法を変えても穴の位置が付いてくる、という生成の利点も残る。
 *
 * (箱の地の模様は canvas で描いていたが、実物の写真 cardboard.jpg に置き換えた。
 *  そちらのほうが良く、生成する理由も無くなった)
 */

/** 画素数。穴の縁が滑らかに見えれば十分 */
const SIZE = 512

/** 穴の大きさ。面の幅・高さに対する割合 */
const HANDLE_WIDTH = 0.17
const HANDLE_HEIGHT = 0.075
/** 上からの位置 (0 = 天面、1 = 底面) */
const HANDLE_Y = 0.24

/**
 * 持ち手の穴のアルファ。白 = 残す / 黒 = 抜く。
 *
 * 塗って描くのではなく本当に抜く。塗ると、光の向きが変わったときに
 * 平らな模様だと分かる。
 */
export function createHandleAlpha(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D コンテキストが取れない')

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, SIZE, SIZE)

  // 面の上寄り。持ち上げる穴なので、真ん中より上に付く
  const w = SIZE * HANDLE_WIDTH
  const h = SIZE * HANDLE_HEIGHT
  const x = (SIZE - w) / 2
  const y = SIZE * HANDLE_Y - h / 2
  ctx.fillStyle = '#000'
  roundedRect(ctx, x, y, w, h, h / 2)
  ctx.fill()

  // ここが肝。CanvasTexture ではなく画像として読ませる
  const texture = new THREE.TextureLoader().load(canvas.toDataURL('image/png'))
  texture.anisotropy = 4
  return texture
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
