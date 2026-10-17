# 2 階より上の窓のシャッターを、木の板で塞いだ窓に替える。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/board_up.py').read(), {'BOARD_UP': ['metal_building10_shutters', ...]})
#
# --- なぜ ---
# 2 階の窓にシャッターは無い (本人 2026-10-16「やるなら木で塞がれてるとか」)。1 階の
# シャッター (店の口・車庫) はそのまま残す。
#
# --- やること (シャッター 1 枚ごと) ---
# 1. シャッターの板を消す
# 2. 同じ口に木の板を横に打ち付ける (tools/gen/facade.py の kind='boards' と同じ寸法)
# 3. 板の奥を掘る。シャッターは口の一番奥に付いていて、そのままだと板の隙間から 2cm 先に
#    壁が見えてハリボテと分かる。建物の本体を BOARD_DEPTH まで掘り (向こうの壁が近ければ
#    手前で止める)、奥を黒い内張りで覆う
#
# シャッターの板の見分け方: 厚さ 6cm 未満・高さ 60cm 以上・下端が 1 階より上 (UPPER_Z)。
# **斜めの壁にも付いている** (b32 は 45°)。向きは形から測る (水平に見て一番薄い向きが壁の法線)。
# 巻き取りの箱 (b15 の 18cm の箱) は高さで外れる。
import bpy, bmesh, random
from mathutils import Vector

UPPER_Z = 11.5          # これより下端が高いシャッターを 2 階以上と見る (地面 10m)
BOARD_H, BOARD_GAP, BOARD_T = 0.272, 0.02, 0.04
BOARD_DEPTH = 1.5       # 板の奥を掘る深さ
WALL_LEFT = 0.3         # 向こうの壁をこれだけ残す
LINER_FROM = 0.05       # 板からこれだけ奥から黒く覆う


def _components(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.transform(obj.matrix_world)
    seen, out = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        stack, comp = [v], []
        seen.add(v)
        while stack:
            x = stack.pop(); comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in seen:
                    seen.add(y); stack.append(y)
        lo = Vector([min(p.co[i] for p in comp) for i in range(3)])
        hi = Vector([max(p.co[i] for p in comp) for i in range(3)])
        out.append((lo, hi, {p.index for p in comp}, [p.co.copy() for p in comp]))
    bm.free()
    return out


def _thin_axis(points):
    """水平に見て一番薄い向き (単位、z = 0) と、その向きの厚さ・直交する向きの幅"""
    n = len(points)
    mx = sum(p.x for p in points) / n
    my = sum(p.y for p in points) / n
    sxx = sum((p.x - mx) ** 2 for p in points)
    syy = sum((p.y - my) ** 2 for p in points)
    sxy = sum((p.x - mx) * (p.y - my) for p in points)
    # 2x2 の共分散の小さいほうの固有ベクトル
    tr, det = sxx + syy, sxx * syy - sxy * sxy
    small = tr / 2 - ((tr / 2) ** 2 - det) ** 0.5
    v = Vector((sxy, small - sxx, 0)) if abs(sxy) > 1e-9 else (Vector((1, 0, 0)) if sxx < syy else Vector((0, 1, 0)))
    v.normalize()
    u = Vector((-v.y, v.x, 0))
    thick = max(p.dot(v) for p in points) - min(p.dot(v) for p in points)
    return v, u, thick


def _box(bm, lo, hi):
    x0, y0, z0 = lo; x1, y1, z1 = hi
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                   (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in idx])


def _uv(bm, scale):
    uv = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        for l in f.loops:
            p = l.vert.co
            t = (p.x, p.y) if abs(n.z) > 0.7 else ((p.y, p.z) if abs(n.x) > abs(n.y) else (p.x, p.z))
            l[uv].uv = (t[0] * scale, t[1] * scale)


def _add_to(name, bm, mat, scale):
    """name の物へ足す (無ければ作る)。世界の座標の bm を物の空間へ移して足す"""
    _uv(bm, scale)
    obj = bpy.data.objects.get(name)
    if obj is None:
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me); bm.free()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        me.materials.append(bpy.data.materials[mat])
        return obj
    old = bmesh.new(); old.from_mesh(obj.data)
    bm.transform(obj.matrix_world.inverted())
    tmp = bpy.data.meshes.new('_tmp'); bm.to_mesh(tmp); bm.free()
    old.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    old.to_mesh(obj.data); old.free()
    return obj


