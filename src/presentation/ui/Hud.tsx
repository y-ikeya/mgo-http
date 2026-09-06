import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { CRITICAL_HEALTH } from '../../domain/rule/damage'
import { t } from '../../i18n'
import { HELD, type HeldId } from '../../domain/item/held'
import { MODES } from '../../domain/match/room'
import { isTranquilizer } from '../../domain/item/weapons'
import type { GameStats } from '../scene/Game'
import Orders from './Orders'
import './Hud.css'

/**
 * HUD オーバーレイ。Solid が担当するのはこの層だけで、3D シーンには一切触れない。
 * 現時点では動作確認用の数値表示とクロスヘアのみ。警戒度メーターやミニマップはここに足していく。
 */
/**
 * 一覧の 1 枚。
 *
 * **武器カードと同じ大きさ・同じ並び。** 選んでいる物 (角のカード) と大きさが
 * 違うと、送るたびに列の形が変わって目が落ち着かない。数を上、名前を下にするのも
 * カードと同じ。
 */
function BrowseItem(props: { item: { id: HeldId; n: number | null } }) {
  return (
    <div
      class="hud-browse-item"
      classList={{ 'hud-browse-item-tranq': isTranquilizer(props.item.id) }}
    >
      <div class="hud-browse-n">{props.item.n ?? ''}</div>
      <div class="hud-browse-name">{HELD[props.item.id].label}</div>
    </div>
  )
}

/** 1 段送ったときに滑る距離 (px)。カード 1 枚より小さくして「動いた」だけを見せる */
const BROWSE_SLIDE = 26

