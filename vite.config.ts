import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import solid from 'vite-plugin-solid'

/**
 * public/models 以下の .glb が変わったらページ全体を読み直す。
 *
 * モデルの読み込み結果は assets.ts のモジュール変数にキャッシュしている。
 * HMR で再評価されるのは編集したモジュールだけなので、glb を差し替えても
 * 古い解析結果が残り続ける。変換し直すたびに手でハードリロードするのは
 * 忘れやすく、しかも「古いモデルのまま動いている」ことに気づきにくい。
 */
function reloadOnModelChange(): Plugin {
  return {
    name: 'reload-on-model-change',
    configureServer(server: ViteDevServer) {
      server.watcher.add('public/models')
      const reload = (file: string) => {
        if (!file.endsWith('.glb')) return
        server.config.logger.info(`モデルが変わったので再読み込み: ${file}`)
        // Vite 6 以降は server.hot、それ以前は server.ws
        const channel = server.hot ?? server.ws
        channel?.send({ type: 'full-reload' })
      }
      // 削除も拾う。消したのに古い解析結果が残り続けるのを防ぐ。
      server.watcher.on('change', reload)
      server.watcher.on('unlink', reload)
      server.watcher.on('add', reload)
    },
  }
}

export default defineConfig({
  plugins: [solid(), reloadOnModelChange()],
  resolve: {
    // three/examples/jsm/* を import すると Vite が three をもう一つ取り込み、
    // クラスが二重定義されて instanceof や内部の型判定が壊れる。1 つに寄せる。
    dedupe: ['three'],
  },
  server: {
    // 5173 は他プロセス (Docker) が掴んでいることがある。URL を固定する。
    port: 5174,
    strictPort: true,
    // 既定では localhost しか待ち受けないので、同じ Wi-Fi の別の端末から届かない。
    // 対戦は別の機械から繋ぐのが前提なので、全インターフェースで待ち受ける。
    host: true,
  },
})
