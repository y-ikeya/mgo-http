# 遠景の団地と塔の**輪郭**を作り直す (2026-11-04 本人「low-poly_city_buildings を真似て」)。
#
# 参考にした作り (smooth998「Low-poly City Buildings」、形は借りていない):
#   セットバック   上へ行くほど細くなる (2〜3 段)
#   角落とし      八角形の塔に、頂部の冠
#   尖塔         セットバック + 細い頂部 + 針 (エンパイアステート風)
#   板 + 屋上    屋上の機械室・階段室・パラペット
# 窓は外壁の絵 (far_facade_*)。面ごとに柱の真ん中から始め、窓の数・階の数を整数にする (外壁の貼り方と同じ)。
#
# 置き場所は今の物 (コレクション far の各物の外接と location) をそのまま使う。形だけ差し替える。
#   開いている Blender で: exec(open('tools/far_massing.py').read())
import bpy, bmesh, math, random
from mathutils import Vector

UP = Vector((0, 0, 1))
BAY, FLOOR, PER = 3.0, 3.0, 6
U0, V0 = 0.08, 0.10
FACADE, ROOF, ACCENT = 0, 1, 2


def prism(bm, ring, z0, z1, wall=FACADE, cap=ROOF, bottom=True):
    """多角形 ring (xy、反時計回り) を z0 から z1 まで押し出す"""
    lo = [bm.verts.new((x, y, z0)) for x, y in ring]
    hi = [bm.verts.new((x, y, z1)) for x, y in ring]
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i])).material_index = wall
    bm.faces.new(hi).material_index = cap
    if bottom:
        bm.faces.new(list(reversed(lo))).material_index = cap


def rect(cx, cy, hx, hy):
    return [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)]


def octagon(cx, cy, hx, hy, cut):
    c = min(cut, hx * 0.45, hy * 0.45)
    return [(cx - hx + c, cy - hy), (cx + hx - c, cy - hy), (cx + hx, cy - hy + c), (cx + hx, cy + hy - c),
            (cx + hx - c, cy + hy), (cx - hx + c, cy + hy), (cx - hx, cy + hy - c), (cx - hx, cy - hy + c)]


def snap_floor(z, base):
    return base + max(1, round((z - base) / FLOOR)) * FLOOR


def tower(bm, cx, cy, hx, hy, base, top, kind, rnd):
    if kind == 'setback':
        z1 = snap_floor(base + (top - base) * 0.62, base)
        z2 = snap_floor(base + (top - base) * 0.85, base)
        prism(bm, rect(cx, cy, hx, hy), base, z1)
        prism(bm, rect(cx, cy, hx * 0.78, hy * 0.78), z1, z2, bottom=False)
        prism(bm, rect(cx, cy, hx * 0.55, hy * 0.55), z2, top, bottom=False)
        prism(bm, rect(cx, cy, hx * 0.3, hy * 0.3), top, top + 4, wall=ACCENT, bottom=False)
    elif kind == 'octagon':
        prism(bm, octagon(cx, cy, hx, hy, hx * 0.35), base, top)
        # 冠: 少し張り出した帯と、細い頂部
        prism(bm, octagon(cx, cy, hx * 1.04, hy * 1.04, hx * 0.36), top, top + 2.5, wall=ACCENT, bottom=False)
        prism(bm, octagon(cx, cy, hx * 0.7, hy * 0.7, hx * 0.25), top + 2.5, top + 6, wall=ACCENT, bottom=False)
    elif kind == 'spire':
        z1 = snap_floor(base + (top - base) * 0.55, base)
        z2 = snap_floor(base + (top - base) * 0.8, base)
        prism(bm, rect(cx, cy, hx, hy), base, z1)
        prism(bm, rect(cx, cy, hx * 0.72, hy * 0.72), z1, z2, bottom=False)
        prism(bm, octagon(cx, cy, hx * 0.45, hy * 0.45, hx * 0.15), z2, top, bottom=False)
        # 針
        r = hx * 0.08
        base_v = [bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), top)) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
        tip = bm.verts.new((cx, cy, top + (top - base) * 0.18))
        for i in range(4):
            bm.faces.new((base_v[i], base_v[(i + 1) % 4], tip)).material_index = ACCENT
    else:  # slab
        prism(bm, rect(cx, cy, hx, hy), base, top)
        rooftop(bm, cx, cy, hx, hy, top, rnd)


