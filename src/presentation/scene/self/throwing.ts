import * as THREE from 'three'
import type { NetTransport } from '../../../application/protocol/types'
import { RELEASE_HEIGHT, throwSpeedOf } from '../../../domain/item/grenade'
import { isPlaceable, isThrownByHand, type HeldId } from '../../../domain/item/held'
import type { Inventory } from '../../../domain/item/inventory'
import { can } from '../../../domain/player/moves'
import { STEP_UP } from '../../../domain/player/moving'
import type { Team } from '../../../domain/player/player'
import type { Skills } from '../../../domain/player/skill'
import type { Input } from '../../../infra/input'
import { type PlaceSpot, placeSpot } from '../../../sim/judge/claymore'
import type { StageBox } from '../../../sim/space/vision'
import type { Soldier } from '../actor/soldier'
import type { Grenades } from '../arms/grenades'
import type { PlacePreview } from '../arms/placePreview'
import type { ThrownItems } from '../arms/thrown'
import type { Knobs } from '../calibration'
import { PRONE_GRENADE_RELEASE_RATIO } from '../knobs'
import type { FollowCamera } from '../sense/camera'
import type { Stage } from '../world/stage'

/**
 * **自機の投げる・置く。** 弾倉 (音で釣る)・手榴弾と E LOCATOR (投げる)・クレイモアと decoy と人形 (置く)。
 * どれも「構えている間は落ちる所 / 置く所を見せ、引き金で放す」の二段。
 *
 * Game.ts の中にあった (2026-11-03 本人「3 歩目もやろう」で外へ)。Game は毎フレーム
 * updateThrowAim → updateGrenadeAim → updateClaymoreRelease → updateGrenadeRelease を呼ぶだけ。
 * 引き金の立ち上がり (1 フレームに 1 回だけ数える)・ボルトを送っている最中か・陣営は Game の持ち物
 * なので ThrowingHost で借りる
 */

/**
 * 弾倉を投げてから次を構えられるまで (ms)。振りかぶりの型が無いので、手榴弾の
 * 「振り切ってからピンを抜く」(約 1.3 秒) に当たる間をここで置く
 */
const MAGAZINE_REARM_MS = 1000

/**
 * 手を離れる位置を、投げる向きへどれだけ前に出すか (m)。
 * server の RELEASE_FORWARD と揃える。
 *
 * 体の中心から出すと、真下へ投げたときに自分の足元をすり抜ける。
 * 腕を伸ばした先から出るようにする。
 */
const GRENADE_RELEASE_FORWARD = 0.45

/**
 * クレイモアが地面に着く位置。置く型に対する割合。
 *
 * **測った値を置く** (目分量だと手が上がりかけた後に現れる)。本人が作った
 * 0.90 秒の型 (2026-10-05) は右手が 2 度床へ下りる — 2〜3 コマ目と 23〜24 コマ目
 * (0.77〜0.80 秒、手の高さ 0.20m)。**後半の方で出す** (本人の指定)。前半で出すと
 * 残りの動きが「置いた物をいじっている」に見える。0.8 = 21.6 コマ目で、
 * 審判の返事 (claymorePlaced) が届いて絵に出るまでの往復ぶんだけ早めてある。
 *
 * Mixamo の 3.6 秒の型では 0.38 だった (右手が一番低い 0.37m の所)。
 */
const CLAYMORE_PLACE_RATIO = 0.8

/** 投げる・置くが借りる物。Game が渡す */
export interface ThrowingHost {
  readonly player: Soldier
  readonly input: Input
  readonly inv: Inventory
  readonly follow: FollowCamera
  readonly net: NetTransport
  readonly thrown: ThrownItems
  readonly grenades: Grenades
  readonly placePreview: PlacePreview
  readonly knobs: Knobs
  stage(): Stage
  /** 置けるかを見る箱 (地形が届くと入る) */
  placeSolid(): StageBox[]
  selfTeam(): Team
  skills(): Skills
  /** 動ける状態か (倒れていない・支度ではない) */
  canAct(): boolean
  /** ボルトを送っている最中か。送り終えるまで投げられない */
  cocking(): boolean
  /** 引き金をこのフレームで引いたか。**フレームの頭で 1 回だけ数えた物** */
  triggerEdge(): boolean
}

