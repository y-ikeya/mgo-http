/** 操作方法。auto は「最後に触ったほう」を使う */
export type InputDevice = 'auto' | 'keyboard' | 'gamepad'

/**
 * スティックの遊び。
 *
 * 安物のパッドは中立でも 0.1 前後を返し続けるので、これを取らないと
 * 手を離しているのにキャラが歩き、視点が回り続ける。
 */
const STICK_DEADZONE = 0.12

/**
 * 視点スティックの応答カーブの指数。
 *
 * 1 (線形) だと、細かく狙う領域と素早く振り向く領域を 1 本のスティックで
 * 両立できない。2 乗にすると倒し始めがゆっくりで、大きく倒したときだけ速くなる。
 */
const LOOK_CURVE = 2

/**
 * 視点スティックを倒し切ったときの速さ (px/秒 相当)。
 *
 * マウスの移動量 (px) と同じ単位に換算して camera.addLook へ渡すので、
 * 感度の設定はマウスと共有できる。
 */
const LOOK_SPEED = 1400

/**
 * ボタンの割り当て (標準マッピング)。
 *
 * PS5 のコントローラーはブラウザから "standard" として見えるので、
 * 添字で書ける。× □ ○ の位置は Xbox 系とも一致する。
 */
const PAD_BUTTONS = {
  /** R2 / RT */
  fire: [7, 5],
  /** L2 / LT */
  aim: [6, 4],
  /** × / A */
  roll: [0],
  /** □ / X */
  reload: [2],
  /** ○ / B */
  knife: [1],
  /** L3 / 左スティック押し込み */
  crouch: [10],
  /** △ / Y */
  box: [3],
  /** 十字キー上 */
  throwItem: [12],
  /** R3 / 右スティック押し込み。手榴弾 (押している間に落下点、離して投げる) */
  grenade: [11],
  /** 十字キー下 */
  salute: [13],
  /** OPTIONS / START */
  menu: [9],
  /** 十字キー左。銃の持ち替え (L1 は構えが使っている) */
  swap: [14],
  /** 十字キー右。倍率を 1 段上げる (一番上まで行ったら戻る) */
  zoom: [15],
} as const

type PadAction = keyof typeof PAD_BUTTONS

/**
 * これを押したら視点を掴む。
 *
 * 何のキーでも掴むようにすると、リロード (F5) や開発者ツールを開こうとした
 * ときにも画面が飛ぶ。遊ぶ操作に限る。
 */
/** ホイールを 1 段と見なす量 (画素)。マウスの 1 ノッチが 100 前後 */
const WHEEL_STEP = 40

/** 1 段動かしてから次まで空ける時間 (ms)。トラックパッドの一振りで飛ばないように */
const WHEEL_COOLDOWN = 140

const LOCK_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
  'KeyR', 'KeyF', 'KeyC', 'KeyG', 'KeyV', 'KeyQ', 'KeyZ', 'KeyE',
  // 装備を選ぶ。ポインタを掴んだままなのでボタンは押せない
  'Digit1', 'Digit2', 'KeyL',
])

/**
 * キーボード + マウス、およびゲームパッドの入力。
 *
 * キーは押下状態をポーリング、マウス移動は「前フレームからの差分」を溜めて
 * ゲームループ側が毎フレーム消費する。ポインタロック中しか視点操作は受け付けない。
 *
 * ゲームパッドは Gamepad API がイベントを出さないので毎フレーム読みに行く
 * (接続の抜き差しだけがイベント)。押した瞬間を取るために前フレームの状態を控える。
 */
export class Input {
  private readonly pressed = new Set<string>()
  /** このフレームに押し始めたキー。押しっぱなしの連続入力と区別するため */
  private readonly justPressed = new Set<string>()
  private target: HTMLElement | null = null

  /** 未消費のマウス移動量 (px) */
  private lookX = 0
  private lookY = 0

  /** 左ボタン押しっぱなし = フルオート射撃。発射レートはゲームループ側が管理する */
  private fireHeld = false
  /** 右ボタン押しっぱなし = 構え */
  private aimHeld = false

  /** どの操作方法を使うか */
  private device: InputDevice = 'auto'
  /** auto のときに実際に使っているほう。最後に入力があったデバイスへ倒れる */
  private lastUsed: 'keyboard' | 'gamepad' = 'keyboard'
  /** 接続中のパッドの index。無ければ null */
  private padIndex: number | null = null
  /** 前フレームのボタン状態。押した瞬間を取るのに使う */
  private padPrevious: boolean[] = []
  private padPressed: boolean[] = []
  /** スティックから作った、このフレームの視点移動量 (px 相当) */
  private padLookX = 0
  private padLookY = 0
  private padMoveX = 0
  private padMoveZ = 0

