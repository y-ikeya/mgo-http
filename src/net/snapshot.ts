/**
 * 位置の符号化。
 *
 * 位置だけは他のメッセージと桁違いに多い。全員が毎秒 20〜64 回送るので、
 * ここだけ JSON をやめる。実測で 1 通 264 バイトが 33 バイトになった。
 *
 * 効いているのは Hz ではなく符号化のほう。`"locomotion":"crouch_idle"` という
 * 文字列と UUID 36 文字を毎秒 20 回送っていた。詰めれば、64Hz でも
 * これまでの 20Hz より軽くなる。
 *
 * 他のメッセージ (体力・撃った・試合の状態) は JSON のまま。数が少ないので
 * 詰める意味が無く、形を変えやすいほうが得。
 *
 * three.js に依存しない。サーバー (bun) がこのファイルをそのまま読む。
 */

import { MOVE_DIRECTIONS, type Locomotion } from '../sim/locomotion'
import type { PlayerSnapshot } from './types'
import type { WeaponId } from '../sim/weapons'

/** 先頭 1 バイト。将来 2 進の種類が増えたときに見分ける */
export const PACKET_STATE = 1

/**
 * モーションの番号。1 バイトに収める。
 *
 * **並びを変えてはいけない。** 番号がそのまま線に乗るので、
 * 順序を入れ替えると古いクライアントが別のモーションを再生する。
 * 増やすときは必ず末尾へ足す。
 */
export const LOCOMOTIONS: Locomotion[] = [
  'idle',
  'crouch_idle',
  'sneak',
  'sit',
  'stab',
  'roll',
  'death',
  'salute',
  'jump_up',
  'jump_loop',
  'jump_down',
  ...MOVE_DIRECTIONS.map((d) => `run_${d}` as Locomotion),
  ...MOVE_DIRECTIONS.map((d) => `crouch_${d}` as Locomotion),
  // 爆風で倒れている / 起き上がる。末尾に足す (並びを変えると古い版が別の姿勢を再生する)
  'sweep',
  'stand',
  // 接続が切れた人の姿。本人は送ってこない — サーバーが書き込む
  'away',
]

const LOCOMOTION_INDEX = new Map(LOCOMOTIONS.map((name, i) => [name, i]))

/**
 * 並び。
 *
 * 送る側は slot を 0 のまま出し、サーバーが誰から来たかを知っているので
 * そこへ書き込んでから配る。**送り主に名乗らせない**ので、他人になりすませない。
 */
const OFF_KIND = 0 // u8
const OFF_SLOT = 1 // u16
const OFF_TIME = 3 // f64
const OFF_X = 11 // f32
const OFF_Y = 15
const OFF_Z = 19
const OFF_YAW = 23
const OFF_PITCH = 27
const OFF_LOCOMOTION = 31 // u8
const OFF_FLAGS = 32 // u8
/**
 * 視点の向き。u16 で 0..2π を刻む (1 目盛り 0.005°)。
 *
 * f32 を足すと 4 バイト増える。これは可視の判定にしか使わないので、
 * その精度は要らない。0.005° の誤差は 100m 先で 1cm。
 */
const OFF_CAMERA_YAW = 33 // u16
/**
 * 2 枚目のフラグ。1 枚目が 8 ビット埋まったので足した。
 *
 * 1 バイト増えるが、位置は 64Hz で流れるので効くのはここだけ。
 * 別メッセージにしなかったのは遮蔽の判定を通すため — 位置は見えている相手に
 * しか配られない。
 */
const OFF_FLAGS2 = 35 // u8
export const SNAPSHOT_BYTES = 36

const FLAG_AIMING = 1
const FLAG_CROUCHING = 2
const FLAG_BOXED = 4
const FLAG_CONCENTRATING = 8
const FLAG_SALUTE = 16
/**
 * 持っている銃。2 ビットで 4 種類まで。
 *
 * 見た目 (相手が何を構えているか) と、サーバーの威力の計算に要る。
 * 銃を増やすときはここを広げる — 足りないまま増やすと、
 * 別の銃として扱われて威力が変わる (狙撃銃で実際に起きた)。
 */
const FLAG_WEAPON_LOW = 32
const FLAG_WEAPON_HIGH = 128

/** 番号の並び。変えると古い版が別の銃として読む */
const WEAPON_BITS: WeaponId[] = ['rifle', 'sniper', 'pistol']
/** 手榴弾を振りかぶって持っている。倒されたら足元に落ちる */
const FLAG_GRENADE = 64

/** 2 枚目のフラグ */
const FLAG2_RELOADING = 1
/**
 * 無敵か。**サーバーが書き込む。**
 *
 * 送り主に名乗らせない。自分で立てられるなら、ずっと無敵と言い続けられる。
 * 席番号と同じで、こちらが知っていることはこちらで書く。
 */
const FLAG2_PROTECTED = 2

