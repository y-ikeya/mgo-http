import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { MODES, type Mode } from '../../domain/match/room'
import { t } from '../../i18n'
import type { Team } from '../../domain/player/player'
import './Orders.css'

/**
 * 試合が始まった瞬間に出す指令。**何をすれば勝ちかを、一度だけ言う。**
 *
 * --- なぜ要るか ---
 * 始まった合図はカウントダウンが消えることだけで、**何をする試合なのかは
 * どこにも出ていなかった。** 個人戦とチーム戦で敵味方が変わるのに、それが
 * 分かるのは名前の色だけ。入ったばかりの人は撃っていい相手を探すところから
 * 始まる。
 *
 * --- いつ出して、いつ消えるか ---
 * **数えている間だけ。** 数え終わるまでは誰も動けないので、その時間はもともと
 * 空いている — 塞いでよいのはそこだけ。始まってから出していた頃は、読んで
 * いる間に撃たれた。
 *
 * 出しておく長さを持たない。**数え終わるまでが出しておく長さ。** 秒数を別に
 * 持つと、数え方を変えたときに片方だけずれる。
 */
export default function Orders(props: {
  mode: Mode
  team: Team | 0 | undefined
  /** 試合の段階。countdown の間だけ出して、playing で退く */
  phase: string | undefined
}) {
  const [showing, setShowing] = createSignal(false)
  const [leaving, setLeaving] = createSignal(false)
  let timers: ReturnType<typeof setTimeout>[] = []

  const clear = () => {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  /*
   * **数えている間に出して、始まった瞬間に退く。**
   *
   * 始まってから出していた頃は、読んでいる間に撃たれた。数え終わるまでは
   * 誰も動けないので、**その時間はもともと空いている** — 塞いでよいのは
   * そこだけ。
   *
   * 出しておく長さを決めない。**数え終わるまでが出しておく長さ**なので、
   * 秒数を別に持つと数え方を変えたときに片方だけずれる。
   */
  let was: string | undefined
  createEffect(() => {
    const now = props.phase
    const before = was
    was = now

    if (now === 'countdown') {
      clear()
      setLeaving(false)
      setShowing(true)
      return
    }
    // 数え終わって始まった。**割れて退く**
    if (before === 'countdown' && now === 'playing') {
      clear()
      setLeaving(true)
      timers.push(setTimeout(() => setShowing(false), LEAVE_MS))
      return
    }
    // 数えるのが途中で止まった (人が抜けたなど)。**待たずに消す**
    if (before === 'countdown') {
      clear()
      setShowing(false)
      setLeaving(false)
    }
  })

  onCleanup(clear)

  /** 自分の陣営。個人戦では色を持たないので中立の色で出す */
  const side = () => (props.team === 'red' ? 'red' : props.team === 'blue' ? 'blue' : 'solo')

  /**
   * 何をすれば勝ちか。**モードで変わる。**
   *
   * チーム戦は相手の色を名指しする。個人戦は名指しできない (全員が敵)。
   */
  const order = () => {
    if (!MODES[props.mode].teams) return t('orders.dm')
    return props.team === 'red' ? t('orders.tdm.blue') : t('orders.tdm.red')
  }

  const heading = () =>
    props.team === 'red' ? 'RED' : props.team === 'blue' ? 'BLUE' : MODES[props.mode].id

  return (
    <Show when={showing()}>
      <div class="orders" classList={{ [`orders-${side()}`]: true, 'orders-leaving': leaving() }}>
        <div class="orders-band">
          <div class="orders-heading">{heading()}</div>
          <div class="orders-rule" />
          <div class="orders-text">{order()}</div>
        </div>
      </div>
    </Show>
  )
}

/**
 * 消えるのにかける時間 (ms)。縞に割れて広がりながら薄れる。
 *
 * **見ている物ではなく、退く物。** 長いと「まだ何か出ている」が続く。
 * 割れ始めたと分かる程度に見えていれば足りる。
 *
 * Orders.css の animation とここが揃っていること。
 */
const LEAVE_MS = 600
