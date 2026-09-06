# stage.blend から stage.glb を書き出す。
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b tools/stage.blend --python tools/export_stage.py
#
# Blender の GUI から File → Export を辿るのと同じことを、コマンド 1 本でやる。
# 書き出しの設定 (選択物だけ / 材質も載せる) を毎回手で合わせずに済むので、
# 「書き出したつもりで設定が違っていた」という取り違えが起きない。
#
# ref_ で始まるオブジェクトは寸法の物差しなので除外する。
#
# 書き出す前に、当たり判定が扱えない形になっていないかを調べる。Blender の中では
# 何も問題なく見えるのに、ゲームに入れて初めて壊れているのが分かる、を減らす。

import bpy
import os
import math
import json

# 物差しの接頭辞。ゲームには持ち込まない
REF_PREFIX = 'ref_'

# 名前に付けられる札。これ以外の接頭辞は打ち間違いの可能性が高い
KNOWN_TAGS = ('col_', 'vis_', 'metal_', 'concrete_', 'wood_', 'glass_', 'ref_')

# 面が何を止めるか。既定は全部止めて、名前で個別に外す。
# (src/domain/stage/flags.ts と同じ規則。MGO2 が面ごとのビットで持っていたのを借りている)
FLAG_WORDS = ('nodraw', 'noplayer', 'nobullet', 'noeye', 'nocamera')


# 触れる物の名前に入る語。**これが入っていなければ飾り。**
#
# 筏を入れたときに要った。植え込みの葉が 1 枚ずつ判定を持っていて、草むらが
# 壁になっていた。名前を 2600 個付け直すより、**触れる物のほうを名指しする**
# ほうが少ない — 建物と地面は polySurface、それ以外は札で分かる。
#
# 札 (concrete_ / wood_ …) が付いていれば、この一覧に無くても触れる。
# rail は手すり。**細くて頂点が多い**ので、名前が無いと飾りの側に落ちる
# (縦の柵が弾も人も通していた)。手すりは寄りかかれる物なので触れる側に置く。
SOLID_WORDS = ('polysurface', 'stair', 'wall', 'base', 'floor', 'ground', 'rail')

def is_stair(name):
    return 'stair' in name.lower()


# 階段を何本の帯に割って上端を拾うか
STAIR_BINS = 12


def stair_plane(pts, lo, hi):
    """段を追う坂を作る。**平らさは見ない。**

    階段の天面は段ごとに水平で、高さが揃っていない。平面に乗るかを見ると必ず
    外れて、**高さ 2m の壁**になる (筏の階段が登れなかった)。飾りの多い
    モデルだと上向きの面が 2 万枚あって、そもそも「1 枚の天面」が無い。

    進む向きに帯を切って、帯ごとの一番高い所を拾い、そこへ直線を通す。
    段の角を結んだ線がそのまま歩く面になる。

    見た目は段のまま。**足だけが坂を登る** — 段差 0.25m 以下を勝手に上がる
    仕掛け (moving.ts の STEP_UP) と同じで、絵と足取りは元から一致していない。
    """
    span_x = hi[0] - lo[0]
    span_z = hi[2] - lo[2]
    axis = 0 if span_x >= span_z else 2
    span = span_x if axis == 0 else span_z
    if span < 0.5:
        return None

    # 帯ごとの上端
    tops = {}
    for x, y, z in pts:
        i = min(STAIR_BINS - 1, int((( x if axis == 0 else z) - lo[axis]) / span * STAIR_BINS))
        tops[i] = max(tops.get(i, -1e9), y)
    if len(tops) < 3:
        return None

    # 最小二乗で直線を通す
    n = len(tops)
    cs = [lo[axis] + (i + 0.5) / STAIR_BINS * span for i in tops]
    ys = list(tops.values())
    mean_c = sum(cs) / n
    mean_y = sum(ys) / n
    denom = sum((c - mean_c) ** 2 for c in cs)
    if denom < 1e-9:
        return None
    grad = sum((c - mean_c) * (y - mean_y) for c, y in zip(cs, ys)) / denom
    if abs(grad) < 0.05:
        return None

    h = mean_y + grad * (lo[axis] - mean_c)
    return {
        'h': round(h, 4),
        'dx': round(grad if axis == 0 else 0.0, 5),
        'dz': round(0.0 if axis == 0 else grad, 5),
    }