export class Throwing {
  private readonly host: ThrowingHost

  constructor(host: ThrowingHost) {
    this.host = host
  }

  /** 照準の起点と向き (毎回 follow から引き直す作業用) */
  private readonly aimOrigin = new THREE.Vector3()
  private readonly aimDir = new THREE.Vector3()
  /** 置く所 (placeSpot の書き込み先) */
  private readonly placeAt: PlaceSpot = { x: 0, y: 0, z: 0, ok: false }

  /** 投げ切る / 置き切る型の最中か (手を離れるまで)。CQC はその間押されたことを覚えておく */
  get releasing(): boolean {
    return this.grenadeRelease > 0 || this.setupRelease > 0
  }

  private grenadeAiming = false
  /** 構え始めと同じフレームに引かれた引き金。次のフレームで放す */
  private pendingThrow = false
  /** クレイモア側の同じもの */
  private pendingSetup = false
  /** 弾倉側の同じもの */
  private pendingDecoy = false

  /** 手を離れるまでの残り (秒)。0 なら投げていない */
  grenadeRelease = 0

  private readonly grenadeOrigin = new THREE.Vector3()
  /** 振りかぶった右手。予測線の頭をここから出す */
  private readonly throwHand = new THREE.Vector3()

  /** 投げる構えを取っているか。離した瞬間に投げる */
  private throwAiming = false

  /** 次の弾倉を構えられる時刻 (performance.now)。投げてから MAGAZINE_REARM_MS */
  private magazineReadyAt = 0

  /**
   * 投げる構えと、離したときの投擲。
   *
   * 押している間は落下点を見せ、離した瞬間に投げる。音で釣る道具なので、
   * どこへ落ちるかを見てから決められないと「そこへ落とす」判断にならない。
   * 押した瞬間に飛ぶ形だと、狙った場所へ落とすのが運になる。
   *
   * 数を限ってあるのは、無制限だと「とりあえず投げ続ける」が最適になって
   * 読み合いにならないため。1 回の命につき数発で、外せば手フラグが減る。
   */
  updateThrowAim(): void {
    // ボルトを送り終えるまでは投げられない。持ち替え・ダンボール・ローリング・
    // リロードと同じドメインルール。ここが抜けていて、撃った直後に投げるとコッキングを
    // 省略できた
    const canThrow =
      this.host.inv.held === 'magazine' &&
      this.host.canAct() &&
      can(this.host.player.body, 'throw') &&
      !this.host.cocking()
    const held = canThrow && this.host.input.aiming
    // 手榴弾・クレイモアと同じドメインルール。構え始めと同じフレームの分も覚えておく
    const pulled = this.host.triggerEdge() || this.pendingDecoy
    const release = held && this.throwAiming && pulled

    if (held && !release) {
      /*
       * **投げてすぐは構え直さない。** 弾倉には振りかぶりの型が無いので、構えを押したままだと
       * 投げた次のコマにはもう構えていて、引き金を連打するだけで投げ続けられた。手榴弾の
       * 「振り切ってからピンを抜く」に当たる間を置く (2026-10-25 本人「mag とかの投擲も同じだよね？」)
       */
      if (!this.throwAiming && performance.now() < this.magazineReadyAt) return
      this.host.follow.aimOrigin(this.aimOrigin)
      this.host.follow.aimDirection(this.aimDir)
      this.host.thrown.showPreview(this.aimOrigin, this.aimDir, this.host.stage().collidables, this.host.stage().water)
      if (!this.throwAiming) this.pendingDecoy = this.host.triggerEdge()
      this.throwAiming = true
      return
    }

    if (!this.throwAiming) return
    this.throwAiming = false
    this.pendingDecoy = false
    this.host.thrown.hidePreview()
    // 構えをやめただけ / 解かされただけ (死んだ・箱に入った) なら投げない
    if (!release || !canThrow) return

    this.host.inv.spend()
    this.magazineReadyAt = performance.now() + MAGAZINE_REARM_MS
    this.host.follow.aimOrigin(this.aimOrigin)
    this.host.follow.aimDirection(this.aimDir)
    this.host.thrown.throwFrom(this.aimOrigin, this.aimDir)
    this.host.net.send({
      type: 'throw',
      id: this.host.net.id,
      from: [this.aimOrigin.x, this.aimOrigin.y, this.aimOrigin.z],
      dir: [this.aimDir.x, this.aimDir.y, this.aimDir.z],
    })
  }