export default function Hud(props: { stats: GameStats | null; selfId: string }) {
  const locked = () => props.stats?.locked ?? false
  // 残り時間の表示だけは秒ごとに動かす。stats は 0.1 秒ごとに来るが、
  // 終了時刻からの引き算なので、こちらでも時計を進める必要がある。
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => clearInterval(timer))

  const phase = () => props.stats?.match?.phase
  /** その部屋のルール。届く前は陣営戦として描く (いちばん普通の形) */
  const mode = () => props.stats?.match?.mode ?? 'TDM'
  const teams = () => MODES[mode()].teams
  /** 1 人でも成立する部屋か。**相手待ちを出さない** (練習・休憩) */
  const soloRoom = () => MODES[mode()].solo
  const won = () => {
    const winner = props.stats?.match?.winner
    return winner !== undefined && winner !== 'draw' && winner === props.stats?.team
  }
  const lost = () => {
    const winner = props.stats?.match?.winner
    return winner !== undefined && winner !== 'draw' && winner !== props.stats?.team
  }
  /**
   * カードに出す物。
   *
   * **一覧を開いている間は、選んでいる物を映す。** カードが選択の印を兼ねるので、
   * 送るたびに中身が入れ替わって「これを選んだらこうなる」が見える。
   */
  const held = () => {
    const browsing = props.stats?.browsing
    // 武器の一覧を送っている間だけ、カードが選んでいる物を映す。
    // 道具の一覧を送っても武器のカードは変わらない
    if (browsing && props.stats?.browsingFamily === 'weapon') {
      return browsing.items[browsing.at]?.id ?? props.stats.weaponHeld
    }
    return props.stats?.weaponHeld ?? 'rifle'
  }
  /** 武器の一覧を送っている間、いま指している物。それ以外は null */
  const browsedItem = () => {
    const browsing = props.stats?.browsing
    if (!browsing || props.stats?.browsingFamily !== 'weapon') return null
    return browsing.items[browsing.at] ?? null
  }

  /**
   * 左下のカードに出す道具。
   *
   * **一覧を送っている間は、指している物を映す。** 武器のカード (held) と同じ
   * ドメインルール — 角のカードが選択の印を兼ねているので、送っても変わらないと
   * 「これを選んだらこうなる」が読めない (ずっと NONE のままに見えていた)。
   */
  const shownTool = (): HeldId => {
    const browsing = props.stats?.browsing
    if (browsing && props.stats?.browsingFamily === 'tool') {
      return browsing.items[browsing.at]?.id ?? props.stats.tool
    }
    return props.stats?.tool ?? 'none'
  }

  const heldLabel = () => HELD[held()].label
  /** 麻酔銃を手にしているか。**色で殺傷と分ける** */
  const heldIsTranq = () => isTranquilizer(held())
  const heldIsGun = () => HELD[held()].shoots

  /**
   * カードの大きい数字。**持っている弾の総数** (装填分 + 予備)。
   *
   * 予備だけを出すと、弾倉に 30 発あるのに 0 と出る瞬間がある。数字は
   * 「あと何発撃てるか」の答えでいてほしい。装填の内訳は下の目盛りが持つ。
   *
   * 一覧を送っている間は、指している銃の総数 (サーバーが総数で載せている)。
   */
  const heldTotal = () => browsedItem()?.n ?? (props.stats?.ammo ?? 0) + (props.stats?.reserve ?? 0)

  /** 投げ物の残り。銃なら null */
  const heldCount = () => {
    const stats = props.stats
    if (!stats || heldIsGun()) return null
    if (held() === 'magazine') return stats.throwables
    if (held() === 'grenade' || held() === 'claymore') return stats.grenades
    return null
  }

  /**
   * 装填弾の目盛り。撃った分から消えていく。
   *
   * 弾倉の大きさぶん並べる。P90 のように 50 発ある銃だと細かくなるが、
   * **数字を読まずに残りが分かる**ことのほうが要る。
   */
  const ticks = () => {
    const browsed = browsedItem()
    const size = browsed?.mag ?? props.stats?.magazine ?? 0
    const left = browsed?.loaded ?? props.stats?.ammo ?? 0
    return Array.from({ length: size }, (_, i) => i < left)
  }

  /**
   * 角の次に来る物の位置。
   *
   * **並びは輪になっている** (送ると端で回る) ので、最後を選んだら次は先頭。
   * 端で「次が無い」にすると、そこだけ左が空いて形が変わる。
   */
  const nextAt = () => {
    const browsing = props.stats?.browsing
    if (!browsing || browsing.items.length === 0) return -1
    return (browsing.at + 1) % browsing.items.length
  }

  /**
   * 角の左に出す物。**1 つだけ。**
   *
   * 何枚も左へ伸ばすと画面を横切るので、左は 1 枚に決めて残りは上へ積む
   * (weapons.png がそうなっていた)。
   */
  const beside = () => {
    const browsing = props.stats?.browsing
    const at = nextAt()
    if (!browsing || at < 0 || at === browsing.at) return null
    return browsing.items[at]
  }

  /*
   * 送った向きに滑らせる。
   *
   * **どちらへ動いたかが分からない**という指摘。カードの中身だけが入れ替わるので、
   * 上へ送ったのか下へ送ったのかが読めなかった。1 段ごとに、来た方向から
   * 滑り込ませる。
   *
   * Solid は中身が変わっても要素を作り直さないので、CSS の入場アニメーションは
   * 流れない。**送るたびに自分で 1 回流す** (Web Animations)。
   */
  let columnEl: HTMLDivElement | undefined
  let rowEl: HTMLDivElement | undefined
  let browsedAt = -1
  createEffect(() => {
    const at = props.stats?.browsing?.at
    if (at === undefined || (!columnEl && !rowEl)) {
      browsedAt = -1
      return
    }
    const from = browsedAt
    browsedAt = at
    if (from < 0 || from === at) return
    // 一覧は輪になっているので、端で回った分は近いほうの向きとして扱う
    const count = props.stats?.browsing?.items.length ?? 1
    const raw = at - from
    const step = Math.abs(raw) > count / 2 ? -Math.sign(raw) : Math.sign(raw)
    const shift = step * BROWSE_SLIDE
    // 武器は上下 (列)、道具は左右 (行) に伸びるので、滑る向きも合わせる
    const tool = props.stats?.browsingFamily === 'tool'
    const offset = tool ? `translateX(${-shift}px)` : `translateY(${shift}px)`
    /*
     * **入れ物ではなく、中の 2 つを動かす。**
     *
     * L 字の列と行はそれぞれ画面に絶対配置してある。入れ物に transform を掛けると
     * **そこが配置の基準になってしまい**、カードが画面の隅へ飛んで L 字が消えた。
     */
    for (const part of [columnEl, rowEl]) {
      part?.animate(
        [
          { transform: offset, opacity: 0.35 },
          { transform: 'translate(0, 0)', opacity: 1 },
        ],
        { duration: 130, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      )
    }
  })

  /** 角の上に積む物。選んでいる物と、左に出した物を除いた残り */
  const above = () => {
    const browsing = props.stats?.browsing
    if (!browsing) return []
    const skip = new Set([browsing.at, nextAt()])
    return browsing.items.filter((_, i) => !skip.has(i))
  }

  /** 眠りが明けるまで。眠っていなければ 0 */
  const asleep = () => props.stats?.asleep === true
  /**
   * 暗がりが開いている割合 (%)。**深いほど狭い。**
   *
   * 眠った瞬間は隅から中央近くまで黒く、時間が経つほど黒が隅へ引いていく。
   * 起きる直前には画面のほとんどが見えている。
   */
  const sleepOpen = () => {
    const depth = props.stats?.sleepDepth ?? 0
    return Math.round(6 + (1 - depth) * 94)
  }

  const health = () => {
    const max = props.stats?.maxHealth ?? 100
    return max > 0 ? ((props.stats?.health ?? max) / max) * 100 : 0
  }

  /** 残り時間。サーバーが持っている終了時刻から出す */
  const remaining = () => {
    const endsAt = props.stats?.match?.endsAt ?? 0
    return Math.max(0, Math.ceil((endsAt - now()) / 1000))
  }
  const clock = () => {
    const t = remaining()
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }

  return (
    <div class="hud">
      {/*
        残機と残り時間。画面上部の中央。
        自分の陣営を左に置かない。どちらが青でどちらが赤かが固定されているほうが、
        相手の画面と話が通じる。

        **数字は残機**で、減っていく。0 にした側が勝ち。
        種目名を上に置くのは、これから他の種目 (SNE / RES …) を足すため —
        入った部屋が何なのかが画面から読めるようにしておく。
      */}
      <Show when={phase() === 'playing' || phase() === 'over'}>
        <div class="hud-match" classList={{ 'hud-match-solo': !teams() }}>
          <span class="hud-mode">{mode()}</span>
          {/*
            陣営で分かれない部屋 (個人戦) は残機が 1 つ。左右に分けて出すと
            **味方が居るように読める**ので、真ん中に 1 つだけ出す。
          */}
          <Show
            when={teams()}
            fallback={<span class="hud-score hud-score-own">{props.stats?.match?.blue ?? 0}</span>}
          >
            <span
              class="hud-score hud-score-blue"
              classList={{ 'hud-score-own': props.stats?.team === 'blue' }}
            >
              {props.stats?.match?.blue ?? 0}
            </span>
          </Show>
          <span class="hud-clock">{clock()}</span>
          <Show when={teams()}>
            <span
              class="hud-score hud-score-red"
              classList={{ 'hud-score-own': props.stats?.team === 'red' }}
            >
              {props.stats?.match?.red ?? 0}
            </span>
          </Show>
        </div>
      </Show>

      {/*
        自分が光っている (個人戦の 1 位)。**位置が全員に漏れている。**

        勝っていることの代償なので、隠さずに出す — 気づかないまま追われるのは
        理不尽で、知っていれば動き方を変えられる。
      */}
      <Show when={props.stats?.leaking && phase() === 'playing'}>
        <div class="hud-leak">位置が漏れている</div>
      </Show>

      {/*
        人待ち。時計は動かない。

        **相手を待たない部屋では出さない** (練習・休憩)。1 人で成立するので、
        待っている物が無いのに「STANDBY」と出ると、始まらないのを待たされて
        いるように見える。段階が playing に固定される前の一瞬もここで消える
        (ドメインルールは domain/match/room.ts の solo)。
      */}
      <Show when={phase() === 'waiting' && !soloRoom()}>
        <div class="hud-standby">
          <div class="hud-standby-title">STANDBY</div>
          <div class="hud-standby-sub">
            {t('hud.waitingForOpponent')} &nbsp; {props.stats?.match?.present ?? 1} /{' '}
            {props.stats?.match?.required ?? 2}
          </div>
        </div>
      </Show>

      {/* 支度。湧き地点へ戻してから数える */}
      <Show when={phase() === 'countdown'}>
        <div class="hud-standby">
          <div class="hud-standby-count">{remaining()}</div>
          <div class="hud-standby-sub">{t('hud.startingSoon')}</div>
        </div>
      </Show>

      {/*
        始まった瞬間の指令。**何をすれば勝ちかを、一度だけ言う。**

        出す長さも消え方も Orders が持つ。ここは段階と陣営を渡すだけ。
      */}
      <Orders mode={mode()} team={props.stats?.team} phase={phase()} />

      {/* 決着。次の支度が始まるまでの間だけ出る */}
      <Show when={phase() === 'over'}>
        <div class="hud-result">
          <div
            class="hud-result-title"
            classList={{ 'hud-result-win': won(), 'hud-result-lose': lost() }}
          >
            {props.stats?.match?.winner === 'draw' ? 'DRAW' : won() ? 'VICTORY' : 'DEFEAT'}
          </div>
          <div class="hud-result-score">
            {props.stats?.match?.blue ?? 0} — {props.stats?.match?.red ?? 0}
          </div>
          <div class="hud-result-next">NEXT MATCH IN {remaining()}</div>
        </div>
      </Show>
      {/*
        左上の列。体力と、その下にキル表示。
        細かい数値 (FPS や座標) は調整パネルへ移した。対戦中に読むものではないので、
        視界の一等地を占めているのがおかしかった。
      */}
      {/*
        傷は画面の縁で見せる。数字やバーを出さないのは、体力を「読む」ものから
        「感じる」ものにするため。残りいくつかを正確に知る代わりに、
        視界が狭まっていくことで危うさが伝わる。

        ただしこの見せ方が成り立つのは、体力が回復する場合に限る。
        回復しないなら「あと何発耐えられるか」は判断に直結する情報なので、
        曖昧にすると押すか引くかを決められなくなる。
      */}
      <div
        class="hud-damage"
        classList={{ 'hud-damage-critical': health() <= CRITICAL_HEALTH }}
        style={{ opacity: `${1 - health() / 100}` }}
      />

      {/*
        麻酔を受けている。**曇るだけ。数字も棒も出さない。**

        棒を出していたが、撃ち合いの最中に読む人は居なかった。しかも眠って
        いる間は 0 のまま動かないので、空の枠が残るだけになる。

        効いているのは手ブレのほうで (scene/Game.ts)、こちらは「そろそろ
        危ない」を知らせるだけ。当たるかどうかには効かない。

        中央は残す。曇らせるのは視界の縁で、狙っている先まで見えなくなると
        撃ち合いにならない。
      */}
      <Show when={(props.stats?.stamina ?? 0) > 0.02 && !asleep()}>
        <div
          class="hud-drowsy"
          style={{ '--drowsy': `${(props.stats?.stamina ?? 0).toFixed(3)}` }}
        />
      </Show>

      {/*
        近くで爆ぜた。**画面がぼやけて、戻る。**

        カメラを揺らしていたが、**回すと画面が斜めに傾いて見えて**、殴られた
        のではなく「傾いた」に読めた。狙いが軸そのものなので (scene 側)、
        揺らせば狙いも動く。**目のほうを効かなくするほうが、爆風で頭を
        殴られた感じに近い。**

        keyed にしてあるので、爆ぜるたびに div ごと作り直される。**同じ場所で
        続けて爆ぜても掛かり直す** — class を付け替えるだけだと、既に流れて
        いる CSS の動きは最初へ戻らない。

        濃さと長さは CSS が持つ。scene から届くのは近さ (power) だけ。
      */}
      <Show when={props.stats?.shock} keyed>
        {(shock) => <div class="hud-shock" style={{ '--shock': `${shock.power.toFixed(3)}` }} />}
      </Show>

      {/*
        眠らされている間。**画面を伏せる。**

        操作は既に効かない (scene 側で止めている) が、それだけだと壊れたように
        見える。何が起きているかを言葉で出す。
      */}
      <Show when={asleep()}>
        <div class="hud-asleep" style={{ '--sleep-open': `${sleepOpen()}%` }}>
          <span class="hud-asleep-word" style={{ opacity: `${props.stats?.sleepDepth ?? 0}` }}>
            SLEEP
          </span>
        </div>
      </Show>

      <div class="hud-left">
        {/*
          キル表示。MGO2 と同じ 倒した人 ▶ 倒された人 (武器) の形。
          ヘッドショットは矢印に髑髏を添える。
        */}
        <For each={props.stats?.links ?? []}>
          {(name) => (
            <div class="hud-link">
              <span class="hud-link-mark">⁝⁝</span> {name} と繋がった
            </div>
          )}
        </For>

        <div class="hud-kills">
          <For each={props.stats?.kills ?? []}>
            {(kill) => (
              <div
                class="hud-kill"
                classList={{
                  'hud-kill-mine': kill.killer === props.selfId,
                  'hud-kill-death': kill.victim === props.selfId,
                }}
              >
                <span class={`hud-kill-name hud-kill-${kill.killerTeam}`}>{kill.killerName}</span>
                <span class="hud-kill-arrow">{kill.headshot ? '▶💀' : '▶'}</span>
                <span class={`hud-kill-name hud-kill-${kill.victimTeam}`}>{kill.victimName}</span>
                <span class="hud-kill-weapon">({kill.weapon})</span>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* 照準は画面中央固定。カメラの視線軸がそのまま弾道になる */}
      {/* スコープ。覗いている間だけ */}
      <Show when={props.stats?.scoped}>
        <div class="scope">
          <div class="scope-glass">
            {/*
              柱 (post)。**上・左・右の 3 本。**

              実物の狙撃眼鏡は、太い線が縁から伸びて中心の手前で止まる。
              太いのは覗いた瞬間に線を見つけるためで、中心を空けるのは
              的を隠さないため。下だけ無いのは、そこに距離の目盛りが入るから。
            */}
            <div class="scope-post scope-post-t" />
            <div class="scope-post scope-post-l" />
            <div class="scope-post scope-post-r" />
            {/* 柱の先から中心までの細かい刻み。ここで的の大きさを測る */}
            <div class="scope-fine scope-fine-t" />
            <div class="scope-fine scope-fine-l" />
            <div class="scope-fine scope-fine-r" />
            {/*
              中心の赤い縦線。**着弾はこの線の上に来る。**

              黒い線だけだと、暗い的に重ねた瞬間にどこを狙っているか分からなくなる。
            */}
            <div class="scope-red" />
            {/*
              距離の目盛り。**中央を空けて左右に分ける。**

              真ん中を点で埋めると、狙っている所が点に隠れる。実物も中心線の
              両脇に刻む。下へ行くほど広がるのは、遠いほど弾が落ちるから。
            */}
            <div class="scope-mils">
              <div><span /><span /></div>
              <div><span /><span /></div>
              <div><span /><span /></div>
              <div><span /><span /></div>
            </div>
            <div class="scope-zoom">{props.stats?.zoom}</div>
          </div>
        </div>
      </Show>

      {/* 覗ける状態のとき、肩越しのまま何もしていない人に操作を伝える */}
      <Show when={props.stats?.canZoom && !props.stats?.scoped}>
        <div class="scope-hint">{t('hud.scopeHint')}</div>
      </Show>

      {/*
        刃物では出さない。**十字も輪も「そこへ飛ぶ」ための印**で、
        届く範囲が体の前 2m しかない刃物には言うことが無い。
      */}
      <Show
        when={
          locked() &&
          props.stats?.aiming &&
          !props.stats?.scoped &&
          props.stats?.weaponHeld !== 'knife'
        }
      >
        <div
          class="crosshair"
          // 散布界に応じて開く。数字で見せずに「今どれだけ散るか」を伝える。
          //
          // **散弾は粒の散りも足す。** 狙いの散布だけだと、止まって構えた
          // 瞬間に輪が点まで縮んで「一点へ飛ぶ」に見える
          //
          // **位置は動かさない。** 手ブレは画面ごと揺れる (カメラの向きに
          // 差し込んである) ので、クロスヘアは中央に固定されたまま
          style={{
            '--crosshair-gap': `${9 + ((props.stats?.spread ?? 0) + (props.stats?.pelletSpread ?? 0)) * 11}px`,
          }}
        >
          <span class="crosshair-dot" />
          {/*
            散弾は輪。**粒がその中に散る**という形をそのまま出す。
            十字は「その一点へ 1 発飛ぶ」の形なので、8 粒に分かれる銃には嘘になる。
          */}
          <Show
            when={(props.stats?.pelletSpread ?? 0) > 0}
            fallback={
              <>
                <span class="crosshair-arm crosshair-arm-up" />
                <span class="crosshair-arm crosshair-arm-down" />
                <span class="crosshair-arm crosshair-arm-left" />
                <span class="crosshair-arm crosshair-arm-right" />
              </>
            }
          >
            <span class="crosshair-ring" />
          </Show>
        </div>
      </Show>

      {/* 命中した部位。倍率が違うので、どこに当たったかが分かると狙いを直せる */}
      <Show when={props.stats?.hitZone}>
        <div class="hud-hit" classList={{ 'hud-hit-tranq': props.stats?.hitTranq === true }}>
          {props.stats?.hitZone}
        </div>
      </Show>

      {/* 倒れている間。復帰の時計はサーバーが持っているので秒数は出さない */}
      <Show when={props.stats?.dead}>
        <div class="hud-down">
          <div class="hud-down-title">DOWN</div>
          <div class="hud-down-sub">WAITING FOR RESPAWN</div>
        </div>
      </Show>

      {/*
        いま手にある物。**1 つだけ出す。**

        持ち替えて使う形にした以上、持っていない物の数を並べても判断に使えない。
        MGO2 も手にしている物だけを出していた (docs/design.md の 5)。

        装填弾は**目盛り**、持っている総数は**数字**。撃っている最中に数字を
        読ませない — 減っていくのが目に入るだけで足りるし、視線を画面の隅へ
        動かす回数が減る。
      */}
      <div
        class="hud-weapon"
        classList={{
          'hud-weapon-picking': !!props.stats?.browsing,
          'hud-weapon-switching': props.stats?.switching,
          // 道具を手にしている間。**弾数は正しいまま薄くする** — 0 と出すと
          // 「弾が無い」に見えるが、実際は手が塞がっているだけ
          'hud-weapon-idle': props.stats?.toolInHand,
          // 送っている間は指している銃の装填で見る。空の銃が赤いまま並ぶ
          'hud-weapon-empty':
            heldIsGun() && (browsedItem()?.loaded ?? props.stats?.ammo ?? 0) === 0,
          // 殺傷か麻酔か。**装備画面の札と同じ色** — 選んだ物と手にある物が繋がる
          'hud-weapon-tranq': heldIsTranq(),
        }}
      >
        <Show when={heldIsGun()}>
          <div class="hud-weapon-spare">{heldTotal()}</div>
        </Show>
        <div class="hud-weapon-name">{heldLabel()}</div>
        <Show when={heldIsGun()}>
          <div class="hud-weapon-mag">
            <For each={ticks()}>
              {(filled) => (
                <span class="hud-weapon-tick" classList={{ 'hud-weapon-tick-on': filled }} />
              )}
            </For>
          </div>
        </Show>
        {/* 投げ物は装填が無い。残りの数だけ */}
        <Show when={!heldIsGun() && heldCount() !== null}>
          <div class="hud-weapon-count">× {heldCount()}</div>
        </Show>

      </div>

      {/*
        点の増減。**倒した / 倒された瞬間だけ、右下に短く出す。**

        誰が誰を倒したかの一覧 (hud-kills) は別に出ている。あれは記録として
        読むもので、こちらは**自分に何が起きたか**の手応え。武器のカードの
        真上に積んで、2.5 秒で消える。
      */}
      <div class="hud-points">
        <For each={props.stats?.points ?? []}>
          {(entry) => (
            <div class="hud-point" classList={{ 'hud-point-minus': entry.delta < 0 }}>
              <span class="hud-point-label">{entry.label}</span>
              <span class="hud-point-delta">
                {entry.delta > 0 ? '+' : ''}
                {entry.delta}
              </span>
            </div>
          )}
        </For>
      </div>

      {/*
        状態の行。**カードの外、真下に置く。**

        中に積むとカードの高さが変わり、撃っている最中に枠が伸び縮みする。
        目盛りを見ている目がそのたびに引っ張られるので、位置は動かさない。
      */}
      <div class="hud-weapon-states">
        <Show when={props.stats?.switching}>
          <div class="hud-weapon-state">SWITCHING</div>
        </Show>
        <Show when={!props.stats?.switching && props.stats?.reloading}>
          <div class="hud-weapon-state">RELOADING</div>
        </Show>
        <Show
          when={
            !props.stats?.switching &&
            !props.stats?.reloading &&
            // 道具を手にしている間は R を押しても入れ替わらない。促さない
            !props.stats?.toolInHand &&
            heldIsGun() &&
            props.stats?.ammo === 0
          }
        >
          <div class="hud-weapon-state hud-weapon-state-warn">
            {(props.stats?.reserve ?? 0) > 0 ? 'PRESS R' : 'NO AMMO'}
          </div>
        </Show>
        {/* 近くに落ちている武器。**押せば拾える**とだけ出す */}
        <Show when={props.stats?.canPickUp}>
          <div class="hud-weapon-state hud-weapon-state-pick">G で拾う</div>
        </Show>
        {/* 転んだら自分で起きる。撃つか起きるかを選ばせたいので、時間では立たない */}
        <Show when={props.stats?.downed}>
          <div class="hud-weapon-state hud-weapon-state-warn">{t('hud.standUpHint')}</div>
        </Show>
      </div>

      {/*
        持ち替えの一覧。
        **1 本のリストを L 字に折る。** 縦一列だと画面の真ん中を塞ぐ。現在の位置を
        角に置いて、前半を上へ、後半を右へ伸ばす。見えていることが勝敗を決める
        ゲームなので、UI が視界を奪わない (MGO2 がそうしていた)。
      */}
      <Show when={props.stats?.browsing}>
        <div
          class="hud-browse"
          classList={{ 'hud-browse-tool': props.stats?.browsingFamily === 'tool' }}
        >
            {/*
              角は出さない。**角にあるのは武器のカードそのもの** (下の hud-weapon)。
              選んでいる物の弾数まで出ているカードが、そのまま選択の印になる。
              別にカードを出すと同じ名前が 2 つ並ぶ。
            */}
          <div class="hud-browse-column" ref={columnEl}>
            <For each={above()}>{(item) => <BrowseItem item={item} />}</For>
          </div>
          <div class="hud-browse-row" ref={rowEl}>
            <Show when={beside()}>{(item) => <BrowseItem item={item()} />}</Show>
          </div>
        </div>
      </Show>

      {/*
        持っている道具。**左下。** 右下は武器のカードが使っている。

        ダンボールを被っていても武器のカードは銃のまま出る。手にある物をそのまま
        出すと、被った瞬間にカードが C.BOX になって「抜けば構える銃」が分からなく
        なる (MGO2 も道具は左下で、武器のカードは別に出ていた)。
      */}
      <Show when={props.stats?.tool}>
        <div class="hud-tool" classList={{ 'hud-tool-on': props.stats?.toolInHand }}>
          <div class="hud-tool-key">C</div>
          <div class="hud-tool-name">{HELD[shownTool()].label}</div>
        </div>
      </Show>


    </div>
  )
}