def rooftop(bm, cx, cy, hx, hy, top, rnd):
    """パラペット (縁の立ち上がり) と、機械室・階段室"""
    t, ph = 0.25, 1.0
    for ring in (rect(cx, cy - hy + t / 2, hx, t / 2), rect(cx, cy + hy - t / 2, hx, t / 2),
                 rect(cx - hx + t / 2, cy, t / 2, hy), rect(cx + hx - t / 2, cy, t / 2, hy)):
        prism(bm, ring, top, top + ph, wall=ROOF, bottom=False)
    for _ in range(rnd.randint(1, 3)):
        w, d = rnd.uniform(2.5, 5), rnd.uniform(2.5, 4)
        x = rnd.uniform(cx - hx + w / 2 + 0.5, cx + hx - w / 2 - 0.5)
        y = rnd.uniform(cy - hy + d / 2 + 0.5, cy + hy - d / 2 - 0.5)
        prism(bm, rect(x, y, w / 2, d / 2), top, top + rnd.uniform(2.5, 4), wall=ACCENT, bottom=False)


def danchi(bm, cx, cy, hx, hy, base, top, rnd):
    long_x = hx >= hy
    step = rnd.random() < 0.45
    if step:
        # 片方の端を 2〜3 階低くする (段々の板)
        cut = (hx if long_x else hy) * rnd.uniform(0.25, 0.4)
        low = top - FLOOR * rnd.randint(2, 3)
        if long_x:
            prism(bm, rect(cx - cut / 2, cy, hx - cut / 2, hy), base, top)
            prism(bm, rect(cx + hx - cut / 2, cy, cut / 2, hy), base, low)
            rooftop(bm, cx - cut / 2, cy, hx - cut / 2, hy, top, rnd)
        else:
            prism(bm, rect(cx, cy - cut / 2, hx, hy - cut / 2), base, top)
            prism(bm, rect(cx, cy + hy - cut / 2, hx, cut / 2), base, low)
            rooftop(bm, cx, cy - cut / 2, hx, hy - cut / 2, top, rnd)
    else:
        prism(bm, rect(cx, cy, hx, hy), base, top)
        rooftop(bm, cx, cy, hx, hy, top, rnd)


def facade_uv(bm, matrix):
    uv = bm.loops.layers.uv.verify()
    n3 = matrix.to_3x3()
    for f in bm.faces:
        n = (n3 @ f.normal).normalized()
        ps = [matrix @ v.co for v in f.verts]
        if f.material_index != FACADE or abs(n.z) > 0.5:
            for l in f.loops:
                p = matrix @ l.vert.co
                l[uv].uv = ((p.y if abs(n.x) > abs(n.y) else p.x) / 2.0, (p.z if abs(n.z) < 0.5 else p.y) / 2.0)
            continue
        t = (-n).cross(UP).normalized()
        s0 = min(p.dot(t) for p in ps); s1 = max(p.dot(t) for p in ps)
        z0 = min(p.z for p in ps); z1 = max(p.z for p in ps)
        bays = max(1, round((s1 - s0) / BAY)); floors = max(1, round((z1 - z0) / FLOOR))
        for l in f.loops:
            p = matrix @ l.vert.co
            l[uv].uv = (U0 + (p.dot(t) - s0) / max(s1 - s0, 1e-6) * bays / PER, V0 + (p.z - z0) / max(z1 - z0, 1e-6) * floors / PER)


def rebuild():
    rnd = random.Random(52)
    concrete = bpy.data.materials.get('concrete_untextured')
    accent = bpy.data.materials.get('blue_metal_plate') or concrete
    kinds = ['setback', 'octagon', 'spire', 'slab']
    done = {}
    for o in list(bpy.data.collections['far'].objects):
        if o.type != 'MESH':
            continue
        is_tower, is_danchi = '_tower_' in o.name, '_danchi_' in o.name
        if not (is_tower or is_danchi):
            continue
        me = o.data
        mats = list(me.materials)
        facade = mats[0]
        if not facade or not facade.name.startswith('far_facade_'):
            continue
        # 外接 (ローカル)。屋上の箱を除いた本体の高さを取るため、facade の面だけで測る
        fv = {v for p in me.polygons if p.material_index == 0 for v in p.vertices}
        ls = [me.vertices[i].co for i in fv] or [v.co for v in me.vertices]
        x0, x1 = min(v.x for v in ls), max(v.x for v in ls)
        y0, y1 = min(v.y for v in ls), max(v.y for v in ls)
        z0, z1 = min(v.z for v in ls), max(v.z for v in ls)
        cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        bm = bmesh.new()
        if is_tower:
            kind = kinds[len(done) % len(kinds)] if True else rnd.choice(kinds)
            tower(bm, cx, cy, hx, hy, z0, z1, kind, rnd)
        else:
            kind = 'danchi'
            danchi(bm, cx, cy, hx, hy, z0, z1, rnd)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        facade_uv(bm, o.matrix_world)
        bm.to_mesh(me)
        bm.free()
        me.materials.clear()
        for mt in (facade, concrete, accent):
            me.materials.append(mt)
        done[o.name] = kind
    print('[massing]', len(done), {k: list(done.values()).count(k) for k in set(done.values())})


rebuild()
