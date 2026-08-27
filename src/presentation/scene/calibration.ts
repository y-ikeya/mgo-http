import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { Player } from './actor/player'
import type { FollowCamera } from './sense/camera'
import type { Input, InputDevice } from '../../infra/input'
import { setBoxTuning, type BoxTuning } from './actor/box'
import { setAmbientIntensity, setCloudCoverage } from './world/stage'
import { GRENADE_RELEASE_RATIO, BOLT_DELAY, RELOAD_SOUND_AT } from './knobs'

/**
 * 調整パネル (開発時のみ) の受け口。
 *
 * --- なぜ本体から外したか ---
 * **デバッグ UI のために内部が開きっぱなしになっていた。** Game に
 * `setBoltDelay` `setCrouchTorsoYaw` … と 20 本以上の setter が生えていて、
 * 外から見ると「この値はいつでも変わりうる」ように読める。実際に変えるのは
 * 手元で `?panel=open` を付けたときだけなのに。
 *
 * 1 つの入れ物に集めて `game.calibration.…` にすると、**本体の顔から消える**。
 * 製品ビルドでは Calibrator ごと落ちるので、ここも呼ばれない。
 *
 * ここに在るのは**仮置きの数字**であって遊びのドメインルールではない (docs/design.md の
 * 7)。決まったものは domain へ移す — 弾の落下がそうだった。
 */

/** 調整パネルが動かす値。**Game が毎フレーム読む** */
export interface Knobs {
  /** 手を離れる位置。投げクリップに対する割合 (0..1) */
  grenadeRelease: number
  /** 撃ってからボルトに手を掛けるまで (秒) */
  boltDelay: number
  /** リロードの音を鳴らし始める位置 (0..1) */
  reloadSoundAt: number
  /** 弾に掛かる重力の上書き。null なら武器の値 (domain) をそのまま使う */
  bulletGravity: number | null
}

export function defaultKnobs(): Knobs {
  return {
    grenadeRelease: GRENADE_RELEASE_RATIO,
    boltDelay: BOLT_DELAY,
    reloadSoundAt: RELOAD_SOUND_AT,
    bulletGravity: null,
  }
}

export interface CalibrationTargets {
  knobs: Knobs
  player: Player
  follow: FollowCamera
  input: Input
  sun: THREE.DirectionalLight
  renderer: WebGPURenderer
}

/** 受け口を組み立てる。Game が 1 つだけ持つ */
export function createCalibration(t: CalibrationTargets) {
  return {
    /** 手に持つ物の位置と角度 */
    calibrateWeapon(target: Parameters<Player['calibrateWeapon']>[0], grip: THREE.Vector3, rotation: THREE.Euler) {
      t.player.calibrateWeapon(target, grip, rotation)
    },
    /** 吹き飛ばされる / 起き上がる型の再生速度 */
    setKnockdownRates(sweep: number, stand: number) {
      t.player.setKnockdownRates(sweep, stand)
    },
    setGrenadeRelease(ratio: number) {
      t.knobs.grenadeRelease = ratio
    },
    setBoltDelay(seconds: number) {
      t.knobs.boltDelay = seconds
    },
    setReloadSoundAt(ratio: number) {
      t.knobs.reloadSoundAt = ratio
    },
    /** 0 でまっすぐ飛ぶ */
    setBulletGravity(gravity: number) {
      t.knobs.bulletGravity = gravity
    },
    setBoxTuning(tuning: Partial<BoxTuning>) {
      setBoxTuning(tuning)
    },
    /** ナイフを出しっぱなしにする */
    setKnifePreview(visible: boolean) {
      t.player.setKnifePreview(visible)
    },
    /** 照準の上下が上半身に効く強度 */
    setAimPitchGain(gain: number) {
      t.player.setAimPitchGain(gain)
    },
    /** しゃがみ時に上半身を右へ旋回させる角度 (度) */
    setCrouchTorsoYaw(degrees: number) {
      t.player.setCrouchTorsoYaw(degrees)
    },
    setUpperTwistFix(amount: number) {
      t.player.setUpperTwistFix(amount)
    },
    /** 構えていないときの前傾 (度) */
    setRelaxedLean(degrees: number) {
      t.player.setRelaxedLean(THREE.MathUtils.degToRad(degrees))
    },
    /** 雲の量。小さいほど広く覆う */
    setCloudCoverage(coverage: number) {
      setCloudCoverage(coverage)
    },
    /** 日陰の明るさ (天空光) */
    setAmbientIntensity(intensity: number) {
      setAmbientIntensity(intensity)
    },
    setShadowIntensity(intensity: number) {
      t.sun.shadow.intensity = intensity
    },
    /** 画面全体の明るさ (トーンマッピングの露出) */
    setExposure(exposure: number) {
      t.renderer.toneMappingExposure = exposure
    },
    /** 構え時のカメラの寄り */
    setAimView(view: { distance: number; shoulder: number; fov: number }) {
      t.follow.setAimView(view)
    },
    setJumpTuning(gravity: number, height: number, fallScale: number) {
      t.player.setJumpTuning(gravity, height, fallScale)
    },
    setMoveSpeed(speed: number, aimScale: number) {
      t.player.setMoveSpeed(speed, aimScale)
    },
    /** 操作方法の切り替え。パッドを挿しても勝手には替えない */
    setInputDevice(device: InputDevice) {
      t.input.setDevice(device)
    },
    /** いまどちらで操作しているか。パネルの表示に使う */
    inputStatus(): { active: 'keyboard' | 'gamepad'; connected: boolean } {
      return { active: t.input.activeDevice, connected: t.input.gamepadConnected }
    },
  }
}

export type Calibration = ReturnType<typeof createCalibration>
