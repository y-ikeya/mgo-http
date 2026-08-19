import { createSignal, For, onCleanup, Show } from 'solid-js'
import { t } from '../i18n'
import { HELD } from '../sim/held'
import type { GameStats } from '../game/Game'
import './Hud.css'

/**
 * HUD オーバーレイ。Solid が担当するのはこの層だけで、3D シーンには一切触れない。
 * 現時点では動作確認用の数値表示とクロスヘアのみ。警戒度メーターやミニマップはここに足していく。
 */
export default function Hud(props: { stats: GameStats | null; selfId: string }) {
  const locked = () => props.stats?.locked ?? false
  // 残り時間の表示だけは秒ごとに動かす。stats は 0.1 秒ごとに来るが、
  // 終了時刻からの引き算なので、こちらでも時計を進める必要がある。
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => clearInterval(timer))

  const phase = () => props.stats?.match?.phase
  const won = () => {
    const winner = props.stats?.match?.winner
    return winner !== undefined && winner !== 'draw' && winner === props.stats?.team
  }
  const lost = () => {
    const winner = props.stats?.match?.winner
    return winner !== undefined && winner !== 'draw' && winner !== props.stats?.team
  }
  /** いま手にある物。届いていなければ主武器を仮に出す */
  const held = () => props.stats?.held ?? 'rifle'
  const heldLabel = () => HELD[held()].label
  const heldIsGun = () => HELD[held()].shoots

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
    const size = props.stats?.magazine ?? 0
    const left = props.stats?.ammo ?? 0
    return Array.from({ length: size }, (_, i) => i < left)
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
        <div class="hud-match">
          <span class="hud-mode">TDM</span>
          <span
            class="hud-score hud-score-blue"
            classList={{ 'hud-score-own': props.stats?.team === 'blue' }}
          >
            {props.stats?.match?.blue ?? 0}
          </span>
          <span class="hud-clock">{clock()}</span>
          <span
            class="hud-score hud-score-red"
            classList={{ 'hud-score-own': props.stats?.team === 'red' }}
          >
            {props.stats?.match?.red ?? 0}
          </span>
        </div>
      </Show>

      {/* 人待ち。時計は動かない */}
      <Show when={phase() === 'waiting'}>
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
        classList={{ 'hud-damage-critical': health() <= 30 }}
        style={{ opacity: `${1 - health() / 100}` }}
      />

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
            <div class="scope-cross scope-cross-v" />
            <div class="scope-cross scope-cross-h" />
            <div class="scope-dot" />
            {/* 目盛り。距離感の手掛かりになる */}
            <div class="scope-ticks">
              <span /><span /><span /><span />
            </div>
            <div class="scope-zoom">{props.stats?.zoom}</div>
          </div>
        </div>
      </Show>

      {/* 覗ける状態のとき、肩越しのまま何もしていない人に操作を伝える */}
      <Show when={props.stats?.canZoom && !props.stats?.scoped}>
        <div class="scope-hint">{t('hud.scopeHint')}</div>
      </Show>

      <Show when={locked() && props.stats?.aiming && !props.stats?.scoped}>
        <div
          class="crosshair"
          // 散布界に応じて開く。数字で見せずに「今どれだけ散るか」を伝える
          style={{ '--crosshair-gap': `${9 + (props.stats?.spread ?? 0) * 11}px` }}
        >
          <span class="crosshair-dot" />
          <span class="crosshair-arm crosshair-arm-up" />
          <span class="crosshair-arm crosshair-arm-down" />
          <span class="crosshair-arm crosshair-arm-left" />
          <span class="crosshair-arm crosshair-arm-right" />
        </div>
      </Show>

      {/* 命中した部位。倍率が違うので、どこに当たったかが分かると狙いを直せる */}
      <Show when={props.stats?.hitZone}>
        <div class="hud-hit">{props.stats?.hitZone}</div>
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

        装填弾は**目盛り**、予備弾は**数字**。撃っている最中に数字を読ませない —
        減っていくのが目に入るだけで足りるし、視線を画面の隅へ動かす回数が減る。
      */}
      <div
        class="hud-weapon"
        classList={{
          'hud-weapon-switching': props.stats?.switching,
          'hud-weapon-empty': heldIsGun() && (props.stats?.ammo ?? 0) === 0,
        }}
      >
        <Show when={heldIsGun()}>
          <div class="hud-weapon-spare">{props.stats?.reserve ?? 0}</div>
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
            heldIsGun() &&
            props.stats?.ammo === 0
          }
        >
          <div class="hud-weapon-state hud-weapon-state-warn">
            {(props.stats?.reserve ?? 0) > 0 ? 'PRESS R' : 'NO AMMO'}
          </div>
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
        {(browsing) => (
          <div class="hud-browse">
            {/* 角より前。角の真上へ積む (角に近いほど下) */}
            <div class="hud-browse-column">
              <For each={browsing().items.slice(0, browsing().at)}>
                {(id) => <div class="hud-browse-item">{HELD[id].label}</div>}
              </For>
            </div>
            {/* 角と、その後ろ。**角は動かない** */}
            <div class="hud-browse-row">
              <div class="hud-browse-item hud-browse-at">
                {HELD[browsing().items[browsing().at]]?.label ?? ''}
              </div>
              <For each={browsing().items.slice(browsing().at + 1)}>
                {(id) => <div class="hud-browse-item">{HELD[id].label}</div>}
              </For>
            </div>
          </div>
        )}
      </Show>

      <div class="hud-help">{t('hud.help')}</div>
    </div>
  )
}
