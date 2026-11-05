# BB の 2F の通路・踊り場・1F ⇔ 2F の階段の柵 (本人の画面 2026-11-05「2F 部分と階段と踊り場はこういうふうに柵がある」)。
#
#   柱 (約 1.5m おき)・上の手すり (1.1m)・中の手すり・下半分の穴あきの金網の板。階段は傾きに沿って斜め。
#   名前 metal_rail_<k>_nobox_noeye_nocamera — 人・弾・投げた物は止め、視線とカメラは通す。**nobox** が無いと
#   書き出しが人の層を外接の箱に置き換え、両側に柵のある通路が丸ごと箱で塞がって進めなかった (2026-11-05)。弾は柵の形 (柱・手すり・板) に
#   当たるので、隙間は抜ける (2026-11-05 本人「全部止めていい、隙間は通していい」)
#
# **縁ごとに、外に何が続いているかを調べて決める。** 縁のすぐ外に、同じ高さの床・踊り場・階段・ベランダがあれば
# 付けない (繋ぎ目)。転がりで跳び移る塔の手前 (北と南の通路の先端) は SKIP_EDGES で空ける。
# 開いている blend でも make_bb.py からでも、build(bpy, scene) を呼ぶ。前の柵 (metal_rail_*) は消して作り直す
import bmesh
import math
from mathutils import Vector

RAIL_H = 1.1
MID_H = 0.55
PANEL = (0.1, 0.85)       # 金網の板の下と上 (床から)
POST = 0.06
BAR = 0.05
PANEL_T = 0.02
POST_STEP = 1.5
SAMPLE = 0.1              # 縁を調べる刻み (m)
OUT = 0.12                # 縁の外を調べる距離
NEAR_Z = 0.4              # 外の床が「同じ高さ」と見なす差
MIN_LEN = 0.4             # これより短い柵は付けない
SLABS = ('metal_walk_2F_', 'metal_landing_')
FLIGHTS = ('metal_stair_nw', 'metal_stair_se', 'metal_stair_sw', 'metal_stair_ne')   # 1F ⇔ 2F (地下の b1_ / b2_ は壁がある)
WALKABLE = ('metal_walk_2F_', 'metal_landing_', 'concrete_stair_', 'metal_stair_', 'concrete_tower_balcony_', 'concrete_tower')
# 柵を付けない縁: (物の名前, 縁の向き)。北と南の通路の先端の、塔に向いた縁 (転がりで跳び移る、本人)
SKIP_EDGES = {('metal_walk_2F_n_tab', 's'), ('metal_walk_2F_s_tab', 'n')}
# 手すりの切れ目 (Blender の x, y、長さ m)。**狙いやすく、また狙われやすく** する (2026-11-05 本人「中央のトーチカ
# 2F にいる人を狙いやすくする」「ところどころ切っていい」)。縁に 0.6m 以内の点を、その縁の上で長さぶん空ける。
# **手で切った所はここに書く** — 作り直すと手の直しは消える (本人が切った所を一度消した)
CUTS = [
    (-13.22, -3.95, 2.4),   # 西の通路の内側 (塔に向く) — 本人が切った所
    (15.52, 1.5, 2.4),      # 東の通路の内側
    (8.0, 11.3, 2.4),       # 北の通路の内側
    (-4.0, -13.34, 2.0),    # 南の通路の内側
    (-15.69, 3.0, 2.0),     # 西の通路の外側
    (17.91, -6.0, 2.0),     # 東の通路の外側
    (14.0, -13.34, 2.0),    # 南東の通路の南
    (-12.0, 9.44, 2.0),     # 北西の通路の北
    (9.18, -15.58, 4.5),    # 南東の延ばした 2F の西の縁 (本人「cursor あたりの柵は消して」)
]


