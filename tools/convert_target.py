"""
TSNE のターゲット (人形) を、この game の規約へ直す。

    $BLENDER -b --factory-startup --python tools/convert_target.py -- <入力.fbx> public/models/target.glb
    $BLENDER -b --factory-startup --python tools/convert_target.py -- <scene.gltf> public/models/cat.glb 0.3 4000

入力は .fbx か .gltf / .glb (拡張子で読み分ける)。3 つ目は高さ (m、既定 0.5)、4 つ目は面の数 (既定 6000)。
猫の置物 (support の CAT、Sketchfab「Cat in Motion」、CREDITS.md) も同じ手順で縮めている。

元は本人が Tripo で作った人形 (~/Downloads/nezu、2026-10-19)。**200 万面・絵 2048 が 4 枚**で、
頭の上に浮かせる小道具には重すぎる。

- 面を 6,000 ほどに間引く (Decimate の collapse)
- 高さを 0.5m に縮める (元は 1m に正規化されている)。足元が原点、正面は -Z
- 絵は 512 に落とす。金属の絵は捨てる (人形は金属ではない)
"""

import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
HEIGHT = float(argv[2]) if len(argv) > 2 else 0.5
FACES = int(argv[3]) if len(argv) > 3 else 6000
SIDE = 512

bpy.ops.wm.read_factory_settings(use_empty=True)
if SRC.lower().endswith(('.gltf', '.glb')):
    bpy.ops.import_scene.gltf(filepath=SRC)
else:
    bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('メッシュが無い')
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
doll = bpy.context.view_layer.objects.active

# 間引く
mod = doll.modifiers.new('decimate', 'DECIMATE')
mod.decimate_type = 'COLLAPSE'
mod.ratio = min(1.0, FACES / max(1, len(doll.data.polygons)))
bpy.ops.object.modifier_apply(modifier=mod.name)

# 縮めて、足元を原点へ
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bb = [doll.matrix_world @ Vector(c) for c in doll.bound_box]
lo = Vector([min(v[i] for v in bb) for i in range(3)])
hi = Vector([max(v[i] for v in bb) for i in range(3)])
scale = HEIGHT / (hi.z - lo.z)
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for v in doll.data.vertices:
    v.co = (v.co - center) * scale
doll.data.update()

# 絵を縮める。金属の絵は外す
for mat in doll.data.materials:
    if not mat or not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf and bsdf.inputs['Metallic'].is_linked:
        mat.node_tree.links.remove(bsdf.inputs['Metallic'].links[0])
        bsdf.inputs['Metallic'].default_value = 0.0
for img in bpy.data.images:
    if img.size[0] > SIDE:
        img.scale(SIDE, SIDE)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_image_format='JPEG')
print('target:', len(doll.data.polygons), 'faces, height', HEIGHT)
