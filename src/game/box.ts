import * as THREE from 'three'
import { damp } from './math'
import { createHandleAlpha } from './cardboard'

/**
 * ダンボール箱。
 *
 * 隠れるための道具。被っている間はキャラのメッシュを消して箱だけを出す
 * (中の姿勢は誰にも見えないので、モーションを足す必要がない)。
 *
 * これは見た目の小細工ではなく、選択的可視化の受け皿になる。サーバー権威に移ったら
 * 「箱の中の人」はプレイヤーとして配信せず、箱というオブジェクトだけを配る。
 * クライアントは中身が誰か、そもそも居るのかすら知らない。情報が届いていないので
 * 透視の類では暴けない。
 */

/**
 * 箱の寸法 (m)。
 *
 * 素の姿勢は しゃがみ静止 0.94m / sneak 1.17m だが、被っている間は
 * 背骨を追加で 34° 丸めて頭を下げている (animation.ts の BOX_LEAN)。
 * 箱の大きさに姿勢を合わせる形にしてあるのは、「人が入れる最小の箱」
 * という見た目を保ちたいため。箱を大きくすれば収まるが、それでは
 * ただの大きな箱になる。
 */
/**
 * 寸法は実機で詰める。中の姿勢は骨だけでも 高さ 1.17m / 幅 1.12m あり、
 * そこに肉と髪の厚みが乗るので、実測値から机上で決めると必ずはみ出る。
 */
export interface BoxTuning {
  width: number
  height: number
  /** 頭の上に取る余裕 (m)。頭ボーンより上に頭頂部があるぶん */
  clearance: number
  /**
   * 浮きの強さ。1 = 頭が収まる最小限だけ浮く。
   * 上げると余分に浮いて隙間から足がよく見えるが、中も覗ける。
   */
  liftScale: number
  /** キャラに対する前後のずれ (m)。+ で前 (キャラの向いている側) */
  offsetForward: number
  /** 左右のずれ (m)。+ で右 */
  offsetRight: number
  /**
   * 不透明度 (0..1)。
   *
   * 中の姿勢と箱の位置関係を目で確かめるための調整用。
   * 1 で完全な段ボール。下げると中が透けるので、頭や腕がどこではみ出ているか、
   * 箱の中心が体に対してどれだけずれているかが直接見える。
   */
  opacity: number
}

const tuning: BoxTuning = {
  width: 1.4,
  height: 1.15,
  clearance: 0.24,
  liftScale: 1,
  offsetForward: 0.2,
  offsetRight: 0.03,
  opacity: 1,
}

/** 寸法と位置の調整用。確定したら tuning の初期値へ焼き込む */
export function setBoxTuning(next: Partial<BoxTuning>): void {
  Object.assign(tuning, next)
}

/**
 * 箱が下りてくる速さ。
 *
 * 上がる側は補間しない。遅れると、歩き出した瞬間に頭が箱を突き抜ける。
 * 下がる側だけ遅らせれば、止まったときに箱がすっと落ちる動きになる。
 * (カメラの遮蔽補正と同じ考え方 — 破綻する側を即座に、戻る側を滑らかに)
 */
const BOX_LIFT_LAMBDA = 12

/**
 * 箱の浮きを 1 フレーム進める。
 *
 * @param current 現在の浮き (m)
 * @param target 姿勢から出した目標 (m)
 */
export function advanceBoxLift(current: number, target: number, dt: number): number {
  if (target >= current) return target
  return damp(current, target, BOX_LIFT_LAMBDA, dt)
}

/**
 * 中の姿勢に対して、箱をどれだけ持ち上げるか (m)。
 *
 * 立ち上がるほど箱は浮き、その隙間から足が見える。しゃがんで止まれば
 * 地面に接する。箱の中の人が動いていることが、外から読み取れる形にしたい
 * (止まっていれば風景、動けば「箱が動いた」という情報になる)。
 *
 * @param headHeight 足元から頭ボーンまでの高さ (m)
 */
export function boxLift(headHeight: number): number {
  return Math.max(0, headHeight + tuning.clearance - tuning.height) * tuning.liftScale
}

/**
 * 箱を今の寸法・位置・浮きに合わせる。毎フレーム呼んでよい。
 *
 * 前後左右のずれはキャラのローカル座標で効く (箱はキャラの子なので、
 * 向きを変えれば箱ごと回る)。前傾した姿勢では体が前に出るので、
 * 箱もそのぶん前へ寄せないと背中がはみ出る。
 *
 * キャラの正面はローカル -Z。
 */
export function placeBox(box: THREE.Mesh, lift: number): void {
  applyOpacity(box)
  box.scale.set(tuning.width, tuning.height, tuning.width)
  box.position.set(
    tuning.offsetRight,
    tuning.height / 2 + lift,
    -tuning.offsetForward,
  )
}

/** 側面の色。彩度を落とした段ボール色 */
const SIDE_COLOR = 0xffffff
/** 上面。フラップが陰になるので側面より暗い */
const TOP_COLOR = 0xbdb3a4
/** 底面。接地して見えないが、下から覗かれたときのために暗く */
const BOTTOM_COLOR = 0x7a7066

/**
 * 箱を 1 つ作る。足元 (y=0) に置く前提で、原点が底面に来るようずらしてある。
 *
 * マテリアルは面ごとに分ける。単色の立方体は陰影が付かず、
 * 平行光の向きによっては輪郭が消えて板に見える。
 */
