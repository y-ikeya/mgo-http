# CQC の型を手で組むための道具。Blender の中で exec する (MCP)。
#
#   exec(open('tools/cqc/pose.py').read(), ns := {})
#   ns['set_pose'](arm, {'Spine': [('U', -30)], 'RightArm': [('R', -70)]}, hips=(0, 0, 0.1))
#   ns['key'](arm, frame)
#
# --- 向きの言い方 ---
# 骨を回す軸は**その人の体から見た向き**で言う: R = 右、F = 前、U = 上。
# 角度は右ねじ (軸の先から見て反時計回りが正)。例:
#   ('U', 30)  左を向く (上から見て反時計回り)
#   ('R', 30)  右の軸回りの正は「上側が後ろへ、下側が前へ」。前屈は ('R', -30)、
#              下ろした腕を前へ振り上げるのは ('R', +x)
#   ('F', 30)  右へ傾く (前の軸回りの正は「上側が右へ」)
#
# 回すのは**基準の姿勢から**。毎回基準へ戻してから、親から順に回す。
# 基準は glTF の型の 1 コマ (BASE_CLIP)。
import bpy
from mathutils import Matrix, Quaternion, Vector

# 起き上がる型の最後 (両足をそろえて立った姿)。同じ型の最初のコマは仰向けに倒れた姿で、
# 投げられる側の終わりをそこへ合わせると、そのまま起き上がる型へつながる
BASE_CLIP = 'stand'
BASE_FRAME = 74
P = 'mixamorig:'

# 親から子への順。回す時はこの順に当てる (子は親を回した後の位置から回る)
ORDER = [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
]

_base = {}


def char_axes(arm):
    """その人の右・前・上を、**骨組みの空間**で返す。

    glTF の骨組みは X 軸回りに 90° 寝た物の中にあり (Y が上、Z が前)、縮尺 0.01
    (骨組みの空間は cm)。右は -X、前は +Z、上は +Y。人を回したければ骨組みの物体ごと回す
    """
    return {'R': Vector((-1, 0, 0)), 'F': Vector((0, 0, 1)), 'U': Vector((0, 1, 0))}


def clip_pose(arm, clip, frame):
    """型の 1 コマの姿勢 (各骨の matrix_basis)"""
    arm.animation_data.action = bpy.data.actions[clip]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    pose = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
    arm.animation_data.action = None
    return pose


def capture_base(arm, clip=BASE_CLIP, frame=BASE_FRAME):
    """基準の姿勢を控える"""
    _base[arm.name] = clip_pose(arm, clip, frame)


def apply_pose(arm, pose):
    """控えた姿勢をそのまま当てる (投げられる側の終わり = 起き上がる型の最初)"""
    for pb in arm.pose.bones:
        pb.matrix_basis = pose[pb.name].copy()
    bpy.context.view_layer.update()


def reset(arm):
    for pb in arm.pose.bones:
        pb.matrix_basis = _base[arm.name][pb.name].copy()
    bpy.context.view_layer.update()


def set_pose(arm, spec, hips=(0, 0, 0), hips_turn=None):
    """基準から spec のとおりに回す。

    spec: {'Spine': [('U', 20), ('R', -10)], ...}  (骨の名前は mixamorig: を省く)
    hips: 腰を動かす量 (m、その人の 右・前・上)
    hips_turn: 腰ごと全身を回す [('U', 90), ...] (投げられる側が宙で回る時)
    """
    reset(arm)
    ax = char_axes(arm)
    # 腰の位置。骨組みの空間は cm
    if any(hips) or hips_turn:
        pb = arm.pose.bones[P + 'Hips']
        m = pb.matrix.copy()
        if hips_turn:
            q = Quaternion()
            for k, deg in hips_turn:
                q = Quaternion(ax[k], radians(deg)) @ q
            rot = q.to_matrix().to_4x4()
            head = m.to_translation()
            m = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ m
        offset = ax['R'] * hips[0] + ax['F'] * hips[1] + ax['U'] * hips[2]
        m.translation = m.translation + offset * 100
        pb.matrix = m
        bpy.context.view_layer.update()
    for name in ORDER:
        turns = spec.get(name)
        if not turns:
            continue
        pb = arm.pose.bones[P + name]
        q = Quaternion()
        for k, deg in turns:
            q = Quaternion(ax[k], radians(deg)) @ q
        m = pb.matrix.copy()
        head = m.to_translation()
        pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
        bpy.context.view_layer.update()


def key(arm, frame):
    """いまの姿勢を frame に打つ (全部の骨の回転、腰の位置)"""
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
    arm.pose.bones[P + 'Hips'].keyframe_insert('location', frame=frame)


def new_action(arm, name):
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    act = bpy.data.actions.new(name)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    return act


from math import radians  # noqa: E402  (上の関数が使う)
