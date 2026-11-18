import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadKnife, loadM1911, loadMosin, loadM4, loadRifle, loadSmg, loadShotgun, loadSniper, loadPistol } from '../assets'
import { isMesh } from '../util/guards'
import type { Stance } from '../../../domain/player/stance'

/**
 * 銃の持ち方が姿勢へ寄る速さ。
 * しゃがみの入り抜けと同じくらいにして、体と銃が別々に動いて見えないようにする。
 */
export const WEAPON_STANCE_LAMBDA = 10

/**
 * 姿勢を持ち方の段階に直す。**0 = 立ち / 1 = しゃがみ / 2 = 伏せ。**
 *
 * 自機と相手で同じ式を使う。相手の側がこれを当てていなくて、**伏せた相手だけ
 * 銃が立ちの握りのまま**になっていた (伏せの向きは立ちから 100° 以上ずれる)。
 */
export function weaponStanceOf(stance: Stance): number {
  return stance === 'prone' ? 2 : stance === 'crouch' || stance === 'box' ? 1 : 0
}

/**
 * 武器ごとの取り付け設定。モデルは convert_gun.py で正規化済みで、
 * どれも「刃/銃身が -Z、上が +Y、原点は後端付近」の座標系に揃っている。
 */
/** 排莢口の位置 (銃のローカル座標)。機関部の右少し上 */
const EJECT_LOCAL = { x: 0.04, y: 0.06, z: -0.12 }

export interface WeaponConfig {
  /** 右手が握る位置。手ボーンは手首にあるので、実機で合わせた値になっている */
  grip: THREE.Vector3
  /**
   * **構えている間だけ、銃を右手の握りを支点に回す角度** (度、銃口が上・左へ
   * 向くのが正)。立ちとしゃがみで別。伏せは回さない。
   *
   * 握りの値は「構えていない姿勢で付けた手の向き」が基準なので、構えると
   * 銃口が照準からずれる — 本番で AK 9° 上・M4 13° 上 (2026-10-10、本人作の
   * 構え歩き m4Walk では真っすぐ前・水平)。銃だけ回すと左手が置いていかれるので、
   * Soldier が左腕を曲げ直して付け直す (actor/armIk.ts)。
   * 測るのは tools/preview/weapon.html?views=3 (斜めの枠の札に銃身の角度が出る)
   */
  aimTrim?: { pitch: number; yaw: number; crouchPitch: number; crouchYaw: number }
  /**
   * 構えた時に**上体を起こす量** (度、立ち・しゃがみ)。animation.ts の gunLift。
   * ずれが大きい時は銃を回すより先にこちらで取り返す — 銃だけを 45° 回すと、
   * 前を握る左手が大きく持ち上がった (P90 のしゃがみ、2026-10-10 本人)
   */
  aimLift?: { stand: number; crouch: number }
  /**
   * 構えている間、**左手首を置く所** (銃の空間の位置と向き)。立って構えた時の
   * 左手 (どの銃もハンドガードを自然に握っている) を測った値
   * (tools/preview/weapon.html?views=3&lh)。しゃがんでも同じ所を握らせる —
   * しゃがみの型の左手はハンドガードを握っておらず、銃の上に浮いていた
   * (2026-10-10 本人: AK のしゃがみ構え)。無ければ、回した分だけ付いていく
   */
  leftHand?: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  /**
   * 構えている間、**右手首をずらす量** (m、体の空間: +X が右・+Y が上・-Z が前)。
   * 立ち・しゃがみ別。銃は一緒に動く (向きは変わらない)。armIk.ts の RightArmShift
   */
  rightShift?: { stand: THREE.Vector3; crouch: THREE.Vector3 }
  /**
   * 構えている間、**銃身を照準の向きへ毎コマ直に向ける** (握りを支点に回す)。
   * 拳銃は付け方が長物と違い (前腕の向きが基準)、aimTrim の角度が素直に効かない
   * — 銃を胸の前で横に持ち、銃口が左へ 47〜83° 向いていた (2026-10-10 本人)
   */
  alignBarrel?: boolean
  /** 向きの微調整。両手の位置からは手首のひねりが決まらないため */
  rotation: THREE.Euler
  /** しゃがみ姿勢での値。無ければ立ちと同じものを使う */
  crouchGrip?: THREE.Vector3
  crouchRotation?: THREE.Euler
  /**
   * 伏せ姿勢での値。無ければしゃがみと同じものを使う。
   *
   * 伏せ撃ちの型を足したのに握りは足していなかったので、**しゃがみの値が
   * そのまま使われていた**。腹這いでは肘の付き方も上半身の向きも違うので、
   * しゃがみの握りだと銃が体に埋まるか浮く。
   */
  /**
   * 伏せてボルトを引く間の持ち方。**骨 (LeftHand) の空間そのまま。**
   *
   * 型を作る側が銃を骨に付けて目で合わせているので、**その位置がいちばん
   * 正しい**。こちらで握りを詰め直さず、測った値をそのまま置く
   * (tools/fit_gun_to_clip.js が出す)。
   *
   * 無ければ、預けた瞬間の持ち方を保ったまま移す。
   */
  boltHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  /**
   * しゃがみでの持ち方。**骨 (RightHand) の空間そのまま。**
   *
   * 握り (crouchGrip) からの逆算を通さない。逆算は「取り付けた瞬間の手の向き」を
   * 基準にしていて、その基準を外から作り直せない — 型から測った置き場所を
   * 握りの値へ写すと **6.3° ずれた** (銃口が下を向いた)。測った物をそのまま置く。
   *
   * 無ければ crouchGrip / crouchRotation を使う。
   */
  crouchHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  /**
   * standHold / crouchHold / proneHold を**構えていない間だけ**使う (構えれば aimHold / crouchAimHold / proneAimHold へ寄せる)。拳銃の構えていない型 (handgun_relaxed_idle /
   * pistol_crouch_relaxed / pistol_crouch_run / handgun_prone_relaxed) に合わせた持ち方で、構えている間は今まで通り握りの値から
   * 組んで照準へ向け直す (alignBarrel)
   */
  relaxedHoldsOnly?: true
  /**
   * 構えている間の持ち方 (立ち・しゃがみ)。**骨 (RightHand) の空間そのまま。**
   * 構えていない持ち方から aimWeight で寄せる。あれば aimTrim は掛けない —
   * 構えの型と一緒に Blender で銃を持たせて詰めた物なので、回し直すとずれる
   */
  aimHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  /** 立って構えていない時の持ち方 (骨 RightHand の空間)。crouchHold と同じく、あれば握りの値を上書きする */
  standHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  crouchAimHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  /** しゃがんで構えた時の左手首 (銃の空間)。無ければ leftHand。立ちとの間は姿勢で混ぜる */
  crouchLeftHand?: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  /** 伏せの持ち方 (構えていない / 構え、骨 RightHand の空間)。crouchHold / aimHold と同じ扱い */
  proneHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  proneAimHold?: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }
  /** 伏せて構えた時の左手首 (銃の空間)。しゃがみとの間は姿勢で混ぜる */
  proneLeftHand?: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  /**
   * **構えずに提げている間の左手首** (銃の空間、立ち / しゃがみ)。銃ごとの型で詰めた姿の左手の所。
   * 歩く・走る間は腕を振る共通の型なので、右手の銃に左手を運んで両手の関係を詰めた形に保つ
   * (本人 2026-11-16「いまの両手の関係とかを既存の走る型に反映できないの？」)。掛かり具合は Soldier が
   * 型 (CharacterAnimator.carrying) を見て寄せる (setCarryWeight)
   */
  relaxedLeftHand?: {
    stand: { position: THREE.Vector3; quaternion: THREE.Quaternion }
    crouch: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  }
  proneGrip?: THREE.Vector3
  proneRotation?: THREE.Euler
  /** 先端 (銃口 / 刃先)。トレーサーや判定の基準 */
  tip: THREE.Vector3
  /**
   * 主観で照準器を覗く時の、**目の位置** (模型の空間) と模型の起こし (rad、銃身の軸回り)。
   *
   * 主観用の銃はカメラに付けて、この点がカメラの位置に来るよう置く。目の点は
   * 照準線 (照門と照星 / ホロサイトの窓の中心を通る、銃身と平行な線) の上、照門の
   * 後ろに取る — こうすると照準線がそのまま画面の真ん中を通る (弾の行き先と一致)。
   * 模型が横倒しで入っている銃 (AK) は roll で起こす。照準線が銃身と平行でない銃は
   * pitch (rad、正で銃口が上) で傾けて、照準線のほうをカメラの向きに揃える
   */
  /**
   * glass … **主観用の銃で素通しにする窓** (模型の空間の箱)。この中の、目の方 (±Z) を
   * 向いた三角形を主観用の銃から削る。ホロサイトのガラスが透けない作りで、覗くと窓が
   * 画面を塞いでいた (本人 2026-10-13)。体が持つ銃は削らない
   */
  sight?: { eye: THREE.Vector3; roll: number; pitch: number; glass?: { min: THREE.Vector3; max: THREE.Vector3 } }
  /** 左手を添える位置。片手武器は null で、その場合 IK を掛けない */
}