  /**
   * 手榴弾の構えと投擲。
   *
   * 弾倉と同じで、押している間に落下点を見せ、離した瞬間に投げる。
   * どこへ落ちるかを見てから決められないと「そこへ落とす」判断にならない。
   *
   * 信管は**手を離れてから**動き出す。握ったまま溜める手 (cooking) は入れていない。
   * 溜められると、構えている間ずっと残り時間を見せる必要が出てきて、
   * 「落下点を見る」ためのこの画面と役目がぶつかる。
   */
  /**
   * 手にある物で分ける。
   *
   * **投げるのは引き金。** 持ち替えて手にした物を、引き金で使う。物ごとに別の
   * キーを割り当てると「持ち替えたのに別のキーを押す」ことになって、持ち替えた
   * こと自体が意味を失う。
   *
   * **銃と同じ二段。** 構える (Shift / 右クリック) と振りかぶり、引き金 (左
   * クリック) で放す。銃は構えて撃つので、投げ物だけ別の操作にすると持ち替えた
   * ときに指が迷う。落下点は構えている間ずっと見えるので、狙ってから放せる。
   */
  /**
   * 握っていた手榴弾を手放す。
   *
   * **落としたのはサーバー** (転倒と仰け反りの所で足元に置いている)。こちらは
   * その分を持ち物から引いて、構えを畳むだけ。引かないと、画面の残り数だけが
   * 1 個多いまま残る。
   *
   * 振りかぶっていなければ何もしない — サーバーも同じ条件で見ている
   * (holdingGrenade)。
   */
  /** いま投げようとしている物。**振り切ったときに知らせる先が変わる** */
  private throwHeld: HeldId = 'grenade'

  loseHeldGrenade(): void {
    if (!this.grenadeAiming && this.grenadeRelease <= 0) return
    if (this.host.inv.held === 'grenade') this.host.inv.spend()
    this.grenadeAiming = false
    this.grenadeRelease = 0
    this.host.grenades.hidePreview()
    this.host.player.cancelThrow()
    this.host.player.setThrowing(false)
  }

