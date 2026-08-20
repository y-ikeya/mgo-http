# 立体駐車場のステージを作る。3 層 (地上 / 2F / 3F)。
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/make_garage.py
#   /Applications/Blender.app/Contents/MacOS/Blender -b tools/garage.blend --python tools/export_stage.py
#
# **既にある garage.blend は上書きしない** (make_stage.py と同じ約束)。
#
# --- なぜ駐車場か ---
# 階を作れるようになった (Obstacle が下面を持った) ので、それが効く形にしたい。
# 駐車場は「床が何枚も重なっていて、柱以外に遮る物が無い」構造で、階が意味を持つ
# 最小の形になる。壁で仕切った建物にすると、結局は平面の迷路が 3 つ積まっただけになる。
#
# --- 遊びの形 ---
# 遮蔽は柱だけ。柱は細いので、**止まっていれば隠れるが動けば見える**。
# 接敵前はステルス、接敵したら動かない側が有利、という形をそのまま置いている。
#
# 階の上げ下げはスロープが 1 本ずつで、**西と東に分けてある**。片方の口を抑えても
# もう片方は取れない。抑える側は 2 人要るか、抑えるのを諦めるかを選ぶことになる。
#
# 中央に吹き抜けを開けてある。階をまたいで撃てて、手榴弾も落とせる。上の階に居る
# ことが安全ではなくなる — 見下ろせる代わりに、見上げられてもいる。
#
# 座標は Blender 基準 (X 右 / Y 奥 / Z 上、単位はメートル)。

import bpy
import math
import mathutils
import os

# --- 寸法の語彙 -------------------------------------------------------------
H_LOW = 1.0        # しゃがめば隠れる。立つと上半身が出る
H_WALL = 3.2       # 外壁。越えられない

# 階の高さ。
#
# **人が入る高さでは決まらない。** 体は 1.8m なので 2.5m もあれば通れるが、
# 三人称のカメラは頭の高さから 4.2m 後ろに居る。内法が低いと、少し見上げただけで
# カメラが天井に刺さって手前へ引き寄せられ、自分の背中が画面いっぱいになる。
#
#   階高 3.2m  内法 2.85m  刺さらない仰角 18°
#   階高 4.0m  内法 3.65m  刺さらない仰角 30°
#
# 実際の駐車場より高いが、駐車場らしさより**見上げられること**を取る。
# 階をまたいで撃ち合わせたい地形なので、上を向けないと成立しない。
LEVEL = 4.0
# 床の厚み。
#
# **薄いほうが軽く見える。** 厚いと要塞のように見えて、駐車場の「柱と板だけ」という
# 感じが出ない。判定の上では厚みに意味が無い (上面と下面しか見ない) ので、
# 見た目だけで決めてよい。
#
# 階高から引いた残りが内法になるので、薄くするとその分だけ頭上が広がる
# (4.0 - 0.10 = 3.90m)。落ちる高さは床の上面どうしの差なので、ここでは変わらない。
#
# 紙のように見えないのは、縁に腰壁 (1.0m) が乗っていて、外から見える厚みが
# 1.1m になるため。**床そのものは薄くてよい。**
SLAB = 0.10
LEVELS = (0.0, LEVEL, LEVEL * 2)   # 各階の床の上面

STEP_RISE = 0.25   # collision.ts の STEP_UP と揃える
STEP_DEPTH = 0.7
STAIR_DEPTH = 0.35   # 床に開けた穴に収めるための浅い段

ARENA = 40.0
WALL_THICK = 1.0

# 建物の外形。2F と 3F でずらしてあり、はみ出した側がスロープの吹き抜けになる。
#
# **広くしてある** (42x30 → 48x40)。湧き地点を対角の角へ移したので、端から端まで
# 建物の中を斜めに横切ることになる。前の大きさだと通路が 1 本きりで、どこを
# 通っても同じ道になっていた。
BX0, BX1 = -24.0, 24.0
BY0, BY1 = -20.0, 20.0
RAMP_W = 7.0                       # スロープの幅 (吹き抜けの幅でもある)
DECK2 = (BX0 + RAMP_W, BX1)        # 2F の床の x 範囲。西がスロープで抜けている
DECK3 = (BX0, BX1 - RAMP_W)        # 3F の床の x 範囲。東が抜けている

