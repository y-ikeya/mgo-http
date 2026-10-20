# 箱のような建物に「汚れ」を貼る: 足元の泥の帯・屋根の縁からの雨だれ・角の欠け。
# 生成器で作った建物 (compound) と同じ見え方を、手で置いた箱 (snipePoint1 の concrete_cube など) にも出す。
#
#   exec(open('tools/gen/dirty.py').read(), {'DIRTY': {'body': 'concrete_cube', 'tag': 'sp1', 'ground': 10.0,
#                                                        'roof_tag': 'sp1roof', 'roof': 'cube'}})
#
# 泥: 地面 + 0.2 で本体を水平に切った輪郭に沿って、外へ 1cm 浮かせた帯。**壁 1 面に 1 本**
#     (同じ直線上の辺はつなぐ)。高さは揃えて GRIME_H、絵は 2.3m ごとに繰り返す (横に一様なノイズ)。
#     以前は 2.3m ごとに板を分けて 10cm 空け、高さも板ごとに変えていた — 壁の途中の辺の
#     切れ目で余りの切れ端もできて、細切れに見えた (2026-10-09 本人)。
#     DIRTY に 'only': ['grime'] を渡すと泥だけ作り直す (雨だれ・角は乱数なので触らない)。
#     作り直す時は 'like_existing': True も渡す — いまの汚れが付いている壁にだけ作る (見えない側は外したまま)。
#     壁を別々の物で組んだ建物は 'body' に名前の並びを渡す (b6: concrete_wall6_east / north / south / west)。
#     2026-10-09 に全棟 (b3 b5 b6 b9 b10 b15 b17 b18 b22 b24 b31 b32 sp1) をこれで作り直した。
# 雨だれ: 壁の面ごとに 1〜3 本、壁の上端から 0.8〜1.6m 垂らす。細いので縞が半分の絵 (decal_streak_half)。
#     窓のある建物は 'windows' に窓の中身の物 (ガラス・板) の名前を渡す — 屋根の縁ではなく窓の下から垂らす
#     (b32 などの元からある建物と同じ)。'only': ['streak'] で雨だれだけ作り直せる。
#     b18: {'body': 'concrete_building18', 'tag': '18', 'ground': 10.103, 'only': ['streak'],
#           'windows': ['glass_building18_panes_notexture', 'wood_building18_boards']}
# 角: tools/gen/edge_wear.py。
import bpy, bmesh, random
from mathutils import Vector

E = 0.01
cfg = globals().get('DIRTY', {})
random.seed(cfg.get('seed', 5))
# 本体は 1 つか、壁を別々の物で組んだ建物 (b6 の concrete_wall6_*) なら名前の並び
BODIES = [bpy.data.objects[n] for n in (cfg['body'] if isinstance(cfg['body'], (list, tuple)) else [cfg['body']])]
body = BODIES[0]
TAG = cfg['tag']
GROUND = cfg.get('ground', 10.0)
grime_mat = bpy.data.materials['decal_grime']
streak_mat = bpy.data.materials.get('decal_streak_half') or bpy.data.materials['decal_streak']


def finish(name, bm, mat):
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    if not len(bm.faces):
        bm.free()
        return None
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def quad(bm, uv, pts, uvs):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    for loop, t in zip(f.loops, uvs):
        loop[uv].uv = t
    return f


