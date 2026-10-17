# b18 の南と東に付いていた箱 3 つ (concrete_building19 / 19.001 / 3.004) を消して、b18 と
# 同じ作りの増築部分として建て直し、b18 の本体に合わせる (本人 2026-10-17「一つの建物として
# 作り直して、高さやトンマナは 18 に揃えて」)。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/extend_b18.py').read(), {'EXTEND_B18': True})
#
# --- b18 の作り (測った値) ---
#   本体 9.85〜17.72m、屋上は 17.27m まで下げて手すり壁を残す。plaster_alley (UV 1m で 0.5)
#   足元の段: 外へ 0.3m、上面 10.10m
#   1 階: シャッター 幅 2.3m × 10.13〜13.03m / 格子の小窓 0.6m × 12.18〜12.78m
#   2 階: ガラス窓 1.0m × 15.6〜16.8m / 板で塞いだ窓 2.4m × 15.4〜16.6m
import bpy, bmesh, random
from mathutils import Vector

ns = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/facade.py').read(), ns)
bu = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/board_up.py').read(), bu)
Face, _box, _uv_world = ns['Face'], ns['_box'], ns['_uv_world']

BOTTOM, TOP, ROOF = 9.85, 17.72, 17.27
PARAPET = 0.25
STEP_OUT, STEP_TOP = 0.3, 10.10
BAY = 3.3          # 窓の間隔
EDGE_MARGIN = 0.9  # 角から窓までの余白

# 増築部分の外周 (反時計回り)。北の辺 (y = -13.99) と西の短い辺 (x = 3.54) は b18 に接していて見えない
OUTLINE = [(-3.88, -13.99), (-3.88, -20.46), (9.05, -20.46), (9.05, -18.99), (16.47, -18.99),
           (16.47, -13.12), (3.54, -13.12), (3.54, -13.99)]
HIDDEN = {6, 7}    # 見えない辺 (OUTLINE[i] → OUTLINE[i+1])
REMOVE = ['concrete_building19', 'concrete_building19.001', 'concrete_building3.004']


def _prism(bm, pts, z0, z1):
    bottom = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))


def _offset(pts, d):
    """外周を外へ d だけ広げる (軸に沿った辺だけを想定)"""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        t0 = (p1 - p0).normalized(); t1 = (p2 - p1).normalized()
        n0 = Vector((t0.y, -t0.x)); n1 = Vector((t1.y, -t1.x))
        # 2 本の辺を外へ d ずらした線の交点
        m = n0 + n1
        k = d / max(m.dot(n0), 1e-6)
        q = p1 + m * k
        out.append((q.x, q.y))
    return out


def _edge_faces():
    """見える辺ごとの Face (facade.py の形: 軸・位置・外向き) と、壁に沿った範囲"""
    out = []
    for i in range(len(OUTLINE)):
        if i in HIDDEN:
            continue
        a, b = Vector(OUTLINE[i]), Vector(OUTLINE[(i + 1) % len(OUTLINE)])
        t = (b - a).normalized()
        n = Vector((t.y, -t.x))
        if abs(n.x) > 0.5:
            face = Face('x', a.x, 1 if n.x > 0 else -1)
            u0, u1 = sorted((a.y, b.y))
        else:
            face = Face('y', a.y, 1 if n.y > 0 else -1)
            u0, u1 = sorted((a.x, b.x))
        out.append((face, u0, u1))
    return out