# 中央の吹き抜け。階をまたいで撃てる穴
WELL = (-3.5, 3.5, -4.5, 4.5)

objects = []


def box(name, x0, x1, y0, y1, z0, z1):
    """角を 2 つ指定して箱を置く。中心と大きさより、範囲のほうが図面と照らしやすい"""
    bpy.ops.mesh.primitive_cube_add(
        size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    objects.append(obj)
    return obj


def wedge(name, x0, x1, y0, y1, z_base, z_at_y0, z_at_y1):
    """
    上面が y 方向に傾いた箱 = スロープ。

    **x0 < x1 / y0 < y1 のまま渡すこと。** 入れ替えると面が裏返り、書き出しが
    上面を見つけられずに平らな蓋として扱う (坂のつもりの物が壁になる)。
    どちらへ上るかは z_at_y0 と z_at_y1 の大小で決める。

    書き出しは**上を向いた面に平面を当てはめて**傾きを測る (export_stage.py の
    top_plane) ので、上面が 1 枚の平らな四角であればそのまま坂として通る。

    低いほうにも厚みを残す。0 にすると面が潰れて、書き出しの検査に引っかかる。
    """
    verts = [
        (x0, y0, z_base), (x1, y0, z_base), (x1, y1, z_base), (x0, y1, z_base),
        (x0, y0, z_at_y0), (x1, y0, z_at_y0), (x1, y1, z_at_y1), (x0, y1, z_at_y1),
    ]
    faces = [
        (3, 2, 1, 0),   # 底
        (4, 5, 6, 7),   # 上 (傾いている)
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    objects.append(obj)
    return obj


def subtract(rects, hole):
    """
    四角の一覧から穴を抜く。軸に沿った短冊に割るだけ。

    床に穴を開けるのに要る。判定は軸に沿った箱しか持てないので、
    穴のある床は**穴を囲む短冊の集まり**として置くことになる。
    """
    hx0, hx1, hy0, hy1 = hole
    out = []
    for x0, x1, y0, y1 in rects:
        if hx1 <= x0 or hx0 >= x1 or hy1 <= y0 or hy0 >= y1:
            out.append((x0, x1, y0, y1))
            continue
        cx0, cx1 = max(x0, hx0), min(x1, hx1)
        cy0, cy1 = max(y0, hy0), min(y1, hy1)
        if y0 < cy0:
            out.append((x0, x1, y0, cy0))
        if cy1 < y1:
            out.append((x0, x1, cy1, y1))
        if x0 < cx0:
            out.append((x0, cx0, cy0, cy1))
        if cx1 < x1:
            out.append((cx1, x1, cy0, cy1))
    return out


def deck(name, parts, top, holes):
    """床。四角をいくつか足し合わせ、穴の分を短冊に割って置く"""
    rects = list(parts)
    for hole in holes:
        rects = subtract(rects, hole)
    for i, (rx0, rx1, ry0, ry1) in enumerate(rects):
        box(f'concrete_{name}_{i:02d}', rx0, rx1, ry0, ry1, top - SLAB, top)
    return rects


def parapet(name, rects, top, open_edges=()):
    """
    床の縁の腰壁。しゃがめば隠れて、立てば撃てる高さ。

    **建物の外形に接している辺だけ**に置く。床の形は短冊の集まりなので、
    短冊ごとに四辺を囲うと建物の中に壁が生えてしまう。

    **囲い切らない。** open_edges で開けた辺は、下の階から撃ち上げられる。
    上に居ることを安全にしすぎない。
    """
    t = 0.35
    outline = {'w': BX0, 'e': BX1, 's': BY0, 'n': BY1}
    for i, (x0, x1, y0, y1) in enumerate(rects):
        for tag, value in outline.items():
            if tag in open_edges:
                continue
            if tag == 'w' and abs(x0 - value) < 1e-6:
                box(f'concrete_{name}_{i:02d}w', x0, x0 + t, y0, y1, top, top + H_LOW)
            elif tag == 'e' and abs(x1 - value) < 1e-6:
                box(f'concrete_{name}_{i:02d}e', x1 - t, x1, y0, y1, top, top + H_LOW)
            elif tag == 's' and abs(y0 - value) < 1e-6:
                box(f'concrete_{name}_{i:02d}s', x0, x1, y0, y0 + t, top, top + H_LOW)
            elif tag == 'n' and abs(y1 - value) < 1e-6:
                box(f'concrete_{name}_{i:02d}n', x0, x1, y1 - t, y1, top, top + H_LOW)


def load_car(path, key):
    """
    車のモデルを 1 台読み込んで、複製の元にする。

    tools/convert_car.py が実寸・接地・前後を Y に揃えた glb を作る。ここでやるのは
    **glTF の読み込みが付ける親を外して姿勢を焼く**ことだけ — 焼いておかないと、
    複製して回したときにローカルとワールドで軸が入れ替わる。
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    added = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not added:
        raise SystemExit(f'{path} にメッシュが無い')
    bpy.ops.object.select_all(action='DESELECT')
    for o in added:
        o.select_set(True)
    bpy.context.view_layer.objects.active = added[0]
    if len(added) > 1:
        bpy.ops.object.join()
    car = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # **ref_ を付けて書き出しから外す** (export_stage.py の約束)。
    # 元は複製の型紙で、ゲームの中に転がっていても邪魔なだけ
    car.name = f'ref_car_{key}'
    for empty in [o for o in bpy.data.objects if o not in before and o.type == 'EMPTY']:
        bpy.data.objects.remove(empty, do_unlink=True)
    return car


def footprint(obj, matrix=None):
    """
    その物が占める軸に沿った箱。

    **行列を自分で渡せる。** 置いた直後の obj.matrix_world は depsgraph が
    更新されるまで古いままで、回したはずの向きが footprint に出ない
    (90 度回した車が回っていない箱として検査を通った)。呼ぶ側が組んだ行列を
    使えば、更新の順番に左右されない。
    """
    m = matrix if matrix is not None else obj.matrix_world
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for corner in obj.bound_box:
        w = m @ mathutils.Vector(corner)
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    return lo, hi


def car(key, x, y, base, spin=0):
    """
    車を 1 台置く。spin は 90 度単位 (判定が軸に沿った箱しか持てないため)。

    **置いた先が空いているかを調べる。** 柱や腰壁に食い込んだ車は、Blender の中では
    それらしく見えるのに、遊ぶと通れない壁になる。歩いて気づく類なので、
    書き出す前ではなく**組み立てる時点**で落とす。
    """
    if spin % 90 != 0:
        raise SystemExit(f'車の向きは 90 度単位: {spin}')
    template = CARS[key]
    dup = template.copy()
    dup.data = template.data
    dup.name = f'metal_car_{key}_{len(objects):02d}'
    matrix = (mathutils.Matrix.Translation((x, y, base))
              @ mathutils.Matrix.Rotation(math.radians(spin), 4, 'Z'))
    dup.matrix_world = matrix
    bpy.context.collection.objects.link(dup)

    lo, hi = footprint(dup, matrix)
    for other in objects:
        olo, ohi = footprint(other)
        # 乗っている床は除く。上面が車の足元と同じ高さなら、それは床
        if ohi[2] <= base + 1e-3:
            continue
        if olo[2] >= hi[2] - 1e-3:
            continue
        if ohi[0] <= lo[0] or olo[0] >= hi[0]:
            continue
        if ohi[1] <= lo[1] or olo[1] >= hi[1]:
            continue
        raise SystemExit(
            f'{dup.name} が {other.name} と重なっている '
            f'(車 x {lo[0]:.1f}..{hi[0]:.1f} y {lo[1]:.1f}..{hi[1]:.1f})')
    objects.append(dup)
    return dup


def stairs(name, x0, x1, y_from, base, height, facing):
    """
    階段。1 段ずつ別の箱にする (判定は上面の高さしか見ないため)。

    段は浅い (0.35m)。**床に開けた穴の中に収めるため** — 駐車場のスロープの
    ように長く取ると、穴が広くなって床が短冊だらけになる。1 段の高さは
    STEP_RISE のままなので、歩いて上れることは変わらない。

    facing は登る向き。'+y' なら y の大きいほうへ登る。
    """
    steps = max(1, round(height / STEP_RISE))
    for i in range(steps):
        h = base + STEP_RISE * (i + 1)
        o = STAIR_DEPTH * i
        if facing == '+y':
            box(f'{name}_{i:02d}', x0, x1, y_from + o, y_from + o + STAIR_DEPTH, base, h)
        else:
            box(f'{name}_{i:02d}', x0, x1, y_from - o - STAIR_DEPTH, y_from - o, base, h)


def stair_run(height):
    """その高さを上るのに要る奥行き (m)"""
    return max(1, round(height / STEP_RISE)) * STAIR_DEPTH


# --- 初期化 -----------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'METERS'

# --- 外周の壁 ---------------------------------------------------------------
box('concrete_wall_e', ARENA, ARENA + WALL_THICK, -ARENA, ARENA, 0, H_WALL)
box('concrete_wall_w', -ARENA - WALL_THICK, -ARENA, -ARENA, ARENA, 0, H_WALL)
box('concrete_wall_n', -ARENA, ARENA, ARENA, ARENA + WALL_THICK, 0, H_WALL)
box('concrete_wall_s', -ARENA, ARENA, -ARENA - WALL_THICK, -ARENA, 0, H_WALL)

# --- 床 ---------------------------------------------------------------------
# 2F は西が、3F は東が抜けている。抜けた所がスロープの吹き抜けになる。
#
# **上り切った先に降り口を足す。** スロープは床の横に付いているので、それだけだと
# 上り切った所で進行方向に床が無く、勢いのまま落ちる。スロープの高いほうの端に
# 床を伸ばして、走り抜けたらそのまま床に乗る形にする。
RAMP_Y = 7.0

# 階段の吹き抜け。**スロープとは反対側の端に置く** — 上がる手が 1 つしかないと、
# その口を抑えるだけで階が閉じる。狭いので撃ち合いには向かないが、速い。
STAIR_X = (4.0, 9.0)

# 踏み板の手前に立つ場所 (m)。
#
# **腰壁のぶんを空ける。** 段を建物の縁ちょうどから始めると、そこに立っている
# 腰壁に食い込んで、下り口に立てない = 上れない。体の直径 (0.7m) より広く取る。
STAIR_LANDING = 1.2

STAIR2 = (STAIR_X[0], STAIR_X[1], BY1 - stair_run(LEVEL) - STAIR_LANDING, BY1)   # 地上 → 2F
STAIR3 = (STAIR_X[0], STAIR_X[1], BY0, BY0 + stair_run(LEVEL) + STAIR_LANDING)   # 2F → 3F

deck2_rects = deck('deck2', [
    (DECK2[0], DECK2[1], BY0, BY1),
    (BX0, DECK2[0], RAMP_Y, BY1),          # 西スロープの降り口
], LEVELS[1], [WELL, STAIR2])
deck3_rects = deck('deck3', [
    (DECK3[0], DECK3[1], BY0, BY1),
    (DECK3[1], BX1, BY0, -RAMP_Y),         # 東スロープの降り口
], LEVELS[2], [WELL, STAIR3])

# --- スロープ ---------------------------------------------------------------
# 上がる口を**西と東に分けてある**。片方を抑えてももう片方は取れない。
#
# 傾きは 3.2m を 14m で上る (約 13 度)。走って上がれて、上っている最中は
# 姿勢が高くなって遠くから見える。上下の移動に代償を持たせる。
# 上る向きも逆にしてある。二つの階を上がるのに、建物を端から端まで往復させる
wedge('concrete_ramp_up2', BX0, BX0 + RAMP_W, -7.0, 7.0, 0.0, 0.15, LEVELS[1])
wedge('concrete_ramp_up3', BX1 - RAMP_W, BX1, -7.0, 7.0, LEVELS[1],
      LEVELS[2], LEVELS[1] + 0.15)

# スロープの脇の壁。落ちないためではなく、**上っている最中の横から守るため**。
#
# **低いほうの半分にしか置かない。** 全長に置くと、上り切った所で床へ乗り移れない
# (スロープと床は x 方向に隣り合っていて、壁がそこに立つ)。
# 上り切る手前で壁が切れるので、守られるのは上りはじめだけになる — 高い所ほど
# 無防備、という形になってちょうどいい。
box('concrete_ramp_up2_side', BX0 + RAMP_W - 0.35, BX0 + RAMP_W, -7.0, 1.0, 0, LEVELS[1] + H_LOW)
box('concrete_ramp_up3_side', BX1 - RAMP_W, BX1 - RAMP_W + 0.35, -1.0, 7.0,
    LEVELS[1], LEVELS[2] + H_LOW)

# --- 階段 -------------------------------------------------------------------
# 床に開けた穴の中を上る。
#
# **建物の内側へ向かって上る。** 外へ向けて上ると、上り切った所が建物の縁で、
# その先に床が無い (走り抜けてそのまま落ちる)。内向きなら、上り切った所が
# 穴の内側の縁 = 床の始まりになる。
stairs('metal_stair_up2', STAIR_X[0], STAIR_X[1], BY1 - STAIR_LANDING, 0.0, LEVEL, '-y')
stairs('metal_stair_up3', STAIR_X[0], STAIR_X[1], BY0 + STAIR_LANDING, LEVELS[1], LEVEL, '+y')

# --- 柱 ---------------------------------------------------------------------
# **遮蔽はこれだけ。** 細いので、止まっていれば隠れるが動けば見える。
# 3F の上へ 1.1m 突き出して、屋上でも身を隠せるようにする。
PILLAR = 0.9
for px in (-19.0, -11.0, -3.0, 5.0, 13.0, 21.0):
    for py in (-16.0, -9.0, 9.0, 16.0):
        # 吹き抜けや階段室の中には立てない
        if any(hx0 < px < hx1 and hy0 < py < hy1
               for hx0, hx1, hy0, hy1 in (WELL, STAIR2, STAIR3)):
            continue
        box(f'concrete_pillar_{px:+.0f}_{py:+.0f}'.replace('.', ''),
            px - PILLAR / 2, px + PILLAR / 2, py - PILLAR / 2, py + PILLAR / 2,
            0, LEVELS[2] + 1.1)

# --- 腰壁 -------------------------------------------------------------------
# 東西は開けたまま。撃ち上げられる辺を残しておく
parapet('rail2', deck2_rects, LEVELS[1], open_edges=('w',))
parapet('rail3', deck3_rects, LEVELS[2], open_edges=('e',))
# 吹き抜けの縁。落ちるのを防ぐのではなく、縁に貼り付いて下を狙えるようにする
for top in (LEVELS[1], LEVELS[2]):
    box(f'metal_well_s_{top:.0f}', WELL[0], WELL[1], WELL[2] - 0.3, WELL[2], top, top + H_LOW)
    box(f'metal_well_n_{top:.0f}', WELL[0], WELL[1], WELL[3], WELL[3] + 0.3, top, top + H_LOW)

# --- 停めてある車 -----------------------------------------------------------
# **駐車場なのだから車が要る。** それだけではなく、遮蔽としても効く —
# 高さ 1.2m ほどなので、しゃがめば隠れて立つと上半身が出る。柱 (完全に隠れる) と
# 腰壁 (縁にしか無い) の間を埋める。
#
# 向きは 90 度単位。判定が軸に沿った箱しか持てないので、斜め driving はできない。
# 置いた先が空いているかは car() が調べる。
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARS = {
    'rusty': load_car(os.path.join(root_dir, 'tools', 'props', 'car_rusty.glb'), 'rusty'),
    'small': load_car(os.path.join(root_dir, 'tools', 'props', 'car_small.glb'), 'small'),
}

# 地上。**柱の間の車路に沿って停める。** 柱は 8m 間隔なので、その中間の
# 通り (x = -15 / -7 / 1 / 9 / 17) が車路になる。y は柱の列 (±9, ±16) の間
car('rusty', -15.0, -12.5, LEVELS[0])
car('small', -15.0, 12.5, LEVELS[0])
car('small', 1.0, -12.5, LEVELS[0], spin=180)
car('rusty', 17.0, 12.5, LEVELS[0])

# 2F。吹き抜けの脇に寄せて、縁に貼り付いた相手の後ろを取れる形にする
car('small', -7.0, -12.5, LEVELS[1])
car('rusty', -7.0, 12.5, LEVELS[1], spin=180)
car('small', 17.0, -12.5, LEVELS[1])
car('rusty', 1.0, 12.5, LEVELS[1])

# 3F (屋上)。数を減らす。見晴らしを潰すと上へ行く意味が消える
car('small', -15.0, 12.5, LEVELS[2])
car('rusty', -7.0, -12.5, LEVELS[2], spin=180)

# --- 地上の遮蔽 -------------------------------------------------------------
# 柱だけだと地上が広すぎる。駐車場らしく、低い塊を散らす
for i, (cx, cy, w, d, h) in enumerate([
    (-12.0, 2.0, 4.5, 2.2, H_LOW),
    (5.0, -9.0, 5.0, 2.2, H_LOW),
    (13.0, 4.0, 2.2, 4.5, 1.4),
    (-5.0, -13.0, 4.5, 2.2, 1.4),
    (18.0, -6.0, 2.2, 4.0, H_LOW),
]):
    box(f'metal_ground_cover_{i}', cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, 0, h)

# --- 湧き地点の遮蔽 ---------------------------------------------------------
# 湧き地点は**対角の角**。建物の中を斜めに横切る形にしてある。
#
# 遮蔽は L 字に 2 枚。角に湧くと 2 方向から抜かれるので、正面を 1 枚切るだけでは
# 足りない (辺の中央に湧いていた頃は 1 枚で済んでいた)。
#
# 中心から 6m。基地の枠 (stage.ts の BASE_HALF = 2m) より外で、出るときに
# 回り込む距離が残る位置。
SPAWN_C = 30.0      # 湧き地点の中心 (角から 10m 内側)
SPAWN_OFF = 6.0     # 遮蔽までの距離
for tag, sx, sy in (('sw', -1, -1), ('ne', 1, 1)):
    cx, cy = sx * SPAWN_C, sy * SPAWN_C
    wall_x = cx - sx * SPAWN_OFF
    wall_y = cy - sy * SPAWN_OFF
    ax = sorted((wall_x - 0.5, wall_x + 0.5))
    ay = sorted((cy + sy * 6.0, cy - sy * 8.0))
    box(f'concrete_spawn_{tag}_a', ax[0], ax[1], ay[0], ay[1], 0, 1.9)
    bx = sorted((cx + sx * 6.0, cx - sx * 8.0))
    by = sorted((wall_y - 0.5, wall_y + 0.5))
    box(f'concrete_spawn_{tag}_b', bx[0], bx[1], by[0], by[1], 0, 1.9)
    # 低い遮蔽。出た先で伏せる場所を 1 つ置く
    cover_x = sorted((cx - sx * 11.0, cx - sx * 15.0))
    cover_y = sorted((cy - sy * 3.0, cy - sy * 5.2))
    box(f'wood_spawn_{tag}_c', cover_x[0], cover_x[1], cover_y[0], cover_y[1], 0, H_LOW)

# --- 寸法の物差し -----------------------------------------------------------
for name, height, x in (('ref_stand', 1.80, 34.0), ('ref_crouch', 0.94, 35.5)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 36.0, height / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (0.25, 0.25, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# --- 書き出し ---------------------------------------------------------------
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
blend_path = os.path.join(root, 'tools', 'garage.blend')

if os.path.exists(blend_path):
    raise SystemExit(
        f'{blend_path} が既にある。作り直すと今の編集が消える。\n'
        '消してよければ自分で消してから走らせること。')

bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f'書いた {blend_path} (メッシュ {len(objects)} 個)')
print('  次: Blender -b tools/garage.blend --python tools/export_stage.py')
