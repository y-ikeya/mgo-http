"""
型の中で銃が置かれている場所を、骨から見た座標で書き出す。

    $BLENDER -b --factory-startup --python tools/dump_clip_gun.py -- \
        <型.fbx> <銃のメッシュ名> <骨の名前> <出力.json>

合わせるのは tools/fit_gun_to_clip.js。**そちらは three で読む** —
ゲームとまったく同じ読み方でないと、軸の変換が混ざって銃が上を向く
(Blender は glTF を読むとき Z 上へ直すので、そこで 90° 入る)。

骨から見た座標は**変換に依らない**。骨も銃も同じだけ回るので、相対の
値は変わらない。だから型側だけ Blender で出してよい。
"""

import bpy, sys, json

argv = sys.argv[sys.argv.index('--') + 1:]
CLIP, MESH_NAME, BONE_NAME, OUT = argv[0], argv[1], argv[2], argv[3]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=CLIP)
gun = bpy.data.objects[MESH_NAME]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bone = arm.pose.bones[BONE_NAME]

to_bone = (arm.matrix_world @ bone.matrix).inverted()
points = []
for v in gun.data.vertices:
    p = to_bone @ (gun.matrix_world @ v.co)
    points.extend([p.x, p.y, p.z])

json.dump(points, open(OUT, 'w'))
print(f'  書き出した {len(points) // 3} 頂点 ({MESH_NAME} / {BONE_NAME}) -> {OUT}')
