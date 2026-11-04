import * as THREE from 'three'
import type { NetTransport } from '../../../application/protocol/types'
import { canThrowWith } from '../../../domain/player/cqc'
import type { Team } from '../../../domain/player/player'
import { stunChargeSeconds, type Skills } from '../../../domain/player/skill'
import { stunCharge, stunReadyAfter } from '../../../domain/rule/damage'
import type { Inventory } from '../../../domain/item/inventory'
import type { Input } from '../../../infra/input'
import type { RemoteSoldiers } from '../actor/remoteSoldier'
import type { Soldier } from '../actor/soldier'
import type { StunSparks } from '../fx/stunSparks'
import type { GameAudio } from '../sense/audio'
import type { FollowCamera } from '../sense/camera'

/**
 * **自機の近接: ナイフと CQC。** 引き金 1 本を、手にある物と構えで「刺す / 眠らせる刺突 / CQC」に振り分ける。
 *
 * Game.ts の中にあった (2026-11-03 本人「3 歩目もやろう」で外へ)。Game は毎フレーム updateTrigger と
 * updateStab を呼ぶだけ。要る物は MeleeHost で受け取る — 銃のリロード中か・投げ切る型の最中か・
 * 当てた表示は Game (と銃・投げ物) の持ち物なので、問いと頼みの形で借りる
 */

/**
 * 刺突の判定を出すタイミング (クリップ尺に対する割合)。
 *
 * **腕が伸び切る直前。** 頭で出すと刃が届く前に倒れ、遅いと刺さってから間が
 * 開いて倒れる。立ちの刺突 (stab、57 コマ) は 9〜12 コマ目で腕が伸び、12 コマ目で
 * 伸び切って 24 コマ目まで保つ (右肩から手まで 0.35 → 0.61m、soldier.glb で実測)。
 * 10.5 コマ目 = 19%。以前の 35% は伸び切ってから 0.4 秒後で、「刺さってから
 * ちょっと間が開いてやられる」だった (本人 2026-10-08)。しゃがみも同じ型
 */
const STAB_HIT_PHASE = 0.19
/** 伏せた刺突 (prone_stab、41 コマ)。11〜17 コマ目で伸びるので、伸び切る直前の 15 コマ目 */
const PRONE_STAB_HIT_PHASE = 0.36
/** 刺突モーションの尺のフォールバック (秒)。クリップが無いとき用 */
const FALLBACK_STAB_DURATION = 1.9

/**
 * CQC の拳の音を、型が始まってから鳴らすまで (秒)。**手が伸び始める所に合わせる** — 型の頭で鳴らすと
 * まだ手を伸ばしていないのに声が出た (2026-11-04 本人「もう 0.1 秒くらい遅く」)。他人の CQC も同じ
 */
export const PUNCH_DELAY = 0.1

/** 近接が借りる物。Game が渡す */
export interface MeleeHost {
  readonly player: Soldier
  readonly remotes: RemoteSoldiers
  readonly net: NetTransport
  readonly audio: GameAudio
  readonly follow: FollowCamera
  readonly input: Input
  readonly inv: Inventory
  readonly stunSparks: StunSparks
  skills(): Skills
  /** その人は敵か (ルールに聞く。個人戦では同じ色でも敵) */
  hostileTo(id: string, side: Team): boolean
  /** 手を使ってよいか (動ける状態で、装備の画面が出ていない) */
  canUseHands(): boolean
  /** 弾倉を替えている最中か */
  reloading(): boolean
  /** 投げ切る / 置き切る型の最中か (手を離れるまで) */
  releasing(): boolean
  /** 当てた部位を HUD に出す */
  showHit(zone: string): void
}

export class Melee {
  private readonly host: MeleeHost

  constructor(host: MeleeHost) {
    this.host = host
  }

  /** 刺突の残り時間 (秒)。0 より大きい間は発砲できない */
  stabTimer = 0
  /** 判定を出したか。1 回の振りで 1 回だけ */
  private stabResolved = true
  private readonly meleeForward = new THREE.Vector3()

  /** いま振っている刺突の判定を出す位置 (STAB_HIT_PHASE / PRONE_STAB_HIT_PHASE) */
  private stabHitPhase = STAB_HIT_PHASE
  /** いま振っているのが眠らせる刺突 (スタンナイフ) か */
  private stabStun = false
  /**
   * スタンナイフの充電が満ちる時刻 (Date.now)。**湧いた時に今へ戻す** (満ちた状態)。
   * 審判も同じ時計を持っていて、満ちる前の当たりは通さない (server/damage.ts)
   */
  stunReadyAt = 0

  /** スタンナイフの充電 (0〜1)。HUD のメーター */
  get stunChargeNow(): number {
    return stunCharge(this.stunReadyAt, Date.now(), stunChargeSeconds(this.host.skills()))
  }

