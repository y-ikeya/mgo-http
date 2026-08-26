/**
 * ステージの .blend を見張って、保存されたら glb を書き出す。
 *
 *   bun run stage         (tools/stage_*.blend が 1 つならそれ)
 *   bun run stage mall    (tools/stage_mall.blend)
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

import { readdirSync, watch } from 'node:fs'

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const DIR = 'tools'
const SCRIPT = 'tools/export_stage.py'

/**
 * ステージの元データの名前。**`stage_` で始まる .blend。**
 *
 * 名前で見分けるのは、`tools/` に他の .blend (props の変換元など) が混ざるため。
 * 札で宣言する、という他の決めごとと同じ形にしてある。
 *
 * どれを書き出すかは引数で選ぶ。省いたら 1 つしか無いときだけ黙って選び、
 * 複数あるなら**選ばせる** — 「どれが乗っているか分からない」が一番困る。
 *
 *     bun run stage           1 つしか無ければそれ
 *     bun run stage mall      tools/stage_mall.blend
 */
const PREFIX = 'stage_'

function stages(): string[] {
  return readdirSync(DIR)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.blend'))
    .sort()
}

function pick(): string {
  const found = stages()
  if (found.length === 0) {
    console.error(`${DIR}/${PREFIX}*.blend が無い。先に make_stage.py で叩き台を作る`)
    process.exit(1)
  }
  const asked = process.argv[2]
  if (asked) {
    const name = asked.endsWith('.blend') ? asked : `${PREFIX}${asked}.blend`
    if (!found.includes(name)) {
      console.error(`${name} が無い。あるのは: ${found.join(' / ')}`)
      process.exit(1)
    }
    return `${DIR}/${name}`
  }
  if (found.length > 1) {
    console.error(`どれを書き出すか選ぶ: ${found.map((n) => n.slice(PREFIX.length, -6)).join(' / ')}`)
    console.error('  bun run stage mall')
    process.exit(1)
  }
  return `${DIR}/${found[0]}`
}

const BLEND = pick()

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

console.info(`${BLEND} を見張っている。Blender で保存すると書き出す。`)
void exportStage()

watch(BLEND, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void exportStage(), SETTLE)
})
