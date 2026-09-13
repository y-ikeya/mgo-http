"""
型に焼かれている銃の**形だけ**を書き出す。場所は書き出さない。

    $BLENDER -b --factory-startup --python tools/dump_clip_gun.py -- \
        <型.fbx> <銃のメッシュ名> <出力.json>

出すのは頂点の生の座標 (mesh.vertices[].co) だけ。行列を一切通さないので、
Blender の軸の直し (Y 上 -> Z 上) も骨の向きの流儀も**混ざりようがない**。

置き場所 (どの骨から見てどこにあるか) は tools/fit_gun_to_clip.js が
three で読む。ゲームと同じ読み方でないと合わない — Blender は FBX も glTF も
**自分の流儀に直して**取り込むので、骨の座標系がゲームのそれとは別物になる。
ここで出した形は、同じ銃どうしを重ねて「ゲームの銃 -> 型の銃」の変換を
求めるために使う。
"""

import bpy, sys, json

argv = sys.argv[sys.argv.index('--') + 1:]
CLIP, MESH_NAME, OUT = argv[0], argv[1], argv[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=CLIP)
gun = bpy.data.objects[MESH_NAME]

points = []
for v in gun.data.vertices:
    points.extend([v.co.x, v.co.y, v.co.z])

json.dump(points, open(OUT, 'w'))
print(f'  書き出した {len(points) // 3} 頂点 ({MESH_NAME}) -> {OUT}')