def _bays(u0, u1):
    length = u1 - u0 - 2 * EDGE_MARGIN
    if length < 1.2:
        return []
    count = max(1, int(length // BAY) + 1)
    if count == 1:
        return [(u0 + u1) / 2]
    step = length / (count - 1)
    return [u0 + EDGE_MARGIN + step * k for k in range(count)]


def windows():
    rows = []
    for face, u0, u1 in _edge_faces():
        for k, u in enumerate(_bays(u0, u1)):
            # 1 階はシャッターと格子の小窓を交互、2 階はガラス窓と板の窓を交互 (上下でずらす)
            if k % 2 == 0:
                rows.append(dict(face=face, u0=u - 1.15, u1=u + 1.15, z0=10.13, z1=13.03, kind='shutter', depth=0.3))
                rows.append(dict(face=face, u0=u - 0.5, u1=u + 0.5, z0=15.6, z1=16.8, kind='glass', depth=0.3))
            else:
                rows.append(dict(face=face, u0=u - 0.3, u1=u + 0.3, z0=12.18, z1=12.78, kind='glass', bars=True, depth=0.3))
                rows.append(dict(face=face, u0=u - 1.2, u1=u + 1.2, z0=15.4, z1=16.6, kind='boards', depth=1.5))
    return rows


def build():
    scene = bpy.context.scene
    for name in REMOVE:
        o = bpy.data.objects.get(name)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    rows = windows()
    # --- 本体: 角柱 + 足元の段。窓の口と屋上を掘る ---
    bm = bmesh.new()
    _prism(bm, OUTLINE, BOTTOM, TOP)
    _prism(bm, _offset(OUTLINE, STEP_OUT), BOTTOM, STEP_TOP)
    me = bpy.data.meshes.new('_b18_ext'); bm.to_mesh(me); bm.free()
    ext = bpy.data.objects.new('_b18_ext', me); scene.collection.objects.link(ext)
    cut = bmesh.new()
    _prism(cut, _offset(OUTLINE, -PARAPET), ROOF, TOP + 1)
    for w in rows:
        a, b = w['face'].box(w['u0'], w['u1'], w['z0'], w['z1'], -w['depth'], 0.4)
        _box(cut, a, b)
    bmesh.ops.recalc_face_normals(cut, faces=cut.faces)
    cme = bpy.data.meshes.new('_b18_cut'); cut.to_mesh(cme); cut.free()
    cutter = bpy.data.objects.new('_b18_cut', cme); scene.collection.objects.link(cutter)
    # 足元の段と本体は重なっているので先に 1 つにしてから掘る
    mod = ext.modifiers.new('cut', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
    mod.use_self = True  # 段と本体の重なりも 1 つの形として解く
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(ext.evaluated_get(dg))
    bpy.data.objects.remove(ext, do_unlink=True); bpy.data.meshes.remove(me)
    bpy.data.objects.remove(cutter, do_unlink=True); bpy.data.meshes.remove(cme)
    bm = bmesh.new(); bm.from_mesh(baked); bpy.data.meshes.remove(baked)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.001, verts=bm.verts, edges=bm.edges)
    bm.normal_update(); _uv_world(bm, 0.5)
    # b18 の本体へ合わせる (本体の空間へ移して足す)
    body = bpy.data.objects['concrete_building18']
    bm.transform(body.matrix_world.inverted())
    tmp = bpy.data.meshes.new('_tmp'); bm.to_mesh(tmp); bm.free()
    old = bmesh.new(); old.from_mesh(body.data); old.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    old.to_mesh(body.data); old.free(); body.data.update()
    # --- 窓の中身: b18 の物へ足す ---
    rnd = random.Random(18)
    glass, shutter, bars, boards, liner = (bmesh.new() for _ in range(5))
    for w in rows:
        f, u0, u1, z0, z1 = w['face'], w['u0'], w['u1'], w['z0'], w['z1']
        if w['kind'] == 'shutter':
            a, b = f.box(u0, u1, z0, z1, -0.22, -0.2); _box(shutter, a, b)
        elif w['kind'] == 'boards':
            z = z0 + 0.01
            while z < z1 - 0.06:
                top = min(z + 0.272, z1 - 0.01)
                a, b = f.box(u0 + 0.01 + rnd.uniform(0, 0.03), u1 - 0.01 - rnd.uniform(0, 0.03), z, top, -0.3, -0.26)
                _box(boards, a, b)
                z = top + 0.02
            e = 0.005
            a, b = f.box(u0 + e, u1 - e, z0 + e, z1 - e, -w['depth'] + e, -w['depth'] + e + 0.002); _box(liner, a, b)
            for za, zb in ((z0 + e, z0 + e + 0.002), (z1 - e - 0.002, z1 - e)):
                a, b = f.box(u0 + e, u1 - e, za, zb, -w['depth'] + e, -0.35); _box(liner, a, b)
            for ua, ub in ((u0 + e, u0 + e + 0.002), (u1 - e - 0.002, u1 - e)):
                a, b = f.box(ua, ub, z0 + e, z1 - e, -w['depth'] + e, -0.35); _box(liner, a, b)
        else:
            f.quad(glass, u0, u1, z0, z1, -0.16)
            if w.get('bars'):
                nb = max(2, round((u1 - u0) / 0.12))
                for k in range(1, nb):
                    u = u0 + (u1 - u0) * k / nb
                    a, b = f.box(u - 0.01, u + 0.01, z0, z1, -0.08, -0.06); _box(bars, a, b)
    add = bu['_add_to']
    for bm_, name, mat, s in ((glass, 'glass_building18_panes_notexture', 'dark_glass', 1.0),
                              (shutter, 'metal_building18_shutters', 'shutter', 1.0),
                              (bars, 'metal_building18_bars', 'dark_steel', 2.0),
                              (boards, 'wood_building18_boards', 'wood_frame', 1.67),
                              (liner, 'vis_building18_interior_notexture', 'wire_black', 1.0)):
        if len(bm_.faces):
            bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
            add(name, bm_, mat, s)
        else:
            bm_.free()
    return {'windows': len(rows), 'body_faces': len(body.data.polygons)}


if globals().get('EXTEND_B18'):
    print(build())
