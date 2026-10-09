import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadSoldier } from './assets'
import { buildLights } from './world/stage'
import { CharacterAnimator, findBoneBySuffix } from './actor/animation'
import { Weapon, type WeaponKind } from './arms/weapon'
import { DEFAULT_EXPOSURE } from './calibration'

/** 模型の正面は +Z、根は -Z が前 (soldier.ts と同じ) */
const MODEL_YAW_OFFSET = Math.PI
/** 少し斜めに立たせる。真正面だと銃が体に重なって形が読めない */
const TURN = -0.35

/**
 * 待合室 (ReadyRoom) の左に立つ自分の兵士。
 *
 * **試合の描画器とは別に持つ。** 支度の間は戦場に体が無い (湧く前) ので、
 * 試合の場面に置く物が無い。小さい描画器を 1 つ立てて、閉じたら捨てる。
 * 型と銃の付け方は試写 (tools/preview/body.tsx) と同じく本物の animator を通す。
 */
export class Portrait {
  private readonly renderer = new WebGPURenderer({ antialias: true, alpha: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50)
  private readonly clock = new THREE.Clock()
  private readonly resize = new ResizeObserver(() => this.fit())
  private anim: CharacterAnimator | null = null
  private weapon: Weapon | null = null
  private disposed = false

  private readonly host: HTMLElement

  constructor(host: HTMLElement, skin: string, gun: WeaponKind | null) {
    this.host = host
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    host.appendChild(this.renderer.domElement)
    buildLights(this.scene)
    this.camera.position.set(0, 1.05, 4.6)
    this.camera.lookAt(0, 0.92, 0)
    this.resize.observe(host)
    this.fit()
    this.mark(`作った (${skin}, ${gun ?? '銃なし'})`)
    this.build(skin, gun).catch((error) => {
      this.mark(`失敗: ${error}`)
      console.error('[Portrait] 兵士を出せない', error)
    })
  }

  /**
   * いまどこまで進んだか。**画面に兵士が出ない時の手掛かり** — 試写では出るのに
   * 試合の画面で出なかった (2026-10-09)。置き場 (host) の data-portrait と
   * コンソールの [Portrait] に残す
   */
  private mark(state: string): void {
    this.host.dataset.portrait = state
    console.info(`[Portrait] ${state}`)
    // 原因が分かるまで画面にも出す (左下に小さく)。分かったら消す
    if (!this.status) {
      this.status = document.createElement('div')
      Object.assign(this.status.style, {
        position: 'absolute', left: '12px', bottom: '12px', zIndex: '1',
        font: '11px ui-monospace, monospace', color: 'rgba(200,220,180,0.7)', whiteSpace: 'pre',
      })
      this.host.appendChild(this.status)
    }
    this.status.textContent += `${this.status.textContent ? '\n' : ''}${state}`
  }

  private status: HTMLDivElement | null = null

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private async build(skin: string, gun: WeaponKind | null): Promise<void> {
    const gltf = await loadSoldier(skin)
    if (this.disposed) return
    // 読んだ物は試合の兵士と共有している。**写して使う**
    const model = cloneSkinned(gltf.scene)
    // 動かした後の姿勢は外接の球に映らない。端で消えないよう切る (soldier.ts と同じ)
    model.traverse((obj) => {
      obj.frustumCulled = false
    })
    model.rotation.y = MODEL_YAW_OFFSET
    const root = new THREE.Group()
    root.rotation.y = Math.PI + TURN
    root.add(model)
    this.scene.add(root)

    const anim = new CharacterAnimator(model, gltf.animations, 4.5)
    anim.setLocomotion('idle' as never)
    // 銃は型を流す前の姿勢で付ける (soldier.ts と同じ順)
    anim.update(0)
    model.updateMatrixWorld(true)
    const right = findBoneBySuffix(model, 'RightHand')
    const left = findBoneBySuffix(model, 'LeftHand')
    if (gun && right && left) {
      const weapon = await Weapon.load(gun)
      if (this.disposed) {
        weapon.dispose()
        return
      }
      this.scene.add(weapon.object)
      weapon.attachTo(
        right,
        new THREE.Vector3().setFromMatrixPosition(right.matrixWorld),
        new THREE.Vector3().setFromMatrixPosition(left.matrixWorld),
        right.matrixWorld.clone(),
      )
      this.weapon = weapon
    } else {
      anim.setHandsEmpty(true)
    }
    this.anim = anim
    this.mark(`描き始め (${this.host.clientWidth}x${this.host.clientHeight})`)
    this.clock.start()
    void this.renderer.setAnimationLoop(() => this.frame())
  }

  private frames = 0

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 1 / 20)
    this.anim?.update(dt)
    try {
      this.renderer.render(this.scene, this.camera)
    } catch (error) {
      if (this.frames < 3) this.mark(`描けない: ${error}`)
    }
    this.frames++
    if (this.frames === 60) {
      const canvas = this.renderer.domElement
      const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend
      this.mark(`60 コマ描いた (${canvas.width}x${canvas.height}, ${backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL'})`)
    }
  }

  dispose(): void {
    this.disposed = true
    this.resize.disconnect()
    void this.renderer.setAnimationLoop(null)
    this.weapon?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
