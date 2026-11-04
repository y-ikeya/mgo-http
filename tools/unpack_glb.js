// meshopt 圧縮した glb を、バイト列を読める形に戻す。pack_glb.js の逆。
//
// clip を足す系の道具 (merge_clip / retime_clip / split_clip など) は圧縮前の
// glb 専用なので、リポジトリの兵士 glb を触るときは先にこれを通す。
// gltfpack は圧縮を解いて書き直せる。量子化 (頂点や型のキーの丸め) は
// 残るので、戻した物は「読める作業用」で、元データではない。
//
// 使い方: bun tools/unpack_glb.js <入力.glb> [出力.glb]
//         出力を省くと入力を置き換える。

import { existsSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

const [input, outputArg] = process.argv.slice(2)
if (!input) throw new Error('使い方: bun tools/unpack_glb.js <入力.glb> [出力.glb]')
const output = outputArg ?? input
const unpacked = output.replace(/\.glb$/, '.unpacked.glb')
if (unpacked === output) throw new Error('出力は .glb でないと gltfpack が断る')

const gltfpack = path.join(import.meta.dir, '..', 'node_modules', '.bin', 'gltfpack')
if (!existsSync(gltfpack)) throw new Error('gltfpack が無い (bun install)')

// -c を付けなければ圧縮は掛からない。-kn/-km/-ke は詰めたときと同じく
// 名前と素材と extras を落とさないため
const proc = Bun.spawnSync([
  gltfpack, '-i', input, '-o', unpacked, '-kn', '-km', '-ke',
])
if (proc.exitCode !== 0) {
  throw new Error(`gltfpack 失敗: ${proc.stderr.toString().slice(0, 200)}`)
}
const before = statSync(input).size
renameSync(unpacked, output)
console.log(`戻した: ${(before / 1e6).toFixed(1)}MB → ${(statSync(output).size / 1e6).toFixed(1)}MB (${output})`)