  private readonly onKeyDown = (e: KeyboardEvent) => {
    // Space はページスクロールを起こすので、操作中は既定動作を止める
    if (e.code === 'Space' && this.locked) e.preventDefault()
    // Tab は入力欄の移動に使われる。成績表を出すのに使うので押さえる
    if (e.code === 'Tab') e.preventDefault()

    // 動かそうとした時点で視点も掴む。
    //
    // ブラウザはユーザーの操作からしかポインタを掴ませてくれないので、
    // 画面を出した瞬間に自動で、というのはできない。ただ「まずクリック」を
    // 挟む必要は無い — 最初に押したキーがその操作を兼ねればいい。
    //
    // カーソルが要るときは Tab で外す、という約束にしたので、
    // 掴んでいない状態を待つ理由がそもそも無くなった。
    if (!this.locked && this.wantsLock && LOCK_KEYS.has(e.code)) this.requestLock()

    // 成績表を Tab で閉じるとき。掴み直すのはこの場でやる必要がある —
    // 実際に閉じるのは次の tick だが、その頃には「ユーザーの操作の最中」では
    // なくなっていて、ブラウザが掴ませてくれない。
    if (e.code === 'Tab' && !this.wantsLock) this.requestLock()
    // keydown はキーリピートで繰り返し飛んでくるので、初回だけ立ち上がりとして記録する
    if (!this.pressed.has(e.code)) this.justPressed.add(e.code)
    this.pressed.add(e.code)
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.code)
  }

  /** フォーカスを失うとキーの up を取りこぼすため、押しっぱなし状態を解除する */
  private readonly onBlur = () => {
    this.clearHeld()
  }

  private readonly onMouseDown = (e: MouseEvent) => {
    // ロック取得のためのクリックでは何も起こさない。効くのはロック中の押下だけ。
    if (!this.locked) {
      this.requestLock()
      return
    }
    if (e.button === 0) this.fireHeld = true
    if (e.button === 2) this.aimHeld = true
  }

  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.fireHeld = false
    if (e.button === 2) this.aimHeld = false
  }

  /** 右クリックでブラウザのメニューが出ると構えが解除されるため潰す */
  private readonly onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  /**
   * ホイールは倍率の上げ下げに使う。
   *
   * 送られてくる値が環境で桁違いに違うので、そのまま足すと使い物にならない。
   *
   *   マウス       1 ノッチで 100 前後 (画素) か 3 前後 (行)
   *   トラックパッド 2 本指で細かい値を大量に
   *
   * 単位を画素へ揃えたうえで、**一定時間に 1 段まで**に制限する。
   * 制限しないと、トラックパッドの一振りで 3 段飛ぶ。
   */
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.locked) return
    e.preventDefault()

    // 1 = 行、2 = 画面。画素へ均す
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
    this.wheelAccum -= pixels
    if (Math.abs(this.wheelAccum) < WHEEL_STEP) return

    const now = performance.now()
    if (now - this.wheelAt < WHEEL_COOLDOWN) {
      // 溜まりすぎを捨てる。指を離すまで段が進み続けるのを防ぐ
      this.wheelAccum = Math.sign(this.wheelAccum) * WHEEL_STEP
      return
    }
    this.wheelAt = now
    this.wheelSteps += Math.sign(this.wheelAccum)
    this.wheelAccum = 0
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return
    this.lookX += e.movementX
    this.lookY += e.movementY
  }

  /** Esc でロックが外れた瞬間に押しっぱなしを解除する (up イベントが来ないため) */
  private readonly onLockChange = () => {
    if (!this.locked) this.clearHeld()
  }

  /** 操作方法を切り替える。auto なら最後に触ったデバイスに従う */
  setDevice(device: InputDevice): void {
    this.device = device
    this.clearHeld()
  }

  get inputDevice(): InputDevice {
    return this.device
  }

  /** 実際に効いているほう。パネルの表示に使う */
  get activeDevice(): 'keyboard' | 'gamepad' {
    return this.device === 'auto' ? this.lastUsed : this.device
  }

  /** パッドが繋がっているか */
  get gamepadConnected(): boolean {
    return this.padIndex !== null
  }

  attach(target: HTMLElement): void {
    this.target = target
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    target.addEventListener('mousedown', this.onMouseDown)
    target.addEventListener('wheel', this.onWheel, { passive: false })
    target.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onLockChange)
    window.addEventListener('gamepadconnected', this.onPadConnected)
    window.addEventListener('gamepaddisconnected', this.onPadDisconnected)
    // 接続済みのパッドは connected イベントを出さない (ボタンを押すまで現れない
    // 実装もある)。読み込み時点で見えているものを拾っておく。
    this.findPad()
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.target?.removeEventListener('mousedown', this.onMouseDown)
    this.target?.removeEventListener('wheel', this.onWheel)
    this.target?.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    window.removeEventListener('gamepadconnected', this.onPadConnected)
    window.removeEventListener('gamepaddisconnected', this.onPadDisconnected)
    this.clearHeld()
    this.target = null
  }

  get locked(): boolean {
    return this.target !== null && document.pointerLockElement === this.target
  }

  /**
   * 操作を受け付けてよい状態か。
   *
   * マウスはポインタロックが要る (取らないと視点が回せず、クリックが
   * ロック要求に食われる)。パッドはロックと無関係に読めるので、
   * 繋がっていれば即座に操作できてよい。
   */
  get engaged(): boolean {
    return this.locked || (this.activeDevice === 'gamepad' && this.gamepadConnected)
  }

  get firing(): boolean {
    return this.fireHeld || this.padDown('fire')
  }

  /**
   * 構え。右クリックのほかに Shift も受ける。
   *
   * トラックパッドでは「右クリックを保持したまま左クリック」ができない
   * (二本指タップは押しっぱなしにできず、ctrl+クリックの保持も無理がある)。
   * 左手で押せるキーを用意しておかないと、マウス以外で撃てなくなる。
   */
  get aiming(): boolean {
    return (
      this.aimHeld || this.isDown('ShiftLeft') || this.isDown('ShiftRight') || this.padDown('aim')
    )
  }

  /**
   * 溜まったマウス移動量を返してリセットする。呼び出しは 1 フレーム 1 回。
   */
  consumeLook(out: { x: number; y: number }): { x: number; y: number } {
    out.x = this.lookX + this.padLookX
    out.y = this.lookY + this.padLookY
    this.lookX = 0
    this.lookY = 0
    return out
  }

  /**
   * WASD / 矢印キーを画面基準の移動入力に変換する。
   * x: 右が +、z: 奥(画面奥方向)が -。長さは 0..1 に正規化。
   */
  moveAxis(): { x: number; z: number } {
    // スティックが倒れていればそちらを優先する。倒し具合がそのまま速度になるので、
    // キーの 0/1 と混ぜると歩きたいのに走ってしまう。
    if (this.padMoveX !== 0 || this.padMoveZ !== 0) {
      return { x: this.padMoveX, z: this.padMoveZ }
    }

    const forward = this.isDown('KeyW') || this.isDown('ArrowUp')
    const back = this.isDown('KeyS') || this.isDown('ArrowDown')
    const left = this.isDown('KeyA') || this.isDown('ArrowLeft')
    const right = this.isDown('KeyD') || this.isDown('ArrowRight')

    let x = (right ? 1 : 0) - (left ? 1 : 0)
    let z = (back ? 1 : 0) - (forward ? 1 : 0)

    const len = Math.hypot(x, z)
    if (len > 1) {
      x /= len
      z /= len
    }
    return { x, z }
  }

  isDown(code: string): boolean {
    return this.pressed.has(code)
  }

  /**
   * パッドを読む。フレームの先頭で 1 回だけ呼ぶ。
   *
   * Gamepad API はスナップショットを返すので、保持した参照は更新されない。
   * 毎回 getGamepads() を引き直す必要がある。
   *
   * @param dt 前フレームからの経過 (秒)。視点の速さを時間基準にするのに使う
   */
  pollGamepad(dt: number): void {
    this.padLookX = 0
    this.padLookY = 0
    this.padMoveX = 0
    this.padMoveZ = 0
    this.padPrevious = this.padPressed
    this.padPressed = []

    if (this.device === 'keyboard') return

    const pad = this.padIndex === null ? null : navigator.getGamepads?.()[this.padIndex]
    if (!pad?.connected) return

    this.padPressed = pad.buttons.map((b) => b.pressed || b.value > 0.5)

    // 移動: 左スティック。倒し具合をそのまま速度に使うので、遊びを引いた後に
    // 0..1 へ引き伸ばす (引かないと、遊びの分だけ最高速に届かない)。
    const move = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0)
    this.padMoveX = move.x
    this.padMoveZ = move.y

    // 視点: 右スティック。マウスの移動量と同じ単位 (px) に換算して渡す。
    const look = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0)
    const magnitude = Math.hypot(look.x, look.y)
    if (magnitude > 0) {
      const scale = (Math.pow(magnitude, LOOK_CURVE) / magnitude) * LOOK_SPEED * dt
      this.padLookX = look.x * scale
      this.padLookY = look.y * scale
    }

    if (this.padActive()) this.lastUsed = 'gamepad'
  }

  /** 押しているか。パッドが無効なら常に false */
  private padDown(action: PadAction): boolean {
    if (this.device === 'keyboard') return false
    return PAD_BUTTONS[action].some((index) => this.padPressed[index])
  }

  /** このフレームに押し始めたか */
  private padJustPressed(action: PadAction): boolean {
    if (this.device === 'keyboard') return false
    return PAD_BUTTONS[action].some(
      (index) => this.padPressed[index] && !this.padPrevious[index],
    )
  }

  /** 何か触られているか。auto の切り替え判定に使う */
  private padActive(): boolean {
    if (this.padMoveX !== 0 || this.padMoveZ !== 0) return true
    if (this.padLookX !== 0 || this.padLookY !== 0) return true
    return this.padPressed.some(Boolean)
  }

  private readonly onPadConnected = (e: GamepadEvent) => {
    this.padIndex = e.gamepad.index
  }

  private readonly onPadDisconnected = (e: GamepadEvent) => {
    if (this.padIndex === e.gamepad.index) this.padIndex = null
    this.findPad()
  }

  /** 繋がっているパッドを探す。最初に見つかったものを使う */
  private findPad(): void {
    const pads = navigator.getGamepads?.() ?? []
    for (const pad of pads) {
      if (pad?.connected) {
        this.padIndex = pad.index
        return
      }
    }
    this.padIndex = null
  }

  /** このフレームに押し始めたか。消費するので 1 回の押下につき 1 回だけ true */
  consumeKeyPress(code: string): boolean {
    if (this.justPressed.delete(code)) {
      this.lastUsed = 'keyboard'
      return true
    }
    return false
  }

  /**
   * キーとパッドのどちらでも受ける「押しっぱなし」。
   * 押した瞬間ではなく、押している間ずっと効かせたい操作に使う。
   */
  isActionDown(action: PadAction, code: string): boolean {
    return this.pressed.has(code) || this.padDown(action)
  }

  /**
   * キーとパッドのどちらでも受ける操作。
   * 呼び出し側が「どのデバイスか」を気にせずに済むよう、ここで束ねる。
   */
  consumeAction(action: PadAction, code: string): boolean {
    // 両方を評価する。片方で early return すると、もう片方の立ち上がりが持ち越される。
    const key = this.justPressed.delete(code)
    const pad = this.padJustPressed(action)
    if (key) this.lastUsed = 'keyboard'
    return key || pad
  }

  /** フレーム末に呼ぶ。消費されなかった立ち上がりを持ち越さない */
  endFrame(): void {
    this.justPressed.clear()
  }

  /**
   * Esc 解除の直後に呼ぶとブラウザが SecurityError で弾くため、失敗は握り潰す。
   * (ユーザーがもう一度クリックすれば通る)
   */
  private requestLock(): void {
    const result = this.target?.requestPointerLock() as Promise<void> | undefined
    void result?.catch(() => {})
  }

  /**
   * 視点を掴んでよい状態か。成績表を開いている間は掴まない。
   *
   * 開いた側が閉じるまでカーソルを渡し続ける。裏で押したキーで掴み直すと、
   * ボタンを押そうとした瞬間に画面が飛ぶ。
   */
  wantsLock = true
  /** ホイールの溜め。1 段ぶん溜まったら steps へ移す */
  private wheelAccum = 0
  private wheelSteps = 0
  /** 直近に 1 段動かした時刻。連続で飛ばないように間隔を空ける */
  private wheelAt = 0

  /** ホイールが何段動いたか。読むと 0 に戻る (上が +) */
  consumeWheel(): number {
    const steps = this.wheelSteps
    this.wheelSteps = 0
    return steps
  }

  /** 視点を掴む。ユーザーの操作の最中から呼ぶこと */
  grab(): void {
    if (!this.locked) this.requestLock()
  }

  private clearHeld(): void {
    this.pressed.clear()
    this.justPressed.clear()
    this.fireHeld = false
    this.aimHeld = false
    this.lookX = 0
    this.lookY = 0
    this.padPressed = []
    this.padPrevious = []
    this.padLookX = 0
    this.padLookY = 0
    this.padMoveX = 0
    this.padMoveZ = 0
  }
}

/**
 * スティックの遊びを取り除く。
 *
 * 軸ごとに切ると斜め方向の遊びが正方形になり、対角線だけ利きが変わる。
 * 長さで判定して、残りを 0..1 へ引き伸ばす。
 */
function applyDeadzone(x: number, y: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y)
  if (magnitude < STICK_DEADZONE) return { x: 0, y: 0 }
  const scale = Math.min(1, (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / magnitude
  return { x: x * scale, y: y * scale }
}