const degrees = (value: number) => THREE.MathUtils.degToRad(value)

/**
 * ライフルの値はすべて実機で詰めたもの。
 * ハンドガードは断面プロファイルで銃身とマガジンの間にあたる位置。
 */
/**
 * AK-47。実寸 870mm に合わせてある。
 *
 * tip は頂点から実測した銃口 (最も -Z の点)。
 * grip / rotation は目で合わせた値。左手はクリップ側が既にハンドガードを
 * 握った姿勢を持っているので、コードで動かしていない。
 */
const RIFLE: WeaponConfig = {
  /*
   * 主観の目。**模型は横倒し** (上が +X) なので 90° 起こす。照門の V 字の底は銃身の
   * 軸から +X へ 0.0482m (前 0.47m)、照星 (輪の中の柱) の頂は 0.0462m (前 0.82m) —
   * 照準線は銃身から 0.33° 下がっている。銃を 0.33° 起こして照準線をカメラへ揃え、
   * 目はその線の上、照門の 17cm 後ろ
   * (tools/preview/sight.html で照門の底と照星の頂を真ん中に重ねて測った)
   */
  sight: { eye: new THREE.Vector3(0.0492, 0.165, -0.3), roll: Math.PI / 2, pitch: 0.0057 },
  // しゃがみ構えの右手が高い・外に開いている (本人 2026-10-10)。右手首を 5cm 下げ、体の中心側へ 6cm (銃は向きを保って一緒に動く)
  rightShift: { stand: new THREE.Vector3(0, 0, 0), crouch: new THREE.Vector3(-0.07, -0.05, 0) },
  // 立って構えた時の左手首 (銃の空間)。しゃがんでもここを握る
  leftHand: {
    position: new THREE.Vector3(-0.115, 0.23, -0.53),
    quaternion: new THREE.Quaternion(-0.1264, 0.4312, -0.8492, 0.2776),
  },
  // 構えた時に銃口を照準へ (tools/preview/weapon.html?views=3&fixeddt で、本番と同じ Soldier を測って詰めた)
  aimTrim: { pitch: -6.3, yaw: -1.6, crouchPitch: 21.7, crouchYaw: 9.5 },
  // しゃがみの構えは型が 30° 以上下を向く。大半を上体の起こしで返す (残りを aimTrim で回す)
  aimLift: { stand: 0, crouch: 10 },
  grip: new THREE.Vector3(-0.095, 0.145, -0.165),
  rotation: new THREE.Euler(degrees(-10), degrees(-16), degrees(80)),
  // しゃがむと上半身の角度が変わるので、同じ握り方では銃が体から浮く。
  // 姿勢ごとに値を持って、切り替わりの間は補間する。
  crouchGrip: new THREE.Vector3(-0.095, 0.16, -0.195),
  crouchRotation: new THREE.Euler(degrees(-33), degrees(-5), degrees(80)),
  // 伏せは前のしゃがみの値のまま (しゃがみを詰め直した時に巻き込まない)
  proneGrip: new THREE.Vector3(-0.105, 0.14, -0.2),
  proneRotation: new THREE.Euler(degrees(-34), degrees(-3), degrees(80)),
  tip: new THREE.Vector3(0, 0.171, -0.845),
}


/**
 * M870。全長 980mm のポンプ式 (戦術用の短い型。1190mm の狩猟用の長さでは床尾が体に刺さった)。
 *
 * 銃口の位置が突撃銃とほぼ同じ (0.174 対 0.171) なので、握りの調整値も
 * そのまま流用できる — convert_gltf_gun.py が銃口を揃えて書き出すのは
 * このため。
 */
const SHOTGUN: WeaponConfig = {
  // しゃがみ構えの右手を体の中心側へ 6.5cm (M4 と同じ。本人 2026-10-10)
  rightShift: { stand: new THREE.Vector3(0, 0, 0), crouch: new THREE.Vector3(-0.065, 0, 0) },
  // 立って構えた時の左手首 (銃の空間)。しゃがんでもここを握る
  leftHand: {
    position: new THREE.Vector3(-0.04, 0.045, -0.485),
    quaternion: new THREE.Quaternion(-0.4176, -0.3685, -0.2654, 0.787),
  },
  // 構えた時に銃口を照準へ (tools/preview/weapon.html?views=3&fixeddt で、本番と同じ Soldier を測って詰めた)
  aimTrim: { pitch: -11.6, yaw: 0.0, crouchPitch: -17.6, crouchYaw: 19.6 },
  // しゃがみは握りを直したので上体は起こさない (M4 と同じ)
  aimLift: { stand: 0, crouch: 0 },
  // 実機で詰めた値
  // 全長 0.98m (戦術用の短い型) に縮めた。握りと左手は銃口を中心に同じ割合で写した
  grip: new THREE.Vector3(0.018, 0.113, -0.19),
  rotation: new THREE.Euler(degrees(-6), degrees(-17), degrees(-9)),
  /*
   * しゃがみ。**AK の値を写していたので、しゃがむと銃が横へ 80° 寝た** (本人:
   * しゃがみ構えで銃が左に回る)。AK の模型は寝た向きで作られていて 80° で起こす
   * が、M870 は上を向いている。M4 と同じく立ちの握りから詰めた値
   */
  crouchGrip: new THREE.Vector3(-0.01, 0.115, -0.185),
  crouchRotation: new THREE.Euler(degrees(15), degrees(-18), degrees(-20)),
  // 伏せは前のしゃがみの値のまま (しゃがみを詰め直した時に巻き込まない)
  proneGrip: new THREE.Vector3(0.018, 0.113, -0.19),
  proneRotation: new THREE.Euler(degrees(14), degrees(-17), degrees(-9)),
  tip: new THREE.Vector3(0.006, 0.172, -0.845),
}

/**
 * M4 CUSTOM。全長 840mm。**握りは M870 の値を流用する。**
 *
 * AK の模型は元から銃身を軸に 90° 寝た向きで作られていて、握りの回転 (80°) で
 * 起こしている。convert_gltf_gun.py で書き出した銃 (M870・M4) は上が上を向いて
 * いるので、AK の値を使うと逆に寝る — 弾倉が横を向き、照準器が横へ飛び出した。
 * 銃口の位置も M870 とほぼ同じ (0.174 対 0.166)
 */
const M4: WeaponConfig = {
  ...SHOTGUN,
  /*
   * 主観の目。機関部の上のホロサイト (前 0.30〜0.36m)。**窓に照準の輪が描かれている**
   * ので、その真ん中 (高さ 0.235m) を画面の真ん中へ。模型は立っている (上が +Y)。
   * 目は窓の 15cm 後ろ (tools/preview/sight.html で輪を真ん中に重ねて測った)
   */
  sight: {
    eye: new THREE.Vector3(0.0006, 0.2349, -0.15),
    roll: 0,
    pitch: 0,
    // 窓のガラス: 後ろ (前 0.307m) と前 (前 0.345m) の細かい三角形。枠 (横 ±0.015〜0.017) は残す
    glass: { min: new THREE.Vector3(-0.0148, 0.199, -0.352), max: new THREE.Vector3(0.0148, 0.246, -0.3) },
  },
  // 立って構えた時の左手首 (銃の空間)。しゃがんでもここを握る
  leftHand: {
    position: new THREE.Vector3(-0.06, 0.05, -0.525),
    quaternion: new THREE.Quaternion(-0.3784, -0.2579, -0.3503, 0.8171),
  },
  // しゃがみ構えの右手を体の中心側へ 6.5cm (本人が三面図で詰めた値)
  rightShift: { stand: new THREE.Vector3(0, 0, 0), crouch: new THREE.Vector3(-0.065, 0, 0) },
  // M870 の補正を写さない (写しより後ろに書く)
  aimLift: { stand: 0, crouch: 0 },
  // 構えた時に銃口を照準へ (tools/preview/weapon.html?views=3&fixeddt で、本番と同じ Soldier を測って詰めた)
  aimTrim: { pitch: -10.0, yaw: -0.4, crouchPitch: -16.7, crouchYaw: 18.3 },
  /*
   * 握りは**ピストルグリップ**。M870 は床尾の付け根を握るので、そのままだと手が
   * 床尾に来て銃が前へ 25cm ずれた。M870 の値と模型の握る点のずれ (前へ 3cm・
   * 下へ 4cm) を、M4 のピストルグリップ (z -0.274, y 0.083) に当てた
   */
  grip: new THREE.Vector3(0.02, 0.085, -0.2),
  // しゃがみ・伏せは立ちと同じ握りから。**M870 のしゃがみの値は AK を写した物**
  // (寝た模型を 80° 起こす回転) なので、上を向いた M4 に当てると逆に寝る
  crouchGrip: new THREE.Vector3(0.005, 0.105, -0.23),
  crouchRotation: new THREE.Euler(degrees(14), degrees(-17), degrees(-1)),
  // 伏せは前のしゃがみの値のまま (しゃがみを詰め直した時に巻き込まない)
  proneGrip: new THREE.Vector3(0.02, 0.085, -0.2),
  proneRotation: new THREE.Euler(degrees(14), degrees(-17), degrees(-9)),
  tip: new THREE.Vector3(0.003, 0.166, -0.845),
}

