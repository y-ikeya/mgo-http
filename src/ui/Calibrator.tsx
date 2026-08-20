import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import * as THREE from 'three'
import type { BoxTuning } from '../game/box'
import type { GameStats } from '../game/Game'
import type { InputDevice } from '../game/input'
import './Calibrator.css'

/**
 * weapon.ts に焼き込んである確定値。ここを起点に調整する。
 *
 * 武器ごとに向きの基準が違う (ライフルは両手を結ぶ線、ナイフは肘から手首) ので、
 * 補正値も別に持つ必要がある。
 */
const INITIAL_WEAPONS = {
  smg: {
    grip: { x: 0, y: 0.1, z: -0.435 },
    rotation: { x: -7, y: -9, z: 7 },
  },
  smgCrouch: {
    grip: { x: -0.05, y: 0.035, z: -0.455 },
    rotation: { x: -44, y: 15, z: 14 },
  },
  rifle: {
    grip: { x: -0.095, y: 0.145, z: -0.165 },
    rotation: { x: -10, y: -16, z: 80 },
  },
  rifleCrouch: {
    grip: { x: -0.105, y: 0.14, z: -0.2 },
    rotation: { x: -34, y: -3, z: 80 },
  },
  sniper: {
    grip: { x: -0.02, y: 0.27, z: 0.11 },
    rotation: { x: 0, y: -10, z: -172 },
  },
  sniperCrouch: {
    grip: { x: -0.01, y: 0.3, z: 0.02 },
    rotation: { x: -37, y: 3, z: 173 },
  },
  pistol: {
    grip: { x: 0.05, y: 0.005, z: 0.125 },
    rotation: { x: -5, y: 0, z: 0 },
  },
  pistolCrouch: {
    grip: { x: 0.035, y: 0, z: 0.11 },
    rotation: { x: -5, y: 0, z: 0 },
  },
  knife: {
    grip: { x: 0.02, y: -0.07, z: 0.025 },
    rotation: { x: 0, y: 0, z: 0 },
  },
} as const

/** box.ts の初期値と揃えること */
const INITIAL_BOX: BoxTuning = {
  width: 1.4,
  height: 1.15,
  clearance: 0.24,
  liftScale: 1,
  offsetForward: 0.2,
  offsetRight: 0.03,
  opacity: 1,
}

const BOX_AXES: {
  key: keyof BoxTuning
  label: string
  hint: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'width', label: '幅', hint: '腕の振りが 1.12m あるので、それ以上要る (m)', min: 0.8, max: 2, step: 0.01 },
  { key: 'height', label: '高さ', hint: '止まっている時に地面へ接する高さ (m)', min: 0.7, max: 2, step: 0.01 },
  { key: 'clearance', label: '頭の余裕', hint: '頭ボーンより上の頭頂部ぶん。足りないと頭が突き抜ける (m)', min: 0, max: 0.5, step: 0.01 },
  { key: 'liftScale', label: '浮きの強さ', hint: '1 = 頭が収まる最小限。上げると足がよく見えるが中も覗ける', min: 0, max: 2.5, step: 0.05 },
  { key: 'offsetForward', label: '前後', hint: '+ で前へずらす。前傾で背中がはみ出るとき (m)', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'offsetRight', label: '左右', hint: '+ で右へずらす (m)', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'opacity', label: '不透明度', hint: '下げると中が透ける。位置合わせ用で、決まったら 1 に戻す', min: 0, max: 1, step: 0.05 },
]

type WeaponTarget = keyof typeof INITIAL_WEAPONS
type Vec3 = { x: number; y: number; z: number }

/**
 * 調整値の初期状態。
 *
 * 表から作る。武器を足したときにここを書き足し忘れると、タブは出るのに
 * 値が無くて落ちる (拳銃を足したときに実際に踏んだ)。
 */
function freshWeapons(): Record<WeaponTarget, { grip: Vec3; rotation: Vec3 }> {
  return Object.fromEntries(
    (Object.keys(INITIAL_WEAPONS) as WeaponTarget[]).map((key) => [
      key,
      { grip: { ...INITIAL_WEAPONS[key].grip }, rotation: { ...INITIAL_WEAPONS[key].rotation } },
    ]),
  ) as Record<WeaponTarget, { grip: Vec3; rotation: Vec3 }>
}

