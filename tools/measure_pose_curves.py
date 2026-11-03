"""
倒れていく・転がる型の**体の部位の位置**を表にする (src/domain/player/poseCurves.ts を書く)。

    $BLENDER -b --factory-startup --python tools/measure_pose_curves.py

審判は骨を動かさない。部位の位置を姿勢ごとの決まった高さで見ているので、型の途中
(眠って倒れていく、転がっている) では、画面の体と審判の体がずれていた
(2026-10-30 本人「倒れてる敵はそのモーションで当たり判定させるのはダメなの？」→ まず stun の倒れと rolling)。
型を 0.1 秒ごとに流して、頭・胸・膝の位置を測っておけば、審判は表を引くだけで済む。

測るのは**足元からの高さ**と、**腰からの前後のずれ** (前が正)。ゲームは腰の前後の動きを型から抜いて
位置の側で運ぶ (animation.ts の stripRootMotion、転がりは型の移動をそのまま位置に使う) ので、
体の部位は「腰の真上からどれだけ前か」で置けば画面と合う。左右は見ない。

部位は審判の 3 つ (sim/judge/hitcheck.ts の HitZone):

    頭   Head の骨
    胴   中心は胸 (Spine1)、範囲は腰 (Hips) から首 (Neck) までの高さ
    脚   中心は両膝、範囲は両足先から腰までの高さ
"""

import bpy, os, sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, 'public', 'models', 'soldier.glb')
OUT = os.path.join(ROOT, 'src', 'domain', 'player', 'poseCurves.ts')
CLIPS = ('sleep', 'roll')
STEP = 0.1

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.animation_data_create()
fps = bpy.context.scene.render.fps


def bone(suffix):
    return next(b for b in arm.pose.bones if b.name.endswith(suffix))


B = {k: bone(k) for k in ('Hips', 'Spine1', 'Neck', 'Head', 'LeftLeg', 'RightLeg', 'LeftToeBase', 'RightToeBase')}


def world(name):
    return arm.matrix_world @ B[name].head


# glTF の +Z (モデルの正面) は Blender の -Y。ゲームはモデルを 180° 回して置くので、これが体の前
def forward(p):
    return -p.y


# 腰は型から前後を抜かれ、休みの姿 (idle の頭の 1 枚) の位置に置かれる
idle = bpy.data.actions['idle']
arm.animation_data.action = idle
bpy.context.scene.frame_set(int(idle.frame_range[0]))
rest_hips = forward(world('Hips'))

curves = {}
for name in CLIPS:
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    duration = (f1 - f0) / fps
    rows = {'head': [], 'body': [], 'legs': []}
    t = 0.0
    while t <= duration + 1e-6:
        bpy.context.scene.frame_set(int(round(f0 + t * fps)))
        p = {k: world(k) for k in B}
        hips = forward(p['Hips'])
        fwd = lambda v: round(forward(v) - hips + rest_hips, 3)
        knee = (p['LeftLeg'] + p['RightLeg']) / 2
        rows['head'].append([round(p['Head'].z, 3), fwd(p['Head'])])
        body_low = min(p['Hips'].z, p['Neck'].z)
        body_high = max(p['Hips'].z, p['Neck'].z)
        rows['body'].append([round(p['Spine1'].z, 3), fwd(p['Spine1']), round(body_low, 3), round(body_high, 3)])
        legs_low = min(p['LeftToeBase'].z, p['RightToeBase'].z)
        legs_high = max(p['Hips'].z, knee.z)
        rows['legs'].append([round(knee.z, 3), fwd(knee), round(legs_low, 3), round(legs_high, 3)])
        t += STEP
    curves[name] = (round(duration, 3), rows)
    print(f'  {name}: {duration:.2f} 秒、{len(rows["head"])} 枚。頭 {rows["head"][0][0]} → {rows["head"][-1][0]}m')


def array(rows):
    return '[' + ', '.join('[' + ', '.join(str(v) for v in r) + ']' for r in rows) + ']'


lines = [
    '// 書き出した物。手で直さない (tools/measure_pose_curves.py で作り直す)',
    '//',
    '// 型を 0.1 秒ごとに流した体の部位の位置。頭は [高さ, 前]、胴と脚は [中心の高さ, 前, 範囲の下, 範囲の上] (m)。',
    '// 高さは足元から、前は腰の真上から体の正面へ。型の時間で取ってある (流す速さは poseCurve.ts)',
    'export const POSE_STEP = ' + str(STEP),
    'export const POSE_CURVES = {',
]
for name, (duration, rows) in curves.items():
    lines.append(f'  {name}: {{')
    lines.append(f'    duration: {duration},')
    for zone in ('head', 'body', 'legs'):
        lines.append(f'    {zone}: {array(rows[zone])},')
    lines.append('  },')
lines.append('} as const')
open(OUT, 'w').write('\n'.join(lines) + '\n')
print('  書いた:', OUT)