  updateGrenadeAim(): void {
    // 手榴弾から離れたなら、構えも**落下点も**畳む。
    //
    // 消すのを忘れていて、構えたままダンボールを被ると放物線が出っぱなしに
    // なっていた。持ち替え・箱・死亡のどれでもここを通る
    //
    // **振り切っている最中は畳まない** (grenadeRelease > 0)。最後の 1 個を投げると
    // 持ち物から消えて次の武器へ移るので、投げの型がそこで中断されていた
    if (!isThrownByHand(this.host.inv.held) && this.grenadeAiming && this.grenadeRelease <= 0) {
      this.grenadeAiming = false
      this.host.grenades.hidePreview()
      this.host.player.cancelThrow()
      this.host.player.setThrowing(false)
    }
    // クレイモアから離れたときも同じ。**構えっぱなしで腕が上がったまま**になる
    if (!isPlaceable(this.host.inv.held) && this.setupAiming && this.setupRelease <= 0) {
      this.setupAiming = false
      this.host.placePreview.hide()
      this.host.player.cancelThrow()
      this.host.player.setThrowing(false)
    }
    /*
     * 置く物は同じ型を通す。**クレイモアも decoy も「かがんで置く」。**
     *
     * 違うのは置いた後だけなので、構えと置き切りの手順は分けない。
     * どちらを置いたかは setupHeld が覚えていて、知らせるときに分かれる。
     */
    if (isPlaceable(this.host.inv.held)) {
      this.setupHeld = this.host.inv.held
      this.updateClaymoreSetup()
      return
    }
    /*
     * **手榴弾と E LOCATOR は同じ型で投げる。**
     *
     * 違うのは手を離れた後だけ (爆ぜるか、置き続けるか) なので、構えと
     * 振りかぶりの手順は分けない。どちらを投げたかは throwHeld が覚えていて、
     * 知らせるときに分かれる (置く物で setupHeld がしているのと同じ形)。
     */
    if (!isThrownByHand(this.host.inv.held)) return
    this.throwHeld = this.host.inv.held
    // 倒れている間は投げられない。しゃがみと箱は許す (箱の中からは出せない)
    const canThrow =
      this.host.inv.countOf(this.host.inv.held) > 0 &&
      this.host.canAct() &&
      // 箱・倒れ・梯子・転がり・跳び越え・ぶら下がりは表 (domain/player/moves.ts) で弾く
      can(this.host.player.body, 'throw') &&
      // **転がりの絵が流れている間は振りかぶれない。** rolling より長い (尻尾の中で
      // 始まって見えない) ので、表の rolling とは別にここで見る
      !this.host.player.rollShowing &&
      !this.host.cocking()
    const held = canThrow && this.host.input.aiming
    /*
     * 構えている間に引き金を引いたら放す。押しっぱなしで連投しない。
     *
     * **同じフレームで構えて引いた分も覚えておく** (pendingThrow)。Shift と
     * クリックがほぼ同時だと、その回は「構え始め」で消えて、引いたことが
     * 無かったことになっていた。押した意思は消さずに、振りかぶりが始まった
     * 次のフレームで放す。
     */
    const pulled = this.host.triggerEdge() || this.pendingThrow
    const release = held && this.grenadeAiming && pulled

    if (held && !release) {
      /*
       * **前の 1 個が手を離れるまで、次を構え始めない。**
       *
       * 構えたまま (Shift を押したまま) 引き金を引くと、その次のフレームには
       * grenadeAiming が倒れていて「構え始め」に見える。そこで振りかぶりを
       * 頭から流し直していたので、**振り上げている最中に前の 1 個が飛んだ**。
       * 振り上げ切った時には 2 個目が構えられている、という形で出る。
       *
       * 手を離れるのは引き金を引いた 1.5 秒後まで遅れることがある
       * (振りかぶりの残りを待つため)。その間は投げの型が流れているので、
       * 新しい振りかぶりを重ねてはいけない。
       */
      if (this.grenadeRelease > 0) return
      /*
       * **振り切りが流れ終わるまで、次のピンを抜かない。** 手を離れた瞬間に次の振りかぶりを
       * 頭から流していたので、構えを押したままだと振り切りが打ち切られてピンを抜く動きが
       * 見えないまま構え終わり、続けざまに投げられた (2026-10-25 本人「L2 押しっぱで次の球が
       * すぐ投げられる、再度ピンを抜くモーションをしてくれないと連続で投げられる」)
       */
      if (!this.grenadeAiming && this.host.player.throwFollowingThrough) return

      // 構えた瞬間にピンを抜いて振りかぶり始める。腕を引き切った所で止まる。
      // 落下点はその間ずっと見える — どこへ落とすかを見てから放せるように
      if (!this.grenadeAiming) {
        this.host.player.playThrow()
        // 構え始めと同じフレームに引かれた分を覚えておく
        this.pendingThrow = this.host.triggerEdge()
      }
      this.grenadeAiming = true
      this.host.follow.aimDirection(this.aimDir)
      // 前へ出す量は水平方向だけで測る。見上げているときに近く、
      // 見下ろしているときに遠く、では手の位置が動いて見える
      const flat = Math.hypot(this.aimDir.x, this.aimDir.z) || 1
      // 手を離れる高さは構えで変わる。**伏せていれば腕も低い所を通る**
      // (サーバーが手榴弾を出す位置と同じ式。ここを変えるなら domain/item/grenade も)
      this.grenadeOrigin.set(
        this.host.player.position.x + (this.aimDir.x / flat) * GRENADE_RELEASE_FORWARD,
        this.host.player.position.y + RELEASE_HEIGHT[this.host.player.stance],
        this.host.player.position.z + (this.aimDir.z / flat) * GRENADE_RELEASE_FORWARD,
      )
      // 線の頭は振りかぶった右手から。軌道 (落ちる所) はサーバーと同じ origin のまま
      /*
       * **振りかぶり切ってから線を出す。** 取り出して腕を引いている間は右手が
       * 動くので、線の頭がそれに付いてうねる。引き切って手が止まり、実際に
       * 放せる状態になった時に初めて出す (それまで放しても手を離れないので、
       * 線が無くても嘘にならない)
       */
      if (this.host.player.throwWindupLeft > 0) {
        this.host.grenades.hidePreview()
      } else {
        const fromHand = this.host.player.rightHandAt(this.throwHand)
        this.host.grenades.showPreview(
          this.grenadeOrigin,
          this.aimDir,
          this.host.stage().thrownWorld,
          this.host.stage().water,
          throwSpeedOf(this.host.skills()),
          fromHand ? this.throwHand : undefined,
        )
      }
      // 体を照準の方へ向ける。投げる向きと見た目を一致させる
      this.host.player.setThrowing(true)
      return
    }

    if (!this.grenadeAiming) {
      /*
       * 振り切っている最中に構えをやめた。**投げない。**
       *
       * 手榴弾が手を離れるのは引き金を引いた 1.5 秒後まで遅れることがある
       * (振りかぶりが残っているぶん待つ)。その間に構えを解けば、腕は下りて
       * 型も畳まれる。**画面では投げていないのに手榴弾だけ飛んでいく**のは
       * 嘘になるので、離す前なら無かったことにする。
       *
       * ピンを戻したことになるが、そこを咎めるより「見た通りに起きる」ほうを
       * 取る。代わりに、投げ切りたければ手を離れるまで構えていることになる。
       */
      if (this.grenadeRelease > 0 && !held) {
        this.grenadeRelease = 0
        this.host.player.cancelThrow()
        this.host.player.setThrowing(false)
        return
      }
      // 構えても投げてもいない間だけ解く。放すまでは向きを保つ
      if (this.grenadeRelease <= 0) this.host.player.setThrowing(false)
      return
    }
    this.grenadeAiming = false
    this.pendingThrow = false
    this.host.grenades.hidePreview()

    // **構えをやめただけなら投げない。** 引き金を引いていないのに投げると、
    // 覗いて確かめる、が使えなくなる
    if (!release) {
      this.host.player.cancelThrow()
      this.host.player.setThrowing(false)
      return
    }

    // 構えを解かされただけ (倒された・箱に入った・死んだ) なら投げない。
    // 腕を下ろして構えに戻す。抜いたピンは無かったことになるが、
    // ここで爆発させると理不尽な死に方が増えるだけで読み合いにならない
    if (!canThrow) {
      this.host.player.cancelThrow()
      this.host.player.setThrowing(false)
      return
    }

    // **数を減らすのは手を離れたとき** (updateGrenadeRelease)。
    //
    // 引き金を引いた時点で減らしていたので、軽く叩いたとき (振りかぶりが
    // 残っている) に「まだ投げていないのに残り数が減る」が 1.5 秒続いていた。
    // 止めていた続きから振り切る。手を離れるのはその途中
    this.host.player.releaseThrow()
    // 残りは**いまどこまで再生されたか**から測る。
    //
    // 振りかぶりで止まっている前提で引くと、軽く叩いただけのときに
    // まだ腕を引いている途中なのに手を離れる。長押しなら 1.50 秒まで
    // 進んでいるので差は 0.16 秒、叩いただけならほぼ丸ごと残る。
    // **振りかぶりの残りを待ってから**、投げの型の途中で手を離れる。
    // 軽く叩いただけなら振りかぶりが残っているぶん遅れて出る
    // 放す割合は型ごと。**伏せの投擲は弧の頂点** (knobs.ts の注)
    const ratio = this.host.player.proneThrowing ? PRONE_GRENADE_RELEASE_RATIO : this.host.knobs.grenadeRelease
    this.grenadeRelease = Math.max(
      0.01,
      this.host.player.throwWindupLeft + ratio * this.host.player.throwReleaseDuration,
    )
  }

