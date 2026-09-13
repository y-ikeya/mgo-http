"""
型の中で銃が置かれている場所へ、ゲームの銃を合わせる数値を出す。

    $BLENDER -b --factory-startup --python tools/fit_gun_to_clip.py -- \
        <型.fbx> <銃のメッシュ名> <骨の名前> <ゲームの銃.glb>

--- なぜ要るか ---
動きを作る側は、銃を骨に付けて**目で合わせて**いる。そこがいちばん正しい。
ところがゲームの銃は別のファイルで、**銃口を決まった座標へ揃えて**ある
(convert_gltf_gun.py)。原点が違うので、型の中の位置をそのまま写せない。

同じ銃なら形は同じなので、**頂点の散らばり方から向きと位置を突き合わせる**。

--- どう突き合わせるか ---
どちらの銃も、頂点の重心と、散らばりの主軸 (共分散の固有ベクトル) を持つ。
同じ形なら主軸も同じなので、その 3 本を揃えれば重なる。

主軸は**向きが決まらない** (180° 反転しても同じ軸)。銃は前後にも上下にも
非対称なので、**軸に沿った歪み (3 次モーメント) の符号**で揃える。銃口側が
細く床尾側が太い、という偏りがそのまま符号になる。
"""

import bpy, sys, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
CLIP, MESH_NAME, BONE_NAME, GUN = argv[0], argv[1], argv[2], argv[3]


def cloud(points):
    """重心・主軸・大きさ。**向きは 3 次モーメントで揃える**"""
    n = len(points)
    centre = sum(points, mathutils.Vector()) / n
    rel = [p - centre for p in points]
    # 共分散
    cov = mathutils.Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for v in rel:
        for i in range(3):
            for j in range(3):
                cov[i][j] += v[i] * v[j]
    for i in range(3):
        for j in range(3):
            cov[i][j] /= n

    # 固有ベクトル。対称行列なのでヤコビ法で回す
    axes = mathutils.Matrix.Identity(3)
    a = cov.copy()
    for _ in range(64):
        # 一番大きい非対角を消す
        p, q, big = 0, 1, 0.0
        for i in range(3):
            for j in range(i + 1, 3):
                if abs(a[i][j]) > big:
                    p, q, big = i, j, abs(a[i][j])
        if big < 1e-16:
            break
        theta = 0.5 * math.atan2(2 * a[p][q], a[p][p] - a[q][q])
        rot = mathutils.Matrix.Identity(3)
        rot[p][p] = rot[q][q] = math.cos(theta)
        rot[p][q] = -math.sin(theta)
        rot[q][p] = math.sin(theta)
        a = rot.transposed() @ a @ rot
        axes = axes @ rot

    order = sorted(range(3), key=lambda i: -a[i][i])
    basis = [mathutils.Vector((axes[0][i], axes[1][i], axes[2][i])).normalized() for i in order]
    spread = [math.sqrt(max(0.0, a[i][i])) for i in order]

    # **向きを揃える。** 軸に沿った歪みが正になる側を前とする
    for k in range(3):
        skew = sum((v.dot(basis[k])) ** 3 for v in rel)
        if skew < 0:
            basis[k] = -basis[k]
    # 右手系に直す
    if basis[0].cross(basis[1]).dot(basis[2]) < 0:
        basis[2] = -basis[2]
    return centre, basis, spread


bpy.ops.wm.read_factory_settings(use_empty=True)

# --- 型の中の銃 (骨から見た位置) ---
bpy.ops.import_scene.fbx(filepath=CLIP)
gun_in_clip = bpy.data.objects[MESH_NAME]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bone = arm.pose.bones[BONE_NAME]
# 骨の空間へ引き戻す
to_bone = (arm.matrix_world @ bone.matrix).inverted()
clip_points = [to_bone @ (gun_in_clip.matrix_world @ v.co) for v in gun_in_clip.data.vertices]
print(f'  型の中の銃 {len(clip_points)} 頂点 ({MESH_NAME} / {BONE_NAME})')

# --- ゲームの銃 (自分の空間) ---
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=GUN)
game = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
game_points = []
root = None
for o in game:
    # 読み込んだ物の根。ここが weapon.object に当たる
    top = o
    while top.parent and top.parent in [x for x in bpy.data.objects if x not in before]:
        top = top.parent
    root = root or top
for o in game:
    for v in o.data.vertices:
        game_points.append(o.matrix_world @ v.co)
print(f'  ゲームの銃 {len(game_points)} 頂点')

c1, b1, s1 = cloud(clip_points)
c2, b2, s2 = cloud(game_points)
scale = (s1[0] / s2[0]) if s2[0] > 1e-9 else 1.0
print(f'  散らばり  型 {[round(v, 4) for v in s1]} / ゲーム {[round(v, 4) for v in s2]}  倍率 {scale:.4f}')

# ゲームの軸を型の軸へ回す
m1 = mathutils.Matrix((b1[0], b1[1], b1[2])).transposed()
m2 = mathutils.Matrix((b2[0], b2[1], b2[2])).transposed()
rot = (m1 @ m2.inverted()).to_3x3()
quat = rot.to_quaternion()
pos = c1 - (rot @ c2) * scale

print()
print('  --- weapon.ts へ写す値 (骨の空間) ---')
print(f'  position ({pos.x:.4f}, {pos.y:.4f}, {pos.z:.4f})')
e = quat.to_euler('XYZ')
print(f'  rotation ({math.degrees(e.x):.1f}, {math.degrees(e.y):.1f}, {math.degrees(e.z):.1f}) 度')
print(f'  quaternion ({quat.x:.5f}, {quat.y:.5f}, {quat.z:.5f}, {quat.w:.5f})')
print(f'  scale {scale:.4f}')
