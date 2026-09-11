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
# 胸の骨を足すか。**Mixamo の 65 本には無い**ので、要る体にだけ作る
BUST = '--bust' in argv
argv = [a for a in argv if a != '--bust']
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
--- 顎から上は頭の骨だけに握らせる ---

**自動リグは頭と首の境目をなだらかに塗る。** 頭が主の頂点の 8 割に首の重みが
乗っていて、280 個はほぼ半分首のものだった (手で組んだ宿主は 57 個)。
首を基準に頭が回ると、その分だけ顎と頭蓋が横へ引きずられる — 画面では
**顔が剪断される**ように見える。

頭の骨の付け根 (頭蓋の底) から上は、頭だけが握る。付け根の少し下に細い帯を
置いて、そこで 0 から 1 へ渡す — 帯を置かないと境目で皮が折れる。
"""
HEAD_BAND = 0.04


def harden_head():
    head_h = (at('mixamorig:Head') - foot).dot(up)
    moved = 0
    for mesh in meshes:
        group = mesh.vertex_groups.get('mixamorig:Head')
        if not group:
            continue
        for v in mesh.data.vertices:
            height = ((mesh.matrix_world @ v.co) - foot).dot(up)
            t = (height - (head_h - HEAD_BAND)) / HEAD_BAND
            if t <= 0:
                continue
            t = min(1.0, t)
            entries = {e.group: e for e in v.groups}
            # 頭を t まで引き上げ、残りを (1-t) 倍に潰す。合計は 1 のまま
            for e in v.groups:
                e.weight = e.weight * (1 - t) + (t if e.group == group.index else 0)
            if group.index not in entries:
                group.add([v.index], t, 'REPLACE')
            moved += 1
    print(f'  顎から上を頭の骨へ寄せた {moved} 頂点')


harden_head()

"""
--- 胸の骨を作る ---

**Mixamo の 65 本には胸の骨が無い。** 揺らすには揺らす対象が要るので、
Spine2 の子として左右に 1 本ずつ足す。クリップはこの骨を知らないので
(宿主に無い)、動かすのは走っている側 (animation.ts)。

当たり判定には触れない。あちらは Head / Neck / Hips / LeftFoot を接尾辞で
引いているだけで、骨が増えても拾わない (skin.ts の「見た目は幾何を変えない」)。

--- どこに置くか ---
胸は「脊椎より前へ出ている所」なので、**前へ出た量で探す**。Spine1/Spine2 が
主の頂点のうち、胸の高さにあって前へ出ているものを左右に分け、その塊の
重心へ骨の先を置く。根元は脊椎側へ引く — 根元と先が同じ点だと向きが決まらない。
"""
BUST_REACH = 0.085   # 骨が持つ範囲 (m)。これより遠い頂点は触らない
BUST_NAMES = ('mixamorig:Bust_L', 'mixamorig:Bust_R')


def add_bust():
    spine2 = at('mixamorig:Spine2')
    neck = at('mixamorig:Neck')
    """
    横は**肩から取る**。爪先から前を出すと、足の開きがそのまま傾きになって
    左右の骨が斜めに並んだ (実測で 38° ずれた)。肩は体の軸そのものなので素直。
    """
    side = at('mixamorig:LeftShoulder') - at('mixamorig:RightShoulder')
    side = (side - up * side.dot(up)).normalized()
    forward = side.cross(up).normalized()

    mesh = max(meshes, key=lambda m: len(m.data.vertices))
    groups = {g.name: g.index for g in mesh.vertex_groups}
    spine_ids = {groups[n] for n in ('mixamorig:Spine1', 'mixamorig:Spine2') if n in groups}
    if not spine_ids:
        print('  胸: 脊椎の頂点群が無いので作らない')
        return

    low = (spine2 - foot).dot(up)
    high = (neck - foot).dot(up)
    picked = {1: [], -1: []}
    for v in mesh.data.vertices:
        if not any(e.group in spine_ids and e.weight > 0.4 for e in v.groups):
            continue
        world = mesh.matrix_world @ v.co
        height = (world - foot).dot(up)
        if not (low < height < high):
            continue
        ahead = (world - spine2).dot(forward)
        if ahead <= 0:
            continue
        picked[1 if (world - spine2).dot(side) > 0 else -1].append((ahead, world))

    """
    **左右は鏡にする。** それぞれの塊から別々に重心を出すと、頂点の偏りが
    そのまま非対称になる。高さと前への出方は平均、横だけ符号を変える。
    """
    centres = {}
    for sign in (1, -1):
        group = picked[sign]
        if len(group) < 20:
            print(f'  胸: 片側の頂点が足りない ({len(group)})')
            return
        # **一番前へ出ている 2 割**の重心。全部の重心だと脇腹に寄る
        group.sort(key=lambda t: -t[0])
        core = group[: max(10, len(group) // 5)]
        centres[sign] = sum((w for _, w in core), mathutils.Vector()) / len(core)

    mid = (centres[1] + centres[-1]) / 2
    lateral = (centres[1] - centres[-1]).dot(side) / 2
    # 脊椎の面へ戻してから、横だけ左右へ振り直す
    base = spine2 + up * (mid - spine2).dot(up) + forward * (mid - spine2).dot(forward)

    made = []
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, sign in zip(BUST_NAMES, (1, -1)):
        centre = base + side * (lateral * sign)
        bone = arm.data.edit_bones.new(name)
        bone.head = arm.matrix_world.inverted() @ (centre - forward * BUST_REACH)
        bone.tail = arm.matrix_world.inverted() @ centre
        bone.parent = arm.data.edit_bones['mixamorig:Spine2']
        bone.use_connect = False
        made.append((name, centre))
    bpy.ops.object.mode_set(mode='OBJECT')

    # 重みを移す。中心ほど胸、遠いほど元のまま
    for name, centre in made:
        group = mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name)
        moved = 0
        for v in mesh.data.vertices:
            world = mesh.matrix_world @ v.co
            gap = (world - centre).length
            if gap >= BUST_REACH:
                continue
            t = 1.0 - gap / BUST_REACH
            t *= t          # 縁をなだらかに。線形だと境目が見える
            for e in v.groups:
                e.weight *= 1 - t
            group.add([v.index], t, 'ADD')
            moved += 1
        print(f'  胸: {name} を作った ({moved} 頂点)')


if BUST:
    add_bust()


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
