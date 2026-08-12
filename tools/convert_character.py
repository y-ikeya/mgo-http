"""Mixamo のキャラ + モーション群を 1 つの .glb にまとめる (設定駆動版)。

引数は JSON ファイルのパス 1 つ:
  {
    "dir": "FBX の置き場",
    "character": "メッシュを取り出すファイル名",
    "clips": { "ファイル名": "glTF 上のクリップ名", ... },
    "out": "出力する .glb",
    "maxTexture": 1024
  }

character に指定したファイルが clips にも含まれる場合、二度読みせず
そのファイルの action をそのまま使う。With Skin の FBX は 1 本 35MB 以上あるので
読み込み回数がそのまま所要時間になる。
"""
import bpy
import sys
import os
import json

config = json.load(open(sys.argv[sys.argv.index('--') + 1]))
pack_dir = config['dir']
clips = config['clips']
character_file = config['character']
max_texture = config.get('maxTexture', 1024)

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- キャラ本体 ---
bpy.ops.import_scene.fbx(filepath=os.path.join(pack_dir, character_file))
character_objects = list(bpy.context.scene.objects)
armature = next(o for o in character_objects if o.type == 'ARMATURE')
meshes = [o for o in character_objects if o.type == 'MESH']
print(f'[character] {character_file} bones={len(armature.data.bones)} '
      f'verts={sum(len(m.data.vertices) for m in meshes)}')

# このファイル自身がクリップも兼ねているなら、その action を残して名前を付ける
own_clip = clips.get(character_file)
kept = None
if own_clip and armature.animation_data and armature.animation_data.action:
    kept = armature.animation_data.action
    kept.name = own_clip
    kept.use_fake_user = True
    print(f'[clip] {own_clip:<10} frames={tuple(int(v) for v in kept.frame_range)} (本体と同梱)')
# action だけ外す。animation_data ごと消すと ACTIONS モードの書き出し先が無くなり、
# アニメーションが 1 本も出力されなくなる。
if armature.animation_data is None:
    armature.animation_data_create()
armature.animation_data.action = None

for action in list(bpy.data.actions):
    if action is not kept:
        bpy.data.actions.remove(action)

# --- 残りのモーション ---
for filename, clip_name in clips.items():
    if filename == character_file:
        continue
    path = os.path.join(pack_dir, filename)
    if not os.path.exists(path):
        print(f'[skip] {filename} が見つからない')
        continue

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    imported = [o for o in bpy.context.scene.objects if o not in before]

    action = None
    for obj in imported:
        if obj.type == 'ARMATURE' and obj.animation_data and obj.animation_data.action:
            action = obj.animation_data.action
            break

    if action is None:
        print(f'[warn] {filename} に action が無い')
    else:
        action.name = clip_name
        action.use_fake_user = True
        print(f'[clip] {clip_name:<10} frames={tuple(int(v) for v in action.frame_range)}')

    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)

# --- テクスチャ減量 ---
for image in bpy.data.images:
    if image.size[0] == 0:
        continue
    longest = max(image.size)
    if longest <= max_texture:
        continue
    scale = max_texture / longest
    new_size = (max(1, int(image.size[0] * scale)), max(1, int(image.size[1] * scale)))
    print(f'[texture] {image.name}: {image.size[0]}x{image.size[1]} -> {new_size[0]}x{new_size[1]}')
    image.scale(*new_size)

# FBX 由来の透明度がアルファ 0 として入り、glTF で完全に透明になることがある
for material in bpy.data.materials:
    if not material.use_nodes or not material.node_tree:
        continue
    for node in material.node_tree.nodes:
        alpha = node.inputs.get('Alpha') if node.type == 'BSDF_PRINCIPLED' else None
        if alpha is not None and not alpha.is_linked and alpha.default_value < 1.0:
            print(f'[material] {material.name}: alpha {alpha.default_value:.2f} -> 1.0')
            alpha.default_value = 1.0

# --- エクスポート ---
bpy.ops.object.select_all(action='DESELECT')
for obj in character_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature

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
