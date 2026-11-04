// glb を gltfpack で詰める (量子化 + meshopt 圧縮)。兵士のモデル用。
//
// ステージは書き出しの最後に export_stage.py が同じことをしている。こちらは
// 変換済みの glb を後から詰めるための受け口で、convert_character.py の最後と
// フラグを揃えてある。glb のバイト列を直接読む道具は圧縮前の素の glb 専用で、
// 詰めた物は道具の側で先に弾く (戻し方は unpack_glb.js と README)。
//
// 使い方: bun tools/pack_glb.js <入力.glb> [出力.glb]
//         出力を省くと入力を置き換える。

import { existsSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { GLTFPACK_FLAGS } from './gltfpack_flags.js'

const [input, outputArg] = process.argv.slice(2)
if (!input) throw new Error('使い方: bun tools/pack_glb.js <入力.glb> [出力.glb]')
const output = outputArg ?? input
const packed = output.replace(/\.glb$/, '.packed.glb')
if (packed === output) throw new Error('出力は .glb でないと gltfpack が断る')

const gltfpack = path.join(import.meta.dir, '..', 'node_modules', '.bin', 'gltfpack')
if (!existsSync(gltfpack)) throw new Error('gltfpack が無い (bun install)')

// 加工のフラグは gltfpack_flags.js (unpack_glb.js と共通)。ここで足すのは
// 圧縮の -cc だけ。土台のフラグは export_stage.py と揃えてある
const proc = Bun.spawnSync([
  gltfpack, '-i', input, '-o', packed, '-cc', ...GLTFPACK_FLAGS,
])
if (proc.exitCode !== 0) {
  throw new Error(`gltfpack 失敗: ${proc.stderr.toString().slice(0, 200)}`)
}
const before = statSync(input).size
renameSync(packed, output)
console.log(`詰めた: ${(before / 1e6).toFixed(1)}MB → ${(statSync(output).size / 1e6).toFixed(1)}MB (${output})`)
