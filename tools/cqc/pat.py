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
DOWN = {**LEAN, 'LeftArm': [('R', 32), ('F', 80)], 'LeftForeArm': [('R', 0)], 'LeftHand': [('R', -25)]}
# 叩く前に手を上げた所 (前腕を起こす)
UP = {**LEAN, 'LeftArm': [('R', 32), ('F', 80)], 'LeftForeArm': [('R', 28)], 'LeftHand': [('R', -10)]}
# 伸ばしかけ (しゃがみから叩く姿への途中)
HALF = {'Spine': [('R', -18), ('F', -8)], 'Spine1': [('R', -8)], 'LeftArm': [('R', 25), ('F', 45)],
        'LeftForeArm': [('R', 25)]}

# 24fps。1.6 秒。**叩く 1 回を 5 コマ (0.2 秒) かける。** 2 コマで上げ下げしていた頃は、型全体を
# 0.6 倍で流しても 1 回が 0.14 秒の素早いはたきに見えた (本人 2026-10-19「めっちゃ早く叩く」)
KEYS = [(0, {}), (6, HALF), (11, UP), (16, DOWN), (21, UP), (26, DOWN), (32, HALF), (38, {})]

# 叩いている間は**指を広げる** (本人 2026-10-19「叩いてる時の指は広げて」)。しゃがみの型では
# 銃の前を握っている。指の骨を基準の姿勢 (開いた手) へ戻し、外側の指を少し開く
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')
SPREAD = {'Index1': 8, 'Ring1': -6, 'Pinky1': -14}


# **手のひらで叩く** (本人 2026-10-19「手のこうで叩いてるじゃん」)。腕を伸ばしただけだと手のひらが
# 上を向く。前腕と手首を骨の軸まわりにひねって下へ向ける。150° (前腕 90°・手首 60°) では「回しすぎ」
# だったので 110° (前腕 72°・手首 38°): 手のひらは下と前の間を向く (法線 z -0.42)。二の腕でひねると
# 手が 30cm 以上動くので使わない。向きは、指の付け根の並びと親指の側から手のひらの法線を出して測った
PALM_DOWN = (('LeftForeArm', -72), ('LeftHand', -38))


def palm_down():
    from mathutils import Matrix
    for name, deg in PALM_DOWN:
        pb = arm.pose.bones[ns['P'] + name]
        pb.matrix_basis = pb.matrix_basis @ Matrix.Rotation(radians(deg), 4, 'Y')
    bpy.context.view_layer.update()


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
            palm_down()
            open_hand()
    else:
        ns['reset'](arm)
    ns['key'](arm, frame)
act = bpy.data.actions['pat']
act.use_fake_user = True
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, KEYS[-1][0]

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
