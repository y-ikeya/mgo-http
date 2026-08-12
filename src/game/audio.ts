import * as THREE from "three";

/**
 * 効果音。位置情報を持たせて鳴らす。
 *
 * ステルスゲームでは音が視覚と対になる索敵の手段になる。姿が見えない相手の位置は
 * 音でしか分からないので、最初から空間音響で鳴らす前提で組んでおく。
 * (視線が通っていなくても音は届く、というのが視覚情報との決定的な違い)
 *
 * <audio> ではなく Web Audio を使うのは、660 RPM = 90ms 間隔の発砲に
 * 再生の重なりと遅延で耐えられないため。three.js の Audio は Web Audio の薄い包み。
 */

/**
 * 効果音の種類と、それぞれの届く距離。
 *
 * 音ごとに変える必要がある。銃声は戦況を伝えるものなのでステージ全体に届いてよいが、
 * 足音は「近くに誰か居る」を伝えるものなので、遠くまで届くと常に鳴りっぱなしになり、
 * 情報として役に立たなくなる。
 *
 *   reference … この距離までは減衰しない
 *   max       … ここで完全に無音になる (linear モデル)
 */
const SOUNDS = {
  rifle: { file: "rifle.mp3", reference: 6, max: 130 },
  /**
   * 狙撃銃。1 発が 1.57 秒あり、後半にボルト操作の音が入っている。
   *
   * 届く距離を突撃銃より伸ばしてある。遠くから撃つ武器なので、
   * 撃った本人には安全でも**音は遠くまで届く**、という交換にする。
   */
  snipe: { file: "snipe.mp3", reference: 8, max: 170 },
  /** 弾倉の入れ替え。自分にしか要らないが、近くの相手には隙が伝わる */
  reload: { file: "reload.mp3", reference: 2, max: 24 },
  /**
   * 足音。20m で消える。
   *
   * 走り (音量 1.0) が 20m、しゃがみ (0.3) は実質 8m ほどで聞こえなくなる。
   * 姿勢ごとに max を変えなくても、音量の違いが届く距離の違いになる。
   */
  step: { file: "step.mp3", reference: 2, max: 20 },
  /** 金属の上を歩いたとき。届く距離はコンクリートと同じにして、材質の差だけ出す */
  metalStep: { file: "metal_step.mp3", reference: 2, max: 20 },
  /**
   * 木の上を歩いたとき。
   *
   * 専用の音源がまだ無いので、コンクリートの足音を低く落として代用している。
   * wood_step.mp3 を用意したら file を差し替えるだけでよい。
   */
  woodStep: { file: "step.mp3", reference: 2, max: 20, rate: 0.78 },
  /**
   * 転がり。体が地面に接する 1 回の音。
   *
   * 専用の音源がまだ無いので、足音を低く落として代用している。
   * roll.mp3 を用意したら file を差し替えるだけでよい。
   * 走るより遠くまで届く (26m) のは、体ごと投げ出す動作だから。
   */
  roll: { file: "step.mp3", reference: 3, max: 26, rate: 0.55 },
  /**
   * 投げた物が落ちた音。
   *
   * 足音より遠くまで届く (30m)。聞かせるために投げるものなので、
   * 届かなければ道具として成立しない。金属の音を少し高めにして、
   * 足音と取り違えないようにしてある。
   */
  clink: { file: "metal_step.mp3", reference: 3, max: 30, rate: 1.15 },
  /**
   * 倒れたときの叫び。
   *
   * 銃声と同じくらい遠くまで届く。誰かが倒れたことは戦況そのもので、
   * 「今そこで撃ち合いが終わった」を全員が知ってよい。
   * 撃った側にとっては当てた手応えになり、周りにとっては近づく合図になる。
   */
  scream: { file: "scream.mp3", reference: 8, max: 110 },
  /**
   * 頭に当たったのに倒れなかったときのうめき。
   *
   * 叫びより届く範囲をずっと狭くしてある。倒れたことは戦況だが、
   * 耐えたことは当人の事情で、遠くの人に知らせる筋のものではない。
   * 近くの相手にだけ「仕留め損ねた」と伝わる。
   */
  pain: { file: "pain.mp3", reference: 3, max: 26 },
  /**
   * 爆発。
   *
   * 銃声より遠くまで届く (160m)。**壁で遮っても聞こえる**のがこの音の役目で、
   * 「どこかで爆ぜた」は隠しようがない。見えない相手の位置は伏せているが、
   * 爆発だけは全員へ配っている (server の detonate) のと同じ理由。
   */
  explosion: { file: "explosion.mp3", reference: 12, max: 160 },
  /**
   * 手榴弾が跳ねた音。
   *
   * 弾倉の囮 (clink) より低く、少し遠くまで届く。足元へ転がってきたことに
   * 気付けないと、逃げるという手が最初から無い。
   */
  bounce: { file: "metal_step.mp3", reference: 4, max: 38, rate: 0.82 },
} as const;

