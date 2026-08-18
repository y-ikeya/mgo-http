import * as THREE from 'three'
import { loadClaymore } from './assets'

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
 * 同じ規則に従う。味方の物は無条件、敵の物はカメラから線が通ったときだけ。
 * 見えなくなれば claymoreGone (blast: false) が来て消える — 隠して置くことに
 * 意味がある道具なので、一度見せたまま残すとそこに在ることが漏れ続ける。
 *
 * つまり `place` / `remove` は**見え隠れでも呼ばれる**。起爆したかどうかは
 * blast で区別する。
 */

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
  private readonly live = new Map<number, { mesh: THREE.Object3D; at: number[]; yaw: number }>()
  private model: THREE.Object3D | null = null

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
        this.live.delete(id)
        this.place(id, entry.at, entry.yaw)
      }
    })
  }

  /**
   * 置かれた。
   *
   * yaw はサーバーの規約 (ローカル -Z が前) のまま渡ってくる。モデルも
   * 正面を -Z に揃えてある (tools/convert_prop.py) ので、そのまま回せばよい。
   */
  place(id: number, at: readonly number[], yaw: number): void {
    if (this.live.has(id)) return
    const mesh = this.model ? this.model.clone(true) : fallbackMesh()
    mesh.position.set(at[0], at[1], at[2])
    mesh.rotation.y = yaw
    this.scene.add(mesh)
    this.live.set(id, { mesh, at: [at[0], at[1], at[2]], yaw })
  }

  /** その id の置き場所。爆発を出す位置に使う */
  at(id: number): THREE.Vector3 | null {
    return this.live.get(id)?.mesh.position.clone() ?? null
  }

  /** 起爆した / 消えた。爆発そのものは blastfx が出す */
  remove(id: number): void {
    const entry = this.live.get(id)
    if (!entry) return
    this.scene.remove(entry.mesh)
    this.live.delete(id)
  }

  /** 試合の仕切り直し。置きっぱなしを持ち越さない */
  clear(): void {
    for (const entry of this.live.values()) this.scene.remove(entry.mesh)
    this.live.clear()
  }
}
