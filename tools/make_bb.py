# BB (MGO2 の Blood Bath) の叩き台を、下絵 tools/raw/bb_map.jpg から白紙で起こす。
#
#   $BLENDER -b --factory-startup --python tools/make_bb.py
#   $BLENDER -b tools/raw/stage_bb.blend --python tools/export_stage.py -- --bake
#
# 書き出すのは tools/raw/stage_bb.blend。**叩き台なので、本人が Blender で育て始めたら流し直さない**
# (流すと上書きする)。
#
# 縮尺: 本家の MAP SIZE は 70 × 70、高さ 15 (wiki。UU は 85 × 75 で、こちらの UU の外壁 約 77 × 81 と
# ほぼ 1 対 1)。下絵の外壁の内側 250 画素 → 70m で 1 画素 0.28m。
#
# 階 (本人 2026-11-05「地下1F, 1F, 2F部分の回路」「真ん中に四角の塔、中には入れないが 2F のベランダには行ける」):
#   いちばん明るい帯 = 2F の通路と塔のベランダ、それ以外 = 1F、真ん中の暗い四角 = 塔。
#   **地下はまだ入れていない。** 下絵で少し薄い所が地下だが読み分けられないので、本人が地下だけの
#   絵を別に作る (同日)。地下へ降りる階段も、場所の印 (ref_) だけ
#   床の上面  地下 2F 5.0 / 地下 1F 8.3 / 1F 11.3 / 2F 14.9。塔の上 23.3 (全体を LIFT 11.2m 持ち上げてある)
#
#   地下 2F (本人の絵 tools/raw/bb_map_B2F.png、下絵と同じ枠): A2 の階段 (北西) から塔の真下を南北に抜けて
#   A1 の階段 (南東) へ出る 1 本の通路。1F の地面をこの深さまで厚くして、通路の形にくり抜く。
#   2 つの階段の所は 1F まで吹き抜け (1F の下絵にも階段が描いてある)
#
#   地下 1F (本人の絵 tools/raw/bb_map_B1B2.png、白の線。赤は地下 2F): 北 (北の張り出しから北の通路の下まで) と
#   南西 (南の張り出しまで) の 2 区画。どちらも 1F から階段で下りる。**地下 2F へは崖を落ちる** —
#   白と赤の線がぶつかる所 (本人「2F から 1F には上がれない、崖を落ちる」。地下の 2F → 1F の意味)。
#   崖の所は地下 2F の通路の天井を地下 1F の天井まで上げて、地下 1F の床の縁から落ちられるようにする
#   外の張り出し (北と南) は外壁の外。地面の箱をそこまで広げる
#
#   小さな暗い四角 5 つ = 2F を支える太い柱 (本人。初めは City の錆びた鉄塔と言っていた)
#   三角の印 = 高さ 2m くらいの石の障害物 (本人)
#
# 決めきれていない物 (本人に確かめる):
#   - 2F の通路の下は通れる (板を柱で支える) と置いた。下が塞がった塀なら箱を伸ばす
#   - 北と南の通路の先 (塔のベランダの手前 2.8m) は切れたままにした
#   - 階段のうち、どちらへ上るか下絵で決めきれない物は形を作らず、ref_ の板 (書き出されない) で場所だけ残す
#
# 座標は下絵を 3 倍に引き伸ばした 960 画素の上で読んだ (x 右、y 下)。Blender は X 右 / Y 奥 / Z 上
import bpy
import bmesh
import math
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'tools', 'raw', 'stage_bb.blend')

# 0.28 (本家の 70m) では広かった。横だけ 0.8 倍 (2026-11-05 本人「xy のスケールがでかい、0.8 倍くらい」)。
# 高さと、人の大きさで決まる物 (段・壁の厚み・石・箱・柱・手すり) は m で持つので変わらない
M_PER_PX = 0.224
CX, CY = 160.7, 153.8          # 外壁の内側の真ん中 (下絵の画素)
# **全体を持ち上げて、地下 2F の床を Blender の 5m に置く** (2026-11-05 本人)。ゲームは地面を高さ 0 から測り
# (sim の groundHeight・投げた物の床・コード側の仮の地面)、0 より下へは行けない。持ち上げておけば手を入れずに済み、
# 地下をもっと深くしたくなった時の余裕 (地面の箱の下端 4.5m まで) も残る
LIFT = 11.2
B2, B1, F1, F2 = (z + LIFT for z in (-6.2, -2.9, 0.1, 3.7))    # 床の上面
B2_CEIL = -3.4 + LIFT                 # 地下 2F の天井 (地下 1F の床の下)
B1_CEIL = -0.3 + LIFT                 # 地下 1F の天井 (1F の床の下)
GROUND_TOP = F1
TOWER_TOP = 12.1 + LIFT
WALL_TOP = 7.1 + LIFT                 # 外壁の上
SLAB = 0.2                     # 2F の床の厚み。階段の段の板と同じ (0.4 は厚かった、2026-11-05 本人)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# 屋内 (空の見えない所) の一番暗い明るさ。焼き込み (bake_stage.py) が読む。ゲーム側の skylight.ts の
# STAGE_SKY_FLOOR と揃える。地下が真っ暗だった (2026-11-05 本人「もっと明るくていい」)
scene['sky_floor'] = 0.25