/**
 * P90。全長 500mm のブルパップ。
 *
 * 握りが**銃の真ん中**にある (弾倉と機関部が後ろ半分を占める) ので、
 * 突撃銃の値をそのまま使うと銃口が体に食い込む。銃口 (-0.845) から
 * 0.22m 後ろ、引き金の輪の高さに合わせてある。
 *
 * **実機で詰め直すこと。** ここは断面から出した初期値で、目で合わせていない。
 * 画面の調整パネル (Calibrator) で動かして、確定したらここへ書き戻す。
 */
const SMG: WeaponConfig = {
  // 主観の目。機関部の上の照準器 (リングサイト) の窓を覗く。tools/preview/sight.html?weapon=smg で詰める
  sight: {
    eye: new THREE.Vector3(0, 0.2335, -0.49),
    roll: 0,
    pitch: 0,
    glass: { min: new THREE.Vector3(-0.013, 0.22, -0.8), max: new THREE.Vector3(0.013, 0.243, -0.64) },
  },
  /*
   * 構えていない時 (立ち / しゃがみ)・構え (立ち / しゃがみ) の持ち方と左手は、**本人が Blender で P90 用の型
   * (smg_relaxed_idle / smg_crouch_relaxed / smg_aim / smg_crouch_aim) に銃を持たせて詰めた所** (2026-11-15)。
   * 型の手の骨からの相対を、試合の骨の空間へ写した値。型が持ち方ごと作ってあるので、
   * 旧来の型を補っていた上体の起こし (aimLift)・右手の寄せ (rightShift)・回し (aimTrim) は外した
   */
  standHold: {
    position: new THREE.Vector3(-5.7088, -67.4329, 8.9373),
    quaternion: new THREE.Quaternion(0.47457, 0.47727, -0.47369, 0.568),
    scale: 117.41,
  },
  crouchHold: {
    position: new THREE.Vector3(-2.8529, -67.6357, 0.1779),
    quaternion: new THREE.Quaternion(0.53052, 0.44858, -0.39269, 0.6026),
    scale: 117.41,
  },
  aimHold: {
    position: new THREE.Vector3(-13.2731, -66.573, 4.1481),
    quaternion: new THREE.Quaternion(0.5, 0.5, -0.5, 0.5),
    scale: 117.41,
  },
  crouchAimHold: {
    position: new THREE.Vector3(-13.4023, -65.6388, 3.6242),
    quaternion: new THREE.Quaternion(0.5, 0.5, -0.5, 0.5),
    scale: 117.41,
  },
  leftHand: {
    position: new THREE.Vector3(-0.0701, 0.0986, -0.6877),
    quaternion: new THREE.Quaternion(-0.23685, 0.38215, -0.67245, 0.58794),
  },
  crouchLeftHand: {
    position: new THREE.Vector3(-0.0558, 0.0601, -0.6724),
    quaternion: new THREE.Quaternion(-0.46183, 0.02763, -0.43997, 0.76966),
  },
  // 伏せ (smg_prone_relaxed / smg_prone_aim)。脱力は前からの握り (proneGrip) と同じ所
  proneHold: {
    position: new THREE.Vector3(-6.7376, -60.8176, 6.329),
    quaternion: new THREE.Quaternion(0.41535, 0.54506, -0.52336, 0.50645),
    scale: 117.41,
  },
  proneAimHold: {
    position: new THREE.Vector3(-13.2452, -64.8968, 2.3022),
    quaternion: new THREE.Quaternion(0.5, 0.5, -0.5, 0.5),
    scale: 117.41,
  },
  proneLeftHand: {
    position: new THREE.Vector3(-0.0934, 0.1227, -0.6734),
    quaternion: new THREE.Quaternion(-0.28004, 0.38296, -0.70834, 0.52266),
  },
  relaxedLeftHand: {
    stand: { position: new THREE.Vector3(-0.073, 0.1232, -0.7692), quaternion: new THREE.Quaternion(0.01637, -0.00361, -0.86522, 0.50111) },
    crouch: { position: new THREE.Vector3(-0.0702, 0.1542, -0.7454), quaternion: new THREE.Quaternion(-0.08941, 0.0423, -0.93794, 0.3324) },
  },
  /*
   * しゃがみは 0.6 / -2.2。止まって構える間は脚も P90 の型 (smg_crouch_aim) になったので、共通のしゃがみの
   * 脚に合わせていた -6.2 / 4.9 では銃身が左 7°・下 7° を向き、背骨の向け直しで右手が 6.8cm 動いた (2026-11-16)
   */
  aimTrim: { pitch: 3.3, yaw: 1.8, crouchPitch: 0.6, crouchYaw: -2.2 },
  // 実機で詰めた値。引き金の輪 (後ろ側の大きいほう) の中に来る
  grip: new THREE.Vector3(0.01, 0.11, -0.465),
  rotation: new THREE.Euler(degrees(-8), degrees(-8), degrees(0)),
  // しゃがむと上半身が前に倒れるので、銃も倒して抱え込む (pitch -7 → -44)
  crouchGrip: new THREE.Vector3(0.02, 0.115, -0.44),
  crouchRotation: new THREE.Euler(degrees(-45), degrees(16), degrees(-3)),
  // 伏せ。本人が三面図で詰めた値 (2026-10-10)
  proneGrip: new THREE.Vector3(0.005, 0.12, -0.51),
  proneRotation: new THREE.Euler(degrees(-1), degrees(-14), degrees(-17)),
  // 銃口。断面の実測 (最も -Z の点)
  tip: new THREE.Vector3(0, 0.16, -0.845),
}

/**
 * ナイフ (銃剣) は全長 0.3m の片手武器。
 * 柄は原点付近なので握り位置はほぼ原点。
 */
/*
 * ナイフ。**Blender で手に持たせた置き方をそのまま写した値。**
 *
 * 刺突の素材 (tools/raw/Stabbing.fbx) には、右手の骨に親付けした同じナイフ
 * (Bayonet) が入っている。その骨内の行列を測り、本番の取り付け (肘→手首の線を
 * 基準にする attachTo) を逆算してこの 2 つにした。目で合わせた値ではない。
 * 測り直すときは Blender で骨からの相対行列を出して、同じ逆算を通す。
 *
 * ただし握りの z だけは、測った値 (0.025) から刃の側へ 2cm 寄せた。測った値では柄の尻
 * (柄は z −0.05〜+0.055、鍔は −0.07〜−0.05) を握って見えた (2026-11-05 本人「あと5cmくらい
 * 深く、いま柄の部分をもっちゃってる」)。5cm 寄せた −0.025 では刃を握っていた (同日「3cm もどして」)
 */
const KNIFE: WeaponConfig = {
  grip: new THREE.Vector3(0.015, 0.08, 0.005),
  rotation: new THREE.Euler(degrees(59.1), degrees(5.8), degrees(-26.8)),
  tip: new THREE.Vector3(0, 0, -0.24),
}

/**
 * 狙撃銃。銃口の位置はライフルと揃えてあるので、握りの値も近い所から始まる。
 * (convert_gltf_gun.py が銃口を同じ座標へ持ってくる)
 *
 * 実際の見え方は調整パネルで詰める。ここは出発点。
 */