  /**
   * ナイフを振り始める。リロード中と多重の振りは受け付けない。
   *
   * stun = 眠らせる刺突。**充電が満ちていなければ振らない** (空振りもしない)。
   * 振ったら空振りでも充電は空になる
   */
  private startStab(stun = false): void {
    if (this.stabTimer > 0 || this.host.reloading() || this.host.player.rolling) return
    if (stun && this.stunChargeNow < 1) return
    this.stabStun = stun
    if (stun) {
      this.stunReadyAt = stunReadyAfter(Date.now(), stunChargeSeconds(this.host.skills()))
      /*
       * **バチバチと刃先が光る。** 振り始めから腕が伸び切る所まで。刃が無ければ
       * (模型が届く前) 右手から。音も同じ所で鳴らし、他の人へも知らせる (zap)
       */
      this.host.stunSparks.discharge((out) => this.host.player.knifeTip(out) ?? this.host.player.handWorld(out))
      this.host.audio.play('zap', this.host.player.position)
      this.host.net.send({ type: 'zap', id: this.host.net.id })
    }
    this.stabTimer = this.host.player.stabDuration || FALLBACK_STAB_DURATION
    this.stabResolved = false
    // 型が違うので腕が伸びる所も違う。振り始めの姿勢で決める
    this.stabHitPhase = this.host.player.isProne ? PRONE_STAB_HIT_PHASE : STAB_HIT_PHASE
    this.host.player.stab()
  }

  /**
   * 刺突の進行。モーションの途中で 1 回だけ判定を出す。
   * 判定はキャラの向きを基準にする (カメラではなく体の正面)。
   */
  updateStab(dt: number): void {
    if (this.stabTimer <= 0) return
    const total = this.host.player.stabDuration || FALLBACK_STAB_DURATION
    const elapsed = total - this.stabTimer
    this.stabTimer -= dt

    if (this.stabResolved || elapsed < total * this.stabHitPhase) return
    this.stabResolved = true

    // yaw = θ のときローカル -Z が (-sinθ, 0, -cosθ)
    const yaw = this.host.player.yaw
    this.meleeForward.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    /*
     * 振ったことだけ知らせる。**当たったかどうかは言わない。**
     *
     * decoy は風船なので刃でも割れるが、割るのはサーバー。位置も向きも
     * あちらが持っているので、「刺した」と言わせない — 言えるようにすると、
     * **刺していないのに割ったことにして相手を晒せる**。
     *
     * 空振りでも送る。手元では割れたかどうかが分からない (decoy かどうかを
     * 手元で決めると、そこが嘘の入り口になる)。
     */
    this.host.net.send({ type: 'stab' })

    const result = this.host.remotes.hitMelee(
      this.host.player.position,
      this.meleeForward,
      // 見下ろしていれば倒れている相手にも届く。構えていなければ水平とみなす
      this.host.player.isAiming ? this.host.follow.aimPitch : 0,
      // 倒れた相手には屈んで (しゃがみ / 伏せ) 見下ろしたときだけ届く
      this.host.player.stance,
    )
    if (!result) return

    // 味方に当てた。申告は送らない (サーバーが捨てるが、送る意味も無い)。
    // 表示だけは出す。当たったこと自体が分からないと、撃ち続けてしまう。
    //
    // **敵かどうかはルールに聞く。** 個人戦では同じ色でも敵で、陣営で見ていると
    // 刺しても何も起きない
    if (!this.host.hostileTo(result.id, result.side)) {
      this.host.showHit('FF')
      return
    }

    /*
     * 手元の表示。**削る量を決めるのはサーバー。**
     *
     * 背後かどうかは申告に載せない — 位置と向きから分かるので、サーバーが
     * 通ったコマから出す (sim/judge/hitcheck.ts の isBackstab)。ここに残って
     * いるのは、刺した瞬間に何か出さないと手応えが無いから。**巻き戻しの
     * 結果と食い違うことはあり得る**が、数字が動くわけではない。
     */
    this.host.showHit(this.stabStun ? 'STUN' : result.fromBehind ? 'BACKSTAB' : 'KNIFE')
    // 刺さった音。**空振りでは鳴らさない** — 当てたかどうかで結果が全部決まる
    this.host.audio.play('stab', this.host.player.position)
    this.host.net.send({
      type: 'damage',
      id: this.host.net.id,
      target: result.id,
      kind: 'melee',
      // 眠らせる刺突。充電を確かめるのは審判
      ...(this.stabStun ? { stun: true } : {}),
    })
  }