def P(px, py):
    """960 画素の下絵の点 → Blender の (x, y)"""
    return ((px / 3 - CX) * M_PER_PX, -(py / 3 - CY) * M_PER_PX)


def box(name, x0, y0, x1, y1, z0, z1):
    """軸に沿った箱。x0..y1 は 960 画素の下絵の矩形、z は m"""
    (ax, ay), (bx, by) = P(x0, y0), P(x1, y1)
    lo = (min(ax, bx), min(ay, by), z0)
    hi = (max(ax, bx), max(ay, by), z1)
    return box_m(name, lo, hi)


def box_m(name, lo, hi):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = lo[0] if v.co.x < 0 else hi[0]
        v.co.y = lo[1] if v.co.y < 0 else hi[1]
        v.co.z = lo[2] if v.co.z < 0 else hi[2]
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def empty(name, px, py, z):
    x, y = P(px, py)
    o = bpy.data.objects.new(name, None)
    o.location = (x, y, z)
    scene.collection.objects.link(o)
    return o


STEP = 0.15
TREAD = 0.2      # 下に入れる階段の段の板の厚み


def stairs(name, x0, y0, x1, y1, z_from, z_to, axis, toward, open_under=False):
    """段の箱を並べた階段。axis = 'x' か 'y' (下絵の向き)、toward = +1 で座標の増える向きへ上る。
    open_under: 段の板 (厚み TREAD) だけを並べ、下に入れるようにする (1F ⇔ 2F の階段、本人「階段下は入れる」)"""
    (ax, ay), (bx, by) = P(x0, y0), P(x1, y1)
    lo_x, hi_x, lo_y, hi_y = min(ax, bx), max(ax, bx), min(ay, by), max(ay, by)
    # 下る階段は、上る階段を逆から組む (段の箱は低い方から順に重ねる)
    if z_to < z_from:
        z_from, z_to, toward = z_to, z_from, -toward
    rise = z_to - z_from
    # 段の高さ 0.15m (0.25 では粗かった、2026-11-05 本人「階段の段をもっと細かく」)
    n = max(2, round(abs(rise) / STEP))
    step = rise / n
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    # 下絵の y は Blender の -y。axis='y' で下絵の下へ上る (toward=+1) = Blender の -y へ上る
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        top = z_from + step * (i + 1)
        if open_under:
            # その段の踏み面だけ
            if axis == 'x':
                s0, s1 = (t0, t1) if toward > 0 else (1 - t1, 1 - t0)
            else:
                s0, s1 = (1 - t1, 1 - t0) if toward > 0 else (t0, t1)
            if axis == 'x':
                xa, xb = lo_x + (hi_x - lo_x) * s0, lo_x + (hi_x - lo_x) * s1
                ya, yb = lo_y, hi_y
            else:
                xa, xb = lo_x, hi_x
                ya, yb = lo_y + (hi_y - lo_y) * s0, lo_y + (hi_y - lo_y) * s1
        elif axis == 'x':
            s0, s1 = (t0, 1.0) if toward > 0 else (0.0, 1 - t0)
            xa, xb = lo_x + (hi_x - lo_x) * s0, lo_x + (hi_x - lo_x) * s1
            ya, yb = lo_y, hi_y
        else:
            s0, s1 = (0.0, 1 - t0) if toward > 0 else (t0, 1.0)
            xa, xb = lo_x, hi_x
            ya, yb = lo_y + (hi_y - lo_y) * s0, lo_y + (hi_y - lo_y) * s1
        bot = top - TREAD if open_under else min(z_from, z_to) - 0.05
        geom = bmesh.ops.create_cube(bm, size=1.0)['verts']
        for v in geom:
            v.co.x = xa if v.co.x < 0 else xb
            v.co.y = ya if v.co.y < 0 else yb
            v.co.z = bot if v.co.z < 0 else top
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


# --- 地面 (1F) と地下 2F ----------------------------------------------------------------
# 地面は地下 2F の床の下まで 1 つの厚い箱。地下 2F の通路と階段の吹き抜けをくり抜く。
# 地下 1F は本人の絵を待つ (入れる時はこの厚みからくり抜く)
OUTER = (107, 88, 857, 835)
ground = box('concrete_ground_1F', OUTER[0], 30, OUTER[2], 925, B2 - 0.5, F1)