def outline(zcut, min_len=0.3):
    """本体を z = zcut で切った輪郭の辺 [(a, b, 外向きの法線)]"""
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for part in BODIES:
        one = bmesh.new()
        one.from_mesh(part.evaluated_get(dg).data)
        one.transform(part.matrix_world)
        tmp = bpy.data.meshes.new('_dirty_tmp')
        one.to_mesh(tmp)
        one.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zcut), plane_no=(0, 0, 1), clear_inner=True, clear_outer=True)
    edges = [g for g in r['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
    pts = [v.co.copy() for e in edges for v in e.verts]
    c = sum(pts, Vector()) / max(1, len(pts))
    out = []
    for e in edges:
        a, b = e.verts[0].co.copy(), e.verts[1].co.copy()
        if (b - a).length < min_len:
            continue
        t = (b - a).normalized()
        n = Vector((t.y, -t.x, 0))
        if n.dot((a + b) / 2 - c) < 0:
            n = -n
        out.append((a, b, n))
    bm.free()
    return out


ONLY = cfg.get('only')
GRIME_H = cfg.get('grime_h', 1.0)  # 0.8 → 1.0 (本人 2026-10-16「1m くらいまで高く」)
GRIME_TILE = 2.3
# これより浅い奥まりは同じ壁 (m)
RECESS = 0.06


def runs(edges):
    """同じ壁の辺を 1 本にまとめる。間が空いていれば (入口) 分ける。

    **数 cm の奥まり (シャッター・扉の枠) は同じ壁として扱い、一番外の面に通す。**
    分けると奥まりの両脇に 0.7m ほどの切れ端が残り、奥の帯はシャッターに埋まった
    """
    groups = {}
    for a, b, n in edges:
        key = (round(n.x, 2), round(n.y, 2))
        groups.setdefault(key, []).append((a, b, n, a.to_2d().dot(n.to_2d())))
    out = []
    for items in groups.values():
        n = items[0][2]
        t = Vector((-n.y, n.x, 0))
        items.sort(key=lambda it: it[3])
        # 面からの距離が RECESS 以内の辺を 1 つの壁に
        walls = [[items[0]]]
        for it in items[1:]:
            if it[3] - walls[-1][-1][3] <= RECESS:
                walls[-1].append(it)
            else:
                walls.append([it])
        for wall in walls:
            offset = max(it[3] for it in wall)
            base = Vector((n.x, n.y, 0)) * offset
            spans = sorted(sorted((it[0].dot(t), it[1].dot(t))) for it in wall)
            merged = [list(spans[0])]
            for s0, s1 in spans[1:]:
                if s0 <= merged[-1][1] + RECESS + 0.02:
                    merged[-1][1] = max(merged[-1][1], s1)
                else:
                    merged.append([s0, s1])
            for s0, s1 in merged:
                out.append((base + t * s0, base + t * s1, n))
    return out


def keep_like(bm, uv, old):
    """いまある汚れ (old) が付いていた壁にだけ帯を残す。範囲もそこに揃える。

    見えない壁 (隣の建物に面した側) の汚れは前に外してある (2026-10 本人:
    見えない所は要らない)。作り直しで戻さないため。部屋の中の面 (古い帯より
    内側) は捨て、柱型の出っ張り (外側) は拾う。出っ張りの側面のような短い帯は、
    両端が残した帯に付いていれば残す。
    """
    M = old.matrix_world
    lines = []
    for p in old.data.polygons:
        n = M.to_3x3() @ p.normal
        n.z = 0
        if n.length < 0.5:
            continue
        lines.append((n.normalized(), [M @ old.data.vertices[i].co for i in p.vertices]))
    keep = set()
    for f in bm.faces:
        n = f.normal.copy(); n.z = 0
        if n.length < 0.5:
            continue
        n.normalize()
        t = Vector((-n.y, n.x, 0))
        ws = [v.co for v in f.verts]
        ss = [w.dot(t) for w in ws]
        s0, s1 = min(ss), max(ss)
        spans = []
        for on, ovs in lines:
            if abs(on.dot(n)) < 0.9:
                continue
            # 外か内かは古い帯の向き (壁から外へ) で測る。新しい帯は向きをまだ揃えていない
            off = sum(w.to_2d().dot(on.to_2d()) for w in ws) / len(ws)
            oo = sum(v.to_2d().dot(on.to_2d()) for v in ovs) / len(ovs)
            if not (oo - 0.1 <= off <= oo + 0.6):
                continue
            os_ = [v.dot(t) for v in ovs]
            if max(os_) > s0 - 0.3 and min(os_) < s1 + 0.3:
                spans.append((min(os_), max(os_)))
        if not spans:
            continue
        lo = max(s0, min(a for a, b in spans) - 0.35)
        hi = min(s1, max(b for a, b in spans) + 0.35)
        if hi - lo < 0.1:
            continue
        for l in f.loops:
            sv = l.vert.co.dot(t)
            if sv < lo or sv > hi:
                l.vert.co += t * (min(max(sv, lo), hi) - sv)
        for l in f.loops:
            l[uv].uv.x = (l.vert.co.dot(t) - lo) / GRIME_TILE
        keep.add(f)

    def ends(f):
        return [v.co.to_2d() for v in sorted(f.verts, key=lambda v: v.co.z)[:2]]
    kept = [e for f in keep for e in ends(f)]
    for f in bm.faces:
        if f in keep:
            continue
        e = ends(f)
        if (e[0] - e[1]).length < 0.7 and all(any((p - q).length < 0.06 for q in kept) for p in e):
            keep.add(f)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context='FACES')


# ---- 泥
if not ONLY or 'grime' in ONLY:
    gr = bmesh.new(); gr_uv = gr.loops.layers.uv.new('UVMap')
    # **短い辺も拾う** (柱型の出っ張りの側面は 30cm ほど)。捨てると出っ張りの
    # 両脇で帯が切れ、角から引いた分と合わせて細切れに見えた (2026-10-09 本人)
    for a, b, n in runs(outline(GROUND + 0.2, min_len=0.08)):
        L = (b - a).length
        if L < 0.08:
            continue
        t = (b - a).normalized()
        # 角まで通す。隣の面の帯とは角で突き合わせになる (外へ 1cm 浮かせてあるので重ならない)
        p0 = Vector((a.x, a.y, GROUND)) + n * E
        p1 = Vector((b.x, b.y, GROUND)) + n * E
        u1 = L / GRIME_TILE
        up = Vector((0, 0, GRIME_H))
        quad(gr, gr_uv, [p0, p1, p1 + up, p0 + up], ((0, 0), (u1, 0), (u1, 1), (0, 1)))
    # 'like_existing': True … いまの汚れが付いている壁にだけ作り直す (向きを揃えてから比べる)
    old = bpy.data.objects.get('vis_decal_b%s_grime_nouv' % TAG)
    if cfg.get('like_existing') and old:
        gr.normal_update()
        keep_like(gr, gr_uv, old)
    o = finish('vis_decal_b%s_grime_nouv' % TAG, gr, grime_mat)
    if o and ONLY:
        # 裏返った面を表へ (通しで回す時は下の角の段でまとめてやる)
        _fix = {}
        exec(open('/Users/yuma/workspace/mgo2http/tools/gen/edge_wear.py').read(), _fix)
        bpy.context.view_layer.update()
        print(o.name, 'flipped', _fix['fix_decal_normals'](o), 'faces', len(o.data.polygons))

# 雨だれと角は乱数で作るので、'only' を渡した時は作り直さない ('only': ['streak'] なら雨だれだけ)
WINDOWS = cfg.get('windows')


def window_openings():
    """窓の中身 (ガラス・板) の物から、窓 1 つずつの (下端の z, 幅の向き t, 中心, 幅)。
    板は 1 枚ずつ別のかたまりなので、同じ窓の板は中心でまとめる"""
    bu = {}
    exec(open('/Users/yuma/workspace/mgo2http/tools/gen/board_up.py').read(), bu)
    out = []
    for name in WINDOWS:
        for lo, hi, _, pts in bu['_components'](bpy.data.objects[name]):
            v, u, _ = bu['_thin_axis'](pts)
            c = (lo + hi) / 2
            us = [p.dot(u) for p in pts]
            # 板の窓の真下に 1 階の小窓がある所もある (b18 の東面) — 中心が近くても高さが離れていれば別の窓
            for w in out:
                if (w['c'].xy - c.xy).length < 0.5 and lo.z < w['top'] + 0.1 and hi.z > w['z'] - 0.1:
                    w['z'] = min(w['z'], lo.z); w['top'] = max(w['top'], hi.z)
                    break
            else:
                out.append({'z': lo.z, 'top': hi.z, 'v': v, 'u': u, 'c': c, 'w': max(us) - min(us)})
    return out


def wall_below(w):
    """窓の下の壁の外の面 (面の上の点, 外向き)。壁の外が無い (埋もれた窓・中庭の床の上に浮いた窓) なら None。
    本体は中の詰まった箱なので、外から戻る線だけが表の面に当たる"""
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    Mi = body.matrix_world.inverted()
    q = Vector((w['c'].x, w['c'].y, w['z'] - 0.3))
    for s in (1, -1):
        d = w['v'] * s
        o = q + d * 0.6
        ok, at, n, _ = ev.ray_cast(Mi @ o, (Mi.to_3x3() @ -d).normalized(), distance=1.2)
        if ok and (body.matrix_world.to_3x3() @ n).normalized().dot(d) > 0.5:
            at = body.matrix_world @ at
            # 前が詰まっている壁 (隣の建物まで 1.5m 無い) は人から見えない
            sc = bpy.context.scene
            hit = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), at + d * 0.05, d, distance=WINDOW_CLEAR)
            if hit[0]:
                return None
            return at, d
    return None