const DEVICE_OPTIONS: { key: InputDevice; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'keyboard', label: 'キーボード' },
  { key: 'gamepad', label: 'パッド' },
]
const INITIAL_AIM_GAIN = 2
/** animation.ts の RELAXED_LEAN と揃えること (度) */
const INITIAL_RELAXED_LEAN = 17
/** animation.ts の UPPER_TWIST_FIX と揃えること */
const INITIAL_TWIST_FIX = 1

/** しゃがみ時に上半身を右へ旋回させる角度 (度)。animation.ts の CROUCH_TORSO_YAW と揃える */
const INITIAL_TORSO_YAW = 12

/** Game.ts の BOLT_DELAY と揃えること */
const INITIAL_BOLT_DELAY = 0.54

/** Game.ts の GRENADE_RELEASE_RATIO と揃えること。投げクリップに対する割合 */
const INITIAL_GRENADE_RELEASE = 0.19

/** animation.ts の SWEEP_RATE / STAND_RATE と揃えること */
const INITIAL_SWEEP_RATE = 1
const INITIAL_STAND_RATE = 1.2
/** Game.ts の RELOAD_SOUND_AT と揃えること */
const INITIAL_RELOAD_SOUND = 0.28
/** Game.ts の DEFAULT_EXPOSURE と揃えること */
const INITIAL_EXPOSURE = 3.0
/** ballistics.ts の BULLET_GRAVITY と揃えること */
const INITIAL_BULLET_GRAVITY = 9.8
/** stage.ts の CLOUD_COVERAGE と揃えること */
const INITIAL_CLOUD = 0.55
/** stage.ts の AMBIENT_INTENSITY / SHADOW_INTENSITY と揃えること */
const INITIAL_AMBIENT = 2.6
const INITIAL_SHADOW = 0.88
/** camera.ts の AIM_VIEW と揃えること */
const INITIAL_AIM_VIEW = { distance: 1.35, shoulder: 0.42, fov: 38 }
/** player.ts の GRAVITY / JUMP_HEIGHT / MOVE_SPEED と揃えること */
const INITIAL_JUMP = { gravity: 9.8, height: 0.6, fall: 1.8 }
const INITIAL_MOVE_SPEED = 3.8
const INITIAL_AIM_SPEED_SCALE = 0.55

const JUMP_AXES: {
  key: 'gravity' | 'height' | 'fall'
  label: string
  hint: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'gravity', label: '重力', hint: '大きいほど滞空が短い。高さは変わらない (m/s²)', min: 8, max: 60, step: 1 },
  { key: 'height', label: '高さ', hint: '跳べる高さ。階段の一段は 0.5m (m)', min: 0.3, max: 2, step: 0.05 },
  { key: 'fall', label: '落下の重さ', hint: '下降だけ重くする倍率。高さは変わらない', min: 1, max: 4, step: 0.1 },
]

const AIM_VIEW_AXES: { key: 'distance' | 'shoulder' | 'fov'; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: 'distance', label: '距離', hint: '小さいほど寄る (m)', min: 0.6, max: 4, step: 0.05 },
  { key: 'shoulder', label: '肩', hint: '大きいほどキャラが画面左へ寄る (m)', min: 0, max: 1.2, step: 0.02 },
  { key: 'fov', label: '画角', hint: '小さいほど望遠。周辺視野は狭くなる (度)', min: 20, max: 70, step: 1 },
]

interface Axis {
  key: 'x' | 'y' | 'z'
  label: string
  hint: string
  /** つまみの可動域。回転は共通なので省略できる */
  min?: number
  max?: number
}

/**
 * 握り位置の可動域 (m)。**軸ごとに違う。**
 *
 * 前後 (Z) だけ広い。握りは銃のローカル座標にある点で、原点は後端付近・
 * 銃口が -Z なので、**長い銃ほど深い値になる**。P90 は握りが真ん中にあって
 * -0.6 で、±0.3 では端に張り付いて動かせなかった。端で止まらないよう、
 * 要ると言われた -1.2 より更に先まで開けてある。
 */
const POSITION_AXES: Axis[] = [
  { key: 'x', label: 'X', hint: '手の中で左右', min: -0.3, max: 0.3 },
  { key: 'y', label: 'Y', hint: '大きいほど銃が下がる', min: -0.3, max: 0.3 },
  { key: 'z', label: 'Z', hint: '大きいほど銃が手前', min: -1.5, max: 0.3 },
]

