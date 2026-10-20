import * as THREE from 'three'
import { loadClaymore } from '../assets'
import { refreshStaticShadows } from '../world/staticShadow'
import { TRIGGER_COS, TRIGGER_RANGE } from '../../../domain/item/claymore'
import type { Team } from '../../../domain/player/player'
import { zoneMaterial } from './cats'

/**
 * 置かれたクレイモア。
 *
 * --- 手榴弾と何が違うか ---
 * **飛ばない。** 置いた瞬間に位置と向きが決まって、起爆するまでそこに在る。
 * だから軌道も固定刻みも要らず、置く / 消すだけで済む。
 *
 * 位置を決めているのはサーバー。ここは配られた場所に置くだけで、
 * 起爆の判定も持たない — 誰が前を通ったかを知っているのはあちらなので。
 *
 * --- 見え方について ---
 * 配られるのは**見えている人にだけ**で、位置の配り方 (relayClaymores) と
 * 同じドメインルールに従う。味方の物は無条件、敵の物はカメラから線が通ったときだけ。
 * 見えなくなれば claymoreGone (blast: false) が来て消える — 隠して置くことに
 * 意味がある道具なので、一度見せたまま残すとそこに在ることが漏れ続ける。
 *
 * つまり `place` / `remove` は**見え隠れでも呼ばれる**。起爆したかどうかは
 * blast で区別する。
 */

/** 扇の弧を何本の線で描くか */
const FAN_STEPS = 24
/** 扇を床から浮かせる量 (m)。床と重なってちらつかないように */
const FAN_LIFT = 0.03

/**
 * sensor に掛かる扇 (置いた物の正面 -Z を中心に、TRIGGER_COS の角度まで、TRIGGER_RANGE の先まで)。
 * **爆風の届く所ではない** — 爆発半径は出さない (本人 2026-10-20)。形は置く前の予告 (placePreview.ts) と同じ
 */
function fanGeometry(): THREE.BufferGeometry {
  const half = Math.acos(TRIGGER_COS)
  const points = [0, FAN_LIFT, 0]
  for (let i = 0; i <= FAN_STEPS; i++) {
    const a = -half + (2 * half * i) / FAN_STEPS
    points.push(-Math.sin(a) * TRIGGER_RANGE, FAN_LIFT, -Math.cos(a) * TRIGGER_RANGE)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const index: number[] = []
  for (let i = 1; i <= FAN_STEPS; i++) index.push(0, i, i + 1)
  geometry.setIndex(index)
  return geometry
}

/** モデルが届くまでの仮の姿。板 1 枚。無いよりは置き場所が分かる */
function fallbackMesh(): THREE.Object3D {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.216, 0.09, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x3f4a32, roughness: 0.8 }),
  )
}

export class Claymores {
  private readonly scene: THREE.Scene
  /**
   * 置かれている物。**位置と向きも控える。**
   *
   * モデルは非同期で届くのに、置かれた物は**繋いだ瞬間に配られる**。
   * リロードして戻ると読み込みが間に合わず、仮の箱のまま残っていた。
   * 控えがあれば、モデルが届いたときに作り直せる。
   */
  private readonly live = new Map<
    number,
    { mesh: THREE.Object3D; fan: THREE.Mesh | null; at: number[]; yaw: number; zone: Team | null }
  >()
  private model: THREE.Object3D | null = null
  /**
   * sensor に掛かる扇。**置いた本人と味方にだけ** (猫の円と同じ。敵には見えない)。陣営の色
   * (基地の枠と同じ)、濃さも猫の円と同じ
   */
  private readonly fanShape = fanGeometry()
  private readonly fanMaterials: Record<Team, THREE.MeshBasicMaterial> = {
    blue: zoneMaterial('blue'),
    red: zoneMaterial('red'),
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene
    void loadClaymore().then((gltf) => {
      this.model = gltf.scene
      this.model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) obj.castShadow = true
      })
      // 間に合わなかったぶんを本物に差し替える
      for (const [id, entry] of [...this.live]) {
        this.scene.remove(entry.mesh)
        if (entry.fan) this.scene.remove(entry.fan)
        refreshStaticShadows()
        this.live.delete(id)
        this.place(id, entry.at, entry.yaw, entry.zone)
      }
    })
  }

  /**
   * 置かれた。
   *
   * yaw はサーバーの規約 (ローカル -Z が前) のまま渡ってくる。モデルも
   * 正面を -Z に揃えてある (tools/convert_prop.py) ので、そのまま回せばよい。
   * zone は扇を出す陣営の色 (置いた本人と味方の画面だけ)。敵の画面では null
   */
  place(id: number, at: readonly number[], yaw: number, zone: Team | null = null): void {
    if (this.live.has(id)) return
    const mesh = this.model ? this.model.clone(true) : fallbackMesh()
    mesh.position.set(at[0], at[1], at[2])
    mesh.rotation.y = yaw
    this.scene.add(mesh)
    let fan: THREE.Mesh | null = null
    if (zone) {
      fan = new THREE.Mesh(this.fanShape, this.fanMaterials[zone])
      fan.position.set(at[0], at[1], at[2])
      fan.rotation.y = yaw
      fan.renderOrder = 1
      this.scene.add(fan)
    }
    refreshStaticShadows()   // 置いた物は影マップに焼き直す
    this.live.set(id, { mesh, fan, at: [at[0], at[1], at[2]], yaw, zone })
  }

  /** その id の置き場所。爆発を出す位置に使う */
  /** もう置いてある物か。**同じ物が二度配られる** (見え隠れするたびに来る) */
  has(id: number): boolean {
    return this.live.has(id)
  }

  at(id: number): THREE.Vector3 | null {
    return this.live.get(id)?.mesh.position.clone() ?? null
  }

  /** 起爆した / 消えた。爆発そのものは blastfx が出す */
  remove(id: number): void {
    const entry = this.live.get(id)
    if (!entry) return
    this.scene.remove(entry.mesh)
    if (entry.fan) this.scene.remove(entry.fan)
    refreshStaticShadows()
    this.live.delete(id)
  }

  /** 試合の仕切り直し。置きっぱなしを持ち越さない */
  clear(): void {
    for (const entry of this.live.values()) {
      this.scene.remove(entry.mesh)
      if (entry.fan) this.scene.remove(entry.fan)
    }
    refreshStaticShadows()
    this.live.clear()
  }
}