# 名前で飾りと分かる物。**細かさに関わらず素通り。**
#
# 筏の草木がこれ。pCube は元のモデルの作り手が植え込みに付けた名前で、
# 頂点の数は物によって違う (低い草は数百しか無い)。細かさだけで分けると
# 半分が壁に残る。
DECORATION_WORDS = ('pcube',)

# 飾りと見なす細かさ (頂点)。**箱は飾りにしない。**
#
# 名前だけで決めると、札を付けていない普通の壁まで素通りになる (モールの箱が
# 全部そうなった)。葉や植え込みは頂点が数千あるので、そこで分ける。
DECORATION_MIN_VERTS = 2_000


def is_decoration(obj):
    """飾りか。**触れる物の名前でも札でも無く、かつ細かい**物だけ"""
    lower = obj.name.lower()
    # **書いてある宣言が勝つ。** noplayer などを名前に書いた物を勝手に変えない
    # (モールの手すりが「弾は止める」と書いてあるのに素通りになった)
    if any(word in lower for word in FLAG_WORDS):
        return False
    if any(tag in lower for tag in KNOWN_TAGS):
        return False
    if any(word in lower for word in SOLID_WORDS):
        return False
    if any(word in lower for word in DECORATION_WORDS):
        return True
    return len(obj.data.vertices) >= DECORATION_MIN_VERTS


def flags_of(obj):
    name = obj.name
    flags = {'draw': True, 'player': True, 'bullet': True, 'eye': True, 'camera': True}
    # 飾り。**素通りできる** — vis_ を手で付けたのと同じ扱い
    if is_decoration(obj):
        flags['player'] = False
        flags['bullet'] = False
        flags['camera'] = False
        flags['eye'] = False
    # 旧: 判定だけ (見えない)。見えない物が視線を止めるのはおかしいので eye を外す
    if 'col_' in name:
        flags['draw'] = False
        flags['eye'] = False
    # 旧: 描画だけ。飾りなので人も弾もカメラも通す
    if 'vis_' in name:
        flags['player'] = False
        flags['bullet'] = False
        flags['camera'] = False
    for word in FLAG_WORDS:
        if word in name:
            flags[word[2:]] = False
    return flags


# 体の高さ (m)。src/presentation/scene/actor/player.ts の PLAYER_HEIGHT と揃える。
# くぐれる隙間かどうかの判断に使う
PLAYER_HEIGHT = 1.8

# 足を乗せられる段差 (m)。src/domain/player/moving.ts の STEP_UP
STEP_UP = 0.25


def check(objects):
    """
    当たり判定の前提を満たしているか調べる。

    判定は XZ 平面の AABB なので、回した箱は回す前の箱として扱われる。
    Blender の中では斜めの壁に見えていても、ゲームでは軸に沿った箱になる。
    この食い違いは実際に歩くまで気づけないので、書き出す前に言う。
    """
    problems = []
    for obj in objects:
        # 浮いているが、下をくぐれない高さ。
        #
        # **見た目と通れるかが食い違う。** 下が空いて見えるのに体が入らないので、
        # 「なぜかここだけ通れない」という形で出る。乗るための台なら段差
        # (STEP_UP) 以下に、くぐらせるなら体の高さ以上に離す。
        bottom = min((obj.matrix_world @ v.co).z for v in obj.data.vertices) if obj.data.vertices else 0
        if STEP_UP < bottom < PLAYER_HEIGHT:
            problems.append(
                f'{obj.name}: 下面が {bottom:.2f}m に浮いている '
                f'(隙間が体の高さ {PLAYER_HEIGHT}m に足りず、くぐれない)'
            )

        # 回転。90 度の倍数なら AABB として破綻しない
        for axis, angle in zip('XYZ', obj.rotation_euler):
            degrees = math.degrees(angle) % 90
            if min(degrees, 90 - degrees) > 0.5:
                problems.append(
                    f'{obj.name}: {axis} 軸に {math.degrees(angle):.1f}° 回っている '
                    f'(判定は回す前の箱になる)'
                )
                break

        # 潰れた箱。判定が消えるか、面が裏返る
        if min(obj.dimensions) < 0.01:
            problems.append(f'{obj.name}: 厚みが無い ({tuple(round(d, 3) for d in obj.dimensions)})')

        # 札の打ち間違い。metall_ のような名前は既定の材質になって静かにずれる
        head = obj.name.split('_')[0] + '_'
        if '_' in obj.name and head not in KNOWN_TAGS and not obj.name[0].isdigit():
            known = any(obj.name.startswith(tag) for tag in KNOWN_TAGS)
            if not known:
                problems.append(f'{obj.name}: 知らない札 "{head}" (材質は既定になる)')

    return problems

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 書き出し先は**元データの名前から決める**。
#
# 長らく stage.glb 固定で、ステージが 1 枚しか無いうちは足りていた。
# 2 枚目 (stage_training) を作った時点で、書き出すたびに前のステージを
# 潰すことになる — しかも潰れたことに気づけるのは、そのステージの部屋に
# 入った時なので遠い。
#
#     tools/stage_mall.blend  →  public/models/stage_mall.glb / .json
#
# 名前は札と同じ考え方で、**ファイル名がそのまま宣言**。どのステージが
# 乗っているかを、中身を開かずに知れる状態を保つ。
stage_name = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
glb_path = os.path.join(root, 'public', 'models', stage_name + '.glb')

