import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { t } from '../../i18n'
import { useNavigate, useParams } from '@solidjs/router'
import type * as THREE from 'three'
import { Game, type GameStats } from '../scene/Game'
import type { Identity } from '../../infra/auth/session'
import type { WeaponTarget } from '../scene/arms/weapon'
import type { SupportId, WeaponId } from '../../domain/item/weapons'
import Calibrator from '../ui/Calibrator'
import Hud from '../ui/Hud'
import Scoreboard from '../ui/Scoreboard'
import { CHOICES } from '../../domain/item/weapons'
import Loadout from '../ui/Loadout'
import Blocked from '../ui/Blocked'
import Leaving from '../ui/Leaving'
import Stats from '../ui/Stats'

/**
 * 調整パネルを出すか。
 *
 * 常に出していると、遊んでいる間ずっと画面の端を占める。触るのは値を詰めるときだけ
 * なので、URL で明示したときにだけ出す。
 *
 *   /rooms/alpha?panel=open
 */
function panelRequested(): boolean {
  return new URLSearchParams(location.search).get('panel') === 'open'
}

/**
 * 診断の表示を出すか。
 *
 *   /rooms/alpha?stats=on
 *
 * 調整パネルと違って**本番でも出す**。値を書き換えないので誰が見ても害が無いし、
 * 「相手がカクつく」の原因が自分側か相手側かを切り分けるのに要る。
 */
function statsRequested(): boolean {
  return new URLSearchParams(location.search).get('stats') === 'on'
}

/**
 * 対戦の画面。
 *
 * ここを離れると描画器も通信路も畳まれる。部屋を出るというのはそういうことなので、
 * 残しておく理由が無い。戻ってきたら作り直す (WebGPU の初期化で 1 テンポ待つ)。
 */
