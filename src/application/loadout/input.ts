/**
 * **支度の入力。** 支度の画面 (待合室・装備) で、鍵盤とパッドの押下を「何をするか」に直す状態機械。
 *
 *   - 指している枠 (上下で動くカーソル)
 *   - READY の長押し (READY_HOLD 秒)。取り消しは 1 押し
 *   - ルールの説明の開け閉め。開いている間は Enter / × で閉じるだけ
 *
 * --- なぜ外に出したか (2026-11-03 本人「状態機械として外へ出します。これやって」) ---
 * Game.ts の中にあり、描画器が無いと動かないクラスに閉じ込められていた。長押しと
 * 取り消しの取り合い (長押しで READY にした押下を離した瞬間に外れる、説明を閉じた押下が
 * そのまま長押しに数えられる) は、ここだけで試せる。
 *
 * three も入力の仕組みも知らない。1 フレームぶんの押下 (LoadoutKeys) を受けて、
 * **やること (LoadoutEffect) を返す。** 実際に装備を替える・送るのは呼ぶ側
 */

/** READY に要る長押しの長さ (秒) */
export const READY_HOLD = 0.6

export interface LoadoutInput {
  /** 指している枠の番号。並ぶ物は窓で変わるので、名前に直すのは呼ぶ側 (focusAt) */
  at: number
  /** READY を押し始めた時刻 (ms)。0 なら押していない */
  holdSince: number
  /** 長押しで READY にした (説明を閉じた) 押下を、まだ離していない */
  releaseWait: boolean
  /** ルールの説明が開いている */
  briefing: boolean
}

export function newLoadoutInput(): LoadoutInput {
  return { at: 0, holdSince: 0, releaseWait: false, briefing: false }
}

/** 1 フレームぶんの押下。tapped は押した瞬間、held は押している間 */
export interface LoadoutKeys {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  /** Enter / × を押した瞬間 */
  confirm: boolean
  /** Enter / × を押している */
  confirmHeld: boolean
  /** 押された数字キーの番号 (0 始まり)。無ければ null */
  slot: number | null
}

/** その時の画面の様子。決めるのは呼ぶ側 (レプリカ) */
export interface LoadoutScene {
  /** 試合前の支度 (待合室) か。違えば倒れて次に湧くまでの装備の画面 */
  ready: boolean
  /** 並んでいる枠の数 */
  rows: number
  /** 自分が READY 済み (サーバーが返した名簿で決まる) */
  selfReady: boolean
}

export type LoadoutEffect =
  /** 指している枠の中を左右に送る */
  | { kind: 'step'; step: 1 | -1 }
  /** READY にする / 取り消す */
  | { kind: 'ready'; ready: boolean }
  /** 戦場へ出る (装備の画面の OK) */
  | { kind: 'spawn' }
  /** 数字キーで名指しした */
  | { kind: 'slot'; index: number }

/** 指している枠。窓が切り替わって番号が余ったら最後の枠に寄せる */
export function focusAt(input: LoadoutInput, rows: number): number {
  return Math.max(0, Math.min(input.at, rows - 1))
}

/** READY の長押しの進み (0〜1)。画面の READY のボタンが満ちていく */
export function holdRatio(input: LoadoutInput, now: number): number {
  if (input.holdSince === 0) return 0
  return Math.min(1, (now - input.holdSince) / (READY_HOLD * 1000))
}

/** 説明を開く。待合室のボタンからも、支度に入った所でも */
export function openBriefing(input: LoadoutInput): void {
  input.briefing = true
}

/** 説明を閉じる (画面の OK)。**押したままの押下は READY の長押しに数えない** */
export function closeBriefing(input: LoadoutInput): void {
  input.briefing = false
  input.releaseWait = true
}

/**
 * 1 フレーム進める。
 *
 * @param now 時刻 (ms)。長押しを測る
 */
export function stepLoadoutInput(
  input: LoadoutInput,
  keys: LoadoutKeys,
  scene: LoadoutScene,
  now: number,
): LoadoutEffect[] {
  // 説明が開いている間は閉じるだけ。スキルも READY も触らせない
  if (input.briefing) {
    if (keys.confirm) closeBriefing(input)
    return []
  }
  const effects: LoadoutEffect[] = []
  /*
   * 十字キーと矢印キー。**上下で枠、左右でその中。** パッドしか無い人はここを通らないと
   * 何も選べない
   */
  const rows = Math.max(1, scene.rows)
  if (keys.down) input.at = (focusAt(input, rows) + 1) % rows
  if (keys.up) input.at = (focusAt(input, rows) + rows - 1) % rows
  if (keys.right) effects.push({ kind: 'step', step: 1 })
  if (keys.left) effects.push({ kind: 'step', step: -1 })
  /*
   * Enter / ×。**支度の段階では READY の切り替え、それ以外は湧く。** 押す場所が同じなので
   * 同じキー — 画面の一番下のボタンが READY から OK に変わるだけ
   */
  if (scene.ready) {
    /*
     * **READY は長押し。** 1 押しで入っていた頃は、スキルを選んでいるつもりの × で READY に
     * なり、相手が先に押していると支度が終わった (2026-10-09 本人)。取り消しは 1 押し。
     * 長押しで READY にしたその押下を離すまでは取り消しを読まない — 離した瞬間が 1 押しとして
     * 立ち、押し続けて離すと解除されていた
     */
    if (input.releaseWait) {
      if (!keys.confirmHeld) input.releaseWait = false
    } else if (scene.selfReady) {
      input.holdSince = 0
      if (keys.confirm) effects.push({ kind: 'ready', ready: false })
    } else if (keys.confirmHeld) {
      if (input.holdSince === 0) input.holdSince = now
      if (now - input.holdSince >= READY_HOLD * 1000) {
        input.holdSince = 0
        input.releaseWait = true
        effects.push({ kind: 'ready', ready: true })
      }
    } else {
      input.holdSince = 0
    }
  } else if (keys.confirm) {
    effects.push({ kind: 'spawn' })
  }
  if (keys.slot !== null) effects.push({ kind: 'slot', index: keys.slot })
  return effects
}
