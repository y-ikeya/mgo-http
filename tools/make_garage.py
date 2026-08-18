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
SLAB = 0.35        # 床の厚み
LEVELS = (0.0, LEVEL, LEVEL * 2)   # 各階の床の上面

STEP_RISE = 0.25   # collision.ts の STEP_UP と揃える
STEP_DEPTH = 0.7
STAIR_DEPTH = 0.35   # 床に開けた穴に収めるための浅い段

ARENA = 40.0
WALL_THICK = 1.0

# 建物の外形。2F と 3F でずらしてあり、はみ出した側がスロープの吹き抜けになる
BX0, BX1 = -21.0, 21.0
BY0, BY1 = -15.0, 15.0
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
for px in (-16.0, -8.0, 0.0, 8.0, 16.0):
    for py in (-12.0, -6.0, 6.0, 12.0):
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
# 出た直後に建物から抜かれないように、正面を切る
for tag, sy in (('n', 1), ('s', -1)):
    box(f'concrete_spawn_{tag}', -6.0, 6.0, sy * 27.0 - 1.0, sy * 27.0 + 1.0, 0, 1.9)
    box(f'wood_spawn_{tag}_a', 12.0, 17.0, sy * 24.0 - 1.2, sy * 24.0 + 1.2, 0, H_LOW)
    box(f'wood_spawn_{tag}_b', -17.0, -12.0, sy * 24.0 - 1.2, sy * 24.0 + 1.2, 0, 1.4)

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