  /** クレイモアを構えているか */
  setupAiming = false
  /** いま置こうとしている物。**置き切ったときに知らせる先が変わる** */
  private setupHeld: HeldId = 'claymore'
  /** 置き切るまでの残り (秒)。0 になった瞬間にサーバーへ知らせる */
  setupRelease = 0

  /**
   * クレイモアを置く。
   *
   * 手榴弾と同じで、押している間は構えたまま止まり、離すと置く型が流れる。
   * **落下点は見せない** — 投げる物ではないので、置くのは自分の足元の前と決まっている。
   *
   * 置く型は 3.6 秒あって、その間ずっと無防備。置いて離れる道具の代償がここ。
   *
   * **置けない所では置く型に入らない。** 審判は壁際や縁の外を黙って弾く
   * (placeSpot)。客が見ずに型だけ流すと、しゃがんで立ち上がって何も出ない、
   * という形で出る。同じ式を手元で読んで、置けない間は引き金を無視して
   * 構えのまま留める。印は赤くなるので、動けば置けると分かる。
   */
  private updateClaymoreSetup(): void {
    const canPlace =
      this.host.inv.countOf(this.host.inv.held) > 0 &&
      this.host.canAct() &&
      // 手榴弾と同じ。条件は表 (domain/player/moves.ts)
      can(this.host.player.body, 'place') &&
      // 手榴弾と同じ。絵が終わるまで待つ
      !this.host.player.rollShowing &&
      !this.host.cocking()
    const held = canPlace && this.host.input.aiming
    // 手榴弾と同じドメインルール。**構え始めと同じフレームに引かれた分も覚えておく**
    const pulled = this.host.triggerEdge() || this.pendingSetup
    // 置く所。審判と同じ式 (向きは体の向き = 審判が受け取る yaw)
    const spot = held
      ? placeSpot(
          {
            x: this.host.player.position.x,
            y: this.host.player.position.y,
            z: this.host.player.position.z,
            yaw: this.host.player.yaw,
          },
          this.host.placeSolid(),
          STEP_UP,
          // 人が止まる面。審判と同じ (server/stage.ts の body)。無ければ箱で見る
          this.host.stage().moveWorld?.surfaces ?? null,
          this.placeAt,
        )
      : null
    if (spot && this.host.placeSolid().length === 0 && !this.host.stage().moveWorld) {
      // 箱も面もまだ無い (届いていない / 読めなかった)。地面が 0 に見えて高い所では
      // 全部「浮く」になるので、見ずに通す。弾くのは審判の仕事のまま
      spot.ok = true
      spot.y = this.host.player.position.y
    }
    // 構えている間だけ描く。置く型が流れ始めたら消す (置く所はもう決まった)
    if (spot && this.setupRelease <= 0) {
      this.host.placePreview.show(
        spot,
        this.host.player.yaw,
        this.setupHeld === 'claymore' ? 'fan' : this.setupHeld === 'doll' ? 'disc' : null,
        this.host.selfTeam(),
      )
    } else {
      this.host.placePreview.hide()
    }
    const placeable = !!spot?.ok
    if (pulled && !placeable) {
      // 置けない所で引いた。**捨てる** — 動いて置ける所へ来た時に勝手に置かれると、
      // 置く気の無い場所に置く。引き直してもらう
      this.pendingSetup = false
    }
    const release = held && this.setupAiming && pulled && placeable

    if (held && !release) {
      /*
       * **前の 1 個が手を離れるまで、次を構え始めない。**
       *
       * 手榴弾と同じ罠 (updateGrenadeThrow の grenadeRelease)。構えたまま
       * 引き金を引くと、その次のフレームには setupAiming が倒れていて
       * 「構え始め」に見える。そこで振りかぶりを頭から流し直すと、
       * **置く型の途中で立ち姿 (腰 1.00m) から始まる**ので、立ち上がって
       * しゃがみ直すように見えた。
       *
       * 置く型が流れている間 (setupRelease > 0) は何もしない。
       *
       * **置き切るまで次を構えない。** 手を離れた後も置く型は続いている
       * (置くのは型の 8 割の所)。そこで次の振りかぶりを頭から流すと、しゃがんで
       * 置いた人が立ち上がって見える (振りかぶりは立ち姿から始まる)
       */
      if (this.setupRelease > 0 || (!this.setupAiming && this.host.player.placing)) return

      if (!this.setupAiming) {
        this.host.player.playSetup()
        // 置けない所で引かれた分は覚えない (上と同じ理由)
        this.pendingSetup = this.host.triggerEdge() && placeable
      }
      this.setupAiming = true
      // 体をカメラの方へ向ける。置く向き = 自分の向きなので、これが照準になる
      this.host.player.setThrowing(true)
      return
    }

    if (!this.setupAiming) {
      /*
       * 置き切る前に構えをやめた。**置かない** (手榴弾と同じドメインルール)。
       *
       * 手を離れるのは引き金を引いたあと。その間に構えを解けば腕は下りるので、
       * 画面では置いていない。**見た通りに起きる**ほうを取る。
       */
      if (this.setupRelease > 0 && !held) {
        this.setupRelease = 0
        this.host.player.cancelThrow()
        this.host.player.setThrowing(false)
      }
      return
    }
    this.setupAiming = false
    this.pendingSetup = false
    this.host.placePreview.hide()
    // 構えをやめただけなら置かない。覗いて場所を確かめる、が使える
    if (!release || !canPlace) {
      this.host.player.cancelThrow()
      this.host.player.setThrowing(false)
      return
    }

    // **数を減らすのは置いた瞬間** (updateClaymoreRelease)
    this.host.player.releaseSetup()
    // 置き切るまでは向きを保つ。放した瞬間に向き直ると、置く先がずれる
    this.host.player.setThrowing(true)
    // 置く型の途中で手を離れる。振りかぶりが残っていればそのぶん待つ
    this.setupRelease = Math.max(
      0.01,
      this.host.player.throwWindupLeft + CLAYMORE_PLACE_RATIO * this.host.player.setupReleaseDuration,
    )
  }