const SNIPER: WeaponConfig = {
  /*
   * 立ち・しゃがみ・伏せ (構えていない / 構え) は、**本人が Blender で狙撃銃用の型 (sniper_relaxed_idle /
   * sniper_aim / sniper_crouch_relaxed / sniper_crouch_aim / sniper_prone_relaxed / sniper_prone_aim) に
   * 銃を持たせて詰めた所** (2026-11-16)。型が持ち方ごと作ってあるので、旧来の型を補っていた
   * しゃがみ構えの右手の寄せ (rightShift) と回し (aimTrim) は外した
   */
  standHold: {
    position: new THREE.Vector3(27.4906, 21.4818, 5.7449),
    quaternion: new THREE.Quaternion(0.49397, -0.4194, 0.65931, 0.38132),
    scale: 117.41,
  },
  aimHold: {
    position: new THREE.Vector3(27.3436, 25.0356, 5.5574),
    quaternion: new THREE.Quaternion(0.51331, -0.40243, 0.65721, 0.37768),
    scale: 117.41,
  },
  relaxedLeftHand: {
    stand: { position: new THREE.Vector3(0.0822, 0.2133, -0.1832), quaternion: new THREE.Quaternion(-0.03743, -0.53726, 0.6489, 0.53747) },
    crouch: { position: new THREE.Vector3(0.1067, 0.2129, -0.2325), quaternion: new THREE.Quaternion(-0.19299, -0.52023, 0.61086, 0.56477) },
  },
  crouchAimHold: {
    position: new THREE.Vector3(6.3559, 29.8541, 5.5517),
    quaternion: new THREE.Quaternion(0.57365, -0.51862, 0.49908, 0.39098),
    scale: 100.0,
  },
  // 伏せの構えていない時は前からの握り (proneGrip) と同じ所
  proneHold: {
    position: new THREE.Vector3(24.2021, 19.3082, -9.2365),
    quaternion: new THREE.Quaternion(0.59904, -0.33093, 0.43507, 0.58511),
    scale: 117.41,
  },
  proneAimHold: {
    position: new THREE.Vector3(8.9302, 29.4636, 4.1095),
    quaternion: new THREE.Quaternion(0.4789, -0.53443, 0.51602, 0.46772),
    scale: 117.41,
  },
  grip: new THREE.Vector3(0.01, 0.28, 0.135),
  rotation: new THREE.Euler(degrees(-20), degrees(-9), degrees(-180)),
  /*
   * しゃがみ。**型 (crouchFire) の中で銃が置かれている所そのまま。**
   *
   * 姿勢もその型から切ってある (knee_relaxed / knee_ready) ので、作った側が
   * 右手の骨へ直付けして合わせた形がそのまま出る。
   * tools/fit_gun_to_clip.js が出した値。
   *
   * 握りの値 (crouchGrip) は**調整パネルを回したときの受け皿**として残す。
   */
  crouchHold: {
    position: new THREE.Vector3(27.0692, 15.78, 4.4352),
    quaternion: new THREE.Quaternion(0.50893, -0.51028, 0.52889, 0.4482),
    scale: 100.0,
  },
  crouchGrip: new THREE.Vector3(-0.0153, 0.2849, 0.137),
  crouchRotation: new THREE.Euler(degrees(-4.4), degrees(-7.2), degrees(178.1)),
  proneGrip: new THREE.Vector3(-0.03, 0.235, 0.14),
  proneRotation: new THREE.Euler(degrees(-2), degrees(-14), degrees(147)),
  /*
   * 伏せてボルトを引く間。**型の中で銃が置かれている所へ揃えてある。**
   *
   * 動きを作る側が銃を左手の骨に付けて詰めた位置を、同じ銃どうしの形を
   * 突き合わせて写したもの (tools/fit_gun_to_clip.js)。頂点が 53,646 で
   * 一致するので、合わせは一意に決まる。
   */
  boltHold: {
    position: new THREE.Vector3(19.7198, -8.0809, 22.0967),
    quaternion: new THREE.Quaternion(-0.25291, 0.67157, -0.59726, 0.35822),
    scale: 100.0,
  },
  tip: new THREE.Vector3(0, 0.177, -0.845),
}

/**
 * 拳銃。
 *
 * 片手で握るので、長物と違って手のひらの中に収まる。握り位置が原点寄りで
 * 追加回転が 0 なのはそのため — モデルの向きがそのまま手の向きになる。
 */
/**
 * M1911。**M9 と同じ握り方から始める。**
 *
 * どちらも片手の拳銃で全長も近い (0.22m / 0.21m) ので、置き値を分ける理由が
 * 無い。ずれていたら調整パネルで詰める。
 */
const M1911: WeaponConfig = {
  /*
   * しゃがんで構えていない間 (pistol_crouch_relaxed / pistol_crouch_run)。P90 のしゃがみと同じ体に拳銃を
   * 持たせ、本人が Blender で詰めた持ち方 (2026-11-16)
   */
  crouchHold: {
    position: new THREE.Vector3(-0.8626, 8.8088, 2.4369),
    quaternion: new THREE.Quaternion(0.61105, 0.36836, -0.4306, 0.55273),
    scale: 117.41,
  },
  relaxedHoldsOnly: true,
  // 立って構えていない時 (handgun_relaxed_idle)。本人が Blender で詰めた持ち方
  standHold: {
    position: new THREE.Vector3(4.963, 15.6344, 3.0639),
    quaternion: new THREE.Quaternion(0.46406, 0.50941, -0.58396, 0.42912),
    scale: 117.41,
  },
  // 伏せて構えていない時 (handgun_prone_relaxed)。本人が Blender で詰めた持ち方
  proneHold: {
    position: new THREE.Vector3(4.5781, 12.6771, 3.3652),
    quaternion: new THREE.Quaternion(0.60972, 0.48948, -0.42082, 0.45996),
    scale: 117.41,
  },
  // 伏せて構えた時 (handgun_prone_aim)。本人が Blender で詰めた持ち方
  proneAimHold: {
    position: new THREE.Vector3(-0.0636, 8.9579, 3.0379),
    quaternion: new THREE.Quaternion(0.4706, 0.44583, -0.43199, 0.62702),
    scale: 117.41,
  },
  // 立って構えた時 (handgun_aim)。本人が Blender で詰めた持ち方
  aimHold: {
    position: new THREE.Vector3(3.5978, 12.1443, 2.9111),
    quaternion: new THREE.Quaternion(0.55516, 0.49497, -0.4468, 0.49716),
    scale: 117.41,
  },
  // しゃがんで構えた時 (handgun_crouch_aim)。本人が Blender で詰めた持ち方。銃身は今まで通り照準へ向け直す (alignBarrel)
  crouchAimHold: {
    position: new THREE.Vector3(3.3528, 10.9273, 2.6058),
    quaternion: new THREE.Quaternion(0.57439, 0.53501, -0.46349, 0.41111),
    scale: 117.41,
  },
  // 構えている間、銃身を照準へ毎コマ向ける (alignBarrel の注)
  alignBarrel: true,
  // 立ちは本人が三面図で詰めた値 (2026-10-10)
  grip: new THREE.Vector3(0.04, -0.01, 0.09),
  rotation: new THREE.Euler(degrees(-6), degrees(3), degrees(-2)),
  // しゃがみ・伏せ・右手のずらしは M9 と同じ (本人 2026-10-10)
  crouchGrip: new THREE.Vector3(-0.005, -0.025, 0.105),
  crouchRotation: new THREE.Euler(degrees(-16), degrees(33), degrees(-1)),
  proneGrip: new THREE.Vector3(0.035, 0, 0.11),
  proneRotation: new THREE.Euler(degrees(-5), 0, 0),
  // 右手の寄せ (rightShift) は無し: 立ち・しゃがみとも構えの型 (handgun_aim / handgun_crouch_aim) に入っている (本人 2026-11-16)
  tip: new THREE.Vector3(0, 0.067, -0.172),
}

