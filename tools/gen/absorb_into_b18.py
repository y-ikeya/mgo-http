# b18 に付いている素の箱を、b18 と同じ作りにして本体へ合わせる。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/absorb_into_b18.py').read(), {'ABSORB': True})   # 下の B18_PIECES を流す
#
#   PIECES = [(物の名前, {windows: 窓を付けるか, outline: 床の形 (反時計回り), z0/z1: 下端と上端, plinth: 足元の段を付けるか}), ...]
#
# 本人 2026-10-17「Cube.005 と concrete_building20 も同じ建物、戻した壁 (3.004) も一緒に作り直して」。
#
# --- やること (1 つずつ) ---
# 1. 形を世界の座標で写し、上端を b18 に揃える (TOP)。傾いた箱 (b20 は 40°) もそのまま
# 2. 窓: 縦の面のうち、前が WINDOW_FREE 以上空いている面にだけ (隣の建物との隙間は見えない)。
#    1 階は格子の小窓、2 階はガラス窓と板の窓を交互 (b18 と同じ寸法)。板の窓は奥を掘って黒く覆う
# 3. 窓の口を掘ってから b18 の本体へ和 (Boolean UNION) で溶かし、元の箱を消す
# 4. 屋上: 取り込んだ所だけ 17.27m まで掘り下げ、建物全体の外周に沿って手すり壁 (0.25m) を残す
import bpy, bmesh, random, math
from mathutils import Vector, geometry

TOP = 17.72
ROOF, PARAPET = 17.27, 0.25
BOTTOM, STEP_OUT, STEP_TOP = 9.85, 0.3, 10.10
OUTLINE_Z = 14.5   # 建物全体の外周を取る高さ (1 階の窓の上、2 階の窓の下。張り出しの 2 階も入る)
WINDOW_FREE = 4.5
BAY = 3.3
EDGE_MARGIN = 1.7
ROWS = [  # (種類, 幅, 下端, 上端, 奥行き, 格子)
    ('small', 0.6, 12.18, 12.78, 0.3, True),
    ('glass', 1.0, 15.6, 16.8, 0.3, False),
    ('boards', 2.4, 15.4, 16.6, 1.5, False),
]

bu = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/board_up.py').read(), bu)
fa = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/facade.py').read(), fa)


def _oriented_box(bm, origin, u, n, ua, ub, za, zb, da, db):
    """壁の向き (u = 壁に沿った向き、n = 外向き) に沿った箱。origin は壁の面の上の点"""
    def at(uu, zz, dd):
        p = origin + u * uu + n * dd
        return Vector((p.x, p.y, zz))
    v = [bm.verts.new(at(uu, zz, dd)) for zz in (za, zb) for dd in (da, db) for uu in (ua, ub)]
    for idx in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([v[i] for i in idx])


def _union(body, add_bm):
    bmesh.ops.recalc_face_normals(add_bm, faces=add_bm.faces)
    me = bpy.data.meshes.new('_add'); add_bm.to_mesh(me); add_bm.free()
    ob = bpy.data.objects.new('_add', me); bpy.context.scene.collection.objects.link(ob)
    mod = body.modifiers.new('add', 'BOOLEAN'); mod.operation = 'UNION'; mod.solver = 'EXACT'; mod.object = ob
    # 本体は元の b18 と増築を重ねて足した形 (中で面が交わっている)。自分の交わりも解かないと
    # 増築の 1 階が消えた
    mod.use_self = True; mod.use_hole_tolerant = True
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    body.modifiers.remove(mod); bpy.data.objects.remove(ob, do_unlink=True); bpy.data.meshes.remove(me)
    old = body.data; name = old.name
    for i, m in enumerate(old.materials):
        if i >= len(baked.materials):
            baked.materials.append(m)
    body.data = baked
    if old.users == 0:
        bpy.data.meshes.remove(old)
    baked.name = name
    empty = [i for i, m in enumerate(baked.materials) if m is None]
    for i in reversed(empty):
        for p in baked.polygons:
            if p.material_index == i:
                p.material_index = 0
            elif p.material_index > i:
                p.material_index -= 1
        baked.materials.pop(index=i)


def _hull(bm):
    pts = [v.co.xy for v in bm.verts]
    idx = geometry.convex_hull_2d(pts)
    ring = [pts[i].copy() for i in idx]
    area = sum(ring[i].x * ring[i - 1].y - ring[i - 1].x * ring[i].y for i in range(len(ring)))
    return ring if area < 0 else ring[::-1]  # 反時計回り


