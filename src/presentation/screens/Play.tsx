import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { t } from '../../i18n'
import { useNavigate, useParams } from '@solidjs/router'
import type * as THREE from 'three'
import { Game, type GameStats } from '../scene/Game'
import type { Identity } from '../../auth/session'
import type { WeaponTarget } from '../scene/arms/weapon'
import type { SupportId, WeaponId } from '../../domain/item/weapons'
import Calibrator from '../ui/Calibrator'
import Hud from '../ui/Hud'
import Scoreboard from '../ui/Scoreboard'
import Loadout from '../ui/Loadout'
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
  const [primary, setPrimary] = createSignal<WeaponId>('rifle')
  const [support, setSupport] = createSignal<SupportId>('grenade')
  const [game, setGame] = createSignal<Game | null>(null)
  let container!: HTMLDivElement

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
          primary={primary()}
          support={support()}
          onPrimary={(id) => game()?.setLoadout(id)}
          onSupport={(id) => game()?.setSupport(id)}
          note={t('loadout.note')}
          left={stats()?.loadoutLeft ?? 0}
          wait={stats()?.loadoutWait ?? 0}
          onSpawn={() => game()?.closeLoadout()}
        />
      </Show>

      {/* 成績表。Tab で開く。部屋を出るのもここから */}
      <Show when={stats()?.menuOpen}>
        <Scoreboard
          stats={stats()}
          identity={props.identity}
          selfId={game()?.selfId ?? ''}
          onClose={() => game()?.setMenu(false)}
          onLeave={() => {
            // 出ることを伝えてから離れる。伝えないと、残った人は
            // 席が畳まれるまで居ない相手を待つことになる
            game()?.leaveRoom()
            navigate('/rooms')
          }}
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