WINDOW_CLEAR = 1.5
# 本体の下端 (世界の z)。雨だれをここより下へ垂らさない
BOTTOM = min((b.matrix_world @ Vector(c)).z for b in BODIES for c in b.bound_box)
STEP = 0.1      # 縦に 10cm ごとに区切る (b32 の窓の下の雨だれと同じ作り。焼いた明るさが縦に滑らかになる)


def window_streak(bm, uv, at, d, c, w, top, h):
    t = Vector((-d.y, d.x, 0)).normalized()
    p = at + t * (c - at.dot(t)) + d * E
    p.z = 0
    vmax = random.uniform(0.8, 1.0)
    n = max(1, round(h / STEP))
    for i in range(n):
        z1 = top - h * i / n; z0 = top - h * (i + 1) / n
        v1 = vmax * i / n; v0 = vmax * (i + 1) / n
        quad(bm, uv, [p + t * (-w / 2) + Vector((0, 0, z0)), p + t * (w / 2) + Vector((0, 0, z0)),
                      p + t * (w / 2) + Vector((0, 0, z1)), p + t * (-w / 2) + Vector((0, 0, z1))],
             ((1, v0), (0, v0), (0, v1), (1, v1)))


if WINDOWS and (not ONLY or 'streak' in ONLY):
    # ---- 雨だれ (窓の下から)。他の建物 (b32 など) と同じく窓の下端の 2cm 下から垂らす。
    # 本人 2026-10-19「ほかの building で屋根から垂れてるってことがなかった」。
    # 幅 1m までの窓は窓の幅いっぱいに 1 本 (広い縞の絵)、板を打ち付けた広い窓は 2〜3 本 (細い縞の絵)
    wide = bpy.data.materials['decal_streak']
    st = bmesh.new(); st_uv = st.loops.layers.uv.new('UVMap')
    nr = bmesh.new(); nr_uv = nr.loops.layers.uv.new('UVMap')
    made = skipped = 0
    for w in window_openings():
        wall = wall_below(w)
        if not wall:
            skipped += 1
            continue
        at, d = wall
        t = Vector((-d.y, d.x, 0)).normalized()
        c = w['c'].dot(t); top = w['z'] - 0.02
        # 壁の下端より下へは垂らさない。渡り廊下 (b12_bridge) は 1m 下で壁が終わっていて、
        # 宙に筋が浮いた
        reach = top - BOTTOM - 0.1
        if reach < 0.3:
            continue
        if w['w'] <= 1.2:
            h = min(random.uniform(1.0, 1.5), reach)
            window_streak(st if w['w'] >= 0.9 else nr, st_uv if w['w'] >= 0.9 else nr_uv, at, d, c, w['w'] - 0.04, top, h)
            made += 1
        else:
            for _ in range(random.randint(2, 3)):
                sw = random.uniform(0.4, 0.7)
                sc_ = random.uniform(c - w['w'] / 2 + sw / 2, c + w['w'] / 2 - sw / 2)
                window_streak(nr, nr_uv, at, d, sc_, sw, top, min(random.uniform(0.8, 1.4), reach))
                made += 1
    # 1 つの物に 2 つの材質 (b32 と同じ)
    if len(st.faces):
        nr_me = bpy.data.meshes.new('_nr'); nr.to_mesh(nr_me); nr.free()
        st_me = bpy.data.meshes.new('_st'); st.to_mesh(st_me); st.free()
        st = bmesh.new(); st.from_mesh(st_me)
        for f in st.faces: f.material_index = 0
        k = len(st.faces); st.from_mesh(nr_me); st.faces.ensure_lookup_table()
        for f in st.faces[k:]: f.material_index = 1
        bpy.data.meshes.remove(nr_me); bpy.data.meshes.remove(st_me)
        o = finish('vis_decal_b%s_streak_nouv' % TAG, st, wide)
        o.data.materials.append(streak_mat)
    else:
        st.free()
        finish('vis_decal_b%s_streak_nouv' % TAG, nr, streak_mat)
    print('window streaks', made, 'windows without an outer wall', skipped)

