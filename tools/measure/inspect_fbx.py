"""Mixamo の FBX を読んで、尺・ルートモーション・骨格を計測する。

Blender の座標系は Z-up。Mixamo (Y-up) はインポート時に変換されるので、
水平移動は X (右) / Y (前後)、高さは Z で読む。
"""
import bpy
import sys
import os
import json

paths = sys.argv[sys.argv.index('--') + 1:]
results = []

for path in paths:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.fbx(filepath=path)
    except Exception as e:
        results.append({'file': os.path.basename(path), 'error': str(e)})
        continue

    scene = bpy.context.scene
    fps = scene.render.fps
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']

    entry = {
        'file': os.path.basename(path),
        'fps': fps,
        'bones': len(arm.data.bones) if arm else 0,
        'meshes': len(meshes),
        'verts': sum(len(m.data.vertices) for m in meshes),
    }

    if arm and arm.animation_data and arm.animation_data.action:
        action = arm.animation_data.action
        start, end = (int(round(v)) for v in action.frame_range)
        duration = (end - start) / fps if fps else 0
        entry['frames'] = [start, end]
        entry['duration'] = round(duration, 3)

        hips = arm.pose.bones.get('mixamorig:Hips')
        if hips and duration > 0:
            scene.frame_set(start)
            p0 = (arm.matrix_world @ hips.matrix).to_translation().copy()
            scene.frame_set(end)
            p1 = (arm.matrix_world @ hips.matrix).to_translation().copy()
            delta = p1 - p0
            entry['rest_hip_height'] = round((arm.matrix_world @ hips.bone.head_local).z, 3)
            # 移動量。X が右、Y が前 (Mixamo は -Y 方向へ歩くことが多い)
            entry['delta'] = [round(delta.x, 3), round(delta.y, 3), round(delta.z, 3)]
            entry['speed'] = round((delta.x ** 2 + delta.y ** 2) ** 0.5 / duration, 3)

    results.append(entry)

print('===JSON===')
print(json.dumps(results, indent=1))