def board_up(names, seed=16):
    rnd = random.Random(seed)
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    cutters = {}      # 本体の名前 → 掘る箱の bmesh (世界)
    report = {}
    for name in names:
        shutter = bpy.data.objects[name]
        tag = name[len('metal_'):-len('_shutters')] if name.startswith('metal_') and name.endswith('_shutters') else name
        boards, liner = bmesh.new(), bmesh.new()
        drop = set()
        done = 0
        for lo, hi, verts, points in _components(shutter):
            ext = hi - lo
            n, u, thick = _thin_axis(points)
            if thick > 0.06 or ext.z < 0.6 or lo.z < UPPER_Z:
                continue
            c = (lo + hi) / 2
            # 外はどちらか: 板のすぐ外から線を引いて、遠い (空いている) ほうが外
            far = {}
            for s in (1, -1):
                r = scene.ray_cast(dg, c + n * s * (thick / 2 + 0.003), n * s)
                far[s] = (r[1] - c).length if r[0] else 1e9
            out = n * (1 if far[1] > far[-1] else -1)
            # 掘る本体。**シャッターの裏から**奥へ線を引く (表から引くとシャッター自身に当たる)。
            # 当たった所が口の一番奥の壁で、以後の基準 (back) にする
            r = scene.ray_cast(dg, c - out * (thick / 2 + 0.002), -out)
            if not r[0] or r[4] == shutter:
                continue
            body = r[4]
            back = r[1].copy()
            # 向こうの壁までの距離 (本体の中から奥へ線を引く)
            inner = scene.ray_cast(dg, back - out * 0.05, -out)
            room = (inner[1] - back).length if inner[0] else BOARD_DEPTH + WALL_LEFT
            depth = max(0.3, min(BOARD_DEPTH, room - WALL_LEFT))
            # 口の広さ (壁に沿った向き u と高さ z)
            u0, u1 = min(p.dot(u) for p in points), max(p.dot(u) for p in points)
            z0, z1 = lo.z, hi.z

            def at(uu, zz, d):
                """壁に沿った位置 uu・高さ zz・外向きに d の点 (d は back から)"""
                p = back + out * d
                p = p - u * p.dot(u) + u * uu
                p.z = zz
                return p

            def box(bm, ua, ub, za, zb, da, db):
                # 壁の向きに沿った箱 (斜めの壁でも)。面の向きは後でまとめて外へ揃える
                v = [bm.verts.new(at(uu, zz, dd)) for zz in (za, zb) for dd in (da, db) for uu in (ua, ub)]
                for idx in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
                    bm.faces.new([v[i] for i in idx])

            # 板。シャッターが居た所 (口の奥) に横に打つ。長さは 1 枚ずつ少しずらす
            z = z0 + 0.01
            while z < z1 - 0.06:
                top = min(z + BOARD_H, z1 - 0.01)
                box(boards, u0 + 0.01 + rnd.uniform(0, 0.03), u1 - 0.01 - rnd.uniform(0, 0.03), z, top, 0.0, BOARD_T)
                z = top + BOARD_GAP
            # 掘る箱 (本体ごとにまとめて 1 回で掘る)
            cut = cutters.setdefault(body.name, bmesh.new())
            box(cut, u0, u1, z0, z1, -depth, 0.02)
            # 黒い内張り。奥の面と、上下左右の内側
            e = 0.005
            box(liner, u0 + e, u1 - e, z0 + e, z1 - e, -depth + e, -depth + e + 0.002)
            for za, zb in ((z0 + e, z0 + e + 0.002), (z1 - e - 0.002, z1 - e)):
                box(liner, u0 + e, u1 - e, za, zb, -depth + e, -LINER_FROM)
            for ua, ub in ((u0 + e, u0 + e + 0.002), (u1 - e - 0.002, u1 - e)):
                box(liner, ua, ub, z0 + e, z1 - e, -depth + e, -LINER_FROM)
            drop |= verts
            done += 1
        if not done:
            boards.free(); liner.free()
            continue
        for b_ in (boards, liner):
            bmesh.ops.recalc_face_normals(b_, faces=b_.faces)
        # シャッターの板を消す
        bm = bmesh.new(); bm.from_mesh(shutter.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context='VERTS')
        bm.to_mesh(shutter.data); bm.free(); shutter.data.update()
        _add_to(f'wood_{tag}_boards', boards, 'wood_frame', 1.67)
        _add_to(f'vis_{tag}_interior_notexture', liner, 'wire_black', 1.0)
        report[name] = done
    # 本体を掘る。本体ごとに 1 回の Boolean (EXACT) で焼き付ける
    for body_name, cut in cutters.items():
        body = bpy.data.objects[body_name]
        if body.data.users > 1:
            body.data = body.data.copy()
        bmesh.ops.recalc_face_normals(cut, faces=cut.faces)
        cme = bpy.data.meshes.new('_board_cut'); cut.to_mesh(cme); cut.free()
        cutter = bpy.data.objects.new('_board_cut', cme)
        scene.collection.objects.link(cutter)
        mod = body.modifiers.new('board_cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
        # 他の Modifier より先に掘る (掘った形に後の Modifier が掛かる)
        while body.modifiers.find('board_cut') > 0:
            with bpy.context.temp_override(object=body):
                bpy.ops.object.modifier_move_up(modifier='board_cut')
        dg = bpy.context.evaluated_depsgraph_get()
        others = [m for m in body.modifiers if m.name != 'board_cut']
        for m in others:
            m.show_viewport = False
        dg.update()
        baked = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
        for m in others:
            m.show_viewport = True
        body.modifiers.remove(mod)
        bpy.data.objects.remove(cutter, do_unlink=True); bpy.data.meshes.remove(cme)
        old = body.data
        name = old.name
        for i, mat in enumerate(old.materials):
            if i >= len(baked.materials):
                baked.materials.append(mat)
        body.data = baked
        if old.users == 0:
            bpy.data.meshes.remove(old)
        baked.name = name
    return report


if globals().get('BOARD_UP'):
    print(board_up(BOARD_UP))
