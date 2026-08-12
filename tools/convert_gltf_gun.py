# glTF で配られている銃を、今の rifle.glb と同じ規約の glb に変換する。
#
#   $BLENDER -b --factory-startup --python tools/convert_gltf_gun.py -- \
#       <scene.gltf> <出力.glb> <実銃の全長 m>
#
# 規約: 銃口が -Z、上が +Y。銃口の位置を既存モデルと揃えるので、
# weapon.ts の握り位置と角度の調整値がそのまま流用できる。
#
# convert_ak.py (OBJ 用) との違いは 3 つ:
#   - glTF を読む
#   - **ボーンを剥がす**。配布モデルは装填や引き金が動くよう仕込まれていることが
#     多いが、手に持たせるだけなら要らない。スキニングの費用も掛からなくなる
#   - **銃身の軸を頂点から自動で判定する**。配布元ごとに向きがばらばらなので、
#     決め打ちすると毎回ここを直すことになる
#
# 材質は元のものをそのまま使う。テクスチャが重ければ shrink_glb.js で後から縮める。

import bpy
import sys
import math
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
LENGTH = float(argv[2]) if len(argv) > 2 else 0.0
# 銃口がどちら側かを明示する ('min' / 'max')。省略すると形から判定する
FORCE = argv[3].lower() if len(argv) > 3 else ''

# 既存の rifle.glb の銃口位置 (weapon.ts の RIFLE.tip)
TIP = mathutils.Vector((0.0, 0.171, -0.845))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# --- ボーンを剥がす ---
# 変形を確定させてから外す。外してから確定させると、素の姿勢に戻ってしまう。
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError:
            obj.modifiers.remove(mod)
    obj.vertex_groups.clear()

for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('メッシュが無い')

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
gun = bpy.context.active_object

# 親の変換を確定させてから測る
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- 銃身の軸を判定する ---
# 一番長い軸が銃身。どちら側が銃口かは「断面が細いほう」で決める
# (銃口側は先細り、床尾側は台尻で太い)。
verts = [v.co.copy() for v in gun.data.vertices]
lo = mathutils.Vector((min(v[i] for v in verts) for i in range(3)))
hi = mathutils.Vector((max(v[i] for v in verts) for i in range(3)))
size = hi - lo
axis = max(range(3), key=lambda i: size[i])


def girth(at_min):
    """
    端から 30% を 6 つに切って、それぞれの太さを平均する。

    端の一点だけを見ると外れる。制退器が細く見えない銃や、銃床を切り詰めた銃で
    逆に判定した (XM2010 がそうだった)。銃身側は**細いまま長く続く**のが特徴なので、
    区間の平均で見る。
    """
    span = size[axis] * 0.30
    lo_edge = lo[axis] if at_min else hi[axis] - span
    others = [i for i in range(3) if i != axis]
    widths = []
    for k in range(6):
        a = lo_edge + span * k / 6
        b = lo_edge + span * (k + 1) / 6
        sel = [v for v in verts if a <= v[axis] < b]
        if not sel:
            continue
        widths.append(sum(max(v[i] for v in sel) - min(v[i] for v in sel) for i in others))
    return sum(widths) / len(widths) if widths else 0.0


thin_at_min, thin_at_max = girth(True), girth(False)
if FORCE in ('min', 'max'):
    muzzle_at_min = FORCE == 'min'
else:
    muzzle_at_min = thin_at_min < thin_at_max
print(f'[gun] 端の太さ  - 側 {thin_at_min * 100:.1f}cm / + 側 {thin_at_max * 100:.1f}cm'
      + (f'  (指定で {FORCE} を銃口とした)' if FORCE else ''))
print(f'[gun] 銃身の軸 {"XYZ"[axis]} / 全長 {size[axis]:.3f}m / '
      f'銃口は {"-" if muzzle_at_min else "+"} 側')

# 銃口を Blender の +Y へ向ける。
#
# glTF の書き出しは Blender の +Y を -Z に写す (= 画面の奥) ので、
# +Y に向けておけば規約どおり「銃口が -Z」になる。
#
# 符号を間違えると銃を後ろ前に持つ。検算:
#   軸 Z・銃口が -Z 側 … 点 (0,0,-1) を Rx(+90) で回すと (0,+1,0)
#   軸 X・銃口が -X 側 … 点 (-1,0,0) を Rz(-90) で回すと (0,+1,0)
rot = mathutils.Matrix.Identity(4)
if axis == 0:
    rot = mathutils.Matrix.Rotation(math.radians(-90 if muzzle_at_min else 90), 4, 'Z')
elif axis == 1:
    rot = mathutils.Matrix.Rotation(math.radians(180 if muzzle_at_min else 0), 4, 'Z')
else:
    rot = mathutils.Matrix.Rotation(math.radians(90 if muzzle_at_min else -90), 4, 'X')
gun.matrix_world = rot @ gun.matrix_world
bpy.ops.object.transform_apply(rotation=True)

# --- 全長を実寸へ ---
if LENGTH > 0:
    scale = LENGTH / max(gun.dimensions)
    gun.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(scale=True)

# --- 銃口を既存モデルと同じ位置へ ---
# 原点は動かさず、メッシュ側をずらす。握りの調整値がそのまま使えるようにするため。
verts = [gun.matrix_world @ v.co for v in gun.data.vertices]
muzzle_y = max(v.y for v in verts)
tip_verts = [v for v in verts if v.y >= muzzle_y - 0.02]
muzzle = mathutils.Vector((
    sum(v.x for v in tip_verts) / len(tip_verts),
    muzzle_y,
    sum(v.z for v in tip_verts) / len(tip_verts),
))
# glTF の (x, y, z) は Blender の (x, z, -y)
gun.location = mathutils.Vector((TIP.x, -TIP.z, TIP.y)) - muzzle
bpy.ops.object.transform_apply(location=True)

bpy.ops.object.select_all(action='DESELECT')
gun.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)

# --- 変換後の寸法。weapon.ts へ焼く値を出すため ---
verts = [gun.matrix_world @ v.co for v in gun.data.vertices]
pts = [(v.x, v.z, -v.y) for v in verts]   # Blender → glTF
zs = [p[2] for p in pts]
tip = min(pts, key=lambda p: p[2])
print(f'[gun] 書き出し: {OUT}')
print(f'[gun] 頂点 {len(pts)} / 材質 {len(gun.data.materials)} / 全長 {max(zs) - min(zs):.3f}m')
print(f'[gun] 銃口 ({tip[0]:.3f}, {tip[1]:.3f}, {tip[2]:.3f})  ← weapon.ts の tip')
