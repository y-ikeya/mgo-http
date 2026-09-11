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

"""
--- ここから先は**実寸**で測れる ---

重みを触る工程 (顎・髪・胸) は、**焼いた後に回す。** 焼く前は FBX の単位の
ままで、この体は宿主の半分の大きさだった — 0.55m のつもりの範囲が実質 1.1m
になって、**迷彩のズボンまで「髪」と判定していた** (腿の 465 頂点が頭の骨に
握られて、走ると破裂した)。

足元は縮尺で動くので測り直す。上の向きは変わらない。
"""
foot = (at('mixamorig:LeftFoot') + at('mixamorig:RightFoot')) / 2

HEAD_BAND = 0.04
"""
--- 髪も頭に握らせる ---

**髪が裂ける。** 1 本の房の中で頂点が別々の骨に割り振られていて (肩・首・
脊椎)、頭が動くと房が長い棘に伸びて砕ける。自動リグは「一番近い骨」で
決めるので、肩に垂れた髪は肩のものになる。

髪は体と地続きで、材質も 1 つ。切り離せないので**色で見分ける**。基本色が
暗ければ髪、明るければ肌か服。頭の周りに限れば、暗いのは髪しかない
(ベルトや靴も暗いが遠い)。
"""
HAIR_SEED = 0.16    # 頭皮とみなす範囲 (m)。ここから辿り始める
HAIR_DARK = 0.12    # これより暗ければ髪 (0..1)


def harden_head():
    """顎から上は頭の骨だけに握らせる。

    **自動リグは頭と首の境目をなだらかに塗る。** 頭が主の頂点の 8 割に首の
    重みが乗っていて、280 個はほぼ半分首のものだった (手で組んだ宿主は 57 個)。
    首を基準に頭が回ると、その分だけ顎と頭蓋が横へ引きずられる — 画面では
    **顔が剪断される**ように見える。

    頭の骨の付け根 (頭蓋の底) から上は、頭だけが握る。付け根の少し下に細い帯を
    置いて、そこで 0 から 1 へ渡す — 帯を置かないと境目で皮が折れる。
    """
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


def base_colour_image(mesh):
    """基本色のテクスチャ。**無ければ None** (色で見分けられない)"""
    for slot in mesh.material_slots:
        tree = slot.material and slot.material.node_tree
        if not tree:
            continue
        for node in tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            link = node.inputs['Base Color'].links
            if link and link[0].from_node.type == 'TEX_IMAGE':
                return link[0].from_node.image
    return None


def take_hair():
    """髪をまるごと頭の骨へ。

    **頭皮から、暗い頂点だけを辿る。** 「暗ければ髪」だけで拾うと、背中の
    黒いベルトまで頭に括り付けてしまい、頭が動くたびにベルトが棘に伸びた。

    髪は頭皮から房まで暗い頂点で繋がっている。ベルトは間に肌や白い服を挟むので、
    辿っても届かない。**地続きの一塊であること**が効く。
    """
    mesh = max(meshes, key=lambda m: len(m.data.vertices))
    image = base_colour_image(mesh)
    if not image:
        print('  髪: 基本色のテクスチャが無いので色で見分けられない')
        return
    group = mesh.vertex_groups.get('mixamorig:Head')
    uv = mesh.data.uv_layers.active
    if not group or not uv:
        print('  髪: 頂点群か UV が無い')
        return

    w, h = image.size
    pixels = list(image.pixels)
    at_uv = {}
    for poly in mesh.data.polygons:
        for vi, li in zip(poly.vertices, poly.loop_indices):
            at_uv.setdefault(vi, uv.data[li].uv)

    def dark(index):
        co = at_uv.get(index)
        if not co:
            return False
        x = min(w - 1, max(0, int(co.x % 1.0 * w)))
        y = min(h - 1, max(0, int(co.y % 1.0 * h)))
        i = (y * w + x) * 4
        return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < HAIR_DARK

    # 隣り合わせ
    near = {}
    for e in mesh.data.edges:
        a, b = e.vertices
        near.setdefault(a, []).append(b)
        near.setdefault(b, []).append(a)

    # 種は頭皮。**頭の骨の近くで、暗い所**
    head_at = at('mixamorig:Head')
    seeds = [
        v.index
        for v in mesh.data.vertices
        if ((mesh.matrix_world @ v.co) - head_at).length < HAIR_SEED and dark(v.index)
    ]
    if not seeds:
        print('  髪: 頭皮に暗い所が無い')
        return

    seen = set(seeds)
    stack = list(seeds)
    while stack:
        i = stack.pop()
        for j in near.get(i, ()):
            if j in seen or not dark(j):
                continue
            seen.add(j)
            stack.append(j)

    for i in seen:
        for e in mesh.data.vertices[i].groups:
            e.weight = 0.0
        group.add([i], 1.0, 'REPLACE')
    print(f'  髪: 頭へ寄せた {len(seen)} 頂点 (種 {len(seeds)})')



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