# 地下 2F の通路の輪郭 (960 画素、本人の絵をなぞった)
B2_OUTLINE = [
    (110, 143), (110, 312), (237, 312), (290, 284), (352, 284), (408, 312), (460, 312), (460, 325),
    (428, 352), (428, 378), (457, 403), (457, 550), (428, 568), (428, 595), (457, 612), (457, 640),
    (377, 640), (377, 695), (457, 695), (457, 750), (540, 750), (540, 695), (612, 695), (612, 785),
    (770, 785), (770, 737), (662, 737), (662, 640), (543, 640), (543, 567), (578, 540), (578, 522),
    (543, 497), (543, 458), (578, 430), (578, 412), (543, 388), (543, 316), (650, 316), (650, 257),
    (522, 257), (522, 200), (460, 200), (460, 255), (408, 255), (352, 227), (290, 227), (237, 255),
    (160, 255), (160, 143),
]
# 地下 1F の輪郭 (白の線をなぞった)
B1_OUTLINES = {
    'n': [(405, 238), (405, 110), (432, 110), (432, 90), (530, 92), (530, 38), (750, 38), (750, 202),
          (648, 202), (648, 257), (600, 257), (600, 202), (530, 202), (530, 145), (457, 145), (457, 238)],
    'sw': [(162, 640), (333, 640), (333, 750), (377, 750), (377, 695), (415, 695), (415, 750), (457, 750),
           (540, 750), (540, 793), (418, 793), (418, 915), (210, 915), (210, 750), (277, 750), (277, 690),
           (162, 690)],
}
# 地下 1F の中の柱 (南西の部屋の真ん中の四角)
B1_COLUMNS = [(265, 803, 357, 860)]
# 1F の床から地下 2F まで縦に抜ける穴 (本人の絵の赤く塗った四角)。落ちれば地下 2F へ直に行け、手榴弾も投げ込める
HOLES = [(438, 252, 495, 309), (495, 639, 555, 696)]
# 崖: 地下 2F の側で、天井を地下 1F の天井まで上げる帯 (白と赤がぶつかる辺から、地下 2F の通路の幅ぶん)
CLIFFS = [
    (600, 257, 648, 316),   # 北の部屋の東寄り → 地下 2F の東の腕
    (377, 640, 415, 695),   # 南西 → 地下 2F の西の出っ張り
    (457, 695, 540, 750),   # 南西 → 地下 2F の南の端
]
# 階段の吹き抜け (1F まで開ける) と、階段の向き
B2_STAIRS = [
    # A2: 北の端 (y 143) が 1F、南へ下りる
    ('concrete_stair_b2_a2', (110, 143, 160, 255), 'y', +1, B2),
    # A1: 東の端 (x 770) が 1F、西へ下りる
    ('concrete_stair_b2_a1', (662, 737, 770, 785), 'x', -1, B2),
    # 南西の地下 1F: 西の端 (x 162) が 1F、東へ下りる
    ('concrete_stair_b1_sw', (162, 640, 277, 690), 'x', +1, B1),
    # 北の地下 1F: 東の端 (x 685) が 1F、西へ下りる。下りた先は階段の周りを回る通路
    ('concrete_stair_b1_n', (583, 85, 685, 145), 'x', -1, B1),
]


