"""
外部ファイル参照の glTF を、テクスチャを埋め込んだ FBX にする。

    $BLENDER -b --factory-startup --python tools/gltf_to_fbx.py -- <scene.gltf> <出力.fbx>

--- なぜ要るか ---
Mixamo の auto-rig は FBX / OBJ / ZIP しか受けず、**glTF を読めない**。
配布モデルの多くは scene.gltf + scene.bin + textures/ の形で、テクスチャは
相対パスで外を指しているだけなので、そのまま上げても材質が解決されず
**真っ白なモデル**になる。

FBX に「テクスチャを埋め込む」形で書き出せば、1 ファイルで完結して色が乗る。

Mixamo が読むのは基本色 (baseColor) だけ。法線や粗さは落ちるが、
リターゲットの目的は骨格なので困らない — 戻ってきた FBX に元の材質を
当て直せばよい (UV は保たれる)。

--- 骨を外して 1 枚にする ---
auto-rig は**骨の入っていない 1 枚のメッシュ**を前提にしている。配布モデルは
独自の骨格 (Raiden は 123 本) と部位ごとのメッシュ (16 枚) を持っていることが
多く、そのまま上げると読み込みに失敗する。

外して困らない。**欲しいのは Mixamo が付け直す mixamorig の骨**であって、
元の骨ではない。
"""

import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
verts = sum(len(o.data.vertices) for o in meshes)
print(f'  メッシュ {len(meshes)} / 頂点 {verts} / 骨格 {len(armatures)}')
for a in armatures:
    print(f'    骨 {len(a.data.bones)}')

# 外部ファイルを .blend に取り込む。これをしないと「埋め込む」対象が無い
missing = [im.name for im in bpy.data.images if im.source == 'FILE' and not im.has_data]
if missing:
    print('  読めていない画像:', ', '.join(missing[:5]))
bpy.ops.file.pack_all()
print(f'  画像 {len(bpy.data.images)} 枚を取り込んだ')

# **統合が先、骨を外すのは後。** 逆にすると、親を失ったメッシュが選べなくなって
# join が空振りし、補助メッシュだけが残った (42 頂点になった)。
# 補助メッシュを落とす。配布モデルには材質を持たない当たり判定用の球などが
# 紛れていることがあり、そのまま出すと**体の半分を隠す白い球**になる (実際なった)。
# 材質が無く頂点も少ない物は本体ではない
helpers = [o for o in meshes if len(o.data.materials) == 0 and len(o.data.vertices) < 200]
for o in helpers:
    print(f'  補助メッシュを捨てる: {o.name} ({len(o.data.vertices)} 頂点)')
    bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in meshes if o not in helpers]
verts = sum(len(o.data.vertices) for o in meshes)

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
# いちばん頂点の多い物を軸にする。補助メッシュが軸になると材質を持っていかれる
bpy.context.view_layer.objects.active = max(meshes, key=lambda o: len(o.data.vertices))
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'body'

# 骨を外す。**欲しいのは Mixamo が付け直す骨**であって元の骨ではない
for m in list(body.modifiers):
    if m.type == 'ARMATURE':
        body.modifiers.remove(m)
body.parent = None
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)

print(f'  1 枚にした: {len(body.data.vertices)} 頂点 / 材質 {len(body.data.materials)}')
print(f'  寸法 {body.dimensions.x:.2f} x {body.dimensions.y:.2f} x {body.dimensions.z:.2f} m')
if len(body.data.vertices) < verts * 0.9:
    raise SystemExit(f'統合で頂点が落ちた ({verts} -> {len(body.data.vertices)})')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.fbx(
    filepath=OUT,
    use_selection=False,
    # **テクスチャを FBX の中へ入れる。** Mixamo は 1 ファイルしか受け取らない
    path_mode='COPY',
    embed_textures=True,
    add_leaf_bones=False,
    bake_anim=False,
)
print(f'  書き出した {OUT} ({os.path.getsize(OUT) / 1024 / 1024:.1f} MB)')
