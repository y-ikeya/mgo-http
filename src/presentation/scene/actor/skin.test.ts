import { describe, expect, test } from 'bun:test'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { missingClips } from './animation'
import { SKIN_FILES } from './skin'

/**
 * **どのモデルにも型が揃っていること。**
 *
 * 欠けていても代用に落ちるだけで、その状態のときだけ別の型が流れる。握りは
 * その型に合わせて詰めてあるので銃がずれるが、**見た目で気づくまで分からない。**
 *
 * 実際に踏んだ: 雷電に knee_relaxed / knee_ready が無く、しゃがむと古い
 * crouch_idle が流れて銃口が上を向いた。試写は別のモデル (soldier) を読んで
 * いたので、本番と突き合わせるまで出なかった。
 *
 * **モデルを足すのは Blender の仕事で、足りているかは目で見ても分からない。**
 * ここで全部のモデルを開いて、表に書いてある型が入っているかを見る。
 */
describe('モデルごとの型', () => {
  for (const file of SKIN_FILES) {
    test(`${file}.glb に足りない型が無い`, async () => {
      const gltf = await new GLTFLoader().parseAsync(
        await Bun.file(`public/models/${file}.glb`).arrayBuffer(),
        '',
      )
      expect(missingClips(gltf.animations)).toEqual([])
    })
  }
})
