import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import type * as THREE from 'three'
import { Game, type GameStats } from '../game/Game'
import type { Identity } from '../auth/session'
import type { WeaponTarget } from '../game/weapon'
import Calibrator from '../ui/Calibrator'
import Hud from '../ui/Hud'
import Scoreboard from '../ui/Scoreboard'

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
 * 対戦の画面。
 *
 * ここを離れると描画器も通信路も畳まれる。部屋を出るというのはそういうことなので、
 * 残しておく理由が無い。戻ってきたら作り直す (WebGPU の初期化で 1 テンポ待つ)。
 */
export default function Play(props: { identity: Identity }) {
  const params = useParams<{ room: string }>()
  const navigate = useNavigate()
  const [stats, setStats] = createSignal<GameStats | null>(null)
  const [game, setGame] = createSignal<Game | null>(null)
  let container!: HTMLDivElement

  onMount(() => {
    const instance = new Game(container, props.identity, params.room)
    // 描画器の初期化 (WebGPU のアダプタ取得) を待つので非同期
    void instance.start(setStats)
    setGame(instance)
  })

  onCleanup(() => {
    game()?.dispose()
    setGame(null)
  })

  const calibrate = (target: WeaponTarget, grip: THREE.Vector3, rotation: THREE.Euler) => {
    game()?.calibrateWeapon(target, grip, rotation)
  }

  return (
    <div class="app">
      <div class="viewport" ref={container} />
      <Hud stats={stats()} selfId={game()?.selfId ?? ''} />

      {/* 成績表。Tab で開く。部屋を出るのもここから */}
      <Show when={stats()?.menuOpen}>
        <Scoreboard
          stats={stats()}
          selfId={game()?.selfId ?? ''}
          onClose={() => game()?.setMenu(false)}
          onLeave={() => navigate('/rooms')}
        />
      </Show>

      {/* 開発時 + URL に ?panel=open があるときだけ。製品ビルドでは丸ごと落ちる */}
      <Show when={import.meta.env.DEV && panelRequested()}>
        <Calibrator
          stats={stats()}
          onChange={calibrate}
          onBox={(tuning) => game()?.setBoxTuning(tuning)}
          onBulletGravity={(gravity) => game()?.setBulletGravity(gravity)}
          onBoltDelay={(seconds) => game()?.setBoltDelay(seconds)}
          onGrenadeRelease={(seconds) => game()?.setGrenadeRelease(seconds)}
          onKnockdownRates={(sweep, stand) => game()?.setKnockdownRates(sweep, stand)}
          onReloadSoundAt={(ratio) => game()?.setReloadSoundAt(ratio)}
          onKnifePreview={(visible) => game()?.setKnifePreview(visible)}
          onAimPitchGain={(gain) => game()?.setAimPitchGain(gain)}
          onUpperTwistFix={(amount) => game()?.setUpperTwistFix(amount)}
          onCrouchTorsoYaw={(degrees) => game()?.setCrouchTorsoYaw(degrees)}
          onRelaxedLean={(degrees) => game()?.setRelaxedLean(degrees)}
          onExposure={(exposure) => game()?.setExposure(exposure)}
          onCloud={(coverage) => game()?.setCloudCoverage(coverage)}
          onAmbient={(intensity) => game()?.setAmbientIntensity(intensity)}
          onShadow={(intensity) => game()?.setShadowIntensity(intensity)}
          onAimView={(view) => game()?.setAimView(view)}
          onJump={(gravity, height, fall) => game()?.setJumpTuning(gravity, height, fall)}
          onMoveSpeed={(speed, aimScale) => game()?.setMoveSpeed(speed, aimScale)}
          onInputDevice={(device) => game()?.setInputDevice(device)}
          inputStatus={() => game()?.inputStatus() ?? { active: 'keyboard', connected: false }}
        />
      </Show>
    </div>
  )
}
