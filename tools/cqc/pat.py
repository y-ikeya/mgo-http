# 眠っている人をしゃがんでぽんぽん叩く型 (pat) を組んで、骨組みだけ glb に書き出す。
#
#   Blender -b tools/raw/cqc.blend --python tools/cqc/pat.py
#   → tools/raw/pat.glb (型は pat 1 本)。cqc.blend にも action 'pat' として残す
#   → bun tools/merge_clip.js public/models/soldier.glb tools/raw/pat.glb pat public/models/soldier.glb --rotation-only
#     (4 つの皮 soldier / soldier_nanashi / soldier_raiden / soldier_xbot に同じく)
#
# 本人 2026-10-19「crouch しながら近くの stun された人をぽんぽん叩いておく motion 作れる?」。
# しゃがみ (crouch_idle の 1 コマ目) から、左手だけ銃を離して左膝の外へ伸ばし、前の床の少し上
# (眠っている人の胸のあたり) を 2 回叩いて戻る。銃は右手で持ったまま、脚もしゃがんだまま。
# 押すたびにこの 1 本を流す (ボタン 1 回 = 1 回叩いた、3 回で起きる)。
#
# 叩く姿の角度は手首の位置を測って探した (体の 0.55m 前、左へ 0.4m、床から 0.2m を狙う。
# 左膝が前に立っているので、肘を膝の外へ出さないと腕が膝にめり込む)。
import bpy

ns = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/cqc/pose.py').read(), ns)
arm = bpy.data.objects['attacker']
ns['capture_base'](arm, 'crouch_idle', 0)

LEAN = {'Spine': [('R', -35), ('F', -15)], 'Spine1': [('R', -17)]}
# 叩いた所 (手のひらが下)
DOWN = {**LEAN, 'LeftArm': [('R', 15), ('F', 80)], 'LeftForeArm': [('R', 0)], 'LeftHand': [('R', -25)]}
# 叩く前に手を上げた所 (前腕を起こす)
UP = {**LEAN, 'LeftArm': [('R', 15), ('F', 80)], 'LeftForeArm': [('R', 28)], 'LeftHand': [('R', -10)]}
# 伸ばしかけ (しゃがみから叩く姿への途中)
HALF = {'Spine': [('R', -18), ('F', -8)], 'Spine1': [('R', -8)], 'LeftArm': [('R', 25), ('F', 45)],
        'LeftForeArm': [('R', 25)]}

# 24fps。0.8 秒 (ゲームでは 0.6 倍で流す。animation.ts の PAT_RATE)
KEYS = [(0, {}), (4, HALF), (7, UP), (9, DOWN), (11, UP), (13, DOWN), (16, HALF), (19, {})]

# 叩いている間は**指を広げる** (本人 2026-10-19「叩いてる時の指は広げて」)。しゃがみの型では
# 銃の前を握っている。指の骨を基準の姿勢 (開いた手) へ戻し、外側の指を少し開く
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')
SPREAD = {'Index1': 8, 'Ring1': -6, 'Pinky1': -14}


def open_hand():
    from mathutils import Matrix
    for pb in arm.pose.bones:
        short = pb.name.replace(ns['P'] + 'LeftHand', '')
        if pb.name.startswith(ns['P'] + 'LeftHand') and short.startswith(FINGERS):
            pb.matrix_basis = Matrix.Identity(4)
            if short in SPREAD:
                pb.matrix_basis = Matrix.Rotation(radians(SPREAD[short]), 4, 'Z')
    bpy.context.view_layer.update()


from math import radians  # noqa: E402

ns['new_action'](arm, 'pat')
for frame, spec in KEYS:
    if spec:
        ns['set_pose'](arm, spec)
        if spec is UP or spec is DOWN:
            open_hand()
    else:
        ns['reset'](arm)
    ns['key'](arm, frame)
act = bpy.data.actions['pat']
act.use_fake_user = True
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, 19

# 骨組みだけ選んで、この型だけを書き出す
for o in bpy.context.selected_objects:
    o.select_set(False)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath='/Users/yuma/workspace/mgo2http/tools/raw/pat.glb',
    use_selection=True,
    export_animation_mode='ACTIVE_ACTIONS',
    # 何も言わないと型の名前が 'Animation' になる (merge_clip.js は名前で探す)
    export_nla_strips_merged_animation_name='pat',
    export_skins=False,
    export_morph=False,
)
bpy.ops.wm.save_mainfile()
print('pat: frames', KEYS[-1][0] + 1)
