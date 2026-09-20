"""素の姿勢が違う FBX から、ゲームの骨格へ型を焼き直す。

    $BLENDER -b --factory-startup --python tools/retarget_clip.py -- \
        <設定.json>

設定は convert_character.py と同じ形。clips の値が 1 本だけ入っていればよい。

--- なぜ要るか ---
FBX の型は「素の姿勢からの差」で入っている。Mixamo から出したものは素の姿勢が
T ポーズなので、同じ T ポーズのキャラへそのまま載る。ところが Blender で作って
出した FBX は、**そのときの姿勢が素の姿勢として焼かれている**ことがある
(crouchFire がそうで、素の姿勢がしゃがみだった)。差だけを T ポーズへ載せると、
差が小さいぶんだけ T ポーズのままの絵が出る。

--- どう直すか ---
骨ごとに**世界での向きを写す**。素の姿勢が何であれ、動いている最中の向きは
同じ骨格なら同じ意味を持つ。腰だけは位置も写す。写したものを焼き付けて
(visual keying)、繋ぎを外せば、ゲームの骨格の型になる。
"""

import bpy, sys, os, json, math

argv = sys.argv[sys.argv.index('--') + 1:]
config = json.load(open(argv[0]))

# 焼く前に元を回す。**向きが逆に作られている素材**がある — 梯子の型は
# 体の前後が反対で、そのまま入れると手足が梯子の裏側を掻いていた。
TURN = 0.0
for i, arg in enumerate(argv):
    if arg == '--turn' and i + 1 < len(argv):
        TURN = math.radians(float(argv[i + 1]))
pack_dir = config['dir']
character_file = config['character']
entry, clip_name = next(iter(config['clips'].items()))
filename, _, take_text = entry.partition('#')
take = int(take_text) if take_text else 1

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- ゲームの骨格 ---
bpy.ops.import_scene.fbx(filepath=os.path.join(pack_dir, character_file))
character_objects = list(bpy.context.scene.objects)
target = next(o for o in character_objects if o.type == 'ARMATURE')
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
if target.animation_data is None:
    target.animation_data_create()

# --- 型 ---
before = set(bpy.context.scene.objects)
before_actions = set(bpy.data.actions)
bpy.ops.import_scene.fbx(filepath=os.path.join(pack_dir, filename))
imported = [o for o in bpy.context.scene.objects if o not in before]
added = [a for a in bpy.data.actions if a not in before_actions]
source = next(o for o in imported if o.type == 'ARMATURE')
if take > len(added):
    raise SystemExit(f'{filename} に {take} 本目の型が無い (全 {len(added)} 本)')
source.animation_data.action = added[take - 1]
start, end = (int(v) for v in added[take - 1].frame_range)
print(f'[clip] {clip_name} frames=({start}, {end})  骨 元 {len(source.data.bones)} / 先 {len(target.data.bones)}')

if TURN:
    source.rotation_mode = 'XYZ'
    source.rotation_euler.z += TURN
    print(f'[turn] 元を {math.degrees(TURN):.0f} 度回してから焼く')

# --- 繋ぐ ---
linked = 0
for bone in target.pose.bones:
    if bone.name not in source.pose.bones:
        continue
    turn = bone.constraints.new('COPY_ROTATION')
    turn.target = source
    turn.subtarget = bone.name
    turn.target_space = 'WORLD'
    turn.owner_space = 'WORLD'
    # 腰だけ位置も。ここが動かないと、しゃがんでも背が縮まない
    if bone.name.endswith('Hips'):
        move = bone.constraints.new('COPY_LOCATION')
        move.target = source
        move.subtarget = bone.name
        move.target_space = 'WORLD'
        move.owner_space = 'WORLD'
    linked += 1
print(f'[link] {linked} 本を繋いだ')

# --- 焼く ---
bpy.context.scene.frame_start = start
bpy.context.scene.frame_end = end
bpy.ops.object.select_all(action='DESELECT')
target.select_set(True)
bpy.context.view_layer.objects.active = target
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(
    frame_start=start,
    frame_end=end,
    only_selected=True,
    visual_keying=True,
    clear_constraints=True,
    clear_parents=False,
    use_current_action=True,
    bake_types={'POSE'},
)
bpy.ops.object.mode_set(mode='OBJECT')

baked = target.animation_data.action
baked.name = clip_name
baked.use_fake_user = True
print(f'[bake] {clip_name} frames={tuple(int(v) for v in baked.frame_range)}')

for obj in imported:
    bpy.data.objects.remove(obj, do_unlink=True)

# --- 書き出し ---
max_texture = config.get('maxTexture', 1024)
for image in bpy.data.images:
    if image.size[0] == 0:
        continue
    longest = max(image.size)
    if longest > max_texture:
        scale = max_texture / longest
        image.scale(max(1, int(image.size[0] * scale)), max(1, int(image.size[1] * scale)))

target.animation_data.action = None
bpy.ops.object.select_all(action='DESELECT')
for obj in character_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = target

options = {
    'filepath': config['out'],
    'export_format': 'GLB',
    'use_selection': True,
    'export_animation_mode': 'ACTIONS',
    'export_animations': True,
    'export_image_format': 'JPEG',
    'export_jpeg_quality': 80,
    'export_yup': True,
}
valid = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k: v for k, v in options.items() if k in valid})
print(f'[done] {config["out"]} ({os.path.getsize(config["out"]) / 1024 / 1024:.1f} MB)')
