# ブルーシートの中 (concrete_cube.006 の上) に廃材を置く (2026-11-05 本人「blueシートの中には
# こういう感じで廃材が置いてあったりした」、本家の画面: 板の山・パレットの上の箱・立て掛けた長い板・鉄の箱)。
#
#   板の山         wood_lumber_stack_*_nouv   人も弾も止める。板の層 + 層の間の桟木 (角材)
#   パレットと箱   wood_pallet_*_nouv / wood_cardboard_*_nouv   止める。段ボールは木の音で代用
#   鉄の箱         metal_scrap_box_nouv        止める
#   立て掛けた板   vis_wood_lean_planks_*_nouv  素通り (細いので当たりにすると引っ掛かるだけ)
#
# 絵は tools/raw/scrap/ の 1k (worn_planks・rusty_metal_04 = Poly Haven CC0、cardboard は手元の物)。
# UV は自前 (_nouv): 板の上面は絵の板目に沿わせ、幅 1m で絵 1 枚 (板 1 枚 ≈ 0.11m)。
# 物 1 つは 400 三角まで (書き出しが間引く)。板は 1 枚ずつ作らず、層ごとに 1 つの箱にする
# (上から見ると絵の板目がそのまま板に見える)。
# 何度流しても同じ物になる。流し直すと前の物 (コレクション scrap) を消して作り直す。
#   開いている Blender で: exec(open('tools/scrap_pile.py').read())
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix

COLLECTION = 'scrap'
BASE = 'concrete_cube.006'
TEX_DIR = os.path.join(os.path.dirname(bpy.data.filepath), 'scrap')
PLANK_TILE = 1.0     # 板の絵 1 枚が覆う幅 (m)。絵の中に板が 9 枚並ぶ
PLANK_LEN = 2.0      # 板の絵 1 枚が覆う長さ (m)
# 絵の中で板 1 枚に当たる列 (u の始まり, 幅)。立て掛けた板は 1 枚ずつ、ここから選ぶ
PLANK_COLUMNS = ((0.125, 0.09), (0.235, 0.095), (0.35, 0.08), (0.535, 0.075), (0.775, 0.075), (0.865, 0.06))

rng = random.Random(11)


def fresh_collection():
    old = bpy.data.collections.get(COLLECTION)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    c = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(c)
    return c


