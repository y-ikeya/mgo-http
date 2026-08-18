"""
配布されている静物 (クレイモア・検知器など) を、この game の規約へ直す。

    $BLENDER -b --factory-startup --python tools/convert_prop.py -- \
        <入力.glb> <出力.glb> <実寸の幅 m> [向きの回転 (度, Z軸)]

--- 規約 ---
既存の小道具は**実寸**で入っている (手榴弾 7×10×6.5cm、ナイフ 30cm)。
配布モデルは 2 単位くらいに正規化されていることが多いので、**幅を実寸に合わせて**
全体を縮める。幅で合わせるのは、横幅がいちばん資料に載っている寸法だから。

正面は **-Z**。銃口の規約 (convert_gltf_gun.py) と揃える。クレイモアのように
「どちらを向けて置くか」が意味を持つ物は、これが爆風の向きになる。

テクスチャは 1024 に落とす。小道具に 4K は要らない (元は 8.35MB あった)。
"""

import bpy, sys, math

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
WIDTH = float(argv[2])
SPIN = math.radians(float(argv[3])) if len(argv) > 3 else 0.0
SIDE = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('メッシュが無い')

# 1 つにまとめる。部位ごとに動かす物ではないので、描画も 1 回で済ませる
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
prop = bpy.context.view_layer.objects.active
prop.name = 'prop'

# **頂点を直に動かす。** object の回転を transform_apply で焼く形にしていたら、
# glTF の読み込みが作る親の下に居るせいか効かなかった (絵が 1 ミリも変わらなかった)。
# メッシュそのものを変換すれば親も選択状態も関係ない。
import mathutils

size = prop.dimensions.copy()
scale = WIDTH / size.x
prop.data.transform(mathutils.Matrix.Rotation(SPIN, 4, 'Z') @ mathutils.Matrix.Scale(scale, 4))

# 足元を原点に置く。地面へ置く物なので、Z=0 が接地面でないと沈む
lowest = min(v.co.z for v in prop.data.vertices)
prop.data.transform(mathutils.Matrix.Translation((0, 0, -lowest)))
prop.location = (0, 0, 0)
prop.rotation_euler = (0, 0, 0)
prop.scale = (1, 1, 1)

for im in bpy.data.images:
    if max(im.size) > SIDE:
        before = tuple(im.size)
        im.scale(SIDE, SIDE)
        print(f'  テクスチャ {im.name} {before[0]}x{before[1]} -> {SIDE}x{SIDE}')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
                          export_image_format='AUTO', export_jpeg_quality=85)
print(f'  {size.x:.3f} x {size.y:.3f} x {size.z:.3f} -> '
      f'{prop.dimensions.x:.3f} x {prop.dimensions.y:.3f} x {prop.dimensions.z:.3f} m')
print('  書き出した', OUT)
