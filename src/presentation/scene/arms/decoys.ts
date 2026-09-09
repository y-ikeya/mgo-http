import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadSoldier } from '../assets'
import { skinFor } from '../actor/skin'
import { DEPLOY_SECONDS } from '../../../domain/item/decoy'

/**
 * 置かれた囮の人形。
 *
 * --- クレイモアと何が違うか ---
 * **見せるための物。** クレイモアは隠して置くので見つかった時点で仕事が半分
 * 終わるが、こちらは見えないと撃たせられない。だから配られ方も逆で、遮蔽で
 * 隠れる以外は敵にも届く。
 *
 * --- なぜ人の姿でなければならないか ---
 * 撃たれて初めて効くので、**撃ちたくなる形をしていないと置いても何も
 * 起きない。** 視界の端で人に見える必要がある。置いた本人と同じ見た目に
 * するのは、「その人が居る」と読ませるため — 別人の姿だと誰か分からない
 * 人形になって、撃つ理由が薄れる。
 *
 * 同時に**よく見れば分かる**ことも要る。分からないと「撃つのが常に損」に
 * なって撃ち合いそのものが止まる。**平たい台**がその手掛かりで、落ち着いて
 * 見る余裕があった側だけが騙されない。
 */

/** 台。**よく見れば分かる**ための手掛かり */
const BASE_RADIUS = 0.34
const BASE_HEIGHT = 0.04

/**
 * 膨らみ始めの大きさ。**0 にしない。**
 *
 * 完全に消えた所から始めると、何も無い床から突然生えたように見える。
 * 畳んだ物が置いてある、という所から始める。
 */
const START_SCALE = 0.12

/**
 * 膨らむ間の揺れ。**空気が入って首が振られる感じ。**
 *
 * 台に足が留められた物へ空気を押し込むと、上のほうほど大きく振れる。
 * 体ごと台の上で傾ける — **頭は根元から一番遠い**ので、傾けるだけで
 * 頭が一番大きく動く。頭の骨だけ回すと、体が固まったまま首だけ振れて
 * 人形というより壊れた玩具になる。
 *
 * 振れは膨らむにつれて収まる。張ってくれば揺れなくなる、という順。
 */
const WOBBLE_RAD = 0.22
/** 1 秒に何往復するか */
const WOBBLE_HZ = 2.6

/**
 * 静止させる型。**拳銃を提げて立っている姿。**
 *
 * 切れた人の姿 (away) は腕を開いた形で、描いてみると人形にしか見えなかった。
 * 一瞬「人が居る」と読ませるのが仕事なので、**戦場に立っている人と同じ形**で
 * なければならない。
 *
 * 小銃の脱力 (relaxed_idle) ではなく拳銃のほうを使う。人形は武器を持って
 * いないので、**両手で構える型だと手の中の空白が目立つ**。片手で提げている
 * 形なら、何も持っていないことが読まれにくい。
 *
 * 型は 1 枚だけ当てて止める。動かないこと自体は、台と並んで
 * 「よく見れば分かる」手掛かりになる。
 */
const POSE_CLIP = 'pistol_relaxed'

export class Decoys {
  private readonly scene: THREE.Scene
  private readonly live = new Map<
    number,
    {
      group: THREE.Group
      body: THREE.Object3D
      at: number[]
      yaw: number
      skin: string
      /** 膨らみ切るまでの残り (秒)。0 で立ち切る */
      inflating: number
      /** 揺れの位相。**物ごとにずらす** — 揃って揺れると仕掛けに見える */
      phase: number
    }
  >()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  has(id: number): boolean {
    return this.live.has(id)
  }

  at(id: number): THREE.Object3D | null {
    return this.live.get(id)?.group ?? null
  }