# **編集モードで保存された .blend を受ける。**
#
# Blender は最後のモードごと保存する。Edit Mode のまま Ctrl+S された .blend を
# 開くと、object の操作が全部 poll() で弾かれて書き出しがそこで止まる
# (RuntimeError: context is incorrect)。作っている本人にとっては
# 「保存しただけ」なので、原因が結び付かない。
#
# こちらで Object Mode へ戻してから始める。開いているのは別プロセスなので、
# 人が触っている Blender には影響しない。
if bpy.context.view_layer.objects.active is None:
    for candidate in bpy.context.scene.objects:
        if candidate.type == 'MESH':
            bpy.context.view_layer.objects.active = candidate
            break
if bpy.context.object is not None and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')

exported = []
skipped = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    if obj.name.startswith(REF_PREFIX):
        skipped.append(obj.name)
        continue
    obj.select_set(True)
    exported.append(obj.name)

if not exported:
    raise SystemExit('書き出すメッシュが無い')

problems = check([o for o in bpy.context.scene.objects if o.select_get()])
if problems:
    print('\n--- 直したほうがよい点 ---')
    for problem in problems:
        print(f'  {problem}')
    print('')

# サーバーにも同じ形を渡す。
#
# サーバーは「見えている相手だけ配る」ために遮蔽を判定する必要があるが、
# glb を読むには glTF の解析が要る。判定に使うのは箱の位置と寸法だけなので、
# それだけを JSON に落とす。glb と同時に書くので、片方だけ古いことが起きない。
#
# Blender は Z が上、glTF は Y が上。ここで揃えておく。
import mathutils


def to_gltf(v):
    """Blender (Z が上) の座標を glTF (Y が上) へ。"""
    return (v.x, v.z, -v.y)


