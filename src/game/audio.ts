import * as THREE from "three";

import { asset } from "./assets";

/**
 * 効果音。位置情報を持たせて鳴らす。
 *
 * ステルスゲームでは音が視覚と対になる索敵の手段になる。姿が見えない相手の位置は
 * 音でしか分からないので、最初から空間音響で鳴らす前提で組んでおく。
 * (視線が通っていなくても音は届く、というのが視覚情報との決定的な違い)
 *
 * <audio> ではなく Web Audio を使うのは、660 RPM = 90ms 間隔の発砲に
 * 再生の重なりと遅延で耐えられないため。three.js の Audio は Web Audio の薄い包み。
 *
 * --- 音源の名前 ---
 * public/audio/ に `<出どころ><番号>_<種類><番号>.mp3` で置く。
 *
 *   ak47_shot1.mp3      銃ごとに分ける。同じ AK でも撃つ音とリロード音は別
 *   man1_scream1.mp3    声は「誰の声か」で括る。man2 を足せば別人の声になる
 *   step_concrete1.mp3  足音は踏んだ材質で分ける
 *
 * 末尾の番号は**同じ音の別テイク**。ピッチを揺らすだけでは繰り返しが機械的に
 * 聞こえるので、いずれ複数持って選ぶことになる。その時に名前を変えずに済ませたい。
 *
 * 下の表が「どの音源をどの役に使っているか」の唯一の記録になる。ファイル名は
 * 出どころを表し、役 (rifle / scream / bounce …) はこの表が決める。
 * 差し替えは file を書き換えるだけで済み、鳴らす側は何も知らなくていい。
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
  rifle: { file: "ak47_shot1.mp3", reference: 6, max: 130 },
  /**
   * 狙撃銃。1 発が 1.57 秒あり、後半にボルト操作の音が入っている。
   *
   * 届く距離を突撃銃より伸ばしてある。遠くから撃つ武器なので、
   * 撃った本人には安全でも**音は遠くまで届く**、という交換にする。
   */
  snipe: { file: "xm2010_shot1.mp3", reference: 8, max: 170 },
  /** 弾倉の入れ替え。自分にしか要らないが、近くの相手には隙が伝わる */
  reload: { file: "ak47_reload1.mp3", reference: 2, max: 24 },
  // P90。突撃銃より軽い音で、間隔が詰まるぶん 1 発を短く聞かせたい
  smg: { file: "p90_shot1.mp3", reference: 5, max: 110 },
  smgReload: { file: "p90_reload1.mp3", reference: 2, max: 24 },
  /**
   * 足音。20m で消える。
   *
   * 走り (音量 1.0) が 20m、しゃがみ (0.3) は実質 8m ほどで聞こえなくなる。
   * 姿勢ごとに max を変えなくても、音量の違いが届く距離の違いになる。
   */
  step: { file: "step_concrete1.mp3", reference: 2, max: 20 },
  /** 金属の上を歩いたとき。届く距離はコンクリートと同じにして、材質の差だけ出す */
  metalStep: { file: "step_metal1.mp3", reference: 2, max: 20 },
  /**
   * 木の上を歩いたとき。
   *
   * 専用の音源がまだ無いので、コンクリートの足音を低く落として代用している。
   * wood_step.mp3 を用意したら file を差し替えるだけでよい。
   */
  woodStep: { file: "step_concrete1.mp3", reference: 2, max: 20, rate: 0.78 },
  /**
   * 転がり。体が地面に接する 1 回の音。
   *
   * 専用の音源がまだ無いので、足音を低く落として代用している。
   * roll.mp3 を用意したら file を差し替えるだけでよい。
   * 走るより遠くまで届く (26m) のは、体ごと投げ出す動作だから。
   */
  roll: { file: "step_concrete1.mp3", reference: 3, max: 26, rate: 0.55 },
  /**
   * 投げた物が落ちた音。
   *
   * 足音より遠くまで届く (30m)。聞かせるために投げるものなので、
   * 届かなければ道具として成立しない。金属の音を少し高めにして、
   * 足音と取り違えないようにしてある。
   */
  clink: { file: "step_metal1.mp3", reference: 3, max: 30, rate: 1.15 },
  /**
   * 倒れたときの叫び。
   *
   * 銃声と同じくらい遠くまで届く。誰かが倒れたことは戦況そのもので、
   * 「今そこで撃ち合いが終わった」を全員が知ってよい。
   * 撃った側にとっては当てた手応えになり、周りにとっては近づく合図になる。
   */
  scream: { file: "man1_scream1.mp3", reference: 8, max: 110 },
  /**
   * 頭に当たったのに倒れなかったときのうめき。
   *
   * 叫びより届く範囲をずっと狭くしてある。倒れたことは戦況だが、
   * 耐えたことは当人の事情で、遠くの人に知らせる筋のものではない。
   * 近くの相手にだけ「仕留め損ねた」と伝わる。
   */
  pain: { file: "man1_pain1.mp3", reference: 3, max: 26 },
  /**
   * 爆風で吹き飛ばされたときの叫び。
   *
   * 倒れたときの叫び (scream, 0.94 秒) とは別の音源で、3.34 秒と長い。
   * 死んだのではなく**まだ生きて転がっている**ことが伝わってほしいので、
   * 短く切れる音では役目が違う。
   *
   * 届く範囲は倒れたときの叫びと同じ。転んでいる相手が近くに居ることは、
   * 詰めるか退くかの判断に直に効く。
   */
  blastScream: { file: "man1_scream2.mp3", reference: 8, max: 110 },
  /**
   * 爆発。
   *
   * 銃声より遠くまで届く (160m)。**壁で遮っても聞こえる**のがこの音の役目で、
   * 「どこかで爆ぜた」は隠しようがない。見えない相手の位置は伏せているが、
   * 爆発だけは全員へ配っている (server の detonate) のと同じ理由。
   */
  explosion: { file: "explosion1.mp3", reference: 12, max: 160 },
  /**
   * クレイモアの起爆。
   *
   * 手榴弾と別の音にする。**何が爆ぜたかが耳で分かる**ようにしたい —
   * 手榴弾なら投げた奴が近くに居るが、クレイモアなら置いた奴はもう居ないかも
   * しれない。次にどう動くかが変わるので、区別が付く価値がある。
   *
   * 届く距離は手榴弾と同じ。壁で遮っても聞こえる。
   */
  claymore: { file: "claymore1.mp3", reference: 12, max: 160 },
  /**
   * 手榴弾が跳ねた音。
   *
   * 弾倉の囮 (clink) より低く、少し遠くまで届く。足元へ転がってきたことに
   * 気付けないと、逃げるという手が最初から無い。
   */
  bounce: { file: "step_metal1.mp3", reference: 4, max: 38, rate: 0.82 },
  /**
   * 拳銃の銃声。
   *
   * 突撃銃 (130m) より近くまでしか届かない (85m)。小さい弾なので実際に静かだし、
   * 「近くで撃っている」と伝わってほしい音でもある。副武器で撃つのは
   * 詰められたときか、主武器を撃ち切ったときなので、そこは近い戦いになる。
   */
  pistol: { file: "pistol_shot1.mp3", reference: 5, max: 85 },
  /**
   * 拳銃のリロード。
   *
   * 弾倉を抜く / 差す / スライドを戻す の 3 つの山。元は 2.32 秒だが、
   * 山の間の無音 (合わせて 1.1 秒) を抜いて 1.18 秒に詰めてある。
   * 型 (2.19 秒) より短いので音が先に終わる。型を音へ合わせると速すぎて
     動きが破綻したので、そこは揃えていない。
   *
   * 届く距離は突撃銃のリロードと同じ。「いま撃てない」が近くの相手に
   * 伝わる程度に留める。
   */
  pistolReload: { file: "pistol_reload1.mp3", reference: 2, max: 24 },
  /**
   * 薬莢が落ちた音。
   *
   * ほぼ足元でしか聞こえない (6m)。撃った本人には手応えとして返るが、
   * 銃声より遠くへ届くと、撃った位置を二重に知らせることになる。
   *
   * 鳴らすのは**最初に地面へ当たった 1 回だけ**。跳ねるたびに鳴らすと、
   * 撃ち続けている間ずっと鳴りっぱなしになる。
   */
  casingDrop: { file: "casing_drop1.mp3", reference: 1, max: 6 },
  /**
   * 弾が無いのに引き金を引いた音。
   *
   * 撃鉄が落ちるだけの小さい音なので、ほぼ本人にしか聞こえない (3.5m)。
   * ナイフが届く間合いで、そこまで詰められているならもう音は要らない。
   *
   * 0 にはしない。この距離で聞こえるということは、隠れている相手のすぐ横で
   * 空撃ちしたら気付かれるということで、それは正しい。
   */
  empty: { file: "gun_empty1.mp3", reference: 1, max: 3.5 },
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
              asset.audio(profile.file),
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