  /**
   * 置く。**姿は後から届く。**
   *
   * 台だけ先に出して、人形は読み込めたら足す。読み込みを待ってから出すと、
   * 置いた本人にも「置けた」が伝わらない間ができる。
   */
  place(id: number, at: readonly number[], yaw: number, owner: string, readyIn: number): void {
    if (this.live.has(id)) return

    const group = new THREE.Group()
    group.position.set(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0)
    group.rotation.y = yaw

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS, BASE_HEIGHT, 20),
      new THREE.MeshStandardMaterial({ color: 0x2a2f26, roughness: 0.9 }),
    )
    base.position.y = BASE_HEIGHT / 2
    base.receiveShadow = true
    group.add(base)

    /*
     * 人形を入れる袋。**伸ばす基点を足元へ置く。**
     *
     * 人の模型は原点が腰にある (足は 0.9m ほど下)。そのまま scale を掛けると
     * **腰を中心に伸び縮みする**ので、上下に同時に伸びて床へめり込む。
     * 袋を台の上に置いて、模型を袋の中で持ち上げてから掛ける。
     */
    const body = new THREE.Group()
    body.position.y = BASE_HEIGHT
    group.add(body)

    // 位相は id から。並べても揃わず、同じ物は何度描いても同じ形になる
    const entry = {
      group,
      body,
      at: [...at],
      yaw,
      skin: skinFor(owner),
      inflating: readyIn,
      phase: (id * 0.37) % 1,
    }
    this.applyScale(entry)
    this.live.set(id, entry)
    this.scene.add(group)

    void this.attachModel(id, entry)
  }

  /** 姿を読み込んで袋へ入れる。**間に合わなければ台だけのまま** */
  private async attachModel(id: number, entry: { body: THREE.Object3D; skin: string }): Promise<void> {
    let gltf
    try {
      gltf = await loadSoldier(entry.skin)
    } catch {
      return
    }
    // 消えた後に届くことがある
    if (this.live.get(id)?.body !== entry.body) return

    // **縮尺は掛けない。** 模型は既に等身大で入っている (soldier.ts も素で使う)
    const model = cloneSkinned(gltf.scene)
    /*
     * 足を台の上へ。**模型の原点は腰**なので、そのまま置くと膝まで埋まる。
     * 姿勢を当ててから測るのが正しいが、静止の 1 枚しか使わないので、
     * 当てた後の高さをそのまま読む。
     */
    const pose = gltf.animations.find((clip: THREE.AnimationClip) => clip.name === POSE_CLIP)
    if (pose) {
      const mixer = new THREE.AnimationMixer(model)
      mixer.clipAction(pose).play()
      /*
       * **1 枚だけ当てて、そこで止める。**
       *
       * setTime(0) では効かない。いまの時刻が 0 なので差が 0 になり、
       * 骨に何も書かれずバインドポーズ (T ポーズ) のまま残る。
       * 進めてから当てる。以後は誰も回さないのでそこで固まる。
       */
      mixer.update(0.001)
    }
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    model.position.y -= box.min.y

    model.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) obj.castShadow = true
    })
    entry.body.add(model)
  }

  /**
   * 膨らみを進める。
   *
   * **下から膨らむ。** 袋が台の上に立っているので、縦に伸ばせば足元から
   * 起き上がる形になる。横は縦より遅らせて、風船が立ち上がってから
   * 太る順にする。
   */
  update(dt: number): void {
    for (const entry of this.live.values()) {
      if (entry.inflating <= 0) continue
      entry.inflating = Math.max(0, entry.inflating - dt)
      this.applyScale(entry)
    }
  }

  private applyScale(entry: { body: THREE.Object3D; inflating: number; phase: number }): void {
    const done = 1 - Math.min(1, entry.inflating / DEPLOY_SECONDS)
    const grown = START_SCALE + (1 - START_SCALE) * done
    // 横は少し遅れて追いつく。**縦に立ってから太る**
    const wide = START_SCALE + (1 - START_SCALE) * done * done
    entry.body.scale.set(wide, grown, wide)

    /*
     * 空気が入って揺れる。**張ってくるほど収まる。**
     *
     * 位相を物ごとにずらす。並べて置いたときに揃って揺れると、風船ではなく
     * 仕掛けに見える。
     */
    const elapsed = DEPLOY_SECONDS - entry.inflating
    entry.body.rotation.z =
      Math.sin((elapsed * WOBBLE_HZ + entry.phase) * Math.PI * 2) * WOBBLE_RAD * (1 - done)
  }

  remove(id: number): void {
    const entry = this.live.get(id)
    if (!entry) return
    this.scene.remove(entry.group)
    entry.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) for (const m of material) m.dispose()
      else material?.dispose()
    })
    this.live.delete(id)
  }

  clear(): void {
    for (const id of [...this.live.keys()]) this.remove(id)
  }
}
