/**
 * 太陽の影は**動かない物だけを 1 度焼く**。
 *
 * 影マップは毎フレーム描き直すのが three の既定で、影を落とす物 (街の 600 個ほどの
 * メッシュ) が毎フレーム光の視点からも描かれていた。太陽もカメラの枠も動かない
 * (stage.ts の fitShadowToStage) ので、街の影は 1 度描けば変わらない。
 *
 * そこで影マップの自動更新を止め、**動かない物が増えたり減ったりした時だけ**
 * ここへ知らせて描き直す (クレイモア・囮・走査装置を置いた / 消えた)。
 * 動く物 (人・箱・武器・投げ物) は影マップに入れない — 入れると焼いた瞬間の
 * 姿がその場に残る。人の影は足元の丸い影 (actor/blobShadow.ts) が受け持つ。
 */
const listeners = new Set<() => void>()

/** 描き直しの合図を受け取る側 (Game が太陽の needsUpdate を立てる) */
export function onStaticShadowRefresh(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 動かない物を置いた / 消した側が呼ぶ。次のフレームで影マップが 1 度描き直される */
export function refreshStaticShadows(): void {
  for (const listener of listeners) listener()
}