/**
 * 全部の面に共通の設定。
 *
 * **裏面も描く。** 持ち手の穴からも、被っている本人の視点からも箱の内側が見えるので、
 * 表しか描かないと壁が消えて外の景色が透ける。
 *
 * shadowSide は触らない。DoubleSide のときは three が裏面を影の深度に使う
 * (奥の面で深度を書くので、手前の面が自分の影に入らない)。
 * FrontSide を指定したら、手前の面が自分自身を影にして大きな黒い塊が出た。
 */
const INTERIOR = {
  side: THREE.DoubleSide,
} as const

/**
 * 箱の見た目は全員で 1 組を共有する。
 *
 * 箱は誰が被っても同じ物なので、人数分作る理由が無い。それ以上に、
 * **人ごとに作って人ごとに捨てる形が壊れやすい**。退出のたびにマテリアルと
 * テクスチャを捨てることになり、まだ描画に使われている物を破棄すると
 * WebGPU が「破棄済みのバッファが使われた」と言って以後ずっと描画が崩れる。
 */
let shared: { geometry: THREE.BoxGeometry; materials: THREE.Material[] } | null = null

function sharedParts(): { geometry: THREE.BoxGeometry; materials: THREE.Material[] } {
  if (shared) return shared

  // 1m 角で作って scale で寸法を出す。調整のたびにジオメトリを作り直さずに済む。
  const geometry = new THREE.BoxGeometry(1, 1, 1)

  // クラフト紙の写真。全部の面で 1 枚を共有する。
  //
  // **読み終わってから map を差し替えない。** loader.load は入れ物を即座に返し、
  // 画像が届いたら中身だけ入れ替わる。あとから material.map を代入して
  // needsUpdate を立てると、WebGPU では描画物が作り直しになり、
  // まだ提出中のバッファが破棄されて以後ずっと描画が崩れる。
  const photo = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}textures/cardboard.jpg`,
    undefined,
    undefined,
    (error) => console.warn('[Box] cardboard.jpg が読めない', error),
  )
  photo.colorSpace = THREE.SRGBColorSpace
  photo.anisotropy = 4

  // 前後の面。持ち手の穴が開く
  const side = new THREE.MeshStandardMaterial({
    color: SIDE_COLOR,
    map: photo,
    // 穴は塗らずに抜く。transparent ではなく alphaTest を使う —
    // 半透明にすると描画順の問題が出るし、穴は開いているか閉じているかしかない
    alphaMap: createHandleAlpha(),
    alphaTest: 0.5,
    ...INTERIOR,
    roughness: 0.95,
    metalness: 0,
  })
  // 左右の面
  const flank = new THREE.MeshStandardMaterial({
    color: SIDE_COLOR,
    map: photo,
    ...INTERIOR,
    roughness: 0.95,
    metalness: 0,
  })
  const top = new THREE.MeshStandardMaterial({
    color: TOP_COLOR,
    map: photo,
    ...INTERIOR,
    roughness: 0.95,
    metalness: 0,
  })
  const bottom = new THREE.MeshStandardMaterial({
    color: BOTTOM_COLOR,
    map: photo,
    ...INTERIOR,
    roughness: 1,
    metalness: 0,
  })

  // BoxGeometry のマテリアル順は +X, -X, +Y, -Y, +Z, -Z。
  //
  // **同じ実体を 2 面で使わない。** 見た目が同じでも複製して渡す。
  // three の WebGPU は (オブジェクト, マテリアル, ジオメトリ) の組で描画物を
  // 索引しているので、同じ組み合わせが 2 つあると互いを追い出し合い、
  // 毎フレーム作り直しになる。
  shared = {
    geometry,
    materials: [flank, flank.clone(), top, bottom, side, side.clone()],
  }
  return shared
}

/**
 * 箱を 1 つ作る。足元 (y=0) に置く前提で、原点が底面に来るようずらしてある。
 *
 * マテリアルは面ごとに分ける。単色の立方体は陰影が付かず、
 * 平行光の向きによっては輪郭が消えて板に見える。
 */
export function createCardboardBox(): THREE.Mesh {
  const { geometry, materials } = sharedParts()
  const box = new THREE.Mesh(geometry, materials)
  box.castShadow = true
  box.receiveShadow = true
  box.visible = false
  return box
}

/**
 * 不透明度を反映する。
 *
 * transparent の切り替えはシェーダーの再構築を伴うので、値が変わったときだけ触る。
 * 毎フレーム立て直すと、箱を出している間ずっとコンパイルが走る。
 */
function applyOpacity(box: THREE.Mesh): void {
  const materials = Array.isArray(box.material) ? box.material : [box.material]
  for (const material of new Set(materials)) {
    if (material.opacity === tuning.opacity) continue
    material.opacity = tuning.opacity
    const transparent = tuning.opacity < 1
    if (material.transparent !== transparent) {
      material.transparent = transparent
      material.needsUpdate = true
    }
  }
}

/**
 * 箱を捨てる。
 *
 * 見た目は全員で共有しているので、ここでは何も捨てない。捨てると、
 * まだ箱を被っている他の人の描画が壊れる。
 */
export function disposeBox(box: THREE.Mesh): void {
  box.removeFromParent()
}