if not ONLY and not WINDOWS:
    # ---- 雨だれ (屋根の縁から)
    st = bmesh.new(); st_uv = st.loops.layers.uv.new('UVMap')
    dg = bpy.context.evaluated_depsgraph_get()
    evm = body.evaluated_get(dg).data
    M = body.matrix_world
    faces = {}
    for p in evm.polygons:
        n = (M.to_3x3() @ p.normal).normalized()
        if abs(n.z) > 0.3:
            continue
        cos = [M @ evm.vertices[i].co for i in p.vertices]
        key = (round(n.x, 1), round(n.y, 1), round(cos[0].dot(n), 1))
        faces.setdefault(key, {'n': n, 'cos': []})['cos'].extend(cos)
    for key, d in faces.items():
        n = d['n']; cos = d['cos']
        t = Vector((-n.y, n.x, 0)).normalized()
        us = [c.dot(t) for c in cos]; zs = [c.z for c in cos]
        u0, u1, ztop = min(us), max(us), max(zs)
        if u1 - u0 < 1.5 or ztop - min(zs) < 1.5:
            continue
        base = cos[0] - t * cos[0].dot(t)          # t 成分を抜いた基準点 (面の上の点)
        for _ in range(random.randint(1, 3)):
            w = random.uniform(0.3, 0.7)
            c = random.uniform(u0 + 0.4 + w / 2, u1 - 0.4 - w / 2)
            h = random.uniform(0.8, 1.6)
            p = base + t * c + n * E
            p.z = 0
            top = ztop - 0.02
            pts = [p + t * (-w / 2) + Vector((0, 0, top - h)), p + t * (w / 2) + Vector((0, 0, top - h)),
                   p + t * (w / 2) + Vector((0, 0, top)), p + t * (-w / 2) + Vector((0, 0, top))]
            quad(st, st_uv, pts, ((0, 1), (1, 1), (1, 0), (0, 0)))     # 絵は v=0 が濃い (上)
    finish('vis_decal_b%s_streak_nouv' % TAG, st, streak_mat)


if not ONLY:
    # ---- 角
    exec(open('/Users/yuma/workspace/mgo2http/tools/gen/edge_wear.py').read(), {'__name__': 'edge'})
    _edge = {}
    exec(open('/Users/yuma/workspace/mgo2http/tools/gen/edge_wear.py').read(), _edge)
    print('edge', _edge['make_edge_decals'](body, TAG, use_base=True))
    if cfg.get('roof'):
        print('roof edge', _edge['make_edge_decals'](bpy.data.objects[cfg['roof']], cfg.get('roof_tag', TAG + 'roof'), use_base=True))
    bpy.context.view_layer.update()
    for nm in ('vis_decal_b%s_grime_nouv' % TAG, 'vis_decal_b%s_streak_nouv' % TAG):
        if nm in bpy.data.objects:
            print(nm, 'flipped', _edge['fix_decal_normals'](bpy.data.objects[nm]), 'faces', len(bpy.data.objects[nm].data.polygons))