def image_material(name, file):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    path = os.path.join(TEX_DIR, file)
    img = bpy.data.images.get(file) or bpy.data.images.load(path)
    img.filepath = bpy.path.relpath(path)
    tex.image = img
    bsdf.inputs['Roughness'].default_value = 0.9
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def add_box(bm, uv, center, size, yaw=0.0, tilt=None, mapper=None, from_end=False):
    """center (x, y, 下端の z)、size (長さ x, 幅 y, 高さ z)。mapper(局所の点, 面の法線, size) → (u, v)。
    from_end: 長さ方向を center から始める (立てた板の足元を center に置く)"""
    lx, ly, lz = size
    rot = Matrix.Rotation(yaw, 4, 'Z')
    if tilt is not None:
        rot = rot @ tilt
    corners = {}
    for i in (0, 1):
        for j in (0, 1):
            for k in (0, 1):
                p = Vector(((i - (0 if from_end else 0.5)) * lx, (j - 0.5) * ly, k * lz))
                corners[i, j, k] = (p, bm.verts.new(Vector(center) + (rot @ p.to_4d()).to_3d()))
    quads = (
        (((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)), (0, 0, 1)),
        (((0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)), (0, 0, -1)),
        (((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), (0, -1, 0)),
        (((1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)), (0, 1, 0)),
        (((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)), (1, 0, 0)),
        (((0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)), (-1, 0, 0)),
    )
    for keys, normal in quads:
        f = bm.faces.new([corners[k][1] for k in keys])
        for l, k in zip(f.loops, keys):
            l[uv].uv = mapper(corners[k][0], normal, size)


def plank_mapper(col=None, u0=0.0, v0=0.0):
    """長さ方向 (局所 x) を絵の縦に。col を渡すと板 1 枚の列だけを使う"""
    def m(p, n, size):
        lx, ly, lz = size
        v = v0 + (p.x + lx / 2) / PLANK_LEN
        if n[0]:   # 木口。小さいので年輪の代わりに板の端を写す
            v = v0 + p.z / PLANK_LEN
            across = p.y + ly / 2
        elif n[1]:  # 横の面 (厚み)
            across = p.z
        else:
            across = p.y + ly / 2
        if col is not None:
            return (col[0] + across / max(ly, 1e-3) * col[1], v)
        return (u0 + across / PLANK_TILE, v)
    return m


def planar_mapper(scale, u0=0.0, v0=0.0):
    """面ごとに平らに写す。scale = 絵 1 枚が覆う長さ (m)"""
    def m(p, n, size):
        lx, ly, lz = size
        q = p + Vector((lx / 2, ly / 2, 0))
        if n[2]:
            a, b = q.x, q.y
        elif n[1]:
            a, b = q.x, q.z
        else:
            a, b = q.y, q.z
        return (u0 + a / scale, v0 + b / scale)
    return m


def new_object(col, name, mat, build):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    build(bm, uv)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    return obj


def lumber_stack(bm, uv, x, y, z, yaw, length, width, layers, board=0.05, sticker=0.045):
    """板の層と、層の間に横に渡す桟木 3 本。上の層ほど少し短く、ずれる"""
    h = z
    for i in range(layers):
        shrink = rng.uniform(0.0, 0.25) if i == layers - 1 else rng.uniform(0.0, 0.08)
        off = rng.uniform(-0.06, 0.06)
        c = Vector((x, y, h)) + Matrix.Rotation(yaw, 3, 'Z') @ Vector((off, rng.uniform(-0.03, 0.03), 0))
        add_box(bm, uv, c, (length - shrink, width - (0.1 if i == layers - 1 else 0), board), yaw,
                mapper=plank_mapper(u0=rng.random(), v0=rng.random()))
        h += board
        if i == layers - 1:
            break
        for s in (-0.42, 0.0, 0.42):
            sc = Vector((x, y, h)) + Matrix.Rotation(yaw, 3, 'Z') @ Vector((s * length, 0, 0))
            add_box(bm, uv, sc, (sticker, width + 0.04, sticker), yaw,
                    mapper=plank_mapper(col=PLANK_COLUMNS[i % len(PLANK_COLUMNS)], v0=rng.random()))
        h += sticker


def pallet(bm, uv, x, y, z, yaw):
    """1.2 × 1.0 × 0.14。下の角材 3 本と上の板 5 枚"""
    rot = Matrix.Rotation(yaw, 3, 'Z')
    for s in (-0.45, 0.0, 0.45):
        add_box(bm, uv, Vector((x, y, z)) + rot @ Vector((0, s, 0)), (1.2, 0.1, 0.1), yaw,
                mapper=plank_mapper(col=PLANK_COLUMNS[1], v0=rng.random()))
    for s in (-0.5, -0.25, 0.0, 0.25, 0.5):
        add_box(bm, uv, Vector((x, y, z + 0.1)) + rot @ Vector((s, 0, 0)), (1.0, 0.14, 0.025), yaw + math.pi / 2,
                mapper=plank_mapper(col=rng.choice(PLANK_COLUMNS), v0=rng.random()))


def leaning_planks(bm, uv, base, toward, count, length, lean):
    """長い板を壁 (シートの足場) に立て掛ける。base = 足元の並びの中心、toward = 倒れ掛かる向き (yaw)"""
    for i in range(count):
        side = (i - (count - 1) / 2) * 0.24 + rng.uniform(-0.03, 0.03)
        c = Vector(base) + Matrix.Rotation(toward, 3, 'Z') @ Vector((0, side, 0))
        # 局所 x が長さ。立てて (y 軸回りに -90°)、壁の方へ lean 傾ける
        tilt = Matrix.Rotation(-math.pi / 2 + lean + rng.uniform(-0.03, 0.03), 4, 'Y')
        add_box(bm, uv, c, (length + rng.uniform(-0.4, 0.2), 0.2, 0.035), toward, tilt=tilt, from_end=True,
                mapper=plank_mapper(col=PLANK_COLUMNS[i % len(PLANK_COLUMNS)], v0=rng.random()))


def boxes_on(bm, uv, spots, z, mapper):
    for (x, y, sx, sy, sz, yaw, level) in spots:
        add_box(bm, uv, (x, y, z + level), (sx, sy, sz), yaw, mapper=mapper)


base = bpy.data.objects[BASE]
top = max((base.matrix_world @ v.co).z for v in base.data.vertices)
col = fresh_collection()
planks = image_material('scrap_worn_planks', 'worn_planks_1k.jpg')
rusty = image_material('scrap_rusty_metal', 'rusty_metal_04_1k.jpg')
cardboard = image_material('scrap_cardboard', 'cardboard_1k.jpg')

# 板の山。南の縁 (y -22.5) と東 (x 28) に寄せ、真ん中を空ける (本家も通路が残る)
new_object(col, 'wood_lumber_stack_1_nouv', planks,
           lambda bm, uv: lumber_stack(bm, uv, 19.4, -21.55, top, 0.0, 3.2, 1.2, 8))
new_object(col, 'wood_lumber_stack_2_nouv', planks,
           lambda bm, uv: lumber_stack(bm, uv, 27.0, -17.2, top, math.pi / 2, 3.8, 1.3, 9))
new_object(col, 'wood_lumber_stack_3_nouv', planks,
           lambda bm, uv: lumber_stack(bm, uv, 23.6, -21.7, top, 0.04, 2.4, 1.0, 5))

# パレットと段ボール
def pallets(bm, uv):
    pallet(bm, uv, 20.4, -15.6, top, 0.05)
    pallet(bm, uv, 21.75, -15.5, top, -0.08)
new_object(col, 'wood_pallet_1_nouv', planks, pallets)
card = planar_mapper(0.9)
new_object(col, 'wood_cardboard_1_nouv', cardboard, lambda bm, uv: boxes_on(bm, uv, [
    (20.25, -15.75, 0.5, 0.4, 0.35, 0.1, 0.125),
    (20.7, -15.4, 0.5, 0.4, 0.35, -0.05, 0.125),
    (20.4, -15.6, 0.5, 0.4, 0.35, 0.3, 0.475),
    (21.6, -15.6, 0.6, 0.45, 0.4, 0.0, 0.125),
], top, card))
new_object(col, 'wood_cardboard_2_nouv', cardboard, lambda bm, uv: boxes_on(bm, uv, [
    (23.2, -21.6, 0.45, 0.35, 0.3, 0.4, 0.0),   # 板の山 3 の上 (高さは下で合わせる)
    (18.3, -13.6, 0.4, 0.35, 0.3, 0.7, 0.0),    # 床に転がった物
    (22.6, -18.9, 0.35, 0.3, 0.25, -0.5, 0.0),
], top, card))
# 板の山 3 の上の箱を山の上面に載せる
stack3 = bpy.data.objects['wood_lumber_stack_3_nouv']
stack3_top = max(v.co.z for v in stack3.data.vertices)
cb2 = bpy.data.objects['wood_cardboard_2_nouv']
for v in cb2.data.vertices[:8]:
    v.co.z += stack3_top - top

# 鉄の箱 (道具箱)。北の縁寄り
new_object(col, 'metal_scrap_box_nouv', rusty,
           lambda bm, uv: add_box(bm, uv, (24.6, -12.9, top), (1.3, 0.8, 0.9), 0.06, mapper=planar_mapper(1.2)))

# 立て掛けた長い板。北のシート (y -11.5) と西のシート (x 16.4) の足場に
new_object(col, 'vis_wood_lean_planks_1_nouv', planks,
           lambda bm, uv: leaning_planks(bm, uv, (18.6, -12.25, top), math.pi / 2, 5, 3.4, 0.2))
new_object(col, 'vis_wood_lean_planks_2_nouv', planks,
           lambda bm, uv: leaning_planks(bm, uv, (17.15, -19.2, top), math.pi, 4, 3.0, 0.22))

for o in col.objects:
    print(o.name, len(o.data.polygons) * 2, '三角')