def prism(name, outline, z0, z1):
    """輪郭 (960 画素) を z0〜z1 に押し出した、閉じた柱 (底・上・側)。底が開いていると引き算が効かない"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    lo = [bm.verts.new((*P(px, py), z0)) for px, py in outline]
    hi = [bm.verts.new((*P(px, py), z1)) for px, py in outline]
    bm.faces.new(lo)
    bm.faces.new(hi)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def carve(target, cutter):
    mod = target.modifiers.new('carve', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


carve(ground, prism('tmp_b2', B2_OUTLINE, B2, B2_CEIL))
for k, outline in B1_OUTLINES.items():
    carve(ground, prism('tmp_b1_' + k, outline, B1, B1_CEIL))
for i, r in enumerate(CLIFFS):
    carve(ground, box(f'tmp_cliff_{i}', *r, B2, B1_CEIL))
for i, r in enumerate(HOLES):
    carve(ground, box(f'tmp_hole_{i}', *r, B2, F1 + 0.5))
for name, (x0, y0, x1, y1), axis, toward, bottom in B2_STAIRS:
    carve(ground, box('tmp_' + name, x0, y0, x1, y1, bottom, F1 + 0.5))
    stairs(name, x0, y0, x1, y1, F1, bottom, axis, toward)
# 1F から地下へ下りる階段は、下り口の他の 3 方を高さ 1.8m の壁で囲う (2026-11-05 本人)。
# 下り口は 1F の高さの端 (向き toward の逆の端)
RAIL_H = 1.8
RW = 0.3 / M_PER_PX * 3
for name, (x0, y0, x1, y1), axis, toward, bottom in B2_STAIRS:
    if axis == 'y':
        entry = 'n' if toward > 0 else 's'
    else:
        entry = 'w' if toward > 0 else 'e'
    sides = {
        'n': (x0 - RW, y0 - RW, x1 + RW, y0),
        's': (x0 - RW, y1, x1 + RW, y1 + RW),
        'w': (x0 - RW, y0, x0, y1),
        'e': (x1, y0, x1 + RW, y1),
    }
    for side, r in sides.items():
        if side != entry:
            box(f'{name.replace("concrete_stair", "concrete_stair_wall")}_{side}', *r, F1 - 0.05, F1 + RAIL_H)
# 1F の床だけ coral_ground_02 (Poly Haven、CC0。tools/raw/coral_ground_02_4k.gltf、2026-11-05 本人「床はこれ」)。
# 地下 1F・2F の床と、穴や吹き抜けの壁はコンクリートのまま (材質の枠 0 は空 = ゲームのコンクリート)
def floor_material():
    tex = os.path.join(root, 'tools', 'raw', 'coral_ground_02_4k.gltf', 'textures')
    mat = bpy.data.materials.new('coral_ground_02')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')

    def img(name, space):
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(os.path.join(tex, name))
        node.image.colorspace_settings.name = space
        return node
    d = img('coral_ground_02_diff_4k.jpg', 'sRGB')
    r = img('coral_ground_02_rough_4k.jpg', 'Non-Color')
    n = img('coral_ground_02_nor_gl_4k.jpg', 'Non-Color')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(d.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out_n.inputs['Surface'])
    return mat


FLOOR_TILE = 3.0   # 絵 1 枚が覆う大きさ (m)
gme = ground.data
gme.materials.append(None)
gme.materials.append(floor_material())
guv = gme.uv_layers.active or gme.uv_layers.new(name='UVMap')
for poly in gme.polygons:
    top = poly.normal.z > 0.9 and abs(poly.center.z - F1) < 0.05
    poly.material_index = 1 if top else 0

# **絵の繰り返しを崩す** (本人「規則正しく揃っていてなんかきもい」)。でたらめな角度の線で床を不揃いな区画に
# 切り、区画ごとに絵を回す・裏返す・ずらす。四角いマスで切ったら境目が碁盤の目に見えた
import random
import math
from mathutils import Vector
FLOOR_LINES = 18
bm = bmesh.new()
bm.from_mesh(gme)
rng = random.Random(11)
xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts]
lines = []
for _ in range(FLOOR_LINES):
    a = rng.uniform(0, math.pi)
    nrm = Vector((math.cos(a), math.sin(a), 0))
    pt = Vector((rng.uniform(min(xs), max(xs)), rng.uniform(min(ys), max(ys)), F1))
    lines.append((pt, nrm))
    tops = [f for f in bm.faces if f.material_index == 1]
    geom = tops + list({e for f in tops for e in f.edges}) + list({v for f in tops for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=pt, plane_no=nrm)
uvl = bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap')
regions = {}
for f in [f for f in bm.faces if f.material_index == 1]:
    c = f.calc_center_median()
    key = tuple((c - pt).dot(nrm) > 0 for pt, nrm in lines)
    if key not in regions:
        regions[key] = (rng.uniform(0, 2 * math.pi), rng.random() < 0.5, rng.random() * 4, rng.random() * 4)
    a, flip, ox, oy = regions[key]
    ca, sa = math.cos(a), math.sin(a)
    for loop in f.loops:
        u, v = loop.vert.co.x / FLOOR_TILE, loop.vert.co.y / FLOOR_TILE
        if flip:
            u = -u
        loop[uvl].uv = (u * ca - v * sa + ox, u * sa + v * ca + oy)
bm.to_mesh(gme)
bm.free()

for i, r in enumerate(B1_COLUMNS):
    box(f'concrete_b1_column_{i}', *r, B1, B1_CEIL)
# 北の階段は東 (1F) から西へ下り、下りた先は階段の周りを回る通路 (本人)。階段の北・南・東は壁で囲み、
# 西の下の端だけで通路に出る (囲わないと、周りの通路へ横から 3m 落ちた)
SW = 0.3 / M_PER_PX * 3
box('concrete_b1_n_stair_wall_n', 583, 85 - SW, 685 + SW, 85, B1, B1_CEIL)
box('concrete_b1_n_stair_wall_s', 583, 145, 685 + SW, 145 + SW, B1, B1_CEIL)
box('concrete_b1_n_stair_wall_e', 685, 85, 685 + SW, 145, B1, B1_CEIL)


# --- 外壁 ------------------------------------------------------------------------------
T = 0.5 / M_PER_PX * 3   # 0.5m を 960 画素で
x0, y0, x1, y1 = OUTER
box('concrete_wall_outer_n', x0 - T, y0 - T, x1 + T, y0, B1_CEIL, WALL_TOP)
box('concrete_wall_outer_s', x0 - T, y1, x1 + T, y1 + T, B1_CEIL, WALL_TOP)
box('concrete_wall_outer_w', x0 - T, y0, x0, y1, B1_CEIL, WALL_TOP)
box('concrete_wall_outer_e', x1, y0, x1 + T, y1, B1_CEIL, WALL_TOP)

# --- 塔とベランダ ------------------------------------------------------------------------
# 2F より上は筒 (tools/bb_tower.py)。ここでは四角の場所だけ決め、下で筒に置き換える
TOWER_SQ = (445, 425, 550, 528)
TOWER_RING = (410, 385, 585, 560)
rx0, ry0, rx1, ry1 = TOWER_RING
# 1F はベランダの外の縁まで塊。せり出し (鼠返し) の下には入れない (本人 2026-11-05)
box('concrete_tower_base', rx0, ry0, rx1, ry1, F1 - 0.05, F2 - SLAB)
box('concrete_tower_balcony_n', rx0, ry0, rx1, 425, F2 - SLAB, F2)
box('concrete_tower_balcony_s', rx0, 528, rx1, ry1, F2 - SLAB, F2)
box('concrete_tower_balcony_w', rx0, 425, 445, 528, F2 - SLAB, F2)
box('concrete_tower_balcony_e', 550, 425, rx1, 528, F2 - SLAB, F2)
# ベランダの手すり (腰の高さ、外の縁)。弾は通す
# ベランダの内側 (筒の足元) も床で埋める。筒にしたら四角の 4 隅が抜けた
box('concrete_tower_balcony_core', 445, 425, 550, 528, F2 - SLAB, F2)

# --- 2F の通路 (板、下は通れる) -----------------------------------------------------------
WALKS = {
    'w': (272, 335, 305, 640),
    'nw_join': (272, 335, 388, 365),
    'nw_up': (355, 228, 388, 365),
    'n': (468, 280, 722, 310),
    # 先端は塔のベランダまで 1.5m。転がりで跳び移れる (本人「ローリングで飛び乗れる」。初めは 2.8m 空いていた)
    'n_tab': (468, 280, 505, 385 - 1.5 / M_PER_PX * 3),
    'e': (690, 280, 722, 640),
    'se': (605, 610, 722, 640),
    'sw': (272, 610, 388, 640),
    's': (360, 640, 525, 670),
    # 南も北と同じく、先端を塔のベランダまで 1.5m (本人「南も同じように」)
    's_tab': (490, 560 + 1.5 / M_PER_PX * 3, 525, 670),
    's_down': (360, 640, 388, 700),
}
for k, r in WALKS.items():
    box(f'metal_walk_2F_{k}', *r, F2 - SLAB, F2)

# 通路を支える柱 (通路の角と、長い辺の途中)
PILLARS = [(272, 335), (272, 488), (272, 610), (384, 610), (690, 280), (690, 460), (690, 610),
           (468, 280), (595, 280), (360, 670), (490, 640)]
PIL = 0.4 / M_PER_PX * 3
# 2F を支える柱は、コンクリートの台座に鉄骨の櫓 (tools/bb_support.py、本人の画面 2026-11-05)
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bb_support
for i, (px, py) in enumerate(PILLARS):
    bb_support.support(bpy, scene, f'{i:02d}', *P(px, py), F1, F2 - SLAB)

# 小さな暗い四角 (下絵) のうち真ん中寄りの 1 つは 2F を支える柱 (本人「2F を支える柱かも」)。2F の高さまで。
# 塔の北西と南の 2 つは地下 2F への穴 (HOLES)、西と東の 2 つは金属の箱 (下)
bb_support.support(bpy, scene, 'col', *P(622, 596), F1, F2 - SLAB)

# 西と東の四角は金属の箱 (本人の画面 2026-11-05「西側と東側にある四角い物体」)。縁に枠の付いた
# コンテナのような箱。下絵の四角の真ん中に 1.7m 角
CRATE = 1.7
for k, r in (('w', (135, 335, 170, 368)), ('e', (825, 515, 855, 548))):
    cx, cy = P((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
    box_m(f'metal_crate_{k}', (cx - CRATE / 2, cy - CRATE / 2, F1 - 0.05), (cx + CRATE / 2, cy + CRATE / 2, F1 + CRATE))


# --- 階段 (向きが読める物) --------------------------------------------------------------
# 1F ⇔ 2F は踊り場 (半分の高さ) をはさんだ 2 本。どれも段の板だけで、下に入れる (2026-11-05 本人
# 「1F から 2F まで続くんじゃなくてどの stair も踊り場がある」「階段下は入れる」)
MID = (F1 + F2) / 2
# 北西: 1F (西) → 東へ上がって踊り場 → 北の列へ寄って東へ上がり 2F の通路。どれも 2.2m で隙間なく繋ぐ
# (2026-11-05 本人「ひどいから直して」。南西を本人が直した形が理想: 踊り場は 2 本を繋ぐのに要る大きさだけ)
stairs('concrete_stair_nw_lower', 265, 258, 295, 288, F1, MID, 'x', +1, open_under=True)
box('metal_landing_nw', 295, 228, 325, 288, MID - SLAB, MID)
stairs('concrete_stair_nw', 325, 228, 355, 258, MID, F2, 'x', +1, open_under=True)
# 南東: 2F の通路 → 南へ下りて踊り場 → 東へ下りて 1F (細い帯を階段と踊り場に分けた、読みは要確認)
stairs('concrete_stair_se_upper', 605, 640, 640, 670, F2, MID, 'y', +1, open_under=True)
box('metal_landing_se', 605, 670, 655, 700, MID - SLAB, MID)
# 踊り場を支える柱 (2F の通路の柱だった物を、踊り場の下面まで縮めた。そのままだと踊り場を突き抜けた)
box('concrete_landing_se_pillar', 605, 680, 605 + 0.4 / M_PER_PX * 3, 680 + 0.4 / M_PER_PX * 3, F1 - 0.05, MID - SLAB)
# 下の階段も踊り場の上の階段と同じ長さに詰める (横を 0.8 倍にした時に伸びて見えた、2026-11-05 本人「コンパクトに」)
stairs('concrete_stair_se', 655, 670, 685, 700, MID, F1, 'x', +1, open_under=True)
# 南西: 2F の通路 (s_down) の先 → 南へ下りて踊り場 → 西へ下りて 1F (本人「踊り場付きの階段は？」)。どちらも 2.2m
stairs('concrete_stair_sw_upper', 360, 700, 388, 730, F2, MID, 'y', +1, open_under=True)
box('metal_landing_sw', 325, 730, 388, 800, MID - SLAB, MID)
stairs('concrete_stair_sw', 295, 765, 325, 800, MID, F1, 'x', -1, open_under=True)
# 北東: 北の 2F の通路の北の縁 → 北へ下りて踊り場 → 東へ下りて 1F (本人「cursor の部分に stair がない」。
# 地下 1F へ下りる階段だと読み違えて印だけにしていた)
stairs('concrete_stair_ne_upper', 605, 250, 635, 280, MID, F2, 'y', +1, open_under=True)
box('metal_landing_ne', 605, 220, 665, 250, MID - SLAB, MID)
stairs('concrete_stair_ne', 665, 220, 695, 250, MID, F1, 'x', +1, open_under=True)

# 向きを決めきれない階段・地下へ降りる階段は印だけ (ref_ は書き出されない)
for name, r in (('a1_north', (755, 600, 790, 670)),):
    box(f'ref_stair_{name}', *r, F1, F1 + 0.05)

# --- 遮蔽 (下絵の三角の印) ----------------------------------------------------------------
# 三角の印 = 先細りの四角いコンクリートの塊が横に倒れた物 (本人の画面 2026-11-05「横にたおれてる、短辺側から上に
# 登ることはできる、登ったら狙い撃ち」)。太い端が高く、細い端から上の坂を登れる。
# 向きは下絵の台形の太い側 (画素の多い側を数えた。怪しい物は Blender で回す)。n / s / e / w = 太い端の向き
COVERS = [((505, 150), 'e'), ((425, 185), 's'), ((505, 225), 'e'), ((402, 265), 'w'), ((815, 280), 'n'),
          ((748, 318), 'n'), ((840, 355), 'e'), ((773, 420), 'n'), ((208, 430), 's'), ((130, 480), 's'),
          ((347, 510), 's'), ((235, 553), 's'), ((152, 580), 's'), ((600, 410), 'w'), ((675, 440), 'e'),
          ((380, 595), 'w'), ((465, 625), 's'), ((290, 672), 'w'), ((282, 738), 'w'), ((490, 715), 'w'),
          ((520, 762), 'w'), ((465, 815), 's')]
ROCK_LEN = 3.0
ROCK_NARROW = (1.1, 0.9)   # 細い端の幅・高さ
ROCK_WIDE = (1.7, 1.7)     # 太い端の幅・高さ
DIRS = {'n': (0, 1), 's': (0, -1), 'e': (1, 0), 'w': (-1, 0)}   # Blender の向き (下絵の上 = +y)


def rock(name, px, py, wide, z):
    cx, cy = P(px, py)
    ax, ay = DIRS[wide]
    sx, sy = -ay, ax          # 横
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = {}
    for end, (w, h) in ((0, ROCK_NARROW), (1, ROCK_WIDE)):
        a = (end - 0.5) * ROCK_LEN
        for side in (-1, 1):
            for up in (0, 1):
                vs[end, side, up] = bm.verts.new((cx + ax * a + sx * side * w / 2, cy + ay * a + sy * side * w / 2, z + up * h))
    quads = [
        [(0, -1, 0), (0, 1, 0), (0, 1, 1), (0, -1, 1)],     # 細い端
        [(1, -1, 0), (1, -1, 1), (1, 1, 1), (1, 1, 0)],     # 太い端
        [(0, -1, 0), (0, -1, 1), (1, -1, 1), (1, -1, 0)],
        [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)],
        [(0, -1, 1), (0, 1, 1), (1, 1, 1), (1, -1, 1)],     # 上 (坂)
        [(0, -1, 0), (1, -1, 0), (1, 1, 0), (0, 1, 0)],     # 底
    ]
    for q in quads:
        bm.faces.new([vs[k] for k in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)


for i, ((px, py), wide) in enumerate(COVERS):
    rock(f'concrete_rock_{i:02d}', px, py, wide, F1)

# --- 銃眼のある壁 ---------------------------------------------------------------------------
# コンクリートの板を並べた壁。板ごとに胸の高さに横長の銃眼 (本人の画面 2026-11-05「地図の北の方にある南北に
# 伸びる壁の障害物」)。下絵の短い白線をなぞる
PANEL_H, PANEL_T = 1.9, 0.35
SLIT_W, SLIT_H, SLIT_Z = 0.7, 0.3, 1.1   # 銃眼の幅・高さ・真ん中の高さ (床から)
PANEL_GAP = 0.05


def slit_wall(name, a, b, z):
    """a → b (960 画素) に、板を幅 2m 前後で並べる。板ごとに真ん中に銃眼"""
    (ax, ay), (bx, by) = P(*a), P(*b)
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    n = max(1, round(length / 2.0))
    w = length / n
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()

    def piece(u0, u1, z0, z1):
        # 線に沿った u0..u1、厚み PANEL_T、高さ z0..z1 の箱
        geom = bmesh.ops.create_cube(bm, size=1.0)['verts']
        for v in geom:
            u = u0 if v.co.x < 0 else u1
            t = (-0.5 if v.co.y < 0 else 0.5) * PANEL_T
            v.co.x = ax + ux * u - uy * t
            v.co.y = ay + uy * u + ux * t
            v.co.z = z0 if v.co.z < 0 else z1

    for i in range(n):
        u0, u1 = i * w + PANEL_GAP / 2, (i + 1) * w - PANEL_GAP / 2
        mid = (u0 + u1) / 2
        s0, s1 = z + SLIT_Z - SLIT_H / 2, z + SLIT_Z + SLIT_H / 2
        piece(u0, u1, z, s0)                                  # 銃眼の下
        piece(u0, u1, s1, z + PANEL_H)                        # 銃眼の上
        piece(u0, mid - SLIT_W / 2, s0, s1)                   # 銃眼の左
        piece(mid + SLIT_W / 2, u1, s0, s1)                   # 銃眼の右
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


slit_wall('concrete_slit_wall_n', (332, 98), (332, 145), F1)


# --- トーチカ (両軍の拠点) ----------------------------------------------------------------
# 北東と南西の角を斜めの壁で切り取った区画。壁と屋根のある小屋で、ここに両軍の拠点がある
# (本人 2026-11-05「トーチカみたいになっていてここに blue と red の拠点がある」)。
# 下絵の白い線をなぞった。線の切れ目が出入り口
BUNKER_TOP = F1 + 3.0
BUNKER_WALL = 0.5


def wall(name, a, b, z0, z1, thick=BUNKER_WALL):
    """960 画素の下絵の点 a → b に沿った壁 (厚み thick、線の真ん中に立てる)"""
    (ax, ay), (bx, by) = P(*a), P(*b)
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    c, s_ = dx / length, dy / length
    for v in bm.verts:
        lx = v.co.x * (length + thick)
        ly = v.co.y * thick
        v.co.x = (ax + bx) / 2 + lx * c - ly * s_
        v.co.y = (ay + by) / 2 + lx * s_ + ly * c
        v.co.z = z0 if v.co.z < 0 else z1
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


BUNKERS = {
    # 北東: 外壁からの短い壁 → 出入り口 → 斜めの壁 → 出入り口 → 外壁までの短い壁。南西と同じく出入り口は 2 つ
    # (本人「片方の base に入り口が 2 個ないのがある」。初めは外壁から斜めの壁まで塞いでいた)
    'ne': {'walls': [((750, 88), (750, 105)), ((750, 147), (810, 195)), ((840, 195), (857, 195))],
           'roof': [(750, 88), (857, 88), (857, 195), (810, 195), (750, 147)]},
    # 南西: 外壁からの短い壁 → 出入り口 → 斜めの壁 → 出入り口 → 外壁までの短い壁
    'sw': {'walls': [((107, 726), (123, 726)), ((156, 726), (213, 783)), ((213, 819), (213, 835))],
           'roof': [(107, 726), (156, 726), (213, 783), (213, 835), (107, 835)]},
}
for k, b in BUNKERS.items():
    for i, (a, c) in enumerate(b['walls']):
        wall(f'concrete_bunker_{k}_wall_{i}', a, c, F1 - 0.05, BUNKER_TOP)
    prism(f'concrete_bunker_{k}_roof', b['roof'], BUNKER_TOP, BUNKER_TOP + 0.4)

# --- 基地・湧く所 ------------------------------------------------------------------------
# トーチカの中。どちらの軍がどちらかは仮 (本人に確かめる)
empty('meta_baseBlue', 150, 790, F1)   # 南西のトーチカ
empty('meta_baseRed', 805, 130, F1)    # 北東のトーチカ


# --- 2F の通路と踊り場は錆びた縞鋼板 (metal_grate_rusty、Poly Haven、CC0。tools/raw/metal_grate_rusty_4k.gltf、
# 2026-11-05 本人「踊り場や 2F は metal_grate_rusty」)。名前も metal_ (足音と着弾が金属)。絵は書き出しが
# 箱に立方投影で貼る (texel = 絵 1 枚の大きさ)
def grate_material():
    tex = os.path.join(root, 'tools', 'raw', 'metal_grate_rusty_4k.gltf', 'textures')
    mat = bpy.data.materials.new('metal_grate_rusty')
    mat['texel'] = 1.0
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')

    def img(name, space):
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(os.path.join(tex, name))
        node.image.colorspace_settings.name = space
        return node
    d = img('metal_grate_rusty_diff_4k.jpg', 'sRGB')
    arm = img('metal_grate_rusty_arm_4k.jpg', 'Non-Color')
    n = img('metal_grate_rusty_nor_gl_4k.jpg', 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(d.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(arm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out_n.inputs['Surface'])
    return mat


grate = grate_material()
for o in scene.objects:
    if o.type == 'MESH' and o.name.startswith(('metal_walk_2F_', 'metal_landing_')) and 'pillar' not in o.name:
        o.data.materials.append(grate)

# --- 塔: 2F より上は筒、ベランダの縁は崩れたコンクリートの壁 (tools/bb_tower.py) -------------
import bb_tower
(tx0, ty0), (tx1, ty1) = P(TOWER_SQ[0], TOWER_SQ[1]), P(TOWER_SQ[2], TOWER_SQ[3])
# 筒はベランダから 2.8m のトーチカ (本人「こんな高くない」)
bb_tower.tube(bpy, scene, (tx0 + tx1) / 2, (ty0 + ty1) / 2, min(abs(tx1 - tx0), abs(ty1 - ty0)) / 2, F1 - 0.5, F2 + 2.8, floor=F2)
(bx0, by0), (bx1, by1) = P(rx0, ry1), P(rx1, ry0)
gap = {}
for side, name in (('n', 'metal_walk_2F_n_tab'), ('s', 'metal_walk_2F_s_tab')):
    o = bpy.data.objects[name]
    xs = [(o.matrix_world @ v.co).x for v in o.data.vertices]
    gap[side] = (min(xs) - 0.5, max(xs) + 0.5)
bb_tower.parapet(bpy, scene, bx0, by0, bx1, by1, F2, gap)

# --- 柵 (2F の通路・踊り場・1F ⇔ 2F の階段の縁、tools/bb_rail.py) ---------------------------
# 縁の外に何が続いているかを光線で調べるので、形が全部できてから最後に
import bb_rail
bpy.context.view_layer.update()
bb_rail.build(bpy, scene)

bpy.ops.wm.save_as_mainfile(filepath=out)
print('書き出し', out, len(scene.objects), '個')
