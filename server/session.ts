/**
 * 接続。**人 (Player) とは別の物。**
 *
 * 同じ人が繋ぎ直せば Session は新しくなるが、人は席に残る。的 (bot) は
 * 席を持つが Session を持たない — だから sessionOf は投げる関数と
 * 返さない関数の 2 本に分けてある。
 */

import type { MatchPlayer } from '../src/domain/player/player'
import { newLagRecord, type LagRecord } from '../src/domain/match/lag'
import type { Client } from './world'

/**
 * 接続 1 本ぶんの帳簿。**人 (Player) とは別。**
 *
 * socket も「届く間隔」も「誰に何を配ったか」も、人ではなく**接続**の持ち物。
 * 同じ人が繋ぎ直せば新しい Session になるが、人は席に残ったままになる —
 * その違いが型に出ていなかったので、30 秒の猶予まわりのドメインルールが読み取れなかった。
 *
 * 人の側は src/domain/player/player.ts。
 */
export interface Session {
  player: MatchPlayer
  /**
   * 位置が届く間隔 (ms) の均し。64Hz で送っているので 16 前後が正常。
   *
   * ここが伸びている人は、こちらから見て「途切れがちな相手」になる。
   * 相手の画面ではその人が明滅するか、出てこない。
   */
  packetGap: number
  /** 最後に位置が届いた時刻 (Date.now)。間隔を測るのに使う */
  lastPacketAt: number
  /**
   * その人の時計とこちらの時計の差 (ms)。
   *
   * 位置には送り主の Date.now() が乗っている。ここが大きくずれている機械が
   * 混ざると、受け取る側が「送り主の時計 − 自分の時計」で古さを測っていた
   * 頃は、その人だけ姿が出なかった。今は各クライアントで直しているが、
   * ずれ自体は見えるようにしておく。
   */
  clockSkew: number
  /**
   * いまこの人へ位置を配っている相手の id。
   *
   * 配るのをやめた瞬間に「もう見えない」と知らせるために持つ。知らせないと、
   * 受け取る側は沈黙から察するしかなく、遅れて届いているだけの相手と
   * 区別が付かない (見えたり消えたりになる)。
   */
  seen: Set<string>
  /**
   * その人に見えていると伝えてあるクレイモアの id。
   *
   * 位置の seen と同じ形。**置いた瞬間に全員へ配ると、壁の裏に置いた物が
   * 透けて見える** — 隠して置くことに意味がある道具なので、そこを漏らすと
   * 使う理由が消える。
   */
  seenClaymores: Set<number>
  /**
   * 見せた囮の人形。
   *
   * クレイモアと違って**敵にも見せる**が、遮蔽で隠すのは同じ。一度見せた
   * 物をもう一度送らないために覚える。
   */
  seenDecoys: Set<number>
  /**
   * 最後に届いた位置のパケット。**そのまま配り直す**ために取っておく。
   *
   * 接続が切れた人の体をその場に残すのに要る。位置は「届いたときに配る」形なので、
   * 送ってこなくなれば自然に止まり、相手の画面から消える。消えると、撃ち合いで
   * 不利になったらブラウザを閉じる、が逃げ道になる。
   */
  lastPayload: Uint8Array | null
  /**
   * 直前に配った体力。同じ値を配り直さないための控え。
   *
   * 回復は毎 tick 少しずつ動くので、丸めた値が変わったときだけ配る
   */
  /** 最後に配ったスタミナ (切り上げ)。変わらない値を流さないための控え */
  staminaShown: number
  healthShown: number
  /** 却下した申告の数。/health に出す (当たり判定が疑わしい人が分かる) */
  rejected: number
  /** 最後に撃った時刻 (Date.now)。連射の速さの上限を見るのに使う */
  lastShotAt: number
  /**
   * その 1 発でまだ受け付けられる粒の数。
   *
   * 散弾は 1 発が 8 粒に分かれて、**同じ瞬間に 8 通の申告が届く**。
   * 連射の検査をそのまま当てると 1 粒目以外が全部弾かれる。1 発ぶんの窓の
   * 中で、粒の数までは通す (それを超えれば作り物)。
   */
  pelletsLeft: number
  /**
   * この 1 発でもう怯ませたか。
   *
   * 怯みは**弾 1 発につき 1 回**。粒ごとに送ると、近距離で 8 回重なって
   * 体が跳ね回る (実際そう見えた)。当たった数は削れる量で出ているので、
   * 仰け反りまで数えると二重になる。
   */
  flinchedThisShot: boolean
  /** この 1 発でもう突き飛ばしたか。怯みと同じで**弾 1 発につき 1 回** */
  pushedThisShot: boolean
  /**
   * この 1 発でもう削ったか。**散弾だけに要る。**
   *
   * 散弾は 1 発が 8 粒に分かれるが、削るのは 1 回だけ (距離の帯で決まる)。
   * 粒ごとに削ると「たまたま何粒入ったか」で結果が変わる。
   */
  hitThisShot: boolean
  /**
   * 形の合わない位置を最後に警告した時刻 (Date.now)。
   *
   * 古いクライアントが繋ぐと毎フレーム落ちるので、間引かないとログが埋まる
   */
  badPacketAt: number
  /** 成立しない移動を最後に警告した時刻 (Date.now)。同じく間引くため */
  badMoveAt: number
  /**
   * 往復の時間の控え (domain/match/lag.ts)。
   *
   * **接続の持ち物。** 繋ぎ直したら 0 から測り直す — 前の回線の値を持ち越すと、
   * 悪い回線から良い回線へ移った人がしばらく切られ続ける。
   */
  lag: LagRecord
  /** 打ち返しを待っている ping の時刻。**返るまで次を投げない** */
  pingAt: number
  socket: Bun.ServerWebSocket<Client>
}

