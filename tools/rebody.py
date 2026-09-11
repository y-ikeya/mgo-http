"""
別のキャラの体で、いまのモーションを動かせる glb を作る。

    $BLENDER -b --factory-startup --python tools/rebody.py -- \
        <体.fbx> <出力.glb> [宿主の腰の高さ] [材質の元.gltf]

そのあとクリップを移して、背丈を合わせる:

    bun tools/merge_all_clips.js public/models/soldier.glb <出力.glb> <完成.glb>
    bun tools/fit_height.js public/models/soldier.glb <完成.glb>

**背丈合わせは最後にやり直す。** ここで腰の高さから決める scale は FBX 側の実測値
なので、Mixamo が正規化して返す単位系とずれる。ずれたまま宿主のクリップを流すと、
腰の移動が宿主の単位のままなので体が沈む (Raiden で頭が 10.3cm 低かった)。
fit_height.js が Armature の scale を宿主と揃えて直す。

--- なぜ骨を貼り替えないか ---
メッシュを宿主の骨に貼り直すと、**レストポーズの差がそのまま歪みになる**。
体つきが違えば骨の長さも違うので、逆バインド行列が合わない。

提供側の骨をそのまま使って、**クリップ (骨ごとの回転) だけを移す**。回転は
体つきに依存しないので、腕が長かろうが同じ角度で曲がる。骨の名前が
mixamorig: で揃っていることが前提 (Mixamo の auto-rig を通せば揃う)。

--- 材質を貼り直す ---
Mixamo は**材質を簡略化して返す**。元は 15 材質すべてに基本色テクスチャが
あったのに、戻ってきたら 10 枚だけになっていて、残りが真っ白になった。

材質の名前は残っているので、元のファイルから名前で引いて差し替える。
UV も保たれているので、貼り直せば元通りになる。

--- 背丈を合わせる ---
腰の高さを宿主に合わせて全体を縮める。クリップの腰の**移動**だけは高さに
依存するので、ここがずれると沈んだり浮いたりする。

見た目の理由でもある。**体格が変わると遮蔽の判定と食い違う** — 頭の高さ
1.47m は 1 体を実測した値で、背の高い体を入れるとその人だけ見つかりやすい。
"""

import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
# 宿主 (soldier.glb) の腰の高さ。合わせる先
HOST_HIPS = float(argv[2]) if len(argv) > 2 else 1.009
# 材質を引いてくる元。Mixamo を通すと簡略化されるので、元のファイルから戻す
MATERIALS_FROM = argv[3] if len(argv) > 3 else ''
# 宿主の Armature に乗っている scale。**ここへ揃える** (fit_height.js と同じ値)
HOST_SCALE = 0.01
SIDE = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
# **読み込む前に fps を立てる。** あとで変えても遅い (投擲で踏んだ穴)
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1

bpy.ops.import_scene.fbx(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
hips = arm.data.bones.get('mixamorig:Hips')
if not hips:
    raise SystemExit('mixamorig:Hips が無い。Mixamo の auto-rig を通してから使う')


def at(name):
    """その骨の根元の世界座標"""
    return arm.matrix_world @ arm.data.bones[name].head_local


"""
--- 上がどちらかを測る ---

**読み込んだ姿が世界 Z 上に立っているとは限らない。** FBX の軸の取り替えは
オブジェクトの回転として乗ってくることがある。Mixamo 生まれの体では起きないが、
外から持ち込んだ体 (Tripo → Mixamo) で出た — 上が -Y を向いていて、腰の高さを
z で測ると -0.023m になり、そこから 44 倍を掛けていた。

**回さない。測るだけ。** 世界ごと回して焼くと、根の骨の素の姿勢が変わる。
移してくるクリップは骨ごとの**回転**で、宿主の素の姿勢を前提にしているので、
そこがずれると同じ回転が別の結果になる (爪先が頭より上に来た)。宿主も回転は
オブジェクトに乗せたままなので、こちらもそのままにする。
"""
foot = (at('mixamorig:LeftFoot') + at('mixamorig:RightFoot')) / 2
up = (at('mixamorig:Head') - foot).normalized()
if abs(up.z) < 0.9:
    print(f'  上が {tuple(round(v, 2) for v in up)} を向いている。その向きで測る')

before = (at('mixamorig:Hips') - foot).dot(up)
if before <= 0:
    raise SystemExit(f'腰が足より下にある ({before:.3f})。骨の名前か向きが違う')

"""
--- 宿主と同じ単位で焼く ---

拡大は**オブジェクトの scale に置かない**。移してくるクリップは腰の位置を
**宿主の単位**で持っていて (骨の回転と違い、移動は長さそのもの)、掛かるのは
Armature の scale。宿主と違う値が入っていると、その比のぶん腰が上下する
(Raiden で 6.9cm 沈んだ)。

「見た目を宿主に合わせる倍率」を骨と頂点へ焼き込んでから、Armature の scale は
宿主と同じ値にする。**回転は焼かない** — scale だけ。
"""
arm.scale = [HOST_HIPS / before] * 3
bpy.ops.object.select_all(action='DESELECT')
for o in [arm] + meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
arm.scale = [HOST_SCALE] * 3
bpy.context.view_layer.update()

after = (at('mixamorig:Hips') - (at('mixamorig:LeftFoot') + at('mixamorig:RightFoot')) / 2).dot(up)
print(f'  腰の高さ {before:.3f} -> {after:.3f} m (宿主 {HOST_HIPS})')
print(f'  骨 {len(arm.data.bones)} / メッシュ {len(meshes)} / 頂点 {sum(len(m.data.vertices) for m in meshes)}')

if MATERIALS_FROM:
    known = {m.name for m in bpy.data.materials}
    bpy.ops.import_scene.gltf(filepath=MATERIALS_FROM)
    # 読み込んだ物のうち、材質だけ使う。体は捨てる
    # 同じ名前があると Blender は .001 を足す。**落として引く** —
    # ここを見落として 0 件しか貼り直せなかった
    def bare(name):
        return name.rsplit('.', 1)[0] if name.rsplit('.', 1)[-1].isdigit() else name

    source = {bare(m.name): m for m in bpy.data.materials if m.name not in known}
    restored = 0
    for mesh in meshes:
        for i, slot in enumerate(mesh.material_slots):
            original = source.get(bare(slot.material.name) if slot.material else '')
            if original and slot.material is not original:
                mesh.data.materials[i] = original
                restored += 1
    print(f'  材質を貼り直した {restored} / {sum(len(m.data.materials) for m in meshes)}')
    # 材質を取りに来ただけなので、体と骨は捨てる
    for o in list(bpy.data.objects):
        if o not in meshes and o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)

# 提供側に付いてきた動き (Mixamo の見本) は要らない
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)

for im in bpy.data.images:
    if max(im.size) > SIDE:
        im.scale(SIDE, SIDE)
print(f'  テクスチャ {len(bpy.data.images)} 枚を {SIDE} に')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
                          export_image_format='AUTO', export_jpeg_quality=85)
print(f'  書き出した {OUT} ({os.path.getsize(OUT) / 1024 / 1024:.1f} MB)')
