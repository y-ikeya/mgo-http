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
# 髪を丸ごと頭の骨へ寄せるか。**垂れた房がある体では固まりすぎる**
HAIR = '--hair' in argv
# 房に骨を通して揺らせるようにするか
HAIR_BONES = '--hairbones' in argv
# 顎から上を頭の骨だけに握らせるか
HARD_HEAD = '--nohead' not in argv
argv = [a for a in argv if a not in ('--bust', '--hair', '--nohead', '--hairbones')]
SRC, OUT = argv[0], argv[1]
# 宿主 (soldier.glb) の腰の高さ。合わせる先
HOST_HIPS = float(argv[2]) if len(argv) > 2 else 1.009
# 材質を引いてくる元。Mixamo を通すと簡略化されるので、元のファイルから戻す
MATERIALS_FROM = argv[3] if len(argv) > 3 else ''
# 宿主の Armature に乗っている scale。**ここへ揃える** (fit_height.js と同じ値)
HOST_SCALE = 0.01
SIDE = int(os.environ.get('REBODY_TEXTURE', '1024'))

bpy.ops.wm.read_factory_settings(use_empty=True)
# **読み込む前に fps を立てる。** あとで変えても遅い (投擲で踏んだ穴)
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1

"""
--- .blend も読む ---

**FBX を経由しない道を残す。** 骨格が 2 つある .blend を FBX へ出すと、
メッシュと骨格の対応が壊れて Blender が読み戻せなくなる (ponyWoman.fbx で
踏んだ)。手で骨を足した体はそうなりがちなので、元のファイルを直に読む。
"""
if SRC.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=SRC)
else:
    bpy.ops.import_scene.fbx(filepath=SRC)
"""
--- 骨格が 2 つあることがある ---

手で髪の骨を足すと、**別の骨格として置かれる**ことが多い (Blender で骨を
足すと新しい Armature ができる)。mixamorig を持っているほうを体として、
もう一方の骨をそこへ移す。

移す先は `mixamorig:Head` の下。**世界での位置を保つ** — 骨格ごとに scale が
違う (体 0.01 / 手で足したほう 0.2) ので、そのまま数値を写すと桁がずれる。
"""
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
arm = next(a for a in arms if any(b.name.startswith('mixamorig') for b in a.data.bones))
spare = [a for a in arms if a is not arm]

# 体のメッシュ。**曲線や下書きは混ぜない**
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.find_armature() is arm]
if not meshes:
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

HEAD_BAND = float(os.environ.get('REBODY_BAND', '0.04'))
"""
頭の骨より**どれだけ下まで**頭として扱うか (m)。

**頭の骨は耳の高さにある。** 顎はそれより下なので、骨の高さで切ると
顎が blend に残る。頭が首より前に乗っている体では、そのぶん顎だけ
置いていかれて**顔が前へ剪断される**。顎の下まで下げて切る。
"""
HEAD_DROP = float(os.environ.get('REBODY_DROP', '0.07'))
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


def hand_rigged(mesh):
    """**手で足した骨に預けてある頂点。** ここは触らない。

    mixamorig 以外の骨 (髪の鎖など) は、作った本人が重みまで塗っている。
    こちらの手当て (顎を寄せる・遠い手の骨を外す・胸へ移す) がそれを
    上書きすると、せっかく通した骨が効かなくなる。
    """
    mine = {
        g.index
        for g in mesh.vertex_groups
        if not g.name.startswith('mixamorig') and arm.data.bones.get(g.name)
    }
    if not mine:
        return set()
    kept = {
        v.index
        for v in mesh.data.vertices
        if any(e.group in mine and e.weight > 0.01 for e in v.groups)
    }
    print(f'  手で足した骨に預けてある頂点 {len(kept)}。ここは触らない')
    return kept


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
        keep = hand_rigged(mesh)
        for v in mesh.data.vertices:
            if v.index in keep:
                continue
            height = ((mesh.matrix_world @ v.co) - foot).dot(up)
            t = (height - (head_h - HEAD_DROP - HEAD_BAND)) / HEAD_BAND
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


"""
--- 房に骨を通す ---

**垂れた髪は頭の骨では足りない。** 頭に固めると房ごと振り回されて背中へ
めり込み、元の重み (首や肩に散らばっている) のままだと房が裂ける。
房の芯に骨を通して、後から揺らす。

置き場所は目分量にしない。**房の頂点を拾って、その塊の芯に沿って並べる。**
胸の骨 (add_bust) と同じ手。
"""
HAIR_CHAIN = 3
HAIR_BONE_NAMES = tuple(f'mixamorig:Hair{i + 1}' for i in range(HAIR_CHAIN))