  /**
   * 引き金は 1 本。手にある物が何をするかを決める。
   *
   * **撃つ・投げる・刺すが同じボタンになる。** 持ち替えて使う形にした以上、
   * 物ごとに別のキーを割り当てると「持ち替えたのに別のキーを押す」ことになって、
   * 持ち替えたこと自体が意味を失う。
   */
  updateTrigger(): void {
    // ナイフを持っている間、鍵盤の右クリックは眠らせる刺突 (構えは Shift)
    this.host.input.rightClickStuns = this.host.inv.held === 'knife'
    if (!this.host.canUseHands()) return
    if (this.host.inv.switching) return
    if (this.updateCqc()) return
    if (this.host.inv.held !== 'knife') return
    // ナイフは押した瞬間に振る。押しっぱなしで連打しない。
    // 引き金の面倒は持ち物が見る (domain/item/trigger.ts)
    /*
     * **構えていなければ刺さない。** ナイフを持っているだけで R2 で刺せた
     * (本人 2026-10-08)。銃と同じく、構えてから使う。押したことは消すので、
     * 押したまま構えても後から刺さない。
     *
     * 構えて 2 通り (MGO2 のスタンナイフ):
     *   殺す刺突      パッド R1 / 鍵盤 左クリック
     *   眠らせる刺突  パッド R2 / 鍵盤 右クリック (充電が満ちている時だけ。構えは Shift)
     */
    const aiming = this.host.player.isAiming
    const killTap = this.host.input.tapped('killStab')
    const stunTap = this.host.input.tapped('stunStab')
    if (this.host.input.firing && this.host.inv.pressedOnce) {
      this.host.inv.consumePress()
      if (aiming) this.startStab(this.host.input.firingByPad)
      return
    }
    if (!aiming) return
    if (killTap) this.startStab(false)
    else if (stunTap) this.startStab(true)
  }

  /**
   * CQC (domain/player/cqc.ts)。**構えずに引き金を引く。** 片手で持つ物 (拳銃・
   * ナイフ・投げる物・置く物) の時だけで、長物では何も起きない。
   *
   * 構えているかは**ボタンで見る** (input.aiming)。投げ物を構えている間は体の構え
   * (isAiming) が立たないので、そちらで見ると構えて引いた手榴弾が CQC に化ける
   *
   * **体の正面**の近くに立っている敵が居れば、そちらへ向き直って投げる。カメラの向きは
   * 見ない (本人 2026-10-12) — 別の方の相手に掛けたいなら、移動で体をそちらへ向けてから押す。
   * 居ない・しゃがんでいる・箱に入っている なら**空振り** — 型の後に棒立ちの隙が
   * 残る (soldier の cqcRecoverLeft)。掛かったかを決めるのはサーバー
   *
   * @returns 引き金を CQC に使った (刺突へは回さない)
   */
  /** 投げ切る型の最中に押された CQC。手を離れたら出す (updateCqc) */
  private cqcQueued = false

  private updateCqc(): boolean {
    if (this.host.input.aiming || this.host.player.isAiming || !canThrowWith(this.host.inv.held)) {
      this.cqcQueued = false
      return false
    }
    const pressed = this.host.input.firing && this.host.inv.pressedOnce
    if (pressed) this.host.inv.consumePress()
    if (!pressed && !this.cqcQueued) return false
    if (this.stabTimer > 0 || this.host.reloading()) return true
    /*
     * 投げ切る / 置き切る型の最中 (手を離れるまで最大 1 秒ほど)。**押したことは覚えておいて、
     * 手を離れた瞬間に出す。** 捨てていたので、手榴弾を投げてすぐ目の前の敵に掛けようと
     * すると何も起きなかった (本人 2026-10-12)
     */
    if (this.host.releasing()) {
      this.cqcQueued = true
      return true
    }
    this.cqcQueued = false
    const look = this.host.player.yaw
    this.meleeForward.set(-Math.sin(look), 0, -Math.cos(look))
    const target = this.host.remotes.cqcTarget(this.host.player.position, this.meleeForward, (id, side) =>
      this.host.hostileTo(id, side),
    )
    if (target?.throwable) {
      const face = Math.atan2(
        -(target.position.x - this.host.player.position.x),
        -(target.position.z - this.host.player.position.z),
      )
      if (this.host.player.cqc('cqc_throw', face)) {
        this.host.net.send({ type: 'cqc', target: target.id })
        this.punchSoon()
      }
      return true
    }
    // 相手が居れば、空振りでもそちらへ振る
    const face = target
      ? Math.atan2(
          -(target.position.x - this.host.player.position.x),
          -(target.position.z - this.host.player.position.z),
        )
      : look
    if (this.host.player.cqc('cqc_miss', face)) this.punchSoon()
    return true
  }

  /** 拳の音を PUNCH_DELAY 後に、その時の自分の位置で鳴らす */
  private punchSoon(): void {
    setTimeout(() => this.host.audio.play('punch', this.host.player.position), PUNCH_DELAY * 1000)
  }
}
