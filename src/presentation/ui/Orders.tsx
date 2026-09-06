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
 * --- なぜ消えるか ---
 * 出しっぱなしにすると画面の真ん中が塞がる。**始まった直後は動かない時間**
 * なので、そこだけ塞いで、動き出す頃には消えている。
 */
export default function Orders(props: {
  mode: Mode
  team: Team | 0 | undefined
  /** 試合の段階。playing に変わった瞬間に出す */
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
   * **段階が playing へ移った瞬間だけ。**
   *
   * playing の間ずっと出す条件にすると、途中から入った人にも出るし、
   * 画面を読み直すたびに出る。移り変わりを見る。
   */
  let was: string | undefined
  createEffect(() => {
    const now = props.phase
    const started = now === 'playing' && was !== 'playing' && was !== undefined
    was = now
    if (!started) return
    clear()
    setLeaving(false)
    setShowing(true)
    timers.push(setTimeout(() => setLeaving(true), HOLD_MS))
    timers.push(setTimeout(() => setShowing(false), HOLD_MS + LEAVE_MS))
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

/** 出しておく時間 (ms)。**始まった直後の動かない時間**に収まる長さ */
const HOLD_MS = 3200

/** 消えるのにかける時間 (ms)。縞に割れて広がりながら薄れる */
const LEAVE_MS = 900