"""
--- 遠すぎる骨から取り上げる ---

**手から 1.17m 離れた頂点を指の骨が握っていた** (713 個)。腰やズボンの布が
手の骨に付いているので、手を動かすたびに飛んで、長い棘になる。自動リグが
「一番近い骨」で決めた副作用で、宿主 (手で組んだ soldier) には 1 つも無い。

手の骨だけを見る。胴や腰の骨は遠くの頂点を持っていて当たり前なので、
同じ物差しは当てられない。
"""
HAND_REACH = 0.30


def drop_far_hands():
    dropped = 0
    for mesh in meshes:
        bones = {}
        for group in mesh.vertex_groups:
            bone = arm.data.bones.get(group.name)
            if bone and 'Hand' in group.name:
                bones[group.index] = arm.matrix_world @ bone.head_local
        if not bones:
            continue
        for v in mesh.data.vertices:
            world = mesh.matrix_world @ v.co
            hit = False
            for e in v.groups:
                where = bones.get(e.group)
                if where is None or e.weight <= 0:
                    continue
                if (world - where).length > HAND_REACH:
                    e.weight = 0.0
                    hit = True
            if not hit:
                continue
            dropped += 1
            # 残りで割り直す。全部落ちたら一番近い骨へ 1 を置く
            total = sum(e.weight for e in v.groups)
            if total > 1e-6:
                for e in v.groups:
                    e.weight /= total
            else:
                near = min(
                    ((mesh.matrix_world @ v.co - (arm.matrix_world @ b.head_local)).length, g.index)
                    for g in mesh.vertex_groups
                    for b in [arm.data.bones.get(g.name)]
                    if b
                )[1]
                for e in v.groups:
                    e.weight = 1.0 if e.group == near else 0.0
    print(f'  遠すぎる手の骨から取り上げた {dropped} 頂点')


drop_far_hands()
harden_head()
take_hair()
if BUST:
    add_bust()

"""
--- 体は透けない ---

Tripo から来た材質が**半透明扱い**になっていた (glTF の alphaMode BLEND)。
半透明は**深度を書かない**ので、三角が描かれた順に手前と奥が入れ替わり、
裏面まで透ける。画面では**顔が黒い破片に砕けて**見えた — 重みの問題に
見えるが、動かす前の素の姿勢でも出る。

体に透ける所は無いので、不透明に倒す。Alpha の繋ぎを切って 1.0 にする —
書き出しはそこを見て alphaMode を決める。
"""
opaque = 0
for mat in bpy.data.materials:
    if getattr(mat, 'blend_method', None) is not None:
        mat.blend_method = 'OPAQUE'
    tree = mat.node_tree
    if not tree:
        continue
    for node in tree.nodes:
        if node.type != 'BSDF_PRINCIPLED':
            continue
        alpha = node.inputs.get('Alpha')
        if not alpha:
            continue
        for link in list(alpha.links):
            tree.links.remove(link)
            opaque += 1
        if alpha.default_value < 1.0:
            opaque += 1
        alpha.default_value = 1.0
print(f'  材質を不透明にした ({opaque} 箇所を直した / 材質 {len(bpy.data.materials)})')

for im in bpy.data.images:
    if max(im.size) > SIDE:
        im.scale(SIDE, SIDE)
print(f'  テクスチャ {len(bpy.data.images)} 枚を {SIDE} に')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
                          export_image_format='AUTO', export_jpeg_quality=85)
print(f'  書き出した {OUT} ({os.path.getsize(OUT) / 1024 / 1024:.1f} MB)')
