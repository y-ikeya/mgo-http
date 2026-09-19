// クリップ 1 本を**その場で回す。**
//
// 使い方: bun tools/turn_clip.js <.glb> <クリップ名> <角度>
//   例:   bun tools/turn_clip.js public/models/soldier.glb climb_top 180
//
// --- なぜ要るか ---
// 素材によって、向いている方向がまちまち。梯子を登り切る型 (ClimbingToTop) は
// 登る型 (ClimbingLadder) と逆を向いて作られていて、続けて流すと上端で
// 後ろ向きになる。
//
// **体の向きで打ち消してはいけない。** 型の切れ目で 180° 振り返る動きが出る
// (追従で回すので、回っているのが見える)。向きの食い違いは**クリップ側**で
// 直す。
//
// --- どう回すか ---
// 根元の骨 (腰) の軌道だけ回せば、その下の骨は付いてくる:
//
//   - 回転 … 世界の Y 回りの回転を**左から**掛ける
//   - 位置 … 同じ角度で x/z を回す
//
// 骨の軌道は**親 (Armature) から見た向き**で入っている。Armature 自体が
// 回っている (glTF は Y 上、Blender は Z 上なので 90° 寝ている) ので、
// 世界の Y 回りに回すには親の向きで挟む: q' = P⁻¹ · 回転 · P · q。
// 焼き直す元の FBX が要らないので、Blender を往復しなくて済む。

const [path, clipName, degText] = process.argv.slice(2)
if (!path || !clipName || !degText) {
  console.error('使い方: bun tools/turn_clip.js <.glb> <クリップ名> <角度>')
  process.exit(1)
}
const angle = (Number(degText) * Math.PI) / 180

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
const binStart = 20 + jsonLength + 8
const bin = bytes.subarray(binStart)

const anim = json.animations?.find((a) => a.name === clipName)
if (!anim) {
  console.error(`${clipName} が ${path} に無い`)
  process.exit(1)
}

// 腰 = 骨の中で親が骨でないもの
const joints = new Set(json.skins?.flatMap((s) => s.joints) ?? [])
const parentOf = new Map()
for (const [i, node] of json.nodes.entries()) {
  for (const c of node.children ?? []) parentOf.set(c, i)
}
const roots = [...joints].filter((i) => !joints.has(parentOf.get(i) ?? -1))
if (roots.length !== 1) {
  console.error(`根元の骨が ${roots.length} 本ある。回す先が決められない`)
  process.exit(1)
}
const root = roots[0]

/** 四元数の積 (a の後に b ではなく、**b を先に効かせる** a·b) */
function mul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

/** 親をたどって世界での向きを作る。行列で置かれていたら諦める */
function worldRotation(node) {
  let q = [0, 0, 0, 1]
  for (let i = parentOf.get(node); i !== undefined; i = parentOf.get(i)) {
    const n = json.nodes[i]
    if (n.matrix) {
      console.error(`${n.name} が行列で置かれている。向きが読めない`)
      process.exit(1)
    }
    q = mul(n.rotation ?? [0, 0, 0, 1], q)
  }
  return q
}

const parentWorld = worldRotation(root)
const parentInverse = [-parentWorld[0], -parentWorld[1], -parentWorld[2], parentWorld[3]]
console.info(`根元の骨: ${json.nodes[root].name} (親の向き ${parentWorld.map((v) => v.toFixed(2)).join(', ')})`)

/** 同じ accessor を他の型も使っていないか。使っていたら書き換えてはいけない */
function usedElsewhere(accessor) {
  let count = 0
  for (const a of json.animations) {
    for (const s of a.samplers) if (s.output === accessor) count++
  }
  return count > 1
}

function floats(accessor) {
  const acc = json.accessors[accessor]
  const bv = json.bufferViews[acc.bufferView]
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type]
  return new Float32Array(bin.buffer, bin.byteOffset + offset, acc.count * size)
}

const half = angle / 2
// Y 回りの回転 (x, y, z, w)
const turn = [0, Math.sin(half), 0, Math.cos(half)]
let turned = 0
for (const channel of anim.channels) {
  if (channel.target.node !== root) continue
  const path_ = channel.target.path
  if (path_ !== 'rotation' && path_ !== 'translation') continue
  const out = anim.samplers[channel.sampler].output
  if (usedElsewhere(out)) {
    console.error(`${path_} の軌道を他の型も使っている。書き換えない`)
    process.exit(1)
  }
  const v = floats(out)
  // 親の向きで挟んだ回転。これを左から掛ければ**世界の Y 回り**に回る
  const local = mul(parentInverse, mul(turn, parentWorld))
  if (path_ === 'rotation') {
    for (let i = 0; i < v.length; i += 4) {
      const q = mul(local, [v[i], v[i + 1], v[i + 2], v[i + 3]])
      v[i] = q[0]
      v[i + 1] = q[1]
      v[i + 2] = q[2]
      v[i + 3] = q[3]
    }
  } else {
    // 位置も同じ向きで回す。四元数のまま回す (v' = local · v · local⁻¹)
    const inv = [-local[0], -local[1], -local[2], local[3]]
    for (let i = 0; i < v.length; i += 3) {
      const r = mul(mul(local, [v[i], v[i + 1], v[i + 2], 0]), inv)
      v[i] = r[0]
      v[i + 1] = r[1]
      v[i + 2] = r[2]
    }
  }
  turned++
}

if (!turned) {
  console.error('回す軌道が無かった')
  process.exit(1)
}

await Bun.write(path, bytes)
console.info(`${path} の ${clipName} を ${degText}° 回した (軌道 ${turned} 本)`)