const PISTOL: WeaponConfig = {
  /*
   * しゃがんで構えていない間 (pistol_crouch_relaxed / pistol_crouch_run)。P90 のしゃがみと同じ体に拳銃を
   * 持たせ、本人が Blender で詰めた持ち方 (2026-11-16)
   */
  crouchHold: {
    position: new THREE.Vector3(-0.8626, 8.8088, 2.4369),
    quaternion: new THREE.Quaternion(0.61105, 0.36836, -0.4306, 0.55273),
    scale: 117.41,
  },
  relaxedHoldsOnly: true,
  // 立って構えていない時 (handgun_relaxed_idle)。本人が Blender で詰めた持ち方
  standHold: {
    position: new THREE.Vector3(4.963, 15.6344, 3.0639),
    quaternion: new THREE.Quaternion(0.46406, 0.50941, -0.58396, 0.42912),
    scale: 117.41,
  },
  // 伏せて構えていない時 (handgun_prone_relaxed)。本人が Blender で詰めた持ち方
  proneHold: {
    position: new THREE.Vector3(4.5781, 12.6771, 3.3652),
    quaternion: new THREE.Quaternion(0.60972, 0.48948, -0.42082, 0.45996),
    scale: 117.41,
  },
  // 伏せて構えた時 (handgun_prone_aim)。本人が Blender で詰めた持ち方
  proneAimHold: {
    position: new THREE.Vector3(-0.0636, 8.9579, 3.0379),
    quaternion: new THREE.Quaternion(0.4706, 0.44583, -0.43199, 0.62702),
    scale: 117.41,
  },
  // 立って構えた時 (handgun_aim)。本人が Blender で詰めた持ち方
  aimHold: {
    position: new THREE.Vector3(3.5978, 12.1443, 2.9111),
    quaternion: new THREE.Quaternion(0.55516, 0.49497, -0.4468, 0.49716),
    scale: 117.41,
  },
  // しゃがんで構えた時 (handgun_crouch_aim)。本人が Blender で詰めた持ち方。銃身は今まで通り照準へ向け直す (alignBarrel)
  crouchAimHold: {
    position: new THREE.Vector3(3.3528, 10.9273, 2.6058),
    quaternion: new THREE.Quaternion(0.57439, 0.53501, -0.46349, 0.41111),
    scale: 117.41,
  },
  // 構えている間、銃身を照準へ毎コマ向ける (alignBarrel の注)
  alignBarrel: true,
  // 立ちは本人が三面図で詰めた値 (2026-10-10)
  grip: new THREE.Vector3(0.04, -0.01, 0.09),
  rotation: new THREE.Euler(degrees(-6), degrees(3), degrees(-2)),
  // しゃがみは本人が三面図で詰めた値 (2026-10-10)。伏せは前の値を明示して残す
  crouchGrip: new THREE.Vector3(-0.005, -0.025, 0.105),
  crouchRotation: new THREE.Euler(degrees(-16), degrees(33), degrees(-1)),
  proneGrip: new THREE.Vector3(0.035, 0, 0.11),
  proneRotation: new THREE.Euler(degrees(-5), 0, 0),
  // 右手の寄せ (rightShift) は無し: 立ち・しゃがみとも構えの型 (handgun_aim / handgun_crouch_aim) に入っている (本人 2026-11-16)
  // 銃口。モデルの先端 5mm を測ると y 0.051〜0.083 で、その中央。
  // 置き値のままだと 4.7cm 低く 6.6cm 手前から弾が出ていた
  tip: new THREE.Vector3(0, 0.067, -0.172),
}

/**
 * モシンナガン (麻酔の狙撃銃)。**持ち方は狙撃銃と同じ。**
 *
 * convert_gltf_gun.py が銃口を同じ座標へ揃えて書き出すので、握りの値も
 * ボルトの置き場所もそのまま通る。合わなければここで分ける。
 */
/*
 * モシン (麻酔の狙撃銃)。**狙撃銃の前の持ち方のまま。** 狙撃銃用の型 (sniper_*) はモシンには流さない
 * (animation.ts の表は sniper だけ) ので、型に合わせた置き場所は持たせない
 */
const MOSIN: WeaponConfig = {
  ...SNIPER,
  rightShift: { stand: new THREE.Vector3(0, 0, 0), crouch: new THREE.Vector3(-0.065, 0, 0) },
  aimTrim: { pitch: 3.9, yaw: -9.3, crouchPitch: 1.6, crouchYaw: 9.1 },
  crouchAimHold: undefined,
  proneHold: undefined,
  proneAimHold: undefined,
  standHold: undefined,
  aimHold: undefined,
  relaxedLeftHand: undefined,
}

export const WEAPON_CONFIGS = { smg: SMG, rifle: RIFLE, m4: M4, shotgun: SHOTGUN, sniper: SNIPER, mosin: MOSIN, m9: PISTOL, m1911: M1911, knife: KNIFE } as const
export type WeaponKind = keyof typeof WEAPON_CONFIGS

/**
 * 調整パネルが指す対象。銃は姿勢ごとに別の値を持つ。
 *
 * 立ちとしゃがみで上半身の角度が変わるので、同じ握り方では銃が体から浮く。
 */
export type WeaponTarget =
  | 'smg'
  | 'smgCrouch'
  | 'rifle'
  | 'rifleCrouch'
  | 'shotgun'
  | 'shotgunCrouch'
  | 'sniper'
  | 'sniperCrouch'
  | 'mosin'
  | 'mosinCrouch'
  | 'm9'
  | 'm9Crouch'
  | 'm1911'
  | 'm1911Crouch'
  | 'knife'
  // 伏せ。**しゃがみとは別の握り** — 腹這いは肘の付き方が違う
  | 'smgProne'
  | 'rifleProne'
  | 'shotgunProne'
  | 'sniperProne'
  | 'mosinProne'
  | 'm9Prone'
  | 'm1911Prone'

/**
 * キャラクターが持つ武器。
 *
 * 手ボーンの子として付けるが、ボーンのローカル座標系は Mixamo の骨格依存で
 * 直感的に読めない。そこでオフセットを直接書かず、構えのポーズにおける
 * 右手と左手のワールド位置から取り付け姿勢を計算して求める。
 * (ライフルは右手がグリップ、左手がハンドガードなので、両手を結ぶ線がほぼ銃身の向きになる)
 *
 * この方式なら、モデルや構えのモーションを差し替えても数値を調整し直さずに済む。
 */
export class Weapon {
  readonly object: THREE.Object3D
  readonly config: WeaponConfig

  /** 実機調整で上書きできるよう、設定は複製して持つ */
  private readonly grip: THREE.Vector3
  private readonly rotation: THREE.Euler
  private readonly holdScale = new THREE.Vector3()
  /**
   * しゃがみの置き場所 (測った物)。**調整パネルを回したら手放す** —
   * 回しても動かない滑りがあると、壊れているのか効いていないのか分からない
   */
  private crouchHold: WeaponConfig['crouchHold'] | null
  private standHold: WeaponConfig['standHold'] | null
  private proneHold: WeaponConfig['proneHold'] | null
  private readonly crouchGrip: THREE.Vector3
  private readonly crouchRotation: THREE.Euler
  private readonly proneGrip: THREE.Vector3
  private readonly proneRotation: THREE.Euler
  /**
   * 今どの姿勢に寄っているか。**0 = 立ち / 1 = しゃがみ / 2 = 伏せ。**
   *
   * 3 つを 1 本の数で持つのは、遷移が必ず**立ち → しゃがみ → 伏せ**の順で
   * 起きるから。伏せから立ちへ跳ぶ道は無い (prone_rise がしゃがみを経る) ので、
   * 隣どうしを繋いだ 1 本の軸で足りる。
   */
  private stance = -1
  /** 構えの補正 (aimTrim) をどれだけ掛けるか (0..1)。Soldier が構えに合わせて寄せる */
  private aimWeight = 0
  /** 補正を掛ける前の置き場所 (親 = 手の空間)。左手を付け直す基準に使う */
  private readonly plainQuaternion = new THREE.Quaternion()
  private readonly correctionScratch = new THREE.Quaternion()
  /**
   * 取り付けた手。**預けた後に戻す先**。
   *
   * 伏せてボルトを引く間だけ、銃を反対の手へ預ける — あの型は**銃を持つ手で
   * ボルトを引く**ので、付けたままだと銃ごと動いてしまう。
   */
  private home: THREE.Object3D | null = null
  /** いま預けている手。預けている間は握りを作り直さない */
  private lent: THREE.Object3D | null = null
  private readonly blendGrip = new THREE.Vector3()
  private readonly blendRotation = new THREE.Quaternion()
  private readonly fromRotation = new THREE.Quaternion()
  private readonly toRotation = new THREE.Quaternion()

  /**
   * 取り付け時の状態。再調整のたびにこれを基準に計算し直す。
   *
   * 手ボーンのワールド行列は毎フレーム動くので、取り付けた瞬間 (構えのポーズ) の
   * ものを保持しておく必要がある。現在の行列で計算すると調整するたびに基準がずれる。
   */
  private context: {
    handWorldInverse: THREE.Matrix4
    /** グリップを重ねる先。取り付ける手ボーンそのものの位置 */
    anchor: THREE.Vector3
    baseRotation: THREE.Quaternion
  } | null = null