def _bounds(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector([min(p[i] for p in ps) for i in range(3)]), Vector([max(p[i] for p in ps) for i in range(3)])


def _covered(scene, dg, x, y, z, self_obj):
    """(x, y) の真下、高さ z ± NEAR_Z に歩ける面があるか"""
    hit, loc, _n, _i, obj, _m = scene.ray_cast(dg, Vector((x, y, z + NEAR_Z)), Vector((0, 0, -1)), distance=2 * NEAR_Z)
    return hit and obj is not self_obj and obj.name.startswith(WALKABLE)


def _runs(flags, step):
    """[(開始の距離, 終わりの距離)] — flags が True の続き"""
    out, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            out.append((start * step, i * step))
            start = None
    return out


def _bar(bm, a, b, t):
    d = b - a
    if d.length < 1e-4:
        return
    rot = d.to_track_quat('Z', 'Y').to_matrix()
    mid = (a + b) / 2
    for v in bmesh.ops.create_cube(bm, size=1.0)['verts']:
        v.co = mid + rot @ Vector((v.co.x * t, v.co.y * t, v.co.z * d.length))


def _panel(bm, a, b, lo, hi, n):
    """a → b の線 (床の高さ) に沿った、床から lo〜hi の薄い板。n は外向き (厚みの向き)"""
    off = n * (PANEL_T / 2)
    vs = []
    for p in (a, b):
        for h in (lo, hi):
            for s in (-1, 1):
                vs.append(bm.verts.new(p + Vector((0, 0, h)) + off * s))
    # vs: [a lo -, a lo +, a hi -, a hi +, b lo -, b lo +, b hi -, b hi +]
    for q in ((0, 4, 6, 2), (1, 3, 7, 5), (0, 1, 5, 4), (2, 6, 7, 3), (0, 2, 3, 1), (4, 5, 7, 6)):
        bm.faces.new([vs[i] for i in q])


def _rail(bm, a, b, n):
    """a → b (床の線、傾いてよい) に柵。n は外向き"""
    length = (b - a).length
    k = max(1, math.ceil(length / POST_STEP))
    for i in range(k + 1):
        p = a + (b - a) * (i / k)
        _bar(bm, p, p + Vector((0, 0, RAIL_H)), POST)
    up = Vector((0, 0, RAIL_H))
    mid = Vector((0, 0, MID_H))
    _bar(bm, a + up, b + up, BAR)
    _bar(bm, a + mid, b + mid, BAR * 0.8)
    _panel(bm, a, b, PANEL[0], PANEL[1], n)


def build(bpy, scene):
    for o in [o for o in scene.objects if o.name.startswith('metal_rail_')]:
        me = o.data
        bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    dg = bpy.context.evaluated_depsgraph_get()
    made = 0

    def emit(name, segs):
        nonlocal made
        if not segs:
            return
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        for a, b, n in segs:
            _rail(bm, a, b, n)
        # 面の向きを外へ揃える (金網の板の組み方で裏返っていた)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        scene.collection.objects.link(bpy.data.objects.new(name, me))
        made += 1

    # 床と踊り場: **上の面の本当の縁** に沿って。外接する四角の 4 辺で立てていたら、本人が L 字に直した
    # 踊り場 (南西) で、欠けた角の床の無い所を柵が通った (2026-11-05 本人「手すりが床に沿ってない」)
    for o in [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(SLABS) and 'pillar' not in o.name]:
        lo, hi = _bounds(o)
        z = hi.z
        M = o.matrix_world
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(M)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        tops = {f for f in bm.faces if f.normal.z > 0.9 and abs(f.calc_center_median().z - z) < 0.02 and f.calc_area() > 1e-6}
        # 上の面のうち、上の面を 1 枚しか持たない辺が縁
        border = [e for e in bm.edges if sum(1 for f in e.link_faces if f in tops) == 1 and e.calc_length() > 1e-3]
        lo_sx, hi_sx = lo.x + 0.02, hi.x - 0.02
        segs = []
        for e in border:
            a, b = e.verts[0].co.copy(), e.verts[1].co.copy()
            a.z = b.z = z
            face = next(f for f in e.link_faces if f in tops)
            d = (b - a).normalized()
            n = Vector((d.y, -d.x, 0))
            c = face.calc_center_median()
            if n.dot(c - (a + b) / 2) > 0:
                n = -n
            # 縁の向きから名前を引く (SKIP_EDGES は四角の辺の向きで書いてある)
            if abs(n.y) > abs(n.x):
                side = 'n' if n.y > 0 else 's'
            else:
                side = 'e' if n.x > 0 else 'w'
            if (o.name, side) in SKIP_EDGES:
                continue
            length = (b - a).length
            cnt = max(1, int(length / SAMPLE))
            flags = []
            for i in range(cnt):
                on = a + (b - a) * ((i + 0.5) / cnt)
                p = on + n * OUT
                cut = any(abs((Vector((cx, cy, z)) - a).dot(n)) < 0.6 and abs((on - Vector((cx, cy, z))).dot(d)) < ln / 2
                          for cx, cy, ln in CUTS)
                flags.append(not cut and not _covered(scene, dg, p.x, p.y, z, o))
            for s0, s1 in _runs(flags, length / cnt):
                if s1 - s0 >= MIN_LEN:
                    segs.append((a + d * s0 - n * (POST / 2), a + d * s1 - n * (POST / 2), n))
        bm.free()
        emit(f'metal_rail_{o.name.split("_", 1)[1]}_nobox_noeye_nocamera', segs)

    # 1F ⇔ 2F の階段: 長い 2 辺に、傾きに沿って
    for o in [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(FLIGHTS)]:
        lo, hi = _bounds(o)
        ws = [o.matrix_world @ v.co for v in o.data.vertices]
        # **上る向きは段の高さから決める。** 辺の長さで決めていたら、平面が正方形の階段 (北西の 2 本、2.24m 角) で
        # 向きを取り違え、柵が上り口と下り口を塞いだ (2026-11-05 本人「cursor らへんどういうこと？」)。
        # 一番高い段と一番低い段の真ん中を結んだ向きが上る向き
        zmax, zmin = max(w.z for w in ws), min(w.z for w in ws)
        high = [w for w in ws if w.z > zmax - 0.01]
        low = [w for w in ws if w.z < zmin + 0.01]
        hc = sum(high, Vector()) / len(high)
        lc = sum(low, Vector()) / len(low)
        run = hc - lc
        along_x = abs(run.x) >= abs(run.y)
        high_at_hi = (run.x if along_x else run.y) > 0
        # 一番低い段の上面 = 高さの値の 2 番目に小さい物 (板の厚みによらない)
        z_lo = sorted({round(w.z, 4) for w in ws})[1]
        z_hi = hi.z

        def floor_at(t):
            # t: 0 = 座標の小さい端、1 = 大きい端
            u = t if high_at_hi else 1 - t
            return z_lo + (z_hi - z_lo) * u

        segs = []
        if along_x:
            sides = ((lo.y, Vector((0, -1, 0))), (hi.y, Vector((0, 1, 0))))
        else:
            sides = ((lo.x, Vector((-1, 0, 0))), (hi.x, Vector((1, 0, 0))))
        for c, n in sides:
            length = (hi.x - lo.x) if along_x else (hi.y - lo.y)
            cnt = max(1, int(length / SAMPLE))
            flags = []
            for i in range(cnt):
                t = (i + 0.5) / cnt
                if along_x:
                    x, y = lo.x + (hi.x - lo.x) * t, c
                else:
                    x, y = c, lo.y + (hi.y - lo.y) * t
                p = Vector((x, y, 0)) + n * OUT
                flags.append(not _covered(scene, dg, p.x, p.y, floor_at(t), o))
            for s0, s1 in _runs(flags, length / cnt):
                if s1 - s0 < MIN_LEN:
                    continue
                t0, t1 = s0 / length, s1 / length
                if along_x:
                    a = Vector((lo.x + (hi.x - lo.x) * t0, c, floor_at(t0)))
                    b = Vector((lo.x + (hi.x - lo.x) * t1, c, floor_at(t1)))
                else:
                    a = Vector((c, lo.y + (hi.y - lo.y) * t0, floor_at(t0)))
                    b = Vector((c, lo.y + (hi.y - lo.y) * t1, floor_at(t1)))
                segs.append((a - n * (POST / 2), b - n * (POST / 2), n))
        # 名前に stair を入れない — 書き出し (is_stair) が柵を階段と見なして柵の高さに坂の板を張り、
        # 階段の上で頭がつかえて登れなかった (2026-11-05 本人「stair が登れなかった」)
        emit(f'metal_rail_{o.name.split("_", 1)[1].replace("stair_", "flight_")}_nobox_noeye_nocamera', segs)
    return made