/** 位置を詰める。slot は送る側では 0 (サーバーが書き込む) */
export function encodeSnapshot(snapshot: PlayerSnapshot, slot = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(SNAPSHOT_BYTES)
  const view = new DataView(buffer)

  view.setUint8(OFF_KIND, PACKET_STATE)
  view.setUint16(OFF_SLOT, slot)
  view.setFloat64(OFF_TIME, snapshot.time)
  view.setFloat32(OFF_X, snapshot.x)
  view.setFloat32(OFF_Y, snapshot.y)
  view.setFloat32(OFF_Z, snapshot.z)
  view.setFloat32(OFF_YAW, snapshot.yaw)
  view.setFloat32(OFF_PITCH, snapshot.pitch)
  view.setUint8(OFF_LOCOMOTION, LOCOMOTION_INDEX.get(snapshot.locomotion) ?? 0)

  let flags = 0
  if (snapshot.aiming) flags |= FLAG_AIMING
  if (snapshot.crouching) flags |= FLAG_CROUCHING
  if (snapshot.boxed) flags |= FLAG_BOXED
  if (snapshot.concentrating) flags |= FLAG_CONCENTRATING
  if (snapshot.saluteHeld) flags |= FLAG_SALUTE
  const weapon = Math.max(0, WEAPON_BITS.indexOf(snapshot.weapon))
  if (weapon & 1) flags |= FLAG_WEAPON_LOW
  if (weapon & 2) flags |= FLAG_WEAPON_HIGH
  if (snapshot.holdingGrenade) flags |= FLAG_GRENADE
  view.setUint8(OFF_FLAGS, flags)

  const turns = snapshot.cameraYaw / (Math.PI * 2)
  view.setUint16(OFF_CAMERA_YAW, Math.round((turns - Math.floor(turns)) * 65536) & 0xffff)

  view.setUint8(OFF_FLAGS2, snapshot.reloading ? FLAG2_RELOADING : 0)

  return buffer
}

/** 誰のものかは呼ぶ側が決める (サーバーは接続から、クライアントは slot から) */
export function decodeSnapshot(view: DataView, id: string): PlayerSnapshot {
  const flags = view.getUint8(OFF_FLAGS)
  return {
    id,
    time: view.getFloat64(OFF_TIME),
    x: view.getFloat32(OFF_X),
    y: view.getFloat32(OFF_Y),
    z: view.getFloat32(OFF_Z),
    yaw: view.getFloat32(OFF_YAW),
    pitch: view.getFloat32(OFF_PITCH),
    locomotion: LOCOMOTIONS[view.getUint8(OFF_LOCOMOTION)] ?? 'idle',
    aiming: (flags & FLAG_AIMING) !== 0,
    crouching: (flags & FLAG_CROUCHING) !== 0,
    boxed: (flags & FLAG_BOXED) !== 0,
    concentrating: (flags & FLAG_CONCENTRATING) !== 0,
    saluteHeld: (flags & FLAG_SALUTE) !== 0,
    weapon:
      WEAPON_BITS[
        ((flags & FLAG_WEAPON_LOW) !== 0 ? 1 : 0) | ((flags & FLAG_WEAPON_HIGH) !== 0 ? 2 : 0)
      ] ?? 'rifle',
    holdingGrenade: (flags & FLAG_GRENADE) !== 0,
    cameraYaw: (view.getUint16(OFF_CAMERA_YAW) / 65536) * Math.PI * 2,
    reloading: (view.getUint8(OFF_FLAGS2) & FLAG2_RELOADING) !== 0,
    protectedNow: (view.getUint8(OFF_FLAGS2) & FLAG2_PROTECTED) !== 0,
  }
}

/** 中継するときに送り主の番号を書き込む。中身は作り直さない */
export function stampSlot(view: DataView, slot: number): void {
  view.setUint16(OFF_SLOT, slot)
}

/**
 * 無敵かどうかを書き込む。中継するときにサーバーが呼ぶ。
 *
 * 中身は作り直さない。1 ビット立てるだけ。
 */
export function stampProtected(view: DataView, protectedNow: boolean): void {
  const flags = view.getUint8(OFF_FLAGS2)
  view.setUint8(OFF_FLAGS2, protectedNow ? flags | FLAG2_PROTECTED : flags & ~FLAG2_PROTECTED)
}

/**
 * モーションを書き込む。中継するときにサーバーが呼ぶ。
 *
 * 接続が切れた人の体をその場に残すのに要る。最後に届いたパケットをそのまま
 * 配り直すと、走っていた人がその場で走り続ける絵になるので、姿勢だけ
 * 差し替える。中身は作り直さない (1 バイト書くだけ)。
 */
export function stampLocomotion(view: DataView, locomotion: Locomotion): void {
  view.setUint8(OFF_LOCOMOTION, LOCOMOTION_INDEX.get(locomotion) ?? 0)
}

export function readSlot(view: DataView): number {
  return view.getUint16(OFF_SLOT)
}

export function isSnapshot(view: DataView): boolean {
  return view.byteLength === SNAPSHOT_BYTES && view.getUint8(OFF_KIND) === PACKET_STATE
}