  private constructor(object: THREE.Object3D, config: WeaponConfig) {
    this.object = object
    this.config = config
    this.grip = config.grip.clone()
    this.rotation = config.rotation.clone()
    this.crouchGrip = (config.crouchGrip ?? config.grip).clone()
    // 設定は共有物なので複製して持つ。パネルで手放すのは自分の分だけ
    this.crouchHold = config.crouchHold
      ? {
          position: config.crouchHold.position.clone(),
          quaternion: config.crouchHold.quaternion.clone(),
          scale: config.crouchHold.scale,
        }
      : null
    this.standHold = config.standHold
      ? { position: config.standHold.position.clone(), quaternion: config.standHold.quaternion.clone(), scale: config.standHold.scale }
      : null
    this.proneHold = config.proneHold
      ? { position: config.proneHold.position.clone(), quaternion: config.proneHold.quaternion.clone(), scale: config.proneHold.scale }
      : null
    this.crouchRotation = (config.crouchRotation ?? config.rotation).clone()
    // 伏せは書いていなければしゃがみと同じ。**書くまでは今までの見え方のまま**
    this.proneGrip = (config.proneGrip ?? this.crouchGrip).clone()
    this.proneRotation = (config.proneRotation ?? this.crouchRotation).clone()
    this.object.traverse((obj) => {
      if (isMesh(obj)) obj.castShadow = false   // 動く物は影マップに入れない (world/staticShadow.ts)
    })
  }

  /** 読み込みは共有キャッシュ。持ち主ごとに複製して返す */
  static async load(kind: WeaponKind = 'rifle'): Promise<Weapon> {
    const gltf =
      kind === 'knife'
        ? await loadKnife()
        : kind === 'sniper'
          ? await loadSniper()
          : kind === 'm9'
            ? await loadPistol()
            : kind === 'm1911'
              ? await loadM1911()
            : kind === 'mosin'
              ? await loadMosin()
            : kind === 'm4'
              ? await loadM4()
            : kind === 'smg'
              ? await loadSmg()
              : kind === 'shotgun'
                ? await loadShotgun()
                : await loadRifle()
    return new Weapon(cloneSkinned(gltf.scene), WEAPON_CONFIGS[kind])
  }

  set visible(value: boolean) {
    this.object.visible = value
  }

  /**
   * 手ボーンに取り付ける。呼ぶ前にモデルのワールド行列が構えのポーズで
   * 更新されている必要がある (バインドポーズのままだと T ポーズ基準で計算してしまう)。
   *
   * 向きはオフセットを直接書かず、骨格上の 2 点を結ぶ線から導く。
   * ライフルなら「右手 -> 左手」が銃身、ナイフなら「肘 -> 手首」が刃の向きになる。
   * こうしておくと、モデルや構えのモーションを差し替えても値の調整が要らない。
   *
   * @param axisFrom 向きの基準の始点
   * @param axisTo 向きの基準の終点。ここへ向かう方向が武器の -Z になる
   * @param handMatrix 手ボーンのワールド行列。省略すると今の姿勢から読む。
   *
   *   持ち替えのときは**最初に取り付けたときの行列**を渡す。その場の姿勢から
   *   取り直すと、しゃがんで構えている最中に持ち替えたときの手の向きが基準に
   *   なってしまい、銃が下を向く。基準は姿勢によらず 1 つでなければならない。
   */
  attachTo(
    hand: THREE.Bone,
    axisFrom: THREE.Vector3,
    axisTo: THREE.Vector3,
    handMatrix?: THREE.Matrix4,
  ): void {
    const forward = new THREE.Vector3().subVectors(axisTo, axisFrom)
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1)
    forward.normalize()

    // 銃の上方向はワールドの上を銃身と直交させたもの。両手だけでは軸回りの回転が決まらない。
    const up = new THREE.Vector3(0, 1, 0)
    if (Math.abs(up.dot(forward)) > 0.99) up.set(0, 0, 1)

    // 銃のローカル軸: -Z が forward なので +Z は逆向き
    const axisZ = forward.clone().negate()
    const axisX = new THREE.Vector3().crossVectors(up, axisZ).normalize()
    const axisY = new THREE.Vector3().crossVectors(axisZ, axisX)

