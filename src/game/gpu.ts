/**
 * この機械が 3D を描けるか。
 *
 * --- なぜ要るか ---
 * GPU が 1 つも使えていない機械では、Windows が最終手段のソフトウェア
 * ラスタライザ (D3D11 WARP / Microsoft Basic Render Driver) に落ちる。
 * そこでは描画も合成もラスタライズも**全部 CPU** が回すので、three.js は
 * 数 FPS しか出ない。
 *
 * 実際にそうなった機械で遊ぼうとしたら、位置を送る間隔まで巻き添えになった
 * (64Hz で仕掛けた setInterval が 3〜13 回/秒 しか発火しない)。本人が遊べない
 * だけでなく、相手の画面でその人がカクついて瞬間移動する。
 *
 * --- FPS では測らない ---
 * 読み込みとシェーダのコンパイルで最初の数秒は誰でも低いので、測るには待つ
 * 必要があり、待つ頃にはもう部屋の中に居る。そして「遊べない」と「ちょっと重い」
 * の線が引けない。
 *
 * **描画する前に、環境として分かる。** 使っているのがソフトウェアラスタライザ
 * なら、名前でそう分かる。
 *
 * --- 疑わしきは通す ---
 * ここで false を返すと**遊ばせない**ので、確信が持てるときだけ落とす。
 * 名前が読めなければ通す。WebGPU が無いだけでも通す (本物の GPU で WebGL2 を
 * 使っているだけかもしれないし、ブラウザによっては WebGPU 自体が無い)。
 */

/**
 * ソフトウェア描画の名前。
 *
 * WARP は Windows の、SwiftShader は Chrome 同梱の、llvmpipe / softpipe は
 * Mesa のソフトウェア実装。`Microsoft Basic Render Driver` は
 * 「GPU ドライバが入っていない / 使えない」ときに Windows が出す物で、
 * リモートデスクトップ越しでも仮想マシンでもこれになる。
 */
const SOFTWARE = [
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'basic render driver',
  'basic display adapter',
  'microsoft basic',
  'mesa offscreen',
  'software adapter',
  'warp',
]

export type GpuVerdict =
  /** 描ける。renderer は診断の表示に使う */
  | { ok: true; renderer: string }
  /** 描けない。reason は案内の文面を選ぶのに使う */
  | { ok: false; reason: 'software' | 'no-webgl'; renderer: string }

let cached: GpuVerdict | null = null

/**
 * 判定は 1 回だけ。文脈を作り直すのは安くないし、答えは変わらない
 * (ドライバを入れ直したらページを開き直すことになる)。
 */
export function checkGpu(): GpuVerdict {
  if (cached) return cached
  cached = probe()
  return cached
}

function probe(): GpuVerdict {
  let canvas: HTMLCanvasElement
  let gl: WebGL2RenderingContext | null
  try {
    canvas = document.createElement('canvas')
    gl = canvas.getContext('webgl2')
  } catch {
    return { ok: true, renderer: '' }
  }

  // WebGL2 すら作れない。WebGPU も期待できないので、そもそも描けない
  if (!gl) return { ok: false, reason: 'no-webgl', renderer: '' }

  let renderer = ''
  try {
    // 素の RENDERER は伏せられていることがあるので、拡張から実名を取る。
    // 取れない環境 (Firefox の fingerprint 対策など) では空になる
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '')
    if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) ?? '')
  } catch {
    renderer = ''
  } finally {
    // 判定のためだけに作った文脈なので、掴んだままにしない
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  // 名前が読めなければ通す。読めないことを理由に締め出さない
  if (!renderer) return { ok: true, renderer: '' }

  const lower = renderer.toLowerCase()
  if (SOFTWARE.some((name) => lower.includes(name))) {
    return { ok: false, reason: 'software', renderer }
  }
  return { ok: true, renderer }
}
