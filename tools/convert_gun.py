"""武器 FBX を実寸・規定の向きに正規化して .glb へ出す。

元データは銃身が Blender +X、長さ 3.1 単位。これを
  - 銃身が glTF の -Z (Player の「前方」と同じ向き)
  - 上が glTF の +Y
  - 全長 TARGET_LENGTH メートル
に揃える。ここで正規化しておくと、手ボーンへの取り付け調整が
「どの軸がどっちか」ではなく純粋な位置合わせだけになる。

Blender -> glTF の軸対応は (X, Y, Z) -> (X, Z, -Y)。
つまり glTF -Z が欲しければ Blender +Y に、glTF +Y が欲しければ Blender +Z に向ける。
元は銃身 +X / 上 +Z なので、Z 軸回りに +90° 回せば銃身が +Y になり上はそのまま。
"""
import bpy
import sys
import os
import math
import mathutils

args = sys.argv[sys.argv.index('--') + 1:]
src, out_path, target_length = args[0], args[1], float(args[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('メッシュが無い')

# 複数パーツなら 1 つにまとめる (取り付け対象を 1 オブジェクトに保つ)
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
gun = bpy.context.view_layer.objects.active

# インポート時のトランスフォームを焼き込んで、オブジェクト空間 = ワールド空間にする
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def world_bounds(obj):
    lo = [float('inf')] * 3
    hi = [float('-inf')] * 3
    for corner in obj.bound_box:
        p = obj.matrix_world @ mathutils.Vector(corner)
        for i in range(3):
            lo[i] = min(lo[i], p[i])
            hi[i] = max(hi[i], p[i])
    return lo, hi

lo, hi = world_bounds(gun)
length = hi[0] - lo[0]
scale = target_length / length
print(f'[gun] 元の全長 {length:.3f} 単位 -> {target_length} m (scale {scale:.4f})')

# 銃身 +X を +Y へ (Z 軸回りに +90°)
gun.rotation_euler = (0, 0, math.radians(90))
gun.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

lo, hi = world_bounds(gun)
print(f'[gun] 正規化後 (Blender) X:{hi[0]-lo[0]:.3f} Y:{hi[1]-lo[1]:.3f} Z:{hi[2]-lo[2]:.3f}')
print(f'[gun] 原点からの銃口側 (Blender +Y): {hi[1]:.3f} m / 反対側: {lo[1]:.3f} m')
print(f'[gun] 上下 (Blender Z): {lo[2]:.3f} .. {hi[2]:.3f} m')

# FBX の透明度がそのまま拾われてアルファ 0 になることがある。
# その状態で glTF に出ると alphaMode=MASK + alpha 0 = 完全に透明で描画されない。
for slot in gun.material_slots:
    mat = slot.material
    if not mat:
        continue
    # EEVEE Next (Blender 4.2+) で blend_method が無くなっているため存在確認する
    if hasattr(mat, 'blend_method'):
        mat.blend_method = 'OPAQUE'
    for node in (mat.node_tree.nodes if mat.use_nodes and mat.node_tree else []):
        alpha = node.inputs.get('Alpha') if node.type == 'BSDF_PRINCIPLED' else None
        if alpha is not None and not alpha.is_linked and alpha.default_value < 1.0:
            print(f'[material] {mat.name}: alpha {alpha.default_value:.3f} -> 1.0')
            alpha.default_value = 1.0

options = {
    'filepath': out_path,
    'export_format': 'GLB',
    'use_selection': True,
    'export_animations': False,
    'export_yup': True,
}
valid = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k: v for k, v in options.items() if k in valid})

print(f'[done] {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)')