    const baseRotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(axisX, axisY, axisZ),
    )

    hand.updateWorldMatrix(true, false)
    const reference = handMatrix ?? hand.matrixWorld
    this.context = {
      handWorldInverse: new THREE.Matrix4().copy(reference).invert(),
      // 基準は「取り付ける手」の位置。軸の始点/終点とは別物で、
      // 混同するとライフルが左手の位置を基準に付いてしまう。
      anchor: new THREE.Vector3().setFromMatrixPosition(reference),
      baseRotation,
    }

    hand.add(this.object)
    this.home = hand
    this.lent = null
    this.stance = -1
    this.applyStance(0)
  }

  /**
   * 姿勢に合わせて持ち方を変える。
   *
   * しゃがむと上半身の角度が変わるぶん、立ちと同じ握り方では銃が体から浮く。
   * 姿勢ごとの値の間を補間して、切り替わりで銃が跳ねないようにする。
   *
   * @param blend 0 = 立ち、1 = しゃがみ、2 = 伏せ
   */
  applyStance(blend: number): void {
    // 預けている間は作り直さない。作り直すと預け先の手を基準に組み直して跳ねる
    if (this.lent) {
      this.stance = blend
      return
    }
    // 変化が無ければ作り直さない。毎フレーム呼ばれる想定なので
    if (Math.abs(blend - this.stance) < 0.002) return
    this.stance = blend
    this.rebuild(blend)
  }

  /**
   * 銃を別の手へ預ける。**世界での位置を保ったまま。**
   *
   * 伏せてボルトを引く型は、**銃を持つ右手でボルトを引く**。付けたままだと
   * 銃が右手に付いていくので、引く動きがそのまま銃の動きになる。
   *
   * 握りの数字は取り直さない。`attach` は**世界での姿勢を保って**親を
   * 付け替えるので、預けた瞬間の持ち方がそのまま左手に移る。左手用の
   * 握り (grip / rotation) を姿勢ごとに詰め直す必要が無い。
   *
   * @param hand 預け先。null で元の手へ戻す
   */
  holdWith(hand: THREE.Object3D | null): void {
    const to = hand ?? this.home
    if (!to || to === (this.lent ?? this.home)) return
    if (hand) {
      hand.updateWorldMatrix(true, false)
      const hold = this.config.boltHold
      if (hold) {
        // 型に合わせて置く。**世界での位置は保たない** — 型のほうが正しい
        hand.add(this.object)
        this.object.position.copy(hold.position)
        this.object.quaternion.copy(hold.quaternion)
        this.object.scale.setScalar(hold.scale)
      } else {
        hand.attach(this.object)
      }
      this.lent = hand
      return
    }
    // 戻す。**握りは組み直す** — 預けている間に手が動いているので
    this.lent = null
    this.home?.add(this.object)
    const blend = this.stance
    this.stance = -1
    this.applyStance(blend)
  }

  /** 調整用に、姿勢ごとの値を差し替える。今の姿勢のまま反映する */
  setStanceValues(
    stance: 'stand' | 'crouch' | 'prone',
    grip: THREE.Vector3,
    rotation: THREE.Euler,
  ): void {
    if (stance === 'prone') {
      this.proneGrip.copy(grip)
      this.proneRotation.copy(rotation)
      this.proneHold = null
    } else if (stance === 'crouch') {
      this.crouchGrip.copy(grip)
      this.crouchRotation.copy(rotation)
      // 手で回し始めたら、測った置き場所は退く
      this.crouchHold = null
    } else {
      this.grip.copy(grip)
      this.rotation.copy(rotation)
      this.standHold = null
    }
    this.rebuild(Math.max(this.stance, 0))
  }

  /**
   * 構えの補正の掛かり具合 (0..1)。**変わった時だけ組み直す。**
   */
  setAimWeight(weight: number): void {
    if (Math.abs(weight - this.aimWeight) < 0.002) return
    this.aimWeight = weight
    if (!this.lent) this.rebuild(this.stance < 0 ? 0 : this.stance)
  }

  private rebuild(blend: number): void {
    this.place(blend)
    this.plainQuaternion.copy(this.object.quaternion)
    this.applyAimTrim(blend)
    // 置き直したので、向け直しの基準も取り直す
    this.restSaved = false
  }

  /**
   * 構えの補正 (aimTrim) を掛ける。**握り (grip) を支点に回す** — 右手と銃の
   * 関係は変わらず、銃口だけが向きを変える。立ち→しゃがみで混ぜ、伏せへ向けて抜く
   */
  private applyAimTrim(blend: number): void {
    const trim = this.config.aimTrim
    if (!trim || this.aimWeight <= 0) return
    const crouch = Math.min(1, blend)
    const fade = blend <= 1 ? 1 : Math.max(0, 2 - blend)
    const weight = this.aimWeight * fade
    if (weight <= 0) return
    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(trim.pitch, trim.crouchPitch, crouch)) * weight
    const yaw = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(trim.yaw, trim.crouchYaw, crouch)) * weight
    /*
     * **付けた時の基準の空間で回す** (右 = +X、上 = +Y が世界と揃っている。attachTo の
     * baseRotation)。銃の空間で回すと、模型ごとに軸が違う — AK の模型は銃身を
     * 軸に 90° 寝ているので、上下に回したつもりが左右に化けた。
     * 手の空間へは: 手の基準の逆 × (基準 × 回し × 基準の逆) × 手の基準
     */
    const ctx = this.context
    if (!ctx) return
    const turn = this.correctionScratch.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
    // 行列には骨の縮尺 (Armature の 0.01) が混じっているので、向きだけ分けて取る
    const hand = new THREE.Quaternion()
    ctx.handWorldInverse.clone().invert().decompose(new THREE.Vector3(), hand, new THREE.Vector3())
    const inWorld = ctx.baseRotation.clone().multiply(turn).multiply(ctx.baseRotation.clone().invert())
    const local = hand.clone().invert().multiply(inWorld).multiply(hand)
    // 握りが動かないよう位置を戻す: 位置 += 回す前の握り − 回した後の握り (手の空間、縮尺込み)
    const grip = this.blendGrip
    const before = grip.clone().multiply(this.object.scale).applyQuaternion(this.object.quaternion)
    this.object.quaternion.premultiply(local)
    const after = grip.clone().multiply(this.object.scale).applyQuaternion(this.object.quaternion)
    this.object.position.add(before.sub(after))
  }

  /** alignBarrel で回す前の置き場所。毎コマここへ戻してから向け直す */
  private readonly restQuaternion = new THREE.Quaternion()
  private readonly restPosition = new THREE.Vector3()
  private restSaved = false

  /**
   * 銃身を世界の向き dir へ向ける (alignBarrel の銃だけ)。重み 0..1。
   * **毎コマ呼ぶ** — 手は型で動くので、向け直しも毎コマ要る
   */
  alignTo(dir: THREE.Vector3, weight: number): void {
    if (!this.config.alignBarrel || this.lent) return
    if (this.restSaved) {
      this.object.quaternion.copy(this.restQuaternion)
      this.object.position.copy(this.restPosition)
    } else {
      this.restQuaternion.copy(this.object.quaternion)
      this.restPosition.copy(this.object.position)
      this.restSaved = true
    }
    if (weight <= 0) return
    const parent = this.object.parent
    if (!parent) return
    this.object.updateWorldMatrix(true, false)
    const barrel = new THREE.Vector3(0, 0, -1).transformDirection(this.object.matrixWorld)
    const turn = new THREE.Quaternion().setFromUnitVectors(barrel, dir.clone().normalize())
    turn.slerp(new THREE.Quaternion(), 1 - weight)
    const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion())
    const local = parentWorld.clone().invert().multiply(turn).multiply(parentWorld)
    const grip = this.blendGrip
    const before = grip.clone().multiply(this.object.scale).applyQuaternion(this.object.quaternion)
    this.object.quaternion.premultiply(local)
    const after = grip.clone().multiply(this.object.scale).applyQuaternion(this.object.quaternion)
    this.object.position.add(before.sub(after))
    this.object.updateWorldMatrix(false, true)
  }

  /**
   * 構えている間に**左手首を置く所** (世界)。銃に leftHand が無ければ false
   */
  leftHandTarget(outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): boolean {
    const aiming = !!this.config.leftHand && this.aimWeight > 0
    const carry = this.config.relaxedLeftHand
    const carrying = !!carry && this.carryWeight > 0
    this.leftWeight = Math.max(aiming ? this.aimWeight : 0, carrying ? this.carryWeight : 0)
    if (!aiming && !carrying) return false
    // 提げている間の左手 (立ち→しゃがみで混ぜる)
    if (carrying) {
      const c = Math.min(1, Math.max(0, this.stance))
      this.carryPosition.lerpVectors(carry!.stand.position, carry!.crouch.position, c)
      this.carryQuaternion.slerpQuaternions(carry!.stand.quaternion, carry!.crouch.quaternion, c)
      if (!aiming) {
        outPosition.copy(this.carryPosition).applyMatrix4(this.object.matrixWorld)
        outQuaternion.copy(this.carryQuaternion).premultiply(this.object.getWorldQuaternion(new THREE.Quaternion()))
        return true
      }
    }
    const hold = this.config.leftHand!
    const crouch = this.config.crouchLeftHand
    const t = crouch ? Math.min(1, Math.max(0, this.stance)) : 0
    outPosition.copy(hold.position)
    outQuaternion.copy(hold.quaternion)
    if (crouch && t > 0) {
      outPosition.lerp(crouch.position, t)
      outQuaternion.slerp(crouch.quaternion, t)
    }
    const prone = this.config.proneLeftHand
    if (prone && this.stance > 1) {
      const p = Math.min(1, this.stance - 1)
      outPosition.lerp(prone.position, p)
      outQuaternion.slerp(prone.quaternion, p)
    }
    // 構えと提げの間 (構えの掛かり具合で寄せる)
    if (carrying) {
      outPosition.lerpVectors(this.carryPosition, outPosition, this.aimWeight)
      outQuaternion.slerpQuaternions(this.carryQuaternion, outQuaternion, this.aimWeight)
    }
    outPosition.applyMatrix4(this.object.matrixWorld)
    outQuaternion.premultiply(this.object.getWorldQuaternion(new THREE.Quaternion()))
    return true
  }

  /** 構えの補正の掛かり具合 (0..1) */
  get aimAmount(): number {
    return this.aimWeight
  }

  /** 左手を運ぶ掛かり具合 (0..1)。構え・提げの大きいほう。leftHandTarget が出す */
  get leftHandWeight(): number {
    return this.leftWeight
  }

  /**
   * 提げている間の左手の掛かり具合 (0..1、relaxedLeftHand)。Soldier が型 (CharacterAnimator.carrying) を見て寄せる
   */
  setCarryWeight(weight: number): void {
    this.carryWeight = weight
  }

  /**
   * **構えの置き場所 (aimHold / crouchAimHold / proneAimHold) の掛かり具合。** 伏せも含む。
   *
   * 構えの補正 (setAimWeight) は伏せで 0 にしている (伏せは回さない・左手を付け直さない) ので、それで
   * 置き場所まで寄せていた頃は**伏せの構えの置き場所が試合で効いていなかった** (試写は 1 を渡していて
   * 気づかなかった、2026-11-16)。渡されなければ構えの補正と同じ値
   */
  setAimHoldWeight(weight: number): void {
    if (Math.abs(weight - this.aimHoldWeight) < 0.002) return
    this.aimHoldWeight = weight
    if (!this.lent) this.rebuild(this.stance < 0 ? 0 : this.stance)
  }
  private carryWeight = 0
  private leftWeight = 0
  private aimHoldWeight = -1
  private readonly carryPosition = new THREE.Vector3()
  private readonly carryQuaternion = new THREE.Quaternion()

  /**
   * 構えの補正で銃が回った分を、**世界の向きで**返す (回した後 × 回す前の逆)。
   * 補正が掛かっていなければ false。支点 (握り) の世界座標も返す
   */
  aimCorrection(outDelta: THREE.Quaternion, outPivot: THREE.Vector3): boolean {
    if (this.object.quaternion.angleTo(this.plainQuaternion) < 1e-4) return false
    const parent = this.object.parent
    if (!parent) return false
    const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion())
    const corrected = parentWorld.clone().multiply(this.object.quaternion)
    const plain = parentWorld.multiply(this.plainQuaternion)
    outDelta.copy(corrected).multiply(plain.invert())
    outPivot.copy(this.blendGrip).applyMatrix4(this.object.matrixWorld)
    return true
  }

  private place(blend: number): void {
    /*
     * 隣どうしを繋ぐ。0〜1 は立ち→しゃがみ、1〜2 はしゃがみ→伏せ。
     *
     * 3 つを一度に混ぜない。真ん中 (しゃがみ) を通らずに立ちと伏せを混ぜると、
     * **どちらの姿勢でもない握り**が途中に出る。
     */
    const from = blend <= 1 ? this.grip : this.crouchGrip
    const to = blend <= 1 ? this.crouchGrip : this.proneGrip
    const fromR = blend <= 1 ? this.rotation : this.crouchRotation
    const toR = blend <= 1 ? this.crouchRotation : this.proneRotation
    const t = blend <= 1 ? blend : blend - 1

    this.blendGrip.lerpVectors(from, to, t)
    /*
     * 向きは**回転として**混ぜる。成分ごとに混ぜない。
     *
     * 姿勢ごとの値は 3 つの角度で持っているが、その 3 つを別々に動かすと
     * 途中がどちらでもない向きになる。しゃがみ (1, -14, -180) から
     * 伏せ (-93, -135, 20) で実測したところ、**銃口が最短の道から 57° 外れて**
     * 一度右を向いてから戻っていた。伏せる 0.3 秒がそのまま見える。
     *
     * 両端は変わらないので、調整した値はそのまま効く。
     */
    this.blendRotation.slerpQuaternions(
      this.fromRotation.setFromEuler(fromR),
      this.toRotation.setFromEuler(toR),
      t,
    )
    this.calibrateWith(this.blendGrip, this.blendRotation)

    /*
     * 型から測った置き場所がある姿勢は、**そちらで上書きする。**
     *
     * 握りの値は「取り付けた瞬間の手の向き」を基準に逆算する仕組みで、その
     * 基準を外から作り直せない。型で測った置き場所を握りへ写すと 6.3° ずれた
     * (銃口が下を向いた)。測った物は測ったまま置く。
     *
     * 隣の姿勢との間は**置き場所どうしを混ぜる**。握りを混ぜてから組むのとは
     * 途中が変わるが、両端は変わらないので切り替わりで跳ねない。
     */
    // 立ちの置き場所 (standHold) も同じく測った物で上書きし、しゃがみへ向けて抜く
    const stand = this.standHold
    if (stand && blend < 1) {
      const relaxedOnly = this.config.relaxedHoldsOnly ? 1 - (this.aimHoldWeight < 0 ? this.aimWeight : this.aimHoldWeight) : 1
      const toStand = (1 - blend) * relaxedOnly
      this.object.position.lerp(stand.position, toStand)
      this.object.quaternion.slerp(stand.quaternion, toStand)
      this.object.scale.lerp(this.holdScale.setScalar(stand.scale), toStand)
    }
    const hold = this.crouchHold
    const aimHold = this.aimHoldWeight < 0 ? this.aimWeight : this.aimHoldWeight
    const toHold = (blend <= 1 ? t : 1 - t) * (this.config.relaxedHoldsOnly ? 1 - aimHold : 1)
    if (hold && toHold > 0) {
      this.object.position.lerp(hold.position, toHold)
      this.object.quaternion.slerp(hold.quaternion, toHold)
      this.object.scale.lerp(this.holdScale.setScalar(hold.scale), toHold)
    }
    const prone = this.proneHold
    if (prone && blend > 1) {
      const toProne = t * (this.config.relaxedHoldsOnly ? 1 - aimHold : 1)
      this.object.position.lerp(prone.position, toProne)
      this.object.quaternion.slerp(prone.quaternion, toProne)
      this.object.scale.lerp(this.holdScale.setScalar(prone.scale), toProne)
    }
    this.placeAim(blend)
  }

  /**
   * 構えの持ち方 (aimHold / crouchAimHold) へ aimWeight で寄せる。立ち→しゃがみで混ぜ、
   * 伏せへ向けて抜く (伏せの構えは握りの値のまま)
   */
  private placeAim(blend: number): void {
    const aimHold = this.aimHoldWeight < 0 ? this.aimWeight : this.aimHoldWeight
    if (aimHold <= 0) return
    /*
     * 姿勢ごとの構えの置き場所 (立ち / しゃがみ / 伏せ)。**ある姿勢だけ寄せる** — 無い姿勢は握りの値のまま。
     * 狙撃銃は立ちの構えを持たない (しゃがみと伏せだけ型で詰めた、2026-11-16)。しゃがみは無ければ立ちと同じ
     */
    const holds = [this.config.aimHold, this.config.crouchAimHold ?? this.config.aimHold, this.config.proneAimHold]
    const low = blend < 1 ? 0 : 1
    const t = Math.min(1, Math.max(0, blend - low))
    const a = holds[low]
    const b = holds[low + 1]
    if (!a && !b) return
    let weight = aimHold
    if (a && b) {
      this.aimPosition.lerpVectors(a.position, b.position, t)
      this.aimQuaternion.slerpQuaternions(a.quaternion, b.quaternion, t)
      this.aimScale = THREE.MathUtils.lerp(a.scale, b.scale, t)
    } else {
      // 片方だけ。無い側へ向けて抜く
      const only = (a ?? b)!
      this.aimPosition.copy(only.position)
      this.aimQuaternion.copy(only.quaternion)
      this.aimScale = only.scale
      weight *= a ? 1 - t : t
    }
    if (weight <= 0) return
    this.object.position.lerp(this.aimPosition, weight)
    this.object.quaternion.slerp(this.aimQuaternion, weight)
    this.object.scale.lerp(this.holdScale.setScalar(this.aimScale), weight)
  }
  private aimScale = 1
  private readonly aimPosition = new THREE.Vector3()
  private readonly aimQuaternion = new THREE.Quaternion()

  /**
   * 握り位置と追加回転を指定して取り付け姿勢を作り直す。
   * 調整用に毎フレーム呼んでも問題ない程度には軽い。
   */
  calibrate(grip: THREE.Vector3, extraRotation: THREE.Euler): void {
    this.calibrateWith(grip, new THREE.Quaternion().setFromEuler(extraRotation))
    // 調整パネルから当て直しても、構えの補正は掛け直す (掛けないと補正が消えたまま残る)
    this.blendGrip.copy(grip)
    this.plainQuaternion.copy(this.object.quaternion)
    this.applyAimTrim(this.stance < 0 ? 0 : this.stance)
  }

  private calibrateWith(grip: THREE.Vector3, extra: THREE.Quaternion): void {
    const ctx = this.context
    if (!ctx) return

    const rotation = ctx.baseRotation.clone().multiply(extra)
    // グリップが手に重なるよう、原点を逆算する
    const origin = grip.clone().applyQuaternion(rotation).negate().add(ctx.anchor)
    const world = new THREE.Matrix4().compose(origin, rotation, new THREE.Vector3(1, 1, 1))

    // ボーンのローカルへ変換する。骨格側のスケール (Armature の 0.01) もここで相殺される
    const local = new THREE.Matrix4().copy(ctx.handWorldInverse).multiply(world)
    local.decompose(this.object.position, this.object.quaternion, this.object.scale)
  }

  /** 先端 (銃口 / 刃先) のワールド座標 */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.config.tip).applyMatrix4(this.object.matrixWorld)
  }

  /**
   * 排莢口のワールド座標。
   *
   * 銃口ではなく機関部の右側から出る。銃ごとに測ってはいない —
   * 飛んだ薬莢は一瞬で視界から外れるので、位置の細かさより
   * 「銃のあたりから右へ飛ぶ」が合っていれば足りる。
   */
  ejectWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(EJECT_LOCAL.x, EJECT_LOCAL.y, EJECT_LOCAL.z).applyMatrix4(this.object.matrixWorld)
  }

  /** 左手を持っていく先のワールド座標。片手武器なら null */


  /**
   * 手から外す。
   *
   * **ジオメトリとマテリアルは捨てない。** 読み込みは URL でキャッシュしていて、
   * 持ち主ごとの複製 (SkeletonUtils.clone) は元とジオメトリ・マテリアルを
   * 共有している。ここで捨てると、同じ銃を持っている他の人の描画まで壊れる。
   *
   * WebGPU では黙って壊れない。まだ提出中のバッファが破棄されて
   * 「used in submit while destroyed」が出続け、影の描画物も一緒に捨てられる
   * (箱の影が出ず、人の影が置き去りになる)。持ち替えと湧き直しのたびに起きる。
   *
   * 捨てないことで残るのは、読み込んだ銃のぶんの記憶だけ。銃は数種類しか
   * 無いので、抱えたままで構わない。
   */
  dispose(): void {
    this.object.removeFromParent()
  }
}

/**
 * 主観用の銃から**窓のガラスを削る** (weapon.ts の sight.glass)。
 *
 * 箱の中にあって目の方 (±Z) を向いた三角形を、索引から外す。形は体の銃と共有
 * しているので、複製してから削る
 */
export function cutSightGlass(root: THREE.Object3D, box: { min: THREE.Vector3; max: THREE.Vector3 }): void {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const rootInverse = root.matrixWorld.clone().invert();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    const position = geometry.getAttribute('position');
    const index = geometry.index ?? null;
    const count = index ? index.count : position.count;
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    const kept: number[] = [];
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(toRoot);
      b.fromBufferAttribute(position, ib).applyMatrix4(toRoot);
      c.fromBufferAttribute(position, ic).applyMatrix4(toRoot);
      centre.copy(a).add(b).add(c).divideScalar(3);
      normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      const glass =
        centre.x > box.min.x && centre.x < box.max.x &&
        centre.y > box.min.y && centre.y < box.max.y &&
        centre.z > box.min.z && centre.z < box.max.z &&
        Math.abs(normal.z) > 0.9;
      if (!glass) kept.push(ia, ib, ic);
    }
    geometry.setIndex(kept);
    mesh.geometry = geometry;
  });
}
