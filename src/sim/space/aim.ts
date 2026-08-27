/**
 * 照準の向きを散布界の中へずらす。**幾何だけ。**
 *
 * --- 何を持たないか ---
 * どれだけ散るか (度) も、どこへ散るか (2 つの乱数) も**受け取る**。武器ごとの
 * 散布値も反動のパターンも規則なので domain (item/spread.ts) が持っていて、
 * ここに在るのは「円錐の中の 1 点へ向きを傾ける」という手続きだけ。
 *
 * 分けてあるおかげで、この試験は本物の武器の数字を持ち出さずに書ける — 円錐の
 * 半角を 10 度と決めて、傾いた角度がそれ以内か、分布が中心に偏っていないかを
 * 見ればよい。散布のバランスを変えても幾何の試験は動かない。
 */

/** 3 次元の点。sim の中で使い回す最小の形 */
export interface Aim {
  x: number
  y: number
  z: number
}

const DEG_TO_RAD = Math.PI / 180

/**
 * 円錐の中へ向きをずらす。**dir を破壊的に書き換える。**
 *
 * @param dir     正規化済みの向き
 * @param degrees 散布界の半角 (度)。0 以下なら何もしない
 * @param angle01 円周のどこか (0..1)
 * @param radius01 中心からの遠さ (0..1)
 *
 * `radius01` に平方根を掛けるのは、**円の中で一様にするため**。そのまま半径に
 * 使うと中心へ偏り、散布界の縁がほとんど当たらなくなる (面積は半径の 2 乗で
 * 増えるので、半径を一様に引くと外周が薄くなる)。
 */
export function offsetInCone(dir: Aim, degrees: number, angle01: number, radius01: number): void {
  if (degrees <= 0) return

  const angle = angle01 * Math.PI * 2
  const radius = Math.sqrt(radius01) * Math.tan(degrees * DEG_TO_RAD)

  // 向きに直交する 2 軸を作る。
  //
  // **真上 (真下) を向いているときだけ基準を変える。** 上を基準にすると外積が
  // 0 に潰れて軸が作れず、その姿勢でだけ散布が消える。真上に撃つ場面は稀だが、
  // 「稀にだけ当たり方が変わる」は原因を探すのが一番面倒な種類になる。
  const steep = Math.abs(dir.y) > 0.99
  const upX = 0
  const upY = steep ? 0 : 1
  const upZ = steep ? -1 : 0

  // right = dir × up
  let rx = dir.y * upZ - dir.z * upY
  let ry = dir.z * upX - dir.x * upZ
  let rz = dir.x * upY - dir.y * upX
  const rLen = Math.hypot(rx, ry, rz) || 1
  rx /= rLen
  ry /= rLen
  rz /= rLen

  // up' = right × dir
  const ux = ry * dir.z - rz * dir.y
  const uy = rz * dir.x - rx * dir.z
  const uz = rx * dir.y - ry * dir.x

  const cos = Math.cos(angle) * radius
  const sin = Math.sin(angle) * radius

  const x = dir.x + rx * cos + ux * sin
  const y = dir.y + ry * cos + uy * sin
  const z = dir.z + rz * cos + uz * sin

  const length = Math.hypot(x, y, z) || 1
  dir.x = x / length
  dir.y = y / length
  dir.z = z / length
}

/**
 * 向きを右へ / 上へ、そのまま傾ける。**dir を破壊的に書き換える。**
 *
 * @param dir      正規化済みの向き
 * @param rightDeg 右へ何度 (負なら左)
 * @param upDeg    上へ何度 (負なら下)
 *
 * 円錐 (offsetInCone) との違いは**どこへ向けるかを呼ぶ側が決めている**こと。
 * あちらは「円の中のどこか」で、乱数を 2 つ受け取る。こちらは行き先が
 * 分かっている — 手ブレのように、時間から滑らかに決まる向きに使う。
 *
 * 小角なので接平面の上で足して正規化する。0.2 度なら誤差は 10^-6 度未満で、
 * 三角関数を 2 回回す形と結果が変わらない。
 */
export function offsetBy(dir: Aim, rightDeg: number, upDeg: number): void {
  if (rightDeg === 0 && upDeg === 0) return

  // 円錐と同じ理由で、真上を向いているときだけ基準を変える
  const steep = Math.abs(dir.y) > 0.99
  const upX = 0
  const upY = steep ? 0 : 1
  const upZ = steep ? -1 : 0

  let rx = dir.y * upZ - dir.z * upY
  let ry = dir.z * upX - dir.x * upZ
  let rz = dir.x * upY - dir.y * upX
  const rLen = Math.hypot(rx, ry, rz) || 1
  rx /= rLen
  ry /= rLen
  rz /= rLen

  const ux = ry * dir.z - rz * dir.y
  const uy = rz * dir.x - rx * dir.z
  const uz = rx * dir.y - ry * dir.x

  const right = Math.tan(rightDeg * DEG_TO_RAD)
  const up = Math.tan(upDeg * DEG_TO_RAD)

  const x = dir.x + rx * right + ux * up
  const y = dir.y + ry * right + uy * up
  const z = dir.z + rz * right + uz * up

  const length = Math.hypot(x, y, z) || 1
  dir.x = x / length
  dir.y = y / length
  dir.z = z / length
}
