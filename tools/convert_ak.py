# AK-47 の OBJ を、今の rifle.glb と同じ規約の glb に変換する。
#
# 規約: 銃口が -Z、上が +Y。銃口の位置を既存モデルと揃えるので、
# weapon.ts の握り位置と角度の調整値がそのまま使える。
import bpy, os, sys, math, mathutils

SRC = sys.argv[sys.argv.index('--') + 1]
TEX = sys.argv[sys.argv.index('--') + 2]
OUT = sys.argv[sys.argv.index('--') + 3]

# 実銃の全長 (m)。AK-47 は 870mm
LENGTH = 0.87
# 既存の rifle.glb の銃口位置 (weapon.ts の RIFLE.tip)
TIP = mathutils.Vector((0.0, 0.165, -0.845))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
gun = bpy.context.active_object

# OBJ は Y 上・銃身 -X。Blender へ入る時点で Y 上 → Z 上に変換されているので、
# 銃身は Blender の -X。glTF は Blender +Y を -Z に写すため、銃口を +Y へ向ける。
gun.rotation_euler = (0, 0, math.radians(-90))
bpy.ops.object.transform_apply(rotation=True)

# 全長を実寸に合わせる
size = gun.dimensions
scale = LENGTH / max(size)
gun.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(scale=True)

# 原点を動かさず、メッシュ側をずらして銃口を狙いの位置へ持ってくる。
# 銃口 = Blender +Y の端。glTF では -Z になる。
verts = [gun.matrix_world @ v.co for v in gun.data.vertices]
muzzle_y = max(v.y for v in verts)
tip_verts = [v for v in verts if v.y >= muzzle_y - 0.02]
muzzle = mathutils.Vector((
    sum(v.x for v in tip_verts) / len(tip_verts),
    muzzle_y,
    sum(v.z for v in tip_verts) / len(tip_verts),
))
# glTF の (x, y, z) は Blender の (x, z, -y)
target = mathutils.Vector((TIP.x, -TIP.z, TIP.y))
gun.location = target - muzzle
bpy.ops.object.transform_apply(location=True)

# --- マテリアル ---
mat = bpy.data.materials.new('ak47')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
img = mat.node_tree.nodes.new('ShaderNodeTexImage')
img.image = bpy.data.images.load(TEX)
mat.node_tree.links.new(bsdf.inputs['Base Color'], img.outputs['Color'])
bsdf.inputs['Roughness'].default_value = 0.55
bsdf.inputs['Metallic'].default_value = 0.25
# FBX 由来の透明扱いで消えた前例があるので、不透明を明示する
bsdf.inputs['Alpha'].default_value = 1.0
mat.blend_method = 'OPAQUE'
gun.data.materials.clear()
gun.data.materials.append(mat)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)

# --- 変換後の寸法を測る。weapon.ts へ焼く値を出すため ---
verts = [gun.matrix_world @ v.co for v in gun.data.vertices]
def g(v):  # Blender → glTF
    return (v.x, v.z, -v.y)
pts = [g(v) for v in verts]
zs = [p[2] for p in pts]
print(f'\n[ak] 頂点 {len(pts)} / 全長 {max(zs) - min(zs):.3f}m')
print(f'[ak] Z 範囲 {min(zs):.3f} .. {max(zs):.3f}   (銃口が最小側)')
tip = min(pts, key=lambda p: p[2])
print(f'[ak] 銃口: ({tip[0]:.3f}, {tip[1]:.3f}, {tip[2]:.3f})')
# ハンドガード = 銃口から 18〜34cm 後ろの、最も下の点。左手が下から掴む位置
band = [p for p in pts if tip[2] + 0.18 <= p[2] <= tip[2] + 0.34]
if band:
    low = min(p[1] for p in band)
    near = [p for p in band if p[1] <= low + 0.01]
    fx = sum(p[0] for p in near) / len(near)
    fz = sum(p[2] for p in near) / len(near)
    print(f'[ak] ハンドガード下面: ({fx:.3f}, {low:.3f}, {fz:.3f})')
