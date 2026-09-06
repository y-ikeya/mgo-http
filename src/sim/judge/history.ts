/**
 * 過去の姿を貯めておく輪。**巻き戻して照合するための材料。**
 *
 * --- なぜ部品なのか ---
 * 遅れを埋めるために過去へ遡る、という手続きは**この遊びに固有ではない。**
 * 撃ち合う物を作れば必ず要る。要るのは 3 つだけで、どれも遊びの語彙を
 * 知らずに書ける。
 *
 *     いつの姿か        time を持っていること
 *     何コマ持つか      遡れる幅と、届く間隔から出る
 *     溢れたら捨てる    古いものから
 *
 * **中身は見ない。** 姿に何が入っているか (しゃがんでいるか、箱を被って
 * いるか) は遊びの決めごとなので、型引数にして触らない。照合の側
 * (hitcheck.ts の verifyHit) が引数で受け取るのと同じ形。
 *
 * --- なぜ貯める側を切り出したか ---
 * 照合 (verifyHit) は既に遊びの数字を import せず、全部引数で受け取る形に
 * なっていた。**貯める側だけが人 (MatchPlayer) を直に読み書きしていて**、
 * そこが持ち出せない結び目になっていた。
 */

/** いつの姿かが分かる物。**部品が知っているのはこれだけ** */
export interface Timed {
  /** 記録した時刻 (ms) */
  time: number
}

/**
 * 遡れる幅を覆うのに要るコマ数。**手で決めない。**
 *
 * 数を直に書くと、送る間隔を変えたときに**片方だけ古くなる。** 20Hz の頃に
 * 「12 個」と書いてあったのを 64Hz へ上げたとき直し忘れて、0.4 秒の幅に
 * 対して 0.19 秒しか遡れなくなっていた。窓は在るのに半分より前が届かず、
 * 遠い人ほど「当てたのに通らない」が静かに増えた。
 *
 * 端で足りなくならないよう 2 コマ足す (境目のコマと、書き込み途中のぶん)。
 */
export function framesFor(windowMs: number, intervalMs: number): number {
  return Math.ceil(windowMs / intervalMs) + 2
}

/**
 * 過去の姿の輪。**新しいものが末尾。**
 *
 * 書くのは「枠を貸すので、そこへ書いてください」という形にしてある。
 * **貸す形にしておくと、中を配列から輪 (リングバッファ) へ差し替えても
 * 呼ぶ側が変わらない** — 差し替えの是非は docs/notes/history-ring-buffer.md。
 */
export class PoseTrack<T extends Timed> {
  private readonly poses: T[] = []
  private readonly size: number
  private readonly make: () => T

  /**
   * @param size 何コマ持つか (framesFor で出す)
   * @param make 空の姿を 1 つ作る。**枠を貸す形にするために要る**
   */
  constructor(size: number, make: () => T) {
    this.size = size
    this.make = make
  }

  /**
   * 1 コマ書く。**枠を渡すので、そこへ書く。**
   *
   * 値を受け取る形 (push(pose)) にしないのは、**呼ぶ側に毎回作らせない**
   * ため。いまは中で作っているが、輪に差し替えれば作らずに済む。
   */
  write(fill: (slot: T) => void): void {
    const slot = this.make()
    fill(slot)
    this.poses.push(slot)
    if (this.poses.length > this.size) this.poses.shift()
  }

  /**
   * 貯まっている姿。**新しいものが末尾。**
   *
   * 返すのは中身そのもの。**呼ぶ側は書き換えない** — 照合しか用が無いので、
   * 写しを作る手間を毎回払わない。
   */
  get frames(): readonly T[] {
    return this.poses
  }

  /** 何コマ貯まっているか */
  get length(): number {
    return this.poses.length
  }

  /** 席を作り直したときに空にする。**前の命の姿で当たってしまわないように** */
  clear(): void {
    this.poses.length = 0
  }
}