export default function Play(props: { identity: Identity }) {
  const params = useParams<{ room: string }>()
  const navigate = useNavigate()
  const [stats, setStats] = createSignal<GameStats | null>(null)
  /**
   * 選んでいる主武器。
   *
   * Game 側にも持っているが、あちらは signal ではないので画面が追従しない。
   * 数字キーでもボタンでも変わるので、押した結果をここへ映して表示に使う。
   */
  // 銃を持たない部屋 (ナイフだけ) では null
  const [primary, setPrimary] = createSignal<WeaponId | null>('rifle')
  const [support, setSupport] = createSignal<SupportId>('grenade')
  const [game, setGame] = createSignal<Game | null>(null)
  /** 部屋を出るか尋ねている最中か。戻るを押した時だけ立つ */
  const [leaving, setLeaving] = createSignal(false)
  let container!: HTMLDivElement

  /**
   * 試合が動いているか。**引き止めるのはこの間だけ。**
   *
   * 待っている間や結果を見ている間に抜けても、誰の試合も壊れない。
   * そこまで引き止めると、ただ邪魔なだけになる。
   */
  const inMatch = () => {
    const phase = stats()?.match?.phase
    return phase === 'countdown' || phase === 'playing'
  }

  /** 出ることを伝えてから離れる。伝えないと、残った人は席が畳まれるまで待つ */
  const leaveRoom = () => {
    game()?.leaveRoom()
    navigate('/rooms')
  }

  onMount(() => {
    const instance = new Game(container, props.identity, params.room)
    // 描画器の初期化 (WebGPU のアダプタ取得) を待つので非同期
    instance.onLoadout = (next) => {
      setPrimary(next.primary)
      setSupport(next.support)
    }
    void instance.start(setStats)
    setGame(instance)
  })

  /**
   * 試合中に画面を離れさせない。
   *
   * --- 戻るは 1 回で試合を抜ける ---
   * 押した本人は入り直せるが、**残った人は数の合わない試合を続ける**ことに
   * なる。しかも席が畳まれるまでの間、抜けた人は「居るのに動かない人」として
   * 映るので、待っているのか抜けたのかも分からない。
   *
   * --- 2 通りの離れ方があり、止め方が違う ---
   * 頁ごと離れる (再読み込み・タブを閉じる・URL を打ち直す) のはブラウザが
   * 尋ねてくれる (beforeunload)。文面はブラウザが決めるので、こちらからは
   * 「尋ねるかどうか」しか言えない。
   *
   * 戻るで /rooms へ移るのは**同じ頁の中の移動**なので beforeunload は出ない。
   * こちらは控えの履歴を 1 つ積んでおいて、戻られたら積み直す — URL が動か
   * ないので画面は残り、代わりに自前の板 (Leaving) で尋ねる。
   *
   * 積み直すのは試合中でなくても同じ。**戻るの意味は変えない**ので、試合中
   * でなければ尋ねずにそのまま出る (出ることをサーバーへ伝える口を通る点が、
   * 素通しの戻ると違う)。
   */
  onMount(() => {
    /*
     * 戻る 1 回ぶんの控え。これが在るので、戻っても URL は変わらない。
     *
     * 印を付けておく。**同じ URL の履歴が 2 つ並ぶ**ので、控えが積まれて
     * いるかどうかを外から見分ける手立てが他に無い (確かめるときに要る)。
     */
    history.pushState({ hold: true }, '')

    const onPop = () => {
      history.pushState({ hold: true }, '')
      if (!inMatch()) {
        leaveRoom()
        return
      }
      setLeaving(true)
      game()?.setLeaving(true)
    }

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!inMatch()) return
      // 尋ねてもらう合図。**文面はブラウザが決める**ので何も渡せない
      e.preventDefault()
    }

    window.addEventListener('popstate', onPop)
    window.addEventListener('beforeunload', onBeforeUnload)
    onCleanup(() => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('beforeunload', onBeforeUnload)
    })
  })

  onCleanup(() => {
    game()?.dispose()
    setGame(null)
  })

  const calibrate = (target: WeaponTarget, grip: THREE.Vector3, rotation: THREE.Euler) => {
    game()?.calibration.calibrateWeapon(target, grip, rotation)
  }

  return (
    <div class="app">
      <div class="viewport" ref={container} />
      <Hud stats={stats()} selfId={game()?.selfId ?? ''} />

      {/* 診断。?stats=on のときだけ。読むだけなので本番でも出す */}
      <Show when={statsRequested()}>
        <Stats stats={stats()} />
      </Show>

      {/*
        装備。支度をしている間 (domain/player/lifecycle.ts の choosing) だけ出す。
        入った直後と、倒れて次に湧くまでがそこにあたる。
      */}
      <Show when={stats()?.loadoutOpen}>
        <Loadout
          primary={stats()?.primary ?? primary()}
          support={support()}
          onPrimary={(id) => game()?.setLoadout(id)}
          onSecondary={(id) => game()?.setSecondary(id)}
          onSupport={(id) => game()?.setSupport(id)}
          note={t('loadout.note')}
          left={stats()?.loadoutLeft ?? 0}
          wait={stats()?.loadoutWait ?? 0}
          onSpawn={() => game()?.closeLoadout()}
          skills={stats()?.skills ?? {}}
          primaries={stats()?.primaries ?? CHOICES.primary}
          // **null は「持たない」。** ?? で埋めると拳銃へ戻る (null は nullish)
          secondary={stats() ? stats()!.secondary : 'm9'}
          /*
            準備の段階かどうか。**画面の性格が変わる。**

            支度の段階では「全員が同じ画面を見て、READY を押し合う」場所に
            なるので、参加者の一覧と締め切りを出す。倒れて次に湧くまでの
            支度では、待っている相手が居ないので出さない。
          */
          phase={stats()?.match?.phase ?? 'waiting'}
          players={stats()?.scores ?? []}
          selfId={game()?.selfId ?? ''}
          onReady={(next) => game()?.setReady(next)}
          skillsOpen={stats()?.skillsOpen ?? false}
          onSkill={(id, level) => game()?.setSkill(id, level)}
          // パッド / 矢印キーで指している枠。マウスと数字キーでは動かない
          focus={stats()?.loadoutFocus ?? 'primary'}
        />
      </Show>

      {/*
        遅れで席を空けてもらった。**描けない機械と同じ出方。**

        落ちただけなら勝手に繋ぎ直すので、ここは出ない。出るのは**もう
        戻らない**ときだけ — 黙って止まると、固まったのか繋がらないのかが
        分からず、待ち続けることになる。
      */}
      <Show when={stats()?.rejected}>
        <Blocked
          title={t('lag.title')}
          lede={t('lag.lede')}
          steps={[t('lag.wifi'), t('lag.other'), t('lag.vpn')]}
          note={t('lag.recheck')}
        />
      </Show>

      {/* 成績表。Tab で開く。部屋を出るのもここから */}
      <Show when={stats()?.menuOpen}>
        <Scoreboard
          stats={stats()}
          identity={props.identity}
          selfId={game()?.selfId ?? ''}
          skills={stats()?.skills ?? {}}
          skillsOpen={stats()?.skillsOpen ?? false}
          onSkill={(id, level) => game()?.setSkill(id, level)}
          onClose={() => game()?.setMenu(false)}
          onLeave={leaveRoom}
        />
      </Show>

      {/*
        戻るを押した。**押し間違いと、出る意思を分ける**だけの板なので、
        戦場は透けたまま (試合は続いている)。
      */}
      <Show when={leaving()}>
        <Leaving
          onStay={() => {
            setLeaving(false)
            game()?.setLeaving(false)
          }}
          onLeave={leaveRoom}
        />
      </Show>

      {/* 開発時 + URL に ?panel=open があるときだけ。製品ビルドでは丸ごと落ちる */}
      <Show when={import.meta.env.DEV && panelRequested()}>
        <Calibrator
          stats={stats()}
          onChange={calibrate}
          onBox={(tuning) => game()?.calibration.setBoxTuning(tuning)}
          onBulletGravity={(gravity) => game()?.calibration.setBulletGravity(gravity)}
          onBoltDelay={(seconds) => game()?.calibration.setBoltDelay(seconds)}
          onGrenadeRelease={(seconds) => game()?.calibration.setGrenadeRelease(seconds)}
          onKnockdownRates={(sweep, stand) => game()?.calibration.setKnockdownRates(sweep, stand)}
          onReloadSoundAt={(ratio) => game()?.calibration.setReloadSoundAt(ratio)}
          onKnifePreview={(visible) => game()?.calibration.setKnifePreview(visible)}
          onAimPitchGain={(gain) => game()?.calibration.setAimPitchGain(gain)}
          onUpperTwistFix={(amount) => game()?.calibration.setUpperTwistFix(amount)}
          onCrouchTorsoYaw={(degrees) => game()?.calibration.setCrouchTorsoYaw(degrees)}
          onRelaxedLean={(degrees) => game()?.calibration.setRelaxedLean(degrees)}
          onExposure={(exposure) => game()?.calibration.setExposure(exposure)}
          onCloud={(coverage) => game()?.calibration.setCloudCoverage(coverage)}
          onAmbient={(intensity) => game()?.calibration.setAmbientIntensity(intensity)}
          onShadow={(intensity) => game()?.calibration.setShadowIntensity(intensity)}
          onAimView={(view) => game()?.calibration.setAimView(view)}
          onJump={(gravity, height, fall) => game()?.calibration.setJumpTuning(gravity, height, fall)}
          onMoveSpeed={(speed, aimScale) => game()?.calibration.setMoveSpeed(speed, aimScale)}
          onInputDevice={(device) => game()?.calibration.setInputDevice(device)}
          inputStatus={() => game()?.calibration.inputStatus() ?? { active: 'keyboard', connected: false }}
        />
      </Show>
    </div>
  )
}