def hanging_hair(mesh):
    """垂れている髪の頂点。**前髪と頭皮は入れない**

    頭の骨より下で、かつ頭より後ろにあるものだけ。前髪は顔の前に垂れるので
    「後ろ」で落ちる。頭皮は「下」で落ちる。
    """
    head_at = at('mixamorig:Head')
    head_h = (head_at - foot).dot(up)
    side = at('mixamorig:LeftShoulder') - at('mixamorig:RightShoulder')
    side = (side - up * side.dot(up)).normalized()
    forward = side.cross(up).normalized()
    out = []
    for i in scalp_hair(mesh):
        world = mesh.matrix_world @ mesh.data.vertices[i].co
        if (world - foot).dot(up) >= head_h:
            continue
        if (world - head_at).dot(forward) > 0:
            continue
        out.append((i, world))
    return out


def weigh_chain(mesh, names):
    """鎖に沿って髪の重みを塗る。**骨は既に在るものを使う。**

    房の頂点を鎖へ落として、どこにいるか (0 = 結び目 / n = 先端) を出し、
    その前後の骨へ分ける。継ぎ目で切らずに渡すので、房が裂けない。
    """
    bones = [arm.data.bones.get(n) for n in names]
    if any(b is None for b in bones):
        print(f'  房の重み: 骨が見つからない ({names})')
        return
    knots = [arm.matrix_world @ bones[0].head_local]
    knots += [arm.matrix_world @ b.tail_local for b in bones]

    hair = hanging_hair(mesh)
    if len(hair) < 50:
        print(f'  房の重み: 垂れている髪が足りない ({len(hair)})')
        return

    groups = [mesh.vertex_groups.get(n) or mesh.vertex_groups.new(name=n) for n in names]
    head_group = mesh.vertex_groups.get('mixamorig:Head')
    span = len(names)

    def along(world):
        best, at_u = 1e9, 0.0
        for k in range(span):
            a, b = knots[k], knots[k + 1]
            ab = b - a
            length = ab.length_squared
            t = 0.0 if length < 1e-9 else max(0.0, min(1.0, (world - a).dot(ab) / length))
            gap = (world - (a + ab * t)).length
            if gap < best:
                best, at_u = gap, k + t
        return at_u

    for i, world in hair:
        u = along(world)
        for e in mesh.data.vertices[i].groups:
            e.weight = 0.0
        # **結び目は頭に預ける。** 骨だけにすると、頭を振ったときに付け根が裂ける
        hold = min(1.0, u * 2) if u < 0.5 else 1.0
        if head_group and hold < 1.0:
            head_group.add([i], 1.0 - hold, 'REPLACE')
        low = min(span - 1, int(u))
        frac = u - low
        groups[low].add([i], hold * (1.0 - frac), 'REPLACE')
        if low + 1 < span:
            groups[low + 1].add([i], hold * frac, 'ADD')
    print(f'  房の重み: {span} 本へ塗った ({len(hair)} 頂点)')


def add_hair_bones():
    """房に骨を通す。**手で置いた骨があるならそちらを使う。**

    置き場所は目分量にしない。房の頂点を拾って、その塊の芯に沿って並べる
    (add_bust と同じ手)。
    """
    mesh = max(meshes, key=lambda m: len(m.data.vertices))
    hair = hanging_hair(mesh)
    if len(hair) < 100:
        print(f'  房の骨: 垂れている髪が足りない ({len(hair)})')
        return

    heights = [(w - foot).dot(up) for _, w in hair]
    top, bottom = max(heights), min(heights)
    if top - bottom < 0.05:
        print('  房の骨: 垂れていない ({:.3f}m)'.format(top - bottom))
        return

    """
    **芯を出す。** 高さで区切って、その帯にある頂点の重心を結ぶ。塊全体の
    重心を 1 点取るやり方では、曲がった房が直線になる。
    """
    knots = []
    for k in range(HAIR_CHAIN + 1):
        want = top - (top - bottom) * k / HAIR_CHAIN
        band = [w for (_, w), h in zip(hair, heights) if abs(h - want) < (top - bottom) / HAIR_CHAIN / 2]
        if not band:
            band = [w for _, w in hair]
        knots.append(sum(band, mathutils.Vector()) / len(band))

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    parent = arm.data.edit_bones['mixamorig:Head']
    for k, name in enumerate(HAIR_BONE_NAMES):
        bone = arm.data.edit_bones.new(name)
        bone.head = arm.matrix_world.inverted() @ knots[k]
        bone.tail = arm.matrix_world.inverted() @ knots[k + 1]
        bone.parent = parent
        bone.use_connect = k > 0
        parent = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    weigh_chain(mesh, list(HAIR_BONE_NAMES))


