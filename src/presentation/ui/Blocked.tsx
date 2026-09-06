import { For, onCleanup, onMount, Show } from 'solid-js'
import { asset } from '../scene/assets'
import './Blocked.css'

/**
 * 断りの画面。**ここから先へは進ませない。**
 *
 * --- 断り方を 1 つに寄せてある ---
 * 描けない機械 (GpuBlocked) と、遅れが直らない人 (domain/match/lag.ts) の
 * 2 つが使う。**どちらも「あなたのせいで他の人の画面が壊れる」**という同じ
 * 理由で止めているので、出方まで同じにする。
 *
 * 別々に作ると、片方だけ音が出なかったり、片方だけ直し方が無かったりする。
 * 実際、遅れのほうを別に作りかけて**音も直し方も無い板**になっていた。
 *
 * --- 断るだけにしない ---
 * **直し方まで出す。** 原因はたいてい環境の側で、直せば普通に遊べる。
 * 何が悪いか分からないまま締め出されるのが一番たちが悪い。
 */
export default function Blocked(props: {
  title: string
  lede: string
  /** 直し方。上から順に試す想定 */
  steps: string[]
  /** 手がかり。問い合わせや検索に使える実名 (描画器の名前など) */
  detail?: { key: string; value: string }
  note: string
}) {
  /**
   * 断りの音。
   *
   * **ブラウザは操作なしの自動再生を止める。** この画面は出た瞬間に描かれる
   * ので、素直に鳴らすと大抵は弾かれる。弾かれたら諦めるのではなく、最初に
   * 触った瞬間に鳴るよう仕掛け直す — 読んでいる人は必ずどこかをクリックする
   * かキーを押すので、そこで鳴る。
   *
   * 鳴らなくても画面は成立するので、失敗は握り潰してよい。
   */
  let audio: HTMLAudioElement | null = null
  const armed: (() => void)[] = []

  onMount(() => {
    audio = new Audio(asset.audio('error1.mp3'))
    audio.volume = 0.7

    void audio.play().catch(() => {
      // 自動再生を断られた。**最初の操作**で 1 回だけ鳴らす。
      // 両方に仕掛けるので、片方が発火したらもう片方も外す (二重に鳴らさない)
      const fire = () => {
        for (const disarm of armed) disarm()
        armed.length = 0
        void audio?.play().catch(() => {})
      }
      for (const kind of ['pointerdown', 'keydown'] as const) {
        window.addEventListener(kind, fire)
        armed.push(() => window.removeEventListener(kind, fire))
      }
    })
  })

  onCleanup(() => {
    for (const disarm of armed) disarm()
    audio?.pause()
    audio = null
  })

  return (
    <div class="blocked">
      <div class="blocked-panel">
        <div class="blocked-title">{props.title}</div>
        <p class="blocked-lede">{props.lede}</p>

        <ol class="blocked-steps">
          <For each={props.steps}>{(step) => <li>{step}</li>}</For>
        </ol>

        {/* 実名を出す。問い合わせや検索の手がかりになる */}
        <Show when={props.detail}>
          <div class="blocked-detail">
            <span class="blocked-key">{props.detail?.key}</span>
            <code>{props.detail?.value}</code>
          </div>
        </Show>

        <p class="blocked-note">{props.note}</p>
      </div>
    </div>
  )
}