def gltf_bounds(obj):
    pts = [to_gltf(obj.matrix_world @ mathutils.Vector(c)) for c in obj.bound_box]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def top_plane(obj, lo, hi):
    """
    上面の傾きを測る。

    判定は「XZ の四角 + 上面の高さ」しか持てないので、平らな上面しか表せなかった。
    高さを 1 つの数ではなく**平面**にすれば、同じ形のまま坂が置ける。
    箱は傾き 0 の平面なので、これまでの形はそのまま通る。

    上を向いた面の頂点に平面を当てはめる。当てはまらない形 (球や凸凹) は
    平らな蓋として扱う — 表せないものを無理に近似すると、見た目と判定が食い違う。
    """
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()

    flat = {'h': round(hi[1], 4), 'dx': 0.0, 'dz': 0.0}

    # 上を向いた面を全部混ぜてはいけない。傾いた板は、広い面も細い側面も
    # 上を向くので、両方の頂点をまとめると 1 枚の平面に乗らなくなる。
    # 「歩く面」= 上から見た面積が最大の面を選び、それと同じ向きの面だけを使う。
    faces = []
    for poly in obj.data.polygons:
        n = (nm @ poly.normal).normalized()
        if n.z < 0.3:            # 上を向いていない面は上面ではない
            continue
        faces.append((poly.area * n.z, n, poly))
    if not faces:
        return flat

    _, main, _ = max(faces, key=lambda f: f[0])

    pts = []
    for _, n, poly in faces:
        if n.dot(main) < 0.996:   # 5 度以上ずれた面は別の面
            continue
        for i in poly.vertices:
            pts.append(to_gltf(mw @ obj.data.vertices[i].co))

    if len(pts) < 3:
        return flat

    # 最小二乗で y = A + B*x + C*z を解く (3x3 の正規方程式)
    n = len(pts)
    sx = sum(p[0] for p in pts)
    sz = sum(p[2] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts)
    szz = sum(p[2] * p[2] for p in pts)
    sxz = sum(p[0] * p[2] for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    szy = sum(p[2] * p[1] for p in pts)

    m = [[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]]
    rhs = [sy, sxy, szy]

    # ガウスの消去法。退化していたら平らとして返す
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-9:
            return flat
        m[col], m[pivot] = m[pivot], m[col]
        rhs[col], rhs[pivot] = rhs[pivot], rhs[col]
        for r in range(3):
            if r == col:
                continue
            f = m[r][col] / m[col][col]
            for c in range(col, 3):
                m[r][c] -= f * m[col][c]
            rhs[r] -= f * rhs[col]
    a, b, c = (rhs[i] / m[i][i] for i in range(3))

    # 選んだ面が本当に平らか。
    #
    # **階段だけは段のままで受ける。** 段の天面は水平で、高さが段ごとに違う。
    # 平らさを見ると必ず外れるので、坂が付かず**高さ 2m の壁**になっていた
    # (筏の階段が登れなかった)。段の真ん中を通る平面がそのまま歩く面になる
    # ので、許す幅を段 1 つぶんまで広げる。
    #
    # 見た目は段のまま。**足だけが坂を登る** — 段差 0.25m 以下を勝手に上がる
    # 仕掛け (moving.ts の STEP_UP) と同じで、絵と足取りは元から一致していない。
    # 階段は平らさを見ない。**段を追う坂**を別に作る
    if is_stair(obj.name):
        return stair_plane(pts, lo, hi) or flat

    worst = max(abs(p[1] - (a + b * p[0] + c * p[2])) for p in pts)
    if worst > 0.05:
        return flat

    # その面より上に飛び出している所が無いか。あれば「歩く面」ではない
    for v in obj.data.vertices:
        g = to_gltf(mw @ v.co)
        if g[1] - (a + b * g[0] + c * g[2]) > 0.05:
            return flat

    if abs(b) < 0.01 and abs(c) < 0.01:
        return flat

    # --- 板の厚み ---
    #
    # **坂の下は空いている。** 上面より下がどこまで詰まっているかを測る。
    #
    # 箱は上下を平らな面で切っているので、傾いた板を入れると**下が三角形に
    # 埋まる**。坂の脇にしゃがんだ相手が誰からも見えなくなっていた
    # (sim/space/vision.ts が上は切っているが、下は切っていなかった)。
    #
    # 上面から一番深い頂点までの距離をそのまま厚みにする。楔のように下まで
    # 詰まっている形なら厚み = 高さになって、今までどおり全部が塞がる。
    # **表せない形を無理に薄くしない。**
    thick = 0.0
    for v in obj.data.vertices:
        g = to_gltf(mw @ v.co)
        thick = max(thick, (a + b * g[0] + c * g[2]) - g[1])

    return {
        'h': round(a + b * lo[0] + c * lo[2], 4),   # min の角における高さ
        'dx': round(b, 5),
        'dz': round(c, 5),
        'thick': round(thick, 4),
    }


boxes = []
slopes = 0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or obj.name.startswith(REF_PREFIX):
        continue
    lo, hi = gltf_bounds(obj)
    top = top_plane(obj, lo, hi)
    if top['dx'] or top['dz']:
        slopes += 1
    boxes.append({
        'name': obj.name,
        'min': [round(v, 3) for v in lo],
        'max': [round(v, 3) for v in hi],
        'top': top,
        'flags': flags_of(obj),
    })


# --- 三角の網 -----------------------------------------------------------------
#
# **箱では見えている形と当たる形が違う。** メッシュを包む直方体を判定に使って
# いるので、斜めの手すりを包む箱は手すりの無い側の空間まで含む。手すりの上を
# 撃っているのに止められる、が起きる。
#
# 三角をそのまま吐く。読む側は木 (BVH) を組んで引く (src/sim/space/bvh.ts)。
#
# **視線を止める面だけ。** 移動の当たり判定はまだ箱なので (あちらは XZ の四角と
# 上面の高さという別の形)、ここで出すのは遮蔽と射線に使う分だけにする。
#
# 平らな配列で持つ。三角 1 枚につき 9 個 (x,y,z を 3 つ)。オブジェクトの配列に
# すると、読む側で数千個の入れ物ができる。


def triangles_of(obj):
    """そのメッシュの三角を、glTF の座標で返す。**世界の位置に置いた形。**"""
    mesh = obj.to_mesh()
    try:
        mesh.calc_loop_triangles()
        matrix = obj.matrix_world
        out = []
        for tri in mesh.loop_triangles:
            for i in tri.vertices:
                v = to_gltf(matrix @ mesh.vertices[i].co)
                out.extend((round(v[0], 3), round(v[1], 3), round(v[2], 3)))
        return out
    finally:
        obj.to_mesh_clear()


# 面ごとに何を止めるか。**視線と物で別々の木を組む**ので、印を持たせる。
#
# 物のほうは弾と同じ集合を使う。**手すりは「人は止めるが弾は通す」**設定に
# なっていて、あれを物の側に入れると三角が 8 倍になる (47 万枚)。手すりを
# 弾がすり抜けるなら、投げた物もすり抜けるほうが揃う。
#
# 人が壁で止まるのは別の話 (箱のまま)。あちらは線ではなく円柱の押し戻し。
#
# 別々のファイルに出すと、両方を止める面 (ほとんどの壁) の頂点が 2 度書かれる。
# 1 枚に印を添えて、読む側が振り分ける。
EYE_BIT = 1
BULLET_BIT = 2

positions = []
marks = []
mesh_objects = 0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or obj.name.startswith(REF_PREFIX):
        continue
    flags = flags_of(obj)
    mark = (EYE_BIT if flags['eye'] else 0) | (BULLET_BIT if flags['bullet'] else 0)
    # どちらも止めないなら出さない。飾りはここで落ちる
    if mark == 0:
        continue
    tris = triangles_of(obj)
    if not tris:
        continue
    positions.extend(tris)
    marks.extend([mark] * (len(tris) // 9))
    mesh_objects += 1

json_path = os.path.join(root, 'public', 'models', stage_name + '.json')
with open(json_path, 'w') as f:
    json.dump({'boxes': boxes}, f, ensure_ascii=False, indent=0)

# 三角は別の口へ、しかも生の数値で。
#
# **クライアントはこの json を落とす** (坂の傾きを引くため)。三角を混ぜると
# 4MB になって、遊ぶ人全員が毎回落とすことになる。
#
# 読むのはサーバーだけ。クライアントは glb のメッシュを既に持っているので、
# 木は手元の形から組める。
#
# json ではなく生の数値で書く。57000 枚で 4.3MB が 2.1MB になり、読む側は
# 解析せずに Float32Array へ載せるだけで済む。
#
#   [uint32 枚数][float32 頂点 × 枚数×9][uint8 印 × 枚数]
#
# 印は「何を止めるか」。読む側が視線用と物用に振り分けて、別々の木を組む。
import struct

bin_path = os.path.join(root, 'public', 'models', stage_name + '.mesh.bin')
with open(bin_path, 'wb') as f:
    f.write(struct.pack('<I', len(marks)))
    f.write(struct.pack('<%df' % len(positions), *positions))
    f.write(struct.pack('<%dB' % len(marks), *marks))


# --- テクスチャを伸ばさない ---------------------------------------------------
#
# **UV は scale を知らない。** 立方体を X に 10 倍伸ばしても UV は 0..1 のままなので、
# 同じ絵が 10 倍に引き伸ばされる。壁を 1 枚作って寸法だけ変える、という一番自然な
# 作り方をすると必ずこれを踏む (concrete_wall_n が scale 10 になっている)。
#
# Blender 側で「scale を適用してから展開し直す」でも直るが、**寸法を変えるたびに
# 手でやり直すことになる**。人の手順から外したいので、書き出す前に毎回やる。
#
# やっているのは**ワールド座標の立方投影**。面の向きが一番強い軸を選んで、残り
# 2 軸のメートルをそのまま UV にする。scale がいくつでも、1 タイルは必ず TEXEL
# メートルになる。
#
# --- 何に掛けるか ---
# **札を持つ物だけ** (metal_ / concrete_ / wood_)。停めてある車のような、絵を
# 持ち込んだ物は自前の UV が正しいので触らない。名前で宣言する、という他の
# 決めごとと同じ形にしてある。
import bmesh

# 1 タイルが何メートルか。小さいほど模様が細かく繰り返す
TEXEL = 2.0

# 立方投影で使う軸。添字が「一番強い法線の軸」で、中身が UV に使う 2 軸
PROJECT_AXES = ((1, 2), (0, 2), (0, 1))

# ガラスは絵を貼らないので UV を作り直す意味が無い (透けることが見た目)
SURFACE_TAGS = ('metal_', 'concrete_', 'wood_')

# **焼き込んだ絵を持っている物の札。** UV を触らない。
#
# 立方投影で貼り直せるのは**繰り返しの絵**だけ (板・金属・コンクリート)。
# 持ち込んだモデルは 1 枚の絵に焼き込んであることが多く、作り直すと崩れる。
#
# 材質の札とは別の軸なので、後置きで組み合わせる (noeye / nobullet と同じ形)。
# `wood_box_nouv` = 木の音と足音を持つが、絵は自前。
KEEP_UV = 'nouv'


def reproject(obj):
    """ワールド座標の立方投影で UV を張り直す。**scale がいくつでも伸びない**"""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    layer = bm.loops.layers.uv.verify()
    mw = obj.matrix_world
    for face in bm.faces:
        n = (mw.to_3x3() @ face.normal)
        axis = max(range(3), key=lambda i: abs(n[i]))
        u_axis, v_axis = PROJECT_AXES[axis]
        for loop in face.loops:
            world = mw @ loop.vert.co
            loop[layer].uv = (world[u_axis] / TEXEL, world[v_axis] / TEXEL)
    bm.to_mesh(mesh)
    bm.free()


reprojected = 0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or not obj.select_get():
        continue
    if not any(tag in obj.name for tag in SURFACE_TAGS):
        continue
    if KEEP_UV in obj.name:
        continue
    reproject(obj)
    reprojected += 1
print(f'  UV を張り直した: {reprojected} 個 (1 タイル = {TEXEL}m)')

# --- 形を間引く -----------------------------------------------------------
#
# **配れる大きさに収める。** 頂点 1 つがおよそ 32 バイトなので、そのまま出すと
# 筏は 688 万頂点 = 235MB になった (モールは 15 万頂点 = 9.3MB)。読み込みで
# 数分待たされるし、Pages にも載らない。
#
# 予算を決めて、**越えた分だけ**縮める。箱しか無いステージは予算に届かないので
# 素通りする — 訓練場もモールもこれまでと同じ物が出る。
#
# 細かい物だけを対象にする。板 (8 頂点) を間引くと角が落ちて、壁が壁でなくなる。
VERTEX_BUDGET = 400_000
DECIMATE_MIN_VERTS = 2_000

# **数えるのは形のデータ。置いてある数ではない。**
#
# 同じ形を 160 本置いていても、書き出しに乗る形は 1 つ。物ごとに数えていた頃は
# 共有していても「160 本ぶん重い」と読んで間引きを掛けていた。
#
# **間引きは共有を壊す。** 修飾子は物ごとに付くので、同じ形を指していても
# 書き出しの評価結果は物ごとに別になり、まとめられなくなる。共有できている物に
# 間引きを掛けると、軽くするつもりで**逆に重くなる**。
dense_data = {
    obj.data.name: obj.data
    for obj in bpy.context.scene.objects
    if obj.type == 'MESH' and obj.select_get() and len(obj.data.vertices) >= DECIMATE_MIN_VERTS
}
dense_verts = sum(len(mesh.vertices) for mesh in dense_data.values())
placed = sum(
    1 for obj in bpy.context.scene.objects
    if obj.type == 'MESH' and obj.select_get() and obj.data.name in dense_data
)
if dense_verts > VERTEX_BUDGET:
    ratio = VERTEX_BUDGET / dense_verts
    dense = [
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and obj.select_get() and obj.data.name in dense_data
    ]
    for obj in dense:
        mod = obj.modifiers.new(name='budget', type='DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
    print(f'  形を間引いた: 形 {len(dense_data)} 種類 / {dense_verts:,} 頂点 '
          f'→ 約 {VERTEX_BUDGET:,} (比 {ratio:.3f})')
else:
    print(f'  形はそのまま: 細かい形 {len(dense_data)} 種類 / {dense_verts:,} 頂点 '
          f'({placed} 個が使っている)')

# --- 絵の大きさの上限 ---
#
# **1 枚が全体を決めてしまう。** 4K の絵を 1 枚足しただけで glb が 10MB から
# 21MB へ倍になった。形の側は共有すれば 0.4MB まで落ちるので、**容量のほとんどは
# 絵**で決まる。
#
# 2048 に揃える。壁や床のように大きく映る面でも、遊ぶ距離では 2K と 4K を
# 見分けられない (人は動いているし、視界の大半は遠景)。読み込みの待ちのほうが
# 遊びに効く。
#
# 縮めるのは**書き出す時だけ**。blend の中の絵はそのままなので、原寸で作り続けて
# よいし、上限を上げれば元の細かさで出し直せる。
MAX_TEXTURE = 2048

def shrink_textures():
    seen = set()
    shrunk = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not obj.select_get():
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'TEX_IMAGE' or not node.image:
                    continue
                image = node.image
                if image.name in seen:
                    continue
                seen.add(image.name)
                w, h = image.size
                if max(w, h) <= MAX_TEXTURE:
                    continue
                scale = MAX_TEXTURE / max(w, h)
                image.scale(max(1, int(w * scale)), max(1, int(h * scale)))
                shrunk.append((image.name, w, h, image.size[0], image.size[1]))
    if shrunk:
        print(f'  絵を縮めた: {len(shrunk)} 枚 (上限 {MAX_TEXTURE})')
        for name, w, h, nw, nh in shrunk:
            print(f'    {name[:38]:40} {w}x{h} → {nw}x{nh}')
    else:
        print(f'  絵はそのまま: 上限 {MAX_TEXTURE} を超える物は無い')

shrink_textures()

# 材質は載せる。
#
# 以前は 'NONE' にして「見た目はゲーム側で付ける」ことにしていた。箱しか無かった
# 頃はそれでよかった — 名前 (metal_ / concrete_) から材質を引けば済む。
#
# **アートの入った物を置くと落ちる。** 停めてある車はテクスチャを持っていて、
# それを落とすと灰色の塊になる。クライアントは「テクスチャを持たないメッシュだけ
# 差し替える」形になっている (stage.ts) ので、載せておけば箱は今までどおり
# 名前から塗られ、車は自分の絵のまま出る。
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,      # モディファイアを確定させてから出す
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_jpeg_quality=85,
    # **頂点色も出す。** bake_stage.py が焼いた「空の見え方」がここに乗る。
    # 既定 (MATERIAL) だと材質が使っていない色は落とされるので、明示する
    export_vertex_color='ACTIVE',
    export_all_vertex_colors=False,
)

# 材質の内訳も出す。札の付け忘れは数を見ると気づける
counts = {}
for name in exported:
    tag = next((t for t in ('metal_', 'concrete_', 'wood_', 'glass_') if t in name), '(既定=金属)')
    counts[tag] = counts.get(tag, 0) + 1

print(f'\n書き出し: {glb_path}')
print(f'          {json_path} (箱 {len(boxes)} 個 / うち坂 {slopes} 個)')
eyes = sum(1 for m in marks if m & EYE_BIT)
bullets = sum(1 for m in marks if m & BULLET_BIT)
print(f'          {bin_path} (三角 {len(marks)} 枚 / {mesh_objects} メッシュ)')
print(f'          視線を止める {eyes} 枚 / 物を止める {bullets} 枚')
print(f'メッシュ {len(exported)} 個' + (f' / 物差し {len(skipped)} 個は除外' if skipped else ''))
print('材質: ' + ' / '.join(f'{k} {v}' for k, v in sorted(counts.items())))

# 属性の内訳。既定から外れている面だけ挙げる (全部止める面は数えるだけ)
special = [b for b in boxes if not all(b['flags'].values())]
print(f'属性: 全部止める {len(boxes) - len(special)} 個' +
      (f' / 個別指定 {len(special)} 個' if special else ''))
for b in special:
    off = [k for k, v in b['flags'].items() if not v]
    print(f"  {b['name']}: {' '.join(off)} を通す")
