/**
 * stage.blend を見張って、保存されたら glb を書き出す。
 *
 *   bun run stage
 *
 * Blender で Ctrl+S を押すだけで、ゲームの画面が作り直したステージに切り替わる
 * (glb が変わると Vite がページを読み直す)。
 *
 * 手で書き出す形だと、直したのに反映されていない状態で見比べることになる。
 * 「変えたのに変わらない」は原因を探すのが一番面倒な種類の詰まり方なので、
 * 人の手順から外しておく。
 *
 * Blender の Python から書き出しているので、GUI で開いたまま保存しても衝突しない
 * (別のプロセスが .blend を読むだけ)。
 */

import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const BLEND = 'tools/stage.blend'
const SCRIPT = 'tools/export_stage.py'

/**
 * 保存が落ち着くまで待つ時間 (ms)。
 *
 * Blender は保存のたびに複数回イベントを出し、書いている途中の .blend を
 * 読むと壊れたファイルを掴む。少し置いてから走らせる。
 */
const SETTLE = 400

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let queued = false

async function exportStage(): Promise<void> {
  if (running) {
    // 走っている最中に保存されたら、終わってからもう一度走らせる
    queued = true
    return
  }
  running = true

  const started = Date.now()
  const proc = Bun.spawn([BLENDER, '-b', BLEND, '--python', SCRIPT], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(proc.stdout).text()
  await proc.exited

  // Blender は起動時の情報を大量に吐くので、書き出しに関わる行だけ拾う
  for (const line of output.split('\n')) {
    if (
      line.startsWith('書き出し') ||
      line.startsWith('メッシュ') ||
      line.startsWith('材質') ||
      line.startsWith('---') ||
      line.startsWith('  ')
    ) {
      console.info(line)
    }
  }

  if (proc.exitCode !== 0) console.error(`書き出しに失敗 (終了コード ${proc.exitCode})`)
  console.info(`(${Date.now() - started}ms)\n`)

  running = false
  if (queued) {
    queued = false
    void exportStage()
  }
}

await stat(BLEND).catch(() => {
  console.error(`${BLEND} が無い。先に make_stage.py で叩き台を作る`)
  process.exit(1)
})

console.info(`${BLEND} を見張っている。Blender で保存すると書き出す。`)
void exportStage()

watch(BLEND, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void exportStage(), SETTLE)
})
