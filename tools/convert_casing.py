# 弾のモデルから弾頭を落として、排出される薬莢にする。
#
#   $BLENDER -b --factory-startup --python tools/convert_casing.py -- \
#       <scene.gltf> <出力.glb> <薬莢の長さ mm> [落とすメッシュ名の一部]
#
# 配布されている「弾」は弾頭が刺さったままの状態 (未発射の一発) なので、
# そのまま転がすと撃つ前の弾が排出されていることになる。
# 弾頭のメッシュを落として空き殻にする。
#
# 規約: 長い軸を +Y (上) に立てて、原点を薬莢の底に置く。
# 転がる物なので、原点が端にあると回転が不自然になる — 重心の高さに合わせる。

import bpy
import sys
import math
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
LENGTH_MM = float(argv[2])
# 弾頭とみなす名前。指定が無ければ「一番上にある塊」を落とす
DROP = argv[3].lower() if len(argv) > 3 else ''

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('メッシュが無い')

# 親を切ってから確定させる。
# glTF の読み込みは Y 上 → Z 上の回転を親の空オブジェクトに持たせるので、
# 子だけ確定させても向きが揃わない (2 つのモデルで軸がばらついた)。
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.select_all(action='DESELECT')


def top_of(obj):
    return max((obj.matrix_world @ v.co).z for v in obj.data.vertices)


def name_of(obj):
    material = obj.data.materials[0].name if obj.data.materials else ''
    return f'{obj.name} {material}'.lower()


if DROP:
    victims = [o for o in meshes if DROP in name_of(o)]
else:
    # 名前で分からない場合。一番高い所にある塊が弾頭
    victims = [max(meshes, key=top_of)]

if not victims:
    raise SystemExit(f'落とす対象が見つからない ({DROP})')

for o in victims:
    print(f'[casing] 落とす: {o.name} ({o.data.materials[0].name if o.data.materials else "材質なし"})')
    bpy.data.objects.remove(o, do_unlink=True)

rest = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in rest:
    o.select_set(True)
bpy.context.view_layer.objects.active = rest[0]
if len(rest) > 1:
    bpy.ops.object.join()
casing = bpy.context.active_object

# --- 長い軸を glTF の +Y (Blender の +Z) に立てる ---
# rotation_euler ではなく行列で掛ける。読み込み時の回転が残っていると
# euler の指定が上書きされて、モデルごとに向きがばらつく。
verts = [casing.matrix_world @ v.co for v in casing.data.vertices]
size = [max(v[i] for v in verts) - min(v[i] for v in verts) for i in range(3)]
axis = size.index(max(size))
print(f'[casing] 長い軸 {"XYZ"[axis]} ({size[axis] * 1000:.1f}mm) を立てる')
if axis == 0:
    rot = mathutils.Matrix.Rotation(math.radians(90), 4, 'Y')
elif axis == 1:
    rot = mathutils.Matrix.Rotation(math.radians(-90), 4, 'X')
else:
    rot = mathutils.Matrix.Identity(4)
casing.matrix_world = rot @ casing.matrix_world
bpy.ops.object.select_all(action='DESELECT')
casing.select_set(True)
bpy.context.view_layer.objects.active = casing
bpy.ops.object.transform_apply(rotation=True)

# --- 実寸へ ---
scale = (LENGTH_MM / 1000.0) / max(casing.dimensions)
casing.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(scale=True)

# --- 原点を真ん中へ ---
# 転がる物なので、端に原点があると回転が不自然になる
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
casing.location = (0, 0, 0)
bpy.ops.object.transform_apply(location=True)

bpy.ops.object.select_all(action='DESELECT')
casing.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)

d = casing.dimensions
print(f'[casing] 書き出し: {OUT}')
print(f'[casing] 頂点 {len(casing.data.vertices)} / 材質 {len(casing.data.materials)}')
print(f'[casing] 寸法 {d.x * 1000:.1f} x {d.z * 1000:.1f} x {d.y * 1000:.1f} mm  (glTF の x, y, z)')