export type SoundName = keyof typeof SOUNDS;

/** 同時に鳴らせる数。使い回しなので撃ち続けても増えない */
const POOL_SIZE = 12;

/** 再生ごとのピッチのゆらぎ。同じ波形の繰り返しが機械的に聞こえるのを防ぐ */
const PITCH_JITTER = 0.06;

/**
 * 音は当たり判定に影響しないので、乱数を同期する必要がない。
 * ここだけは Math.random() でよい (弾道の散布や反動とは扱いが違う)。
 */
const jitter = () => 1 + (Math.random() * 2 - 1) * PITCH_JITTER;

export class GameAudio {
  readonly listener = new THREE.AudioListener();

  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly pool: THREE.PositionalAudio[] = [];
  private readonly anchors: THREE.Object3D[] = [];
  private next = 0;
  private readonly listenerPosition = new THREE.Vector3();
  private disposed = false;

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    // 聴取点はカメラ。三人称なので厳密にはキャラの耳ではないが、
    // プレイヤーが見ている場所と音の定位が一致するほうが分かりやすい。
    camera.add(this.listener);

    for (let i = 0; i < POOL_SIZE; i++) {
      const anchor = new THREE.Object3D();
      const sound = new THREE.PositionalAudio(this.listener);
      // linear は max で完全に無音になる。どこまで聞こえるかを距離で言い切れるので、
      // 索敵の設計として扱いやすい。距離そのものは鳴らすときに音ごとへ差し替える。
      sound.setDistanceModel("linear");
      anchor.add(sound);
      scene.add(anchor);
      this.pool.push(sound);
      this.anchors.push(anchor);
    }

    void this.load();
  }

  /**
   * ブラウザはユーザー操作があるまで音を出せない。
   * ポインタロックを取るクリックのタイミングで呼ぶ。
   */
  resume(): void {
    const context = this.listener.context;
    if (context.state === "suspended") void context.resume();
  }

  /**
   * 指定位置で 1 回鳴らす。プールを使い回すので鳴らしっぱなしでも増えない。
   * @param volume 0..1。近くで聞いたときの大きさ
   * @param range 届く距離の倍率。しゃがみのように「近くなら聞こえるが遠くへは届かない」
   *   を作るのはこちら。音量だけ下げても減衰の形が同じなので、届く距離はほぼ変わらない
   * @returns 聴取点で実際に聞こえた強さ (0..1)。0 なら届いていない。
   *   レーダーはこれをそのまま使う。「聞こえたものだけ映る」を別々の計算で
   *   判断すると、耳とレーダーが食い違う。
   */
  play(name: SoundName, position: THREE.Vector3, volume = 1, range = 1): number {
    const buffer = this.buffers.get(name);
    if (!buffer) return 0;

    const sound = this.pool[this.next];
    const anchor = this.anchors[this.next];
    this.next = (this.next + 1) % POOL_SIZE;

    if (sound.isPlaying) sound.stop();
    anchor.position.copy(position);
    const profile = SOUNDS[name];
    sound.setRefDistance(profile.reference * range);
    sound.setMaxDistance(profile.max * range);
    sound.setBuffer(buffer);
    sound.setVolume(volume);
    // 音ごとの基準の高さに、毎回のゆらぎを掛ける
    sound.setPlaybackRate(("rate" in profile ? profile.rate : 1) * jitter());
    sound.play();

    return this.audibility(position, profile.reference * range, profile.max * range) * volume;
  }

  /**
   * 聴取点でどれだけの強さで聞こえるか (0..1)。
   *
   * linear モデルと同じ式を使う。Web Audio の内部値は取り出せないので、
   * ここで同じ計算をする。距離の設定を変えたら両方が同時に変わるよう、
   * 引数は鳴らすときと同じものを渡している。
   */
  private audibility(position: THREE.Vector3, reference: number, max: number): number {
    const distance = this.listener.getWorldPosition(this.listenerPosition).distanceTo(position);
    if (distance <= reference) return 1;
    if (distance >= max) return 0;
    return 1 - (distance - reference) / (max - reference);
  }

  dispose(): void {
    this.disposed = true;
    for (const sound of this.pool) {
      if (sound.isPlaying) sound.stop();
      sound.removeFromParent();
    }
    for (const anchor of this.anchors) anchor.removeFromParent();
    this.listener.removeFromParent();
  }

  private async load(): Promise<void> {
    const loader = new THREE.AudioLoader();
    await Promise.all(
      (Object.entries(SOUNDS) as [SoundName, (typeof SOUNDS)[SoundName]][]).map(
        async ([name, profile]) => {
          try {
            const buffer = await loader.loadAsync(
              `${import.meta.env.BASE_URL}audio/${profile.file}`,
            );
            if (!this.disposed) this.buffers.set(name, buffer);
          } catch (error) {
            // 音が無くてもゲームは成立する
            console.error(`[Audio] 読み込みに失敗: ${profile.file}`, error);
          }
        },
      ),
    );
  }
}
