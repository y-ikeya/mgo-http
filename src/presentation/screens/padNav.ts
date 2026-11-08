import { onCleanup, onMount } from 'solid-js'

/**
 * **遊びの外の画面 (最初の画面・部屋の一覧) をパッドで動かす** (2026-11-08 本人「rooms とかでも pad つかえるようにしてよ」)。
 *
 * 十字キー / 左スティックで、画面の中のボタンへ**見た目の位置で**上下左右にフォーカスを送る。
 * × で押し、○ で前の画面へ戻る。遊びの最中の割り当て (infra/input の PAD_BUTTONS) と
 * 同じ指: × は決定、○ は戻る。
 *
 * --- × は離した時に押す ---
 * 押した時に押すと、部屋に入った先の遊びの画面が「押されたままの ×」を拾う。
 * 遊びの側は装備の画面で × を決定に使う (Game の updateLoadoutKeys)。
 *
 * --- 移動先から外す物 ---
 * `data-pad-skip` を付けたボタン (Logout)。押し間違いで締め出されると戻るのが面倒
 */

/** 標準マッピングのボタン番号 (infra/input の PAD_BUTTONS と同じ) */
const CROSS = 0
const CIRCLE = 1
const UP = 12
const DOWN = 13
const LEFT = 14
const RIGHT = 15
/** スティックをこれより倒したら 1 歩 */
const STICK = 0.5
/** 倒し続けた時、最初の 1 歩から次までと、その後の間隔 (ms) */
const REPEAT_FIRST = 350
const REPEAT_NEXT = 130

type Dir = 'up' | 'down' | 'left' | 'right'

export interface PadNavOptions {
  /** ○。無ければ何もしない */
  back?: () => void
}

/** 画面に出ている、押せるボタン */
function targets(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('button:not(:disabled):not([data-pad-skip]), a[href]')].filter(
    (el) => el.getClientRects().length > 0,
  )
}

/**
 * 今の所から dir の向きで一番近い物。**向きの距離に、横ずれを重く足して**比べる —
 * 真下の物を、斜め下の近い物より先に選ぶ
 */
function nearest(from: HTMLElement, all: HTMLElement[], dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect()
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of all) {
    if (el === from) continue
    const b = el.getBoundingClientRect()
    const dx = b.left + b.width / 2 - ax
    const dy = b.top + b.height / 2 - ay
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)
    if (along <= 1) continue
    const score = along + across * 2
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

/** 画面が出ている間だけパッドを読む。Solid の部品の中で呼ぶ */
export function usePadNav(options: PadNavOptions = {}): void {
  let frame = 0
  let previous: boolean[] = []
  /** 最初のコマは控えるだけ。前の画面から押されたままの物で押さない */
  let primed = false
  let held: Dir | null = null
  let nextAt = 0

  const markPad = () => {
    document.documentElement.dataset.input = 'pad'
  }
  const markPointer = () => {
    delete document.documentElement.dataset.input
  }

  const move = (dir: Dir) => {
    const all = targets()
    if (all.length === 0) return
    const current = document.activeElement as HTMLElement | null
    // 何も選んでいなければ、最初の 1 歩は先頭を選ぶだけ
    const next = current && all.includes(current) ? nearest(current, all, dir) : all[0]!
    if (!next) return
    next.focus()
    next.scrollIntoView({ block: 'nearest' })
  }

  const poll = (now: number) => {
    frame = requestAnimationFrame(poll)
    const pad = [...navigator.getGamepads()].find((p) => p?.connected)
    if (!pad) return
    const down = pad.buttons.map((b) => b.pressed)
    if (!primed) {
      primed = true
      previous = down
      return
    }
    const pressed = (i: number) => down[i] === true && previous[i] !== true
    const released = (i: number) => down[i] !== true && previous[i] === true

    // 十字キーとスティックを 1 つの向きにまとめる。十字キーを先に見る
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    const dir: Dir | null = down[UP]
      ? 'up'
      : down[DOWN]
        ? 'down'
        : down[LEFT]
          ? 'left'
          : down[RIGHT]
            ? 'right'
            : Math.abs(y) >= STICK && Math.abs(y) >= Math.abs(x)
              ? y < 0
                ? 'up'
                : 'down'
              : Math.abs(x) >= STICK
                ? x < 0
                  ? 'left'
                  : 'right'
                : null
    if (dir !== held) {
      held = dir
      if (dir) {
        markPad()
        move(dir)
        nextAt = now + REPEAT_FIRST
      }
    } else if (dir && now >= nextAt) {
      move(dir)
      nextAt = now + REPEAT_NEXT
    }

    if (pressed(CROSS) || pressed(CIRCLE)) markPad()
    if (released(CROSS)) {
      const current = document.activeElement as HTMLElement | null
      if (current && targets().includes(current)) current.click()
      else move('down')
    }
    if (released(CIRCLE)) options.back?.()
    previous = down
  }

  onMount(() => {
    frame = requestAnimationFrame(poll)
    window.addEventListener('mousemove', markPointer)
    window.addEventListener('mousedown', markPointer)
  })
  onCleanup(() => {
    cancelAnimationFrame(frame)
    window.removeEventListener('mousemove', markPointer)
    window.removeEventListener('mousedown', markPointer)
    markPointer()
  })
}