def scalp_hair(mesh):
    """髪の頂点。**頭皮から、暗い頂点だけを辿る。**

    「暗ければ髪」だけで拾うと、背中の黒いベルトまで入る。髪は頭皮から房まで
    暗い頂点で繋がっているが、ベルトは間に肌や白い服を挟むので辿っても届かない。
    **地続きの一塊であること**が効く。
    """
    image = base_colour_image(mesh)
    uv = mesh.data.uv_layers.active
    if not image or not uv:
        print('  髪: 基本色か UV が無いので色で見分けられない')
        return set()

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

    near = {}
    for e in mesh.data.edges:
        a, b = e.vertices
        near.setdefault(a, []).append(b)
        near.setdefault(b, []).append(a)

    head_at = at('mixamorig:Head')
    seeds = [
        v.index
        for v in mesh.data.vertices
        if ((mesh.matrix_world @ v.co) - head_at).length < HAIR_SEED and dark(v.index)
    ]
    seen = set(seeds)
    stack = list(seeds)
    while stack:
        i = stack.pop()
        for j in near.get(i, ()):
            if j in seen or not dark(j):
                continue
            seen.add(j)
            stack.append(j)
    return seen


def take_hair():
    """髪をまるごと頭の骨へ。**垂れた房がある体には使わない** (--hair)。

    頭の骨で固めると、垂れたポニーテールが頭と一緒に振り回されて背中へ
    めり込む。房に骨を通す (--hairbones) ほうが本筋。短い髪や、房が頭に
    貼り付いている体でだけ使う。
    """
    mesh = max(meshes, key=lambda m: len(m.data.vertices))
    group = mesh.vertex_groups.get('mixamorig:Head')
    if not group:
        return
    seen = scalp_hair(mesh)
    for i in seen:
        for e in mesh.data.vertices[i].groups:
            e.weight = 0.0
        group.add([i], 1.0, 'REPLACE')
    print(f'  髪: 頭へ寄せた {len(seen)} 頂点')



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
    keep = hand_rigged(mesh)
    for name, centre in made:
        group = mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name)
        moved = 0
        for v in mesh.data.vertices:
            if v.index in keep:
                continue
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




def absorb(extra):
    """別の骨格の骨を、体の骨格へ移す。**世界での位置のまま。**"""
    moved = []
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    order = sorted(extra.data.bones, key=lambda b: len(b.parent_recursive))
    made = {}
    for b in order:
        bone = arm.data.edit_bones.new(b.name)
        bone.head = arm.matrix_world.inverted() @ (extra.matrix_world @ b.head_local)
        bone.tail = arm.matrix_world.inverted() @ (extra.matrix_world @ b.tail_local)
        bone.use_connect = False
        bone.parent = made.get(b.parent.name if b.parent else None) or arm.data.edit_bones['mixamorig:Head']
        made[b.name] = bone
        moved.append(b.name)
    bpy.ops.object.mode_set(mode='OBJECT')
    return moved


hair_chain = []
for extra in spare:
    hair_chain += absorb(extra)
    print(f'  骨格を 1 つ合流させた: {", ".join(b.name for b in extra.data.bones)}')
    bpy.data.objects.remove(extra, do_unlink=True)

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
HAND_REACH = float(os.environ.get('REBODY_HAND', '0.30'))


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
        keep = hand_rigged(mesh)
        for v in mesh.data.vertices:
            if v.index in keep:
                continue
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
if HARD_HEAD:
    harden_head()
if hair_chain:
    # **手で置いた骨を使う。** こちらで置き直さない
    weigh_chain(max(meshes, key=lambda m: len(m.data.vertices)), hair_chain)
elif HAIR_BONES:
    add_hair_bones()
if HAIR:
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
DROP_NORMAL = os.environ.get('REBODY_NONORMAL') == '1'
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
        if DROP_NORMAL:
            normal = node.inputs.get('Normal')
            for link in list(normal.links if normal else []):
                tree.links.remove(link)
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