  /** 置き切ったらサーバーへ知らせる。位置も向きもあちらが決める */
  updateClaymoreRelease(dt: number): void {
    if (this.setupRelease <= 0) return
    this.setupRelease -= dt
    if (this.setupRelease > 0) return
    this.setupRelease = 0
    this.host.player.setThrowing(false)
    // **数を減らすのはサーバーが置けたと言ってから** (claymorePlaced)。
    // 壁の中や縁の外は断られるので、送った時点で減らすと置けずに減る
    // **どちらを置いたかは構え始めに覚えてある。** 置き切るまでの間に
    // 持ち替えられても、流れていた型と知らせる先が食い違わない
    this.host.net.send(
      this.setupHeld === 'decoy'
        ? { type: 'decoy' }
        : this.setupHeld === 'doll'
          ? { type: 'doll' }
          : { type: 'claymore' },
    )
  }

  /** 投げる型が振り切る所で手を離す */
  updateGrenadeRelease(dt: number): void {
    if (this.grenadeRelease <= 0) return
    this.grenadeRelease -= dt
    if (this.grenadeRelease > 0) return
    this.grenadeRelease = 0
    this.host.player.setThrowing(false)
    // ここで初めて手を離れる。残り数が減るのもここ
    this.host.inv.spend()

    // 向きはこの瞬間のもの。放す所まで狙いを追えるようにする
    this.host.follow.aimDirection(this.aimDir)
    // 向きだけ送る。位置も速さもサーバーが決める (捏造した初速で
    // 地図の反対側まで飛ばせないように)
    //
    // **どちらを投げたかは構え始めに覚えてある** (throwHeld)。振り切るまでの
    // 間に持ち替えられても、流れていた型と知らせる先が食い違わない
    this.host.net.send({
      type: this.throwHeld === 'locator' ? 'locator' : 'grenade',
      dir: [this.aimDir.x, this.aimDir.y, this.aimDir.z],
    })
  }
}