const ROTATION_AXES: Axis[] = [
  { key: 'x', label: 'Pitch', hint: '銃口の上下' },
  { key: 'y', label: 'Yaw', hint: '銃口の左右' },
  { key: 'z', label: 'Roll', hint: '銃身回りの傾き' },
]

/**
 * 目で見ないと決められない値を実機で合わせるための開発用パネル。
 *
 * 手ボーンのローカル座標系や画面の明るさは数値から推測できないので、
 * 動かしながら決めるほうが速い。確定した値は各モジュールの定数へ焼き込む。
 * import.meta.env.DEV でしか描画されないため製品ビルドには入らない。
 */
export default function Calibrator(props: {
  onChange: (target: WeaponTarget, grip: THREE.Vector3, rotation: THREE.Euler) => void
  onBox: (tuning: BoxTuning) => void
  onBulletGravity: (gravity: number) => void
  /** 実行中の数値。HUD から追い出してここへ集めてある */
  stats: GameStats | null
  onKnifePreview: (visible: boolean) => void
  onAimPitchGain: (gain: number) => void
  onUpperTwistFix: (amount: number) => void
  onCrouchTorsoYaw: (degrees: number) => void
  onBoltDelay: (seconds: number) => void
  onGrenadeRelease: (seconds: number) => void
  onKnockdownRates: (sweep: number, stand: number) => void
  onReloadSoundAt: (ratio: number) => void
  onRelaxedLean: (degrees: number) => void
  onExposure: (exposure: number) => void
  onCloud: (coverage: number) => void
  onAmbient: (intensity: number) => void
  onShadow: (intensity: number) => void
  onAimView: (view: { distance: number; shoulder: number; fov: number }) => void
  onJump: (gravity: number, height: number, fallScale: number) => void
  onMoveSpeed: (speed: number, aimScale: number) => void
  onInputDevice: (device: InputDevice) => void
  inputStatus: () => { active: 'keyboard' | 'gamepad'; connected: boolean }
}) {
  const [target, setTarget] = createSignal<WeaponTarget>('rifle')
  const [weapons, setWeapons] = createSignal(freshWeapons())
  const grip = () => weapons()[target()].grip
  const rotation = () => weapons()[target()].rotation
  const [box, setBox] = createSignal({ ...INITIAL_BOX })
  const [aimGain, setAimGain] = createSignal(INITIAL_AIM_GAIN)
  const [relaxedLean, setRelaxedLean] = createSignal(INITIAL_RELAXED_LEAN)
  const [twistFix, setTwistFix] = createSignal(INITIAL_TWIST_FIX)
  const [torsoYaw, setTorsoYaw] = createSignal(INITIAL_TORSO_YAW)
  const [boltDelay, setBoltDelay] = createSignal(INITIAL_BOLT_DELAY)
  const [grenadeRelease, setGrenadeRelease] = createSignal(INITIAL_GRENADE_RELEASE)
  const [sweepRate, setSweepRate] = createSignal(INITIAL_SWEEP_RATE)
  const [standRate, setStandRate] = createSignal(INITIAL_STAND_RATE)
  const [reloadSound, setReloadSound] = createSignal(INITIAL_RELOAD_SOUND)
  const [exposure, setExposure] = createSignal(INITIAL_EXPOSURE)
  const [bulletGravity, setBulletGravity] = createSignal(INITIAL_BULLET_GRAVITY)
  const [cloud, setCloud] = createSignal(INITIAL_CLOUD)
  const [ambient, setAmbient] = createSignal(INITIAL_AMBIENT)
  const [shadow, setShadow] = createSignal(INITIAL_SHADOW)
  const [aimView, setAimView] = createSignal({ ...INITIAL_AIM_VIEW })
  const [jump, setJump] = createSignal({ ...INITIAL_JUMP })
  const [moveSpeed, setMoveSpeed] = createSignal(INITIAL_MOVE_SPEED)
  const [aimSpeedScale, setAimSpeedScale] = createSignal(INITIAL_AIM_SPEED_SCALE)
  const [device, setDevice] = createSignal<InputDevice>('auto')
  // パッドの接続は Game 側が握っているので定期的に読みに行く。
  // 抜き差しのイベントを Solid まで引き回すほどの情報ではない。
  const [status, setStatus] = createSignal(props.inputStatus())
  const statusTimer = setInterval(() => setStatus(props.inputStatus()), 400)
  onCleanup(() => clearInterval(statusTimer))

  // 確定済みなので普段は畳んでおく。別の武器を試すときだけ開く。
  const [open, setOpen] = createSignal(false)

  /**
   * 実行中の数値。HUD の一等地を占めていたものを、調整と同じ場所へ集めた。
   * 対戦中に読むものではなく、詰まったときに確かめるものなので。
   */
  const statRows = () => {
    const s = props.stats
    return [
      { label: 'STAGE', value: s?.stage ?? '--' },
      { label: 'FPS', value: String(s?.fps ?? 0) },
      { label: 'GPU', value: s?.backend ?? '--' },
      { label: 'POS', value: `${(s?.x ?? 0).toFixed(1)}, ${(s?.z ?? 0).toFixed(1)}` },
      { label: 'SPD', value: `${(s?.speed ?? 0).toFixed(1)} m/s` },
      { label: 'HP', value: `${Math.ceil(s?.health ?? 0)} / ${s?.maxHealth ?? 100}` },
      { label: 'STANCE', value: s?.crouching ? 'CROUCH' : 'STAND' },
      { label: 'SHOTS', value: String(s?.shots ?? 0) },
      { label: 'PLAYERS', value: String((s?.players ?? 0) + 1) },
    ]
  }

  const apply = () => {
    const g = grip()
    const r = rotation()
    props.onChange(
      target(),
      new THREE.Vector3(g.x, g.y, g.z),
      new THREE.Euler(
        THREE.MathUtils.degToRad(r.x),
        THREE.MathUtils.degToRad(r.y),
        THREE.MathUtils.degToRad(r.z),
      ),
    )
  }

  const updateGrip = (key: 'x' | 'y' | 'z', value: number) => {
    const t = target()
    setWeapons({ ...weapons(), [t]: { ...weapons()[t], grip: { ...grip(), [key]: value } } })
    apply()
  }

  const updateRotation = (key: 'x' | 'y' | 'z', value: number) => {
    const t = target()
    setWeapons({ ...weapons(), [t]: { ...weapons()[t], rotation: { ...rotation(), [key]: value } } })
    apply()
  }

  /** ナイフは普段隠れているので、選んでいる間だけ出しっぱなしにする */
  const preview = (next: WeaponTarget, shown: boolean) => {
    props.onKnifePreview(shown && next === 'knife')
  }

  /** 調整対象を切り替える */
  const selectTarget = (next: WeaponTarget) => {
    setTarget(next)
    preview(next, open())
    apply()
  }

  /**
   * 体の姿勢に合わせてタブを切り替える。
   *
   * ライフルは立ちとしゃがみで別の値を持つので、姿勢と違うタブをいじっても
   * 画面は動かない。かといってパネル側で姿勢を作ると、開いた瞬間に銃が動く。
   * 見せかけを作らず、いじる対象のほうを体に合わせる。
   */
  createEffect(() => {
    if (target() === 'knife') return
    // 持ち替えと姿勢の両方に追従する。いじっている値と、いま見えている銃を
    // 常に一致させる (見えていない銃の値を触っても画面は動かない)
    const gun = props.stats?.equipped ?? 'rifle'
    const next = (props.stats?.crouching ? `${gun}Crouch` : gun) as WeaponTarget
    if (target() !== next) {
      setTarget(next)
      apply()
    }
  })

  const updateAimGain = (value: number) => {
    setAimGain(value)
    props.onAimPitchGain(value)
  }

  const updateRelaxedLean = (value: number) => {
    setRelaxedLean(value)
    props.onRelaxedLean(value)
  }

  const updateExposure = (value: number) => {
    setExposure(value)
    props.onExposure(value)
  }

  const updateAimView = (key: 'distance' | 'shoulder' | 'fov', value: number) => {
    const next = { ...aimView(), [key]: value }
    setAimView(next)
    props.onAimView(next)
  }

  const updateJump = (key: 'gravity' | 'height' | 'fall', value: number) => {
    const next = { ...jump(), [key]: value }
    setJump(next)
    props.onJump(next.gravity, next.height, next.fall)
  }

  const updateMoveSpeed = (value: number) => {
    setMoveSpeed(value)
    props.onMoveSpeed(value, aimSpeedScale())
  }

  const updateAimSpeedScale = (value: number) => {
    setAimSpeedScale(value)
    props.onMoveSpeed(moveSpeed(), value)
  }

  const reset = () => {
    setWeapons(freshWeapons())
    updateAimGain(INITIAL_AIM_GAIN)
    updateRelaxedLean(INITIAL_RELAXED_LEAN)
    updateExposure(INITIAL_EXPOSURE)
    setAimView({ ...INITIAL_AIM_VIEW })
    props.onAimView({ ...INITIAL_AIM_VIEW })
    setJump({ ...INITIAL_JUMP })
    props.onJump(INITIAL_JUMP.gravity, INITIAL_JUMP.height, INITIAL_JUMP.fall)
    setAimSpeedScale(INITIAL_AIM_SPEED_SCALE)
    updateMoveSpeed(INITIAL_MOVE_SPEED)
    apply()
  }

  const snippet = () => {
    const g = grip()
    const r = rotation()
    const gripLine = `${target()}: grip (${g.x.toFixed(3)}, ${g.y.toFixed(3)}, ${g.z.toFixed(3)})`
    return [
      gripLine,
      `// 追加回転 (度): pitch ${r.x} / yaw ${r.y} / roll ${r.z}`,
      `// 照準の上下の強度: ${aimGain().toFixed(2)}`,
      `// 非構えの前傾: ${relaxedLean()}度`,
      `// 非構えの上半身の向き補正: ${twistFix().toFixed(2)}`,
      `// しゃがみ時の上半身の旋回: ${torsoYaw().toFixed(0)}度`,
      `// ボルトに手を掛けるまで: ${boltDelay().toFixed(2)}秒`,
      `// 手榴弾が手を離れる位置: 投げクリップの ${(grenadeRelease() * 100).toFixed(0)}%`,
      `// 吹き飛び ${sweepRate().toFixed(2)}倍 (着地まで ${(0.92 / sweepRate()).toFixed(2)}秒)`,
      `// 起き上がり ${standRate().toFixed(2)}倍 (${(2.4 / standRate()).toFixed(2)}秒)`,
      `// リロード音の開始: ${reloadSound().toFixed(2)}`,
      `// 露出: ${exposure().toFixed(2)}`,
      `// 弾の落下: ${bulletGravity().toFixed(1)}`,
      `// 雲: ${cloud().toFixed(2)}`,
      `// 天空光: ${ambient().toFixed(1)} / 影の濃さ: ${shadow().toFixed(2)}`,
      `// 箱: 幅 ${box().width.toFixed(2)} / 高さ ${box().height.toFixed(2)} / 頭の余裕 ${box().clearance.toFixed(2)}` +
        ` / 浮き ${box().liftScale.toFixed(2)} / 前後 ${box().offsetForward.toFixed(2)} / 左右 ${box().offsetRight.toFixed(2)}` +
        ` / 不透明度 ${box().opacity.toFixed(2)}`,
      `// 構えのカメラ: distance ${aimView().distance} / shoulder ${aimView().shoulder} / fov ${aimView().fov}`,
      `// ジャンプ: gravity ${jump().gravity} / height ${jump().height} / fall ${jump().fall}`,
      `// 移動速度: ${moveSpeed().toFixed(1)} / 構え中の倍率 ${aimSpeedScale().toFixed(2)}`,
    ].join('\n')
  }

  return (
    <div class="calib" classList={{ 'calib-closed': !open() }}>
      <button
        class="calib-toggle"
        onClick={() => {
          const next = !open()
          setOpen(next)
          // 閉じたらナイフも戻す。出しっぱなしのまま隠れると理由が分からなくなる
          preview(target(), next)
        }}
      >
        {open() ? '× 調整パネル' : '調整パネル'}
      </button>

      <div class="calib-body">
        <div class="calib-section">状態</div>
        <div class="calib-stats">
          <For each={statRows()}>
            {(row) => (
              <div class="calib-stat">
                <span class="calib-stat-label">{row.label}</span>
                <span class="calib-stat-value">{row.value}</span>
              </div>
            )}
          </For>
        </div>

        <div class="calib-section">操作方法</div>
        <div class="calib-tabs">
          <For each={DEVICE_OPTIONS}>
            {(option) => (
              <button
                classList={{ 'calib-tab': true, 'calib-tab-on': device() === option.key }}
                onClick={() => {
                  setDevice(option.key)
                  props.onInputDevice(option.key)
                }}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <div class="calib-note">
          {status().connected ? 'パッド接続あり' : 'パッド未接続'} / 現在:{' '}
          {status().active === 'gamepad' ? 'ゲームパッド' : 'キーボード'}
          <br />
          左スティック 移動 · 右スティック 視点 · L2 構え · R2 射撃 · × ローリング · □ リロード · ○ ナイフ · L3 しゃがみ
        </div>

        <div class="calib-section">
          調整する武器
          <Show when={target() !== 'knife'}>
            <span class="calib-hint" style={{ 'margin-left': '8px' }}>
              {props.stats?.crouching ? 'しゃがみ' : '立ち'} (姿勢に追従)
            </span>
          </Show>
        </div>
        <div class="calib-tabs">
          <button
            classList={{
              'calib-tab': true,
              'calib-tab-on': target() === 'smg' || target() === 'smgCrouch',
            }}
            onClick={() => selectTarget(props.stats?.crouching ? 'smgCrouch' : 'smg')}
          >
            P90
          </button>
          <button
            classList={{
              'calib-tab': true,
              'calib-tab-on': target() === 'rifle' || target() === 'rifleCrouch',
            }}
            onClick={() => selectTarget(props.stats?.crouching ? 'rifleCrouch' : 'rifle')}
          >
            ライフル
          </button>
          <button
            classList={{
              'calib-tab': true,
              'calib-tab-on': target() === 'sniper' || target() === 'sniperCrouch',
            }}
            onClick={() => selectTarget(props.stats?.crouching ? 'sniperCrouch' : 'sniper')}
          >
            スナイパー
          </button>
          <button
            classList={{
              'calib-tab': true,
              'calib-tab-on': target() === 'pistol' || target() === 'pistolCrouch',
            }}
            onClick={() => selectTarget(props.stats?.crouching ? 'pistolCrouch' : 'pistol')}
          >
            ハンドガン
          </button>
          <button
            classList={{ 'calib-tab': true, 'calib-tab-on': target() === 'knife' }}
            onClick={() => selectTarget('knife')}
          >
            ナイフ
          </button>
        </div>

        <div class="calib-section">握り位置 (m)</div>
        <For each={POSITION_AXES}>
          {(axis) => (
            <label class="calib-row">
              <span class="calib-label">{axis.label}</span>
              <input
                type="range"
                min={axis.min}
                max={axis.max}
                step="0.005"
                value={grip()[axis.key]}
                onInput={(e) => updateGrip(axis.key, Number(e.currentTarget.value))}
              />
              {/*
                **数字も打てる。** つまみの端に用があるとき (銃が長い / 想定外の
                握り) に、範囲を広げ直さないと進めないのは詰まる
              */}
              <input
                class="calib-value calib-number"
                type="number"
                step="0.005"
                value={grip()[axis.key].toFixed(3)}
                onChange={(e) => updateGrip(axis.key, Number(e.currentTarget.value))}
              />
              <span class="calib-hint">{axis.hint}</span>
            </label>
          )}
        </For>

        <div class="calib-section">追加回転 (度)</div>
        <For each={ROTATION_AXES}>
          {(axis) => (
            <label class="calib-row">
              <span class="calib-label">{axis.label}</span>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={rotation()[axis.key]}
                onInput={(e) => updateRotation(axis.key, Number(e.currentTarget.value))}
              />
              <span class="calib-value">{rotation()[axis.key]}</span>
              <span class="calib-hint">{axis.hint}</span>
            </label>
          )}
        </For>

        <div class="calib-section">照準の上下が上半身に効く強度</div>
        <label class="calib-row">
          <span class="calib-label">Gain</span>
          <input
            type="range"
            min="-4"
            max="4"
            step="0.05"
            value={aimGain()}
            onInput={(e) => updateAimGain(Number(e.currentTarget.value))}
          />
          <span class="calib-value">{aimGain().toFixed(2)}</span>
          <span class="calib-hint">0 で無効、負で反転。1 = カメラの角度そのまま</span>
        </label>

        <div class="calib-section">非構え時の上半身の向き</div>
        <label class="calib-row">
          <span class="calib-label">補正</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={twistFix()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setTwistFix(value)
              props.onUpperTwistFix(value)
            }}
          />
          <span class="calib-value">{twistFix().toFixed(2)}</span>
          <span class="calib-hint">
            relaxed 系クリップは他と 31° 違う向きで作られている。
            0 = そのまま (左へ約 37° 捻れる) / 1 = 完全に打ち消して腰に合わせる
          </span>
        </label>

        <div class="calib-section">動作のタイミング</div>
        <label class="calib-row">
          <span class="calib-label">ボルト</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={boltDelay()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setBoltDelay(value)
              props.onBoltDelay(value)
            }}
          />
          <span class="calib-value">{boltDelay().toFixed(2)}s</span>
          <span class="calib-hint">
            撃ってから手を掛けるまで。次の 1 発までの間隔もこのぶん延びる
          </span>
        </label>
        <label class="calib-row">
          <span class="calib-label">手榴弾</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={grenadeRelease()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setGrenadeRelease(value)
              props.onGrenadeRelease(value)
            }}
          />
          <span class="calib-value">{(grenadeRelease() * 100).toFixed(0)}%</span>
          <span class="calib-hint">
            **投げクリップ**のどこで手を離れるか。振りかぶりは別クリップなので
            0% が「放した瞬間」。秒ではなく割合なので、尺の違うモデルでもずれない
          </span>
        </label>
        <label class="calib-row">
          <span class="calib-label">吹き飛び</span>
          <input
            type="range"
            min="0.4"
            max="3"
            step="0.05"
            value={sweepRate()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setSweepRate(value)
              props.onKnockdownRates(value, standRate())
            }}
          />
          <span class="calib-value">{(0.92 / sweepRate()).toFixed(2)}s</span>
          <span class="calib-hint">爆風で投げ出されてから背中が着くまで</span>
        </label>
        <label class="calib-row">
          <span class="calib-label">起き上がり</span>
          <input
            type="range"
            min="0.4"
            max="3"
            step="0.05"
            value={standRate()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setStandRate(value)
              props.onKnockdownRates(sweepRate(), value)
            }}
          />
          <span class="calib-value">{(2.4 / standRate()).toFixed(2)}s</span>
          <span class="calib-hint">中断できない時間。長いほど倒された代償が重い</span>
        </label>
        <label class="calib-row">
          <span class="calib-label">リロード音</span>
          <input
            type="range"
            min="0"
            max="0.7"
            step="0.02"
            value={reloadSound()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setReloadSound(value)
              props.onReloadSoundAt(value)
            }}
          />
          <span class="calib-value">{reloadSound().toFixed(2)}</span>
          <span class="calib-hint">
            動作全体に対する割合。0.28 なら 3.33 秒の動作で 0.93 秒後
          </span>
        </label>

        <div class="calib-section">しゃがみ時の上半身</div>
        <label class="calib-row">
          <span class="calib-label">右へ旋回</span>
          <input
            type="range"
            min="0"
            max="35"
            step="1"
            value={torsoYaw()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setTorsoYaw(value)
              props.onCrouchTorsoYaw(value)
            }}
          />
          <span class="calib-value">{torsoYaw().toFixed(0)}°</span>
          <span class="calib-hint">
            素の構えは体が正面向きで、支える左手が体の中心より 15.2cm 左に出る (実測)。
            腕をいじらず半身にして直す
          </span>
        </label>

        <div class="calib-section">構えていないときの前傾</div>
        <label class="calib-row">
          <span class="calib-label">前傾</span>
          <input
            type="range"
            min="-10"
            max="35"
            step="1"
            value={relaxedLean()}
            onInput={(e) => updateRelaxedLean(Number(e.currentTarget.value))}
          />
          <span class="calib-value">{relaxedLean()}</span>
          <span class="calib-hint">大きいほど前のめり。負で反り気味 (度)</span>
        </label>

        <div class="calib-section">ダンボール</div>
        <For each={BOX_AXES}>
          {(axis) => (
            <label class="calib-row">
              <span class="calib-label">{axis.label}</span>
              <input
                type="range"
                min={axis.min}
                max={axis.max}
                step={axis.step}
                value={box()[axis.key]}
                onInput={(e) => {
                  const next = { ...box(), [axis.key]: Number(e.currentTarget.value) }
                  setBox(next)
                  props.onBox(next)
                }}
              />
              <span class="calib-value">{box()[axis.key].toFixed(2)}</span>
              <span class="calib-hint">{axis.hint}</span>
            </label>
          )}
        </For>

        <div class="calib-section">弾道</div>
        <label class="calib-row">
          <span class="calib-label">落下</span>
          <input
            type="range"
            min="0"
            max="40"
            step="0.5"
            value={bulletGravity()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setBulletGravity(value)
              props.onBulletGravity(value)
            }}
          />
          <span class="calib-value">{bulletGravity().toFixed(1)}</span>
          <span class="calib-hint">
            0 でまっすぐ。9.8 (現実の重力) なら初速 420m/s で 80m 先が 22cm 下がる
          </span>
        </label>

        <div class="calib-section">空</div>
        <label class="calib-row">
          <span class="calib-label">雲</span>
          <input
            type="range"
            min="0.2"
            max="0.75"
            step="0.01"
            value={cloud()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setCloud(value)
              props.onCloud(value)
            }}
          />
          <span class="calib-value">{cloud().toFixed(2)}</span>
          <span class="calib-hint">しきい値なので小さいほど広く覆う。0.3 で曇り、0.6 でほぼ快晴</span>
        </label>

        <div class="calib-section">日陰</div>
        <label class="calib-row">
          <span class="calib-label">天空光</span>
          <input
            type="range"
            min="0"
            max="6"
            step="0.1"
            value={ambient()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setAmbient(value)
              props.onAmbient(value)
            }}
          />
          <span class="calib-value">{ambient().toFixed(1)}</span>
          <span class="calib-hint">日陰の明るさそのもの。直射 2.4 との比が日向との差になる</span>
        </label>
        <label class="calib-row">
          <span class="calib-label">影の濃さ</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={shadow()}
            onInput={(e) => {
              const value = Number(e.currentTarget.value)
              setShadow(value)
              props.onShadow(value)
            }}
          />
          <span class="calib-value">{shadow().toFixed(2)}</span>
          <span class="calib-hint">1 で直射を完全に遮る。下げると影だけが薄くなる</span>
        </label>

        <div class="calib-section">構えたときのカメラ</div>
        <For each={AIM_VIEW_AXES}>
          {(axis) => (
            <label class="calib-row">
              <span class="calib-label">{axis.label}</span>
              <input
                type="range"
                min={axis.min}
                max={axis.max}
                step={axis.step}
                value={aimView()[axis.key]}
                onInput={(e) => updateAimView(axis.key, Number(e.currentTarget.value))}
              />
              <span class="calib-value">{aimView()[axis.key]}</span>
              <span class="calib-hint">{axis.hint}</span>
            </label>
          )}
        </For>

        <div class="calib-section">移動</div>
        <label class="calib-row">
          <span class="calib-label">速度</span>
          <input
            type="range"
            min="1.5"
            max="6"
            step="0.1"
            value={moveSpeed()}
            onInput={(e) => updateMoveSpeed(Number(e.currentTarget.value))}
          />
          <span class="calib-value">{moveSpeed().toFixed(1)}</span>
          <span class="calib-hint">クリップ実測は 2.55〜3.26。離れるほど速回しに見える (m/s)</span>
        </label>
        <label class="calib-row">
          <span class="calib-label">構え中</span>
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={aimSpeedScale()}
            onInput={(e) => updateAimSpeedScale(Number(e.currentTarget.value))}
          />
          <span class="calib-value">{aimSpeedScale().toFixed(2)}</span>
          <span class="calib-hint">
            構え中の速度倍率。現在 {(moveSpeed() * aimSpeedScale()).toFixed(1)} m/s
          </span>
        </label>

        <div class="calib-section">ジャンプ</div>
        <For each={JUMP_AXES}>
          {(axis) => (
            <label class="calib-row">
              <span class="calib-label">{axis.label}</span>
              <input
                type="range"
                min={axis.min}
                max={axis.max}
                step={axis.step}
                value={jump()[axis.key]}
                onInput={(e) => updateJump(axis.key, Number(e.currentTarget.value))}
              />
              <span class="calib-value">{jump()[axis.key]}</span>
              <span class="calib-hint">{axis.hint}</span>
            </label>
          )}
        </For>

        <div class="calib-section">画面全体の明るさ</div>
        <label class="calib-row">
          <span class="calib-label">露出</span>
          <input
            type="range"
            min="0.4"
            max="6"
            step="0.05"
            value={exposure()}
            onInput={(e) => updateExposure(Number(e.currentTarget.value))}
          />
          <span class="calib-value">{exposure().toFixed(2)}</span>
          <span class="calib-hint">トーンマッピングの露出。1.0 が素通し</span>
        </label>

        <pre class="calib-snippet">{snippet()}</pre>
        <button class="calib-reset" onClick={reset}>
          初期値に戻す
        </button>
      </div>
    </div>
  )
}
