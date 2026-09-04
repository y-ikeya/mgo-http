"""FBX のクリップの上半身の前後傾きを測る。glb 側の tilt.ts と同じ定義。

腰→首 / 腰→頭 のベクトルを矢状面で見た角度。正 = 前傾、負 = のけぞり。
前方は「左脚→右脚を右とした法線」で決めるので、素材の向きに依存しない。
"""
import bpy
import sys
import math
from mathutils import Vector

paths = sys.argv[sys.argv.index('--') + 1:]

for path in paths:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not arm:
        print(f'{path}: armature なし')
        continue

    def bone(name):
        for b in arm.pose.bones:
            if b.name.endswith(name) and 'End' not in b.name:
                return b
        return None

    hips, neck, head = bone('Hips'), bone('Neck'), bone('Head')
    lleg, rleg = bone('LeftUpLeg'), bone('RightUpLeg')

    action = arm.animation_data.action if arm.animation_data else None
    start, end = (int(round(v)) for v in action.frame_range) if action else (1, 1)

    sums = [0.0, 0.0]
    steps = 8
    for k in range(steps):
        bpy.context.scene.frame_set(start + int((end - start) * k / steps))
        wp = lambda b: (arm.matrix_world @ b.matrix).to_translation()
        h = wp(hips)
        right = (wp(rleg) - wp(lleg))
        right.z = 0
        right.normalize()
        fwd = Vector((0, 0, 1)).cross(right).normalized()
        for i, b in enumerate((head, neck)):
            d = wp(b) - h
            sums[i] += math.degrees(math.atan2(d.dot(fwd), d.z))

    print(f'{path.split("/")[-1]:<24} 頭 {sums[0]/steps:7.1f}°   首 {sums[1]/steps:7.1f}°'
          f'   ({end - start + 1} フレーム)')
