import * as THREE from 'three'
import type { Team } from '../../../application/protocol/types'

/**
 * 味方の名札。**見えている味方の頭の上に名前だけを出す** (2026-11-17 本人「1 だね、
 * ただ見えるのは名前だけでいい。red チームなら赤い文字で、blue なら青い文字で」)。
 *
 * --- 壁越しには出さない ---
 * 出すのは目で見えている味方だけ。壁の裏の味方を知らせるのは敬礼の光の仕事
 * (remoteSoldier.ts の ALLY_GLOW)。名札まで壁を抜けると、敬礼が要らなくなる。
 * 見えているかはカメラから頭への線で決める (呼ぶ側が判断して渡す)。
 *
 * --- 3D の中ではなく画面の上に文字で ---
 * 板 (Sprite) に描くと露出 (toneMappingExposure 3 前後) が文字にも掛かり、赤も青も
 * 白っぽく抜けた (WebGPU の描画は材質ごとの toneMapped: false を見ない)。名札は
 * 情報なので、明るさで色が変わっては困る。**頭の位置を画面へ写して、HTML の文字を
 * 置く。** 大きさも距離で変わらず、遠い味方でも同じ大きさで読める。
 *
 * --- 出さない物 ---
 * レベル・体力は出さない (本人)。名前だけ。
 */

/** 文字の色。味方の光 (remoteSoldier.ts の ALLY_GLOW_TINT) と同じ色 */
const NAME_COLOR: Record<Team, string> = {
  blue: '#5c8cff',
  red: '#ff6a4a',
}

/** 頭の上にどれだけ浮かせるか (m) */
const LABEL_LIFT = 0.45
/** カメラのすぐ前 (m) より手前は出さない。肩越しに重なった味方の名札が画面いっぱいに跳ねないように */
const NEAR = 0.3

export interface AllyName {
  id: string
  name: string
  team: Team
  /** 頭の位置 (世界)。名札はこの上に浮く */
  head: THREE.Vector3
}

interface Label {
  el: HTMLDivElement
  name: string
  team: Team
}

export class AllyNames {
  private readonly layer = document.createElement('div')
  private readonly labels = new Map<string, Label>()
  private readonly seen = new Set<string>()
  private readonly at = new THREE.Vector3()
  private readonly view = new THREE.Vector3()

  /** host は描画面を包む要素。名札はその上に重ねる */
  constructor(host: HTMLElement) {
    const s = this.layer.style
    s.position = 'absolute'
    s.inset = '0'
    s.pointerEvents = 'none'
    s.overflow = 'hidden'
    host.appendChild(this.layer)
  }

  /** このフレームに出す名札。渡されなかった人の名札は消す */
  sync(allies: Iterable<AllyName>, camera: THREE.Camera, width: number, height: number): void {
    this.seen.clear()
    for (const ally of allies) {
      this.at.set(ally.head.x, ally.head.y + LABEL_LIFT, ally.head.z)
      /*
       * **カメラの後ろは先に見る。** 写した後の z で見ていたら、背後の味方が画面の前へ
       * 裏返って映った (2026-11-17 本人「自分の後ろにいる味方の名前が写ってるの？」)。
       * 後ろの点は w が負になり、写した x・y・z が反転して画面の中に収まってしまう。
       * カメラから見た奥行き (前が -z) で決める
       */
      if (this.view.copy(this.at).applyMatrix4(camera.matrixWorldInverse).z > -NEAR) continue
      this.at.project(camera)
      if (Math.abs(this.at.x) > 1.1 || Math.abs(this.at.y) > 1.1) continue
      this.seen.add(ally.id)
      const label = this.labels.get(ally.id) ?? this.create(ally)
      if (label.name !== ally.name) {
        label.el.textContent = ally.name
        label.name = ally.name
      }
      if (label.team !== ally.team) {
        label.el.style.color = NAME_COLOR[ally.team]
        label.team = ally.team
      }
      const x = ((this.at.x + 1) / 2) * width
      const y = ((1 - this.at.y) / 2) * height
      label.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
    }
    for (const [id, label] of this.labels) {
      if (this.seen.has(id)) continue
      label.el.remove()
      this.labels.delete(id)
    }
  }

  private create(ally: AllyName): Label {
    const el = document.createElement('div')
    const s = el.style
    s.position = 'absolute'
    s.left = '0'
    s.top = '0'
    s.whiteSpace = 'nowrap'
    s.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, monospace'
    s.letterSpacing = '0.02em'
    // 明るい壁の前でも読めるよう、暗い縁取り
    s.textShadow = '0 0 2px #000, 0 0 2px #000, 1px 1px 1px #000'
    s.color = NAME_COLOR[ally.team]
    el.textContent = ally.name
    this.layer.appendChild(el)
    const label = { el, name: ally.name, team: ally.team }
    this.labels.set(ally.id, label)
    return label
  }

  dispose(): void {
    for (const label of this.labels.values()) label.el.remove()
    this.labels.clear()
    this.layer.remove()
  }
}