/**
 * 接続の帳簿。人の id で引く。
 *
 * 人に socket を持たせない代わりに、こちら側から人を指す。**人は
 * 部屋 (Match) が持ち、接続はここが持つ。**
 */
export const sessions = new Map<string, Session>()

/**
 * 繋がった時の帳簿。**繋ぎ直すたびに作り直す。**
 *
 * 前の接続の値を引き継がない。誰に何を配ったかを残すと「隠れた」の 1 通が
 * 出ないまま見えていることになり、届く間隔を引き継ぐと巨大な間隔になり、
 * 過去の姿を引き継ぐと**離脱前の位置で当たってしまう**。
 */
export function newSession(player: MatchPlayer, socket: Bun.ServerWebSocket<Client>): Session {
  return {
    player,
    socket,
    seen: new Set(),
    seenClaymores: new Set(),
    seenDecoys: new Set(),
    lastPayload: null,
    packetGap: 0,
    lastPacketAt: 0,
    clockSkew: 0,
    lag: newLagRecord(),
    pingAt: 0,
    healthShown: player.health,
    staminaShown: player.stamina,
    rejected: 0,
    badPacketAt: 0,
    badMoveAt: 0,
    lastShotAt: 0,
    pelletsLeft: 0,
    flinchedThisShot: false,
    pushedThisShot: false,
    hitThisShot: false,
  }
}

/**
 * その人の接続。**無ければ null** — 的 (bot) は接続を持たない。
 *
 * 「人にも的にも起こりうる」場所ではこちらを使う。sessionOf は投げるので、
 * **的が混ざった瞬間にサーバーが落ちる** (実際、爆風の転倒を送る所で落ちた)。
 */
export function sessionFor(player: MatchPlayer): Session | null {
  return sessions.get(player.id) ?? null
}

/** その人の接続。席に着いている**人**には必ず在る (的には無い) */
export function sessionOf(player: MatchPlayer): Session {
  const found = sessions.get(player.id)
  if (!found) throw new Error(`接続が無い: ${player.id}`)
  return found
}
