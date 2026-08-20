import type { Locomotion } from "../locomotion";
import { stanceOf } from "./stance";

/**
 * 足音。
 *
 * 姿勢ごとに「何メートル進むごとに 1 歩鳴るか」と「どれだけ大きいか」を持つ。
 * 時間ではなく距離で数えるのが要点で、そうすると速度が変わっても歩幅が変わらず、
 * 遅く歩けば自然に音の間隔も開く。移動速度を調整しても足音の設定を直さずに済む。
 *
 * 音そのものは送らない。位置と locomotion は既に共有されているので、
 * 各クライアントが同じ式で鳴らせば結果は一致する。1 人あたり毎秒 3〜4 通を
 * 節約できるうえ、取りこぼしで足音だけ消えることもない。
 *
 * --- ゲームとしての意味 ---
 * これが入って初めて、しゃがみとダンボールが「遅くなるだけの選択肢」でなくなる。
 * 音は壁を越えて届くので、姿が見えない相手の位置を知る唯一の手段になり、
 * 「速く動いて気づかれる」か「遅く動いて隠れる」かの交換条件が成立する。
 */

export interface Step {
  /** 近くで聞いたときの大きさ (0..1) */
  volume: number;
  /** 届く距離の倍率 */
  range: number;
}


interface StepProfile {
  /** 1 歩あたりの移動距離 (m)。クリップの実測歩幅に合わせてある */
  distance: number;
  volume: number;
  range: number;
  /**
   * 足音を出さない姿勢か。
   *
   * 距離は積んだまま音だけ止める。積むのをやめると、その姿勢の間の移動が
   * 無かったことになって無音の移動手段になる。転がりは転がり自体の音が
   * 別に鳴るので、そこで音は払っている。
   */
  silent?: boolean;
}

/**
 * 走り。実測の歩幅は 1.26m (クリップ 0.53 秒で 2 歩、4.76 m/s)。基準。
 */
const RUN: StepProfile = { distance: 1.26, volume: 1, range: 1 };
/**
 * しゃがみ移動。歩幅 1.0m。
 *
 * 変えるのは主に**届く距離**。音量だけ下げても減衰の形が同じなので、
 * 聞こえなくなる距離はほとんど変わらない (実測で 19m → 17m にしかならなかった)。
 * 距離の倍率を落とすと 20m → 9m になり、「近づかれるまで気づけない」が成立する。
 *
 * 近くではちゃんと聞こえるのが要点。しゃがみは「消える」のではなく
 * 「遠くへ伝わらない」。真横に居れば分かる。
 */
const CROUCH: StepProfile = { distance: 1.0, volume: 0.7, range: 0.45 };
/** ダンボールで移動しているとき。歩幅 0.81m。5m まで近づかないと分からない */
const SNEAK: StepProfile = { distance: 0.81, volume: 0.5, range: 0.25 };
/**
 * 転がり。足音は鳴らさない。
 *
 * 2〜3m を一息で進むので歩幅で数えると 2〜3 回続けて鳴り、走っているより
 * うるさくなる。転がりは足ではなく体が地面に接する動作なので、
 * 踏む音を並べるのではなく 1 回の擦れる音として鳴らす (Game 側)。
 */
const ROLL: StepProfile = { distance: 1.26, volume: 0, range: 1, silent: true };

/**
 * 姿勢から歩き方を引く。
 *
 * 「移動中のクリップかどうか」ではなく「どんな姿勢か」で選ぶ。移動の判定は
 * 実際に進んだ距離のほうでやる。
 *
 * ここを移動クリップだけに絞ると抜け道になる。キーを短く連打すると停止判定の
 * ヒステリシスに収まって locomotion が idle のままになり、進んでいるのに
 * 「歩いていない」と見なされて無音で移動できてしまう。
 *
 * 空中と死亡だけが本当に鳴らない状態。
 */
function profileFor(locomotion: Locomotion): StepProfile | null {
  // 倒れている間と起き上がりは足で歩いていない
  if (locomotion === "death" || locomotion === "sweep" || locomotion === "stand") return null;
  if (locomotion.startsWith("jump_")) return null;
  if (locomotion === "roll") return ROLL;
  // 構えは 1 か所の表から引く (stance.ts)。ここで名前を見比べ直すと、
  // モーションが増えたときに片方だけ古くなる
  switch (stanceOf(locomotion)) {
    case "box":
      return SNEAK;
    case "crouch":
      return CROUCH;
    default:
      return RUN;
  }
}

/**
 * 1 人分の足音の勘定。
 *
 * 位置の差分を積んで、歩幅ぶん進むごとに 1 歩返す。速度そのものではなく
 * 実際に動いた距離を見るので、壁に押し付けて足踏みしている間は鳴らない。
 */
/**
 * 1 回の呼び出しで進んだとみなす上限 (m)。これを超えたら瞬間移動。
 *
 * 走っても 64Hz で 1 回あたり 0.1m 程度なので、3m は明らかに歩いていない。
 * 湧き直しで 70m 跳ぶと、その距離が積算に入って**そのあと 1 歩ずつ吐き出される**。
 * 実際に起きた: 試合が始まった瞬間に足音が 0.9 秒ほど連打された。
 */
const TELEPORT = 3;

export class Footsteps {
  private travelled = 0;
  private lastX = 0;
  private lastZ = 0;
  private started = false;

  /**
   * 瞬間移動した。積んだ距離を捨てる。
   *
   * 湧き直しや繋ぎ直しで呼ぶ。update 側でも距離で弾いているが、
   * 呼べる場面では呼んだほうが確実 (跳んだ距離が短いときも取りこぼさない)。
   */
  warp(x: number, z: number): void {
    this.started = true;
    this.lastX = x;
    this.lastZ = z;
    this.travelled = 0;
  }

  /**
   * @returns この呼び出しで踏んだなら鳴らし方、鳴らないなら null
   */
  update(x: number, z: number, locomotion: Locomotion, grounded: boolean): Step | null {
    if (!this.started) {
      this.started = true;
      this.lastX = x;
      this.lastZ = z;
      return null;
    }

    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;

    // 歩いて着いた距離ではない。積まずに捨てる
    if (moved > TELEPORT) {
      this.travelled = 0;
      return null;
    }

    const profile = grounded ? profileFor(locomotion) : null;
    if (!profile) return null;

    // 止まっても積んだ距離は捨てない。捨てると、止まる直前までの移動が
    // 無かったことになり、細かく止まりながら進めば無音で移動できてしまう。
    // 足音は「どれだけ進んだか」の関数であって、どう刻んだかは関係ない。
    this.travelled += moved;
    if (this.travelled < profile.distance) return null;
    this.travelled -= profile.distance;
    if (profile.silent) return null;
    // 材質は含めない。足の下に何があるかを知っているのは世界の側で、
    // ここは「何歩進んだか」だけを数える
    return { volume: profile.volume, range: profile.range };
  }
}
