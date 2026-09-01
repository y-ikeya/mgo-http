/**
 * 押している時間から、単押しと長押しを分ける。
 *
 * --- なぜ入力から切り出すか ---
 * ここは装置に触らない。**押しているかどうか (真偽) と経過時間だけ**で決まる
 * ので、鍵盤もパッドも要らずに確かめられる。入力そのもの (index.ts) は
 * window の出来事を聞くので、画面を出さないと動かせない。
 *
 * --- 分け方 ---
 *
 *     長押し  押している途中で立てる。**離してから立てると、押していた時間ぶんの
 *             遅れが動作に乗る** — 避ける動作でそれは致命的
 *     単押し  離した時に立てる。押している間はまだどちらか決まらない
 *
 * 「しゃがみが 0.17 秒遅れる」のはこの形の代償で、避けられない。避ける動作の
 * ほうが遅れてはいけない、という優先順で決めてある。
 */

/** 1 つの操作ぶんの状態 */
export interface Hold {
  /** 押している時間 (秒)。離していれば 0 */
  held: number
  /** その押下でもう長押しが立ったか。1 回の押下につき 1 度だけ効かせるため */
  fired: boolean
  /** 離した瞬間に立つ。読まれるまで残る */
  tapped: boolean
}

export function newHold(): Hold {
  return { held: 0, fired: false, tapped: false }
}

/**
 * 1 フレーム進める。
 *
 * @param down いま押されているか
 * @param dt 前のフレームからの秒数
 * @param threshold 長押しと見なす時間 (秒)。**無ければ長押しを持たない操作**
 */
export function advanceHold(state: Hold, down: boolean, dt: number, threshold?: number): void {
  if (!down) {
    // 離した。長押しが立っていなければ単押しだった
    if (state.held > 0 && !state.fired) state.tapped = true
    state.held = 0
    state.fired = false
    return
  }
  state.held += dt
  if (threshold !== undefined && state.held >= threshold) state.fired = true
}

/** 単押しを取る。**消費する** — 1 回の押下につき 1 回だけ */
export function takeTap(state: Hold): boolean {
  if (!state.tapped) return false
  state.tapped = false
  return true
}
