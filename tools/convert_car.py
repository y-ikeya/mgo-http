"""
配布されている車のモデルを、ステージに置ける形へ直す。

    $BLENDER -b --factory-startup --python tools/convert_car.py -- \
        <入力.gltf|glb> <出力.glb> <全長 m>

--- 小道具 (convert_prop.py) と何が違うか ---

**地面の板を捨てる。** 配布されている車には、影を落とすための平らな板が
一緒に入っていることが多い (old_rusty_car がそう: 4 頂点で 1056 x 1327)。
これを混ぜたまま大きさを合わせると、板の大きさで縮尺が決まって車が豆粒になる。
厚みの無いメッシュを落とす。

**幅ではなく全長で合わせる。** 車の寸法として世に出ているのは全長。幅は
ミラーを含むかどうかで変わるので、基準にすると車種ごとにばらつく。

**前後を Y 軸に揃える。** ステージは軸に沿った箱でしか当たりを持てないので、
斜めに置けない。長いほうを Y に向けておけば、駐車の向きは 90 度単位で選べる。
"""

import bpy, sys, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
LENGTH = float(argv[2])
# テクスチャの 1 辺。
#
# **小道具より小さくてよい。** 置いてある車は近寄って眺める物ではなく、
# 遮蔽として見る物。1024 のままだと 1 台 13MB になって、ステージ全体より重くなる。
SIDE = 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('メッシュが無い')


def extent(obj):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for corner in obj.bound_box:
        w = obj.matrix_world @ mathutils.Vector(corner)
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    return [hi[i] - lo[i] for i in range(3)]


# 厚みの無いメッシュを落とす。影用の板がこれにあたる
kept = []
for obj in meshes:
    d = extent(obj)
    if d[2] < max(d) * 0.02:
        print(f'  捨てる {obj.name} (厚み {d[2]:.3f} / 最大 {max(d):.3f}) — 影の板とみなす')
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    kept.append(obj)
if not kept:
    raise SystemExit('全部落ちた。閾値を見直すこと')

bpy.ops.object.select_all(action='DESELECT')
for obj in kept:
    obj.select_set(True)
bpy.context.view_layer.objects.active = kept[0]
if len(kept) > 1:
    bpy.ops.object.join()
car = bpy.context.view_layer.objects.active
car.name = 'car'

# **親を外して姿勢を焼く。** glTF の読み込みは -90 度 X 回転した親の下にメッシュを
# 置く。そのままだとローカルとワールドで軸が入れ替わっていて、mesh.transform で
# 「長いほうを Y へ」と回したつもりが別の軸を回すことになる (実際そうなった)。
# ここで焼いておけば、以降はローカル = ワールドとして扱える。
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

size = extent(car)
# 長いほうを Y へ。既に Y が長ければ回さない
spin = 0.0 if size[1] >= size[0] else (3.14159265 / 2)
scale = LENGTH / max(size[0], size[1])
car.data.transform(
    mathutils.Matrix.Rotation(spin, 4, 'Z') @ mathutils.Matrix.Scale(scale, 4))

# 車輪を地面に。Z=0 が接地面でないと沈むか浮く
lowest = min(v.co.z for v in car.data.vertices)
car.data.transform(mathutils.Matrix.Translation((0, 0, -lowest)))
car.location = (0, 0, 0)
car.rotation_euler = (0, 0, 0)
car.scale = (1, 1, 1)

# 基本色だけ大きく残す。
#
# **法線と粗さは半分でよい。** 見て分かるのは色で、陰影の細かさは遠目には効かない。
# small_price_car は材質 19・画像 37 枚で 6.4MB あった。全部を大きく持つと、
# 車 2 台でクライアントの読み込みがステージ本体より重くなる。
base_color = set()
for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    for node in material.node_tree.nodes:
        if node.type != 'BSDF_PRINCIPLED':
            continue
        link = node.inputs['Base Color'].links
        if link and link[0].from_node.type == 'TEX_IMAGE':
            base_color.add(link[0].from_node.image)

for im in bpy.data.images:
    side = SIDE if im in base_color else SIDE // 2
    if max(im.size) > side:
        before = tuple(im.size)
        im.scale(side, side)
        print(f'  テクスチャ {im.name} {before[0]}x{before[1]} -> {side}x{side}')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
                          export_image_format='AUTO', export_jpeg_quality=85)
d = extent(car)
print(f'  幅 {d[0]:.2f} x 全長 {d[1]:.2f} x 高さ {d[2]:.2f} m')
print('  書き出した', OUT)