def _offset(pts, d):
    """反時計回りの輪を外へ d だけ広げる (d < 0 で内へ)"""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector((*pts[i - 1][:2], 0)), Vector((*pts[i][:2], 0)), Vector((*pts[(i + 1) % n][:2], 0))
        t0 = (p1 - p0).normalized(); t1 = (p2 - p1).normalized()
        n0 = Vector((t0.y, -t0.x, 0)); n1 = Vector((t1.y, -t1.x, 0))
        m = n0 + n1
        q = p1 + m * (d / max(m.dot(n0), 1e-6))
        out.append((q.x, q.y))
    return out


def _prism(bm, pts, z0, z1):
    bottom = [bm.verts.new((p[0], p[1], z0)) for p in pts]
    top = [bm.verts.new((p[0], p[1], z1)) for p in pts]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))


def _obj(name, bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def _drop(ob):
    me = ob.data; bpy.data.objects.remove(ob, do_unlink=True); bpy.data.meshes.remove(me)


# 2026-10-17 に b18 へ合わせた物。座標は世界 (m)。
# Cube.005: 路地の口の上を西の通りへ張り出した 2 階 (L 字)。全く同じ箱 Cube.012 が同じ位置に重なっていたので一緒に消す
# concrete_building20: 南へ 40° 振れて伸びる棟。**北西の角は増築の西の壁 (x = -3.88) の線に乗せる** — 元の角は
#   12cm 外にあって、和を取ると 1 階の高さに細い隙間が開いた (本人 2026-10-17「ここ穴空いてるでしょ」)
# concrete_building3.004: 路地の口の閉まりかけのシャッター (metal_shutter.007) の横の壁待ちの壁。張り出しの下端 (13.1) まで。
#   外の面を増築の西の壁 (x = -3.88) に揃える (元は 1cm ずれていた)
B18_PIECES = [
    ('Cube.005', {'windows': True, 'z0': 13.1, 'z1': TOP, 'also_remove': ['Cube.012'],
                  'outline': [(-5.72, -20.46), (5.84, -20.46), (5.84, -17.42), (6.63, -17.42), (6.63, -6.27), (-5.72, -6.27)]}),
    ('concrete_building20', {'windows': True, 'plinth': True, 'z1': TOP,
                             'outline': [(-3.88, -20.0), (-3.88, -20.643), (1.74, -27.36), (3.72, -25.7), (-2.02, -18.84)]}),
    ('concrete_building3.004', {'windows': False, 'z1': 13.15,
                                'outline': [(-3.88, -14.74), (-3.76, -14.74), (-3.76, -13.92), (-3.88, -13.92)]}),
]

FOOTPRINTS = []   # 取り込んだ物の床の形 (屋上を掘る範囲)


def absorb(name, opt):
    with_windows = opt.get('windows', False)
    scene = bpy.context.scene
    body = bpy.data.objects['concrete_building18']
    src = bpy.data.objects[name]
    # 1) 形は写さず、床の形 (outline、無ければ元の箱の外接の凸包) から角柱を組み直す。
    #    元の箱は Bevel の名残で面から 14cm 浮いた頂点が混じっていて、和を取ると穴が開いた
    sb = bmesh.new(); sb.from_mesh(src.data); sb.transform(src.matrix_world)
    ring = opt.get('outline') or _hull(sb)
    z0 = opt.get('z0', max(BOTTOM, min(v.co.z for v in sb.verts)))
    z1 = opt.get('z1', min(TOP, max(v.co.z for v in sb.verts)))
    sb.free()
    bm = bmesh.new(); _prism(bm, ring, z0, z1)
    bm.normal_update()
    hull = [Vector(p[:2]) for p in ring]
    FOOTPRINTS.append(hull)
    if opt.get('plinth'):
        _prism(bm, _offset(hull, STEP_OUT), BOTTOM, STEP_TOP)
    # 2) 窓の口 (掘る箱) と中身
    rnd = random.Random(hash(name) & 0xffff)
    cut = bmesh.new()
    glass, bars, boards, liner = (bmesh.new() for _ in range(4))
    placed = 0
    if with_windows:
        # いま (掘る前) の場面で前の空きを測る。この箱自身は除いて測りたいので、隠してから引く
        src.hide_set(True); src.hide_viewport = True
        dg = bpy.context.evaluated_depsgraph_get()
        for f in list(bm.faces):
            n = f.normal.copy(); n.z = 0
            if n.length < 0.9 or f.calc_area() < 4.0:
                continue
            n.normalize()
            u = Vector((-n.y, n.x, 0))
            vs = [v.co for v in f.verts]
            z_lo, z_hi = min(v.z for v in vs), max(v.z for v in vs)
            origin = f.calc_center_median(); origin.z = 0
            us = [ (v - origin).dot(u) for v in vs ]
            u0, u1 = min(us), max(us)
            length = u1 - u0 - 2 * EDGE_MARGIN
            if length < 0.5:
                continue
            count = max(1, int(length // BAY) + 1)
            bays = [(u0 + u1) / 2] if count == 1 else [u0 + EDGE_MARGIN + length / (count - 1) * k for k in range(count)]
            for k, uc in enumerate(bays):
                for kind, width, za, zb, depth, has_bars in ROWS:
                    if za < z_lo + 0.2 or zb > z_hi - 0.2:
                        continue
                    # 2 階はガラスと板を交互、1 階の小窓は板の下にだけ
                    if kind == 'glass' and k % 2 == 1:
                        continue
                    if kind in ('boards', 'small') and k % 2 == 0:
                        continue
                    # 前が空いているか (その窓の高さで)
                    p = origin + u * uc + n * 0.05
                    r = scene.ray_cast(dg, Vector((p.x, p.y, (za + zb) / 2)), n)
                    if r[0] and (r[1] - Vector((p.x, p.y, (za + zb) / 2))).length < WINDOW_FREE:
                        continue
                    h = width / 2
                    _oriented_box(cut, origin, u, n, uc - h, uc + h, za, zb, -depth, 0.4)
                    if kind == 'boards':
                        z = za + 0.01
                        while z < zb - 0.06:
                            t = min(z + 0.272, zb - 0.01)
                            _oriented_box(boards, origin, u, n, uc - h + 0.01 + rnd.uniform(0, 0.03), uc + h - 0.01 - rnd.uniform(0, 0.03), z, t, -0.3, -0.26)
                            z = t + 0.02
                        e = 0.005
                        _oriented_box(liner, origin, u, n, uc - h + e, uc + h - e, za + e, zb - e, -depth + e, -depth + e + 0.002)
                        for zz in ((za + e, za + e + 0.002), (zb - e - 0.002, zb - e)):
                            _oriented_box(liner, origin, u, n, uc - h + e, uc + h - e, zz[0], zz[1], -depth + e, -0.35)
                        for uu in ((uc - h + e, uc - h + e + 0.002), (uc + h - e - 0.002, uc + h - e)):
                            _oriented_box(liner, origin, u, n, uu[0], uu[1], za + e, zb - e, -depth + e, -0.35)
                    else:
                        q0 = origin + u * (uc - h) - n * 0.16; q1 = origin + u * (uc + h) - n * 0.16
                        glass.faces.new([glass.verts.new(Vector((q.x, q.y, zz))) for q, zz in ((q0, za), (q1, za), (q1, zb), (q0, zb))])
                        if has_bars:
                            nb = max(2, round(width / 0.12))
                            for j in range(1, nb):
                                uu = uc - h + width * j / nb
                                _oriented_box(bars, origin, u, n, uu - 0.01, uu + 0.01, za, zb, -0.08, -0.06)
                    placed += 1
        src.hide_set(False); src.hide_viewport = False
    # 3) 窓の口を掘ってから本体へ合わせる
    me = bpy.data.meshes.new('_part'); bm.to_mesh(me); bm.free()
    part = bpy.data.objects.new('_part', me); scene.collection.objects.link(part)
    if len(cut.faces):
        bmesh.ops.recalc_face_normals(cut, faces=cut.faces)
        cme = bpy.data.meshes.new('_cut'); cut.to_mesh(cme); cut.free()
        cob = bpy.data.objects.new('_cut', cme); scene.collection.objects.link(cob)
        mod = part.modifiers.new('cut', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cob
        mod.use_self = True  # 足元の段と本体が重なっている
        dg = bpy.context.evaluated_depsgraph_get()
        baked = bpy.data.meshes.new_from_object(part.evaluated_get(dg))
        part.modifiers.clear(); bpy.data.objects.remove(cob, do_unlink=True); bpy.data.meshes.remove(cme)
    else:
        cut.free()
        baked = me.copy()
    pb = bmesh.new(); pb.from_mesh(baked); bpy.data.meshes.remove(baked)
    bpy.data.objects.remove(part, do_unlink=True); bpy.data.meshes.remove(me)
    if opt.get('plinth'):
        # 段と本体が重なっているので、先に自分の中で 1 つにする
        tmp = _obj('_self', pb)
        mod = tmp.modifiers.new('self', 'BOOLEAN'); mod.operation = 'UNION'; mod.solver = 'EXACT'
        mod.use_self = True
        empty = _obj('_empty', bmesh.new()); mod.object = empty
        dg = bpy.context.evaluated_depsgraph_get()
        baked = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        _drop(tmp); _drop(empty)
        pb = bmesh.new(); pb.from_mesh(baked); bpy.data.meshes.remove(baked)
    _union(body, pb)
    # 窓の口の中身を b18 の物へ足す
    for bm_, oname, mat, s in ((glass, 'glass_building18_panes_notexture', 'dark_glass', 1.0),
                               (bars, 'metal_building18_bars', 'dark_steel', 2.0),
                               (boards, 'wood_building18_boards', 'wood_frame', 1.67),
                               (liner, 'vis_building18_interior_notexture', 'wire_black', 1.0)):
        if len(bm_.faces):
            bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
            bu['_add_to'](oname, bm_, mat, s)
        else:
            bm_.free()
    # 元の箱を消す (形を共有していても消すのはこの物だけ)
    bpy.data.objects.remove(src, do_unlink=True)
    for other in opt.get('also_remove', []):
        if other in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[other], do_unlink=True)
    return {'name': name, 'windows': placed}


def roof():
    """取り込んだ所の屋上を ROOF まで掘る。建物全体の外周の内側 PARAPET だけ残して手すり壁にする
    (取り込んだ物の縁が屋上の中に来る所は手すり壁にしない)"""
    fb = {}
    exec(open('/Users/yuma/workspace/mgo2http/tools/gen/flush_band.py').read(), fb)
    body = bpy.data.objects['concrete_building18']
    ring = fb['outline'](body, OUTLINE_Z)
    for hull in FOOTPRINTS:
        a = bmesh.new(); _prism(a, _offset(ring, -PARAPET), ROOF, TOP + 1.0)
        inner = _obj('_roof_in', a)
        b = bmesh.new(); _prism(b, hull, ROOF - 0.5, TOP + 1.5)
        foot = _obj('_roof_foot', b)
        mod = inner.modifiers.new('and', 'BOOLEAN'); mod.operation = 'INTERSECT'; mod.solver = 'EXACT'; mod.object = foot
        dg = bpy.context.evaluated_depsgraph_get()
        cme = bpy.data.meshes.new_from_object(inner.evaluated_get(dg))
        _drop(inner); _drop(foot)
        cutter = bpy.data.objects.new('_roof_cut', cme); bpy.context.scene.collection.objects.link(cutter)
        mod = body.modifiers.new('roof', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
        mod.use_self = True; mod.use_hole_tolerant = True
        dg = bpy.context.evaluated_depsgraph_get()
        baked = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
        body.modifiers.remove(mod); _drop(cutter)
        old = body.data; name = old.name; body.data = baked
        if old.users == 0:
            bpy.data.meshes.remove(old)
        baked.name = name


def _seal(bm, w):
    """和と屋上掘りの後始末。開いた辺 (面が 1 枚だけの辺) を 0 にする
    - 重なった頂点をまとめる
    - T 字の継ぎ目 (片側だけ辺が割れている) を、割れている点で反対側も割って縫う
    - 屋上に残った厚みのない板 (取り込んだ物の縁が屋上の中に来る所、高さ 0.45m) を消す
    """
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    for _ in range(3):
        opened = [e for e in bm.edges if len(e.link_faces) == 1]
        ends = set(v for e in opened for v in e.verts)
        split = 0
        for e in opened:
            if not e.is_valid:
                continue
            a, c = e.verts; d = c.co - a.co; L = d.length
            on = [v for v in ends if v not in (a, c) and v.is_valid and 1e-4 < (v.co - a.co).dot(d) / L < L - 1e-4
                  and ((v.co - a.co) - d * ((v.co - a.co).dot(d) / L / L)).length < 0.002]
            if on:
                v = min(on, key=lambda v: (v.co - a.co).length)
                _, nv = bmesh.utils.edge_split(e, a, (v.co - a.co).length / L)
                nv.co = v.co.copy(); split += 1
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
        if not split:
            break
    for _ in range(4):
        fins = set()
        for e in bm.edges:
            if len(e.link_faces) != 1:
                continue
            f = e.link_faces[0]
            zs = [(w @ v.co).z for v in f.verts]
            if abs(f.normal.z) < 0.1 and min(zs) > ROOF - 0.07 and max(zs) < TOP + 0.03:
                fins.add(f)
        if not fins:
            break
        bmesh.ops.delete(bm, geom=list(fins), context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return sum(1 for e in bm.edges if len(e.link_faces) == 1)


def finish():
    """穴を塞ぎ、本体の平らな面をまとめ、UV を座標から付け直す (plaster_alley、1m で 0.5)"""
    body = bpy.data.objects['concrete_building18']
    bm = bmesh.new(); bm.from_mesh(body.data)
    print('open edges', _seal(bm, body.matrix_world))
    bmesh.ops.dissolve_limit(bm, angle_limit=0.001, verts=bm.verts, edges=bm.edges)
    bm.transform(body.matrix_world); bm.normal_update(); fa['_uv_world'](bm, 0.5)
    bm.transform(body.matrix_world.inverted()); bm.to_mesh(body.data); bm.free()
    body.data.materials.clear(); body.data.materials.append(bpy.data.materials['plaster_alley'])
    for p in body.data.polygons:
        p.material_index = 0


if globals().get('ABSORB'):
    for _name, _opt in (B18_PIECES if ABSORB is True else ABSORB):
        print(absorb(_name, _opt))
    roof()
    finish()
