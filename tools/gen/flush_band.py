# 建物の「くびれ」を無くす。Blender の中で流す (MCP から exec)。
#
#   ns = {'FLUSH': 'concrete_building10', 'ATTACHED': ['glass_building10_panes_notexture', ...]}
#   exec(open('tools/gen/flush_band.py').read(), ns)
#
# --- くびれとは ---
# 街の建物の多くは、2 階より上の外壁が 1 階より 0.35m 外へ出ていて、その間を斜めの帯
# (高さ 13.5〜14.07m) がつないでいる。本人がこれを要らないと言った (2026-10-14、b9 / b10)。
# 上の階を 1 階の壁の線まで寄せて、壁を 1 枚の面にする。
#
# --- やること ---
# 1. 上の階の外壁 (14.07m から立ち上がる外向きの大きな面) と、それぞれの 1 階の面の位置を拾う。
#    寄せる量は壁ごとに形から読む (決め打ちの 0.35m にしない)
# 2. 外壁から内 0.6m〜外 0.15m にある頂点を、その壁の 1 階の線まで寄せる。**角は 2 枚の壁の
#    両方に乗る点を連立で解く** — 足し合わせると斜めの角でずれて、ひれが出た (b9 の南東)。
#    外へ 0.15m より遠い頂点は拾わない (段差の外に乗っていた帯の端を引き込んだ)
# 3. 帯の高さに残る壊れた面を消し、1 階の外周に沿った平らな壁で覆う (BAND_COVER)。帯は角で
#    作りが違い、平らに寄せると角を斜めに横切る面と穴が残った
# 4. 付いている物 (窓・シャッター・汚れのデカール) も同じ規則で寄せる。覆いの高さのデカールは
#    覆いより手前 (4mm) へ出す
#
# 角の汚れ (edge_wear.py) は形が変わるので後で作り直すこと。
import bpy, bmesh
from mathutils import Vector

BAND = (13.5, 14.075)          # 帯の下端と上端。この間の頂点は 1 階の線へ平らに寄せる
# 覆いの壁の高さ。帯の壊れた面の下端 (b9 は 12.82) から上の階の最初の段まで。
# 1 階の窓の上端 (b10 は 13.05) より下から張ると窓の奥が塞がるので、建物ごとに渡せるようにしてある
BAND_COVER = globals().get('BAND_COVER', (12.78, 14.85))
COVER_OUT = 0.001              # 覆いを壁から浮かせる量 (m)
PICK_IN, PICK_OUT = 0.6, 0.15  # 壁の頂点として拾う範囲 (内 / 外、m)


def _faces(body, zlo, zhi, min_area):
    W = body.matrix_world
    N3 = W.to_3x3()
    out = []
    for p in body.data.polygons:
        n = (N3 @ p.normal).normalized()
        c = W @ p.center
        if abs(n.z) < 0.1 and zlo < c.z < zhi and p.area > min_area:
            hn = Vector((n.x, n.y)).normalized()
            vs = [W @ body.data.vertices[i].co for i in p.vertices]
            t = Vector((-hn.y, hn.x))
            along = [Vector((v.x, v.y)).dot(t) for v in vs]
            out.append(dict(n=hn, d=Vector((c.x, c.y)).dot(hn), t=t, a0=min(along), a1=max(along),
                            z0=min(v.z for v in vs), area=p.area))
    merged = []
    for w in sorted(out, key=lambda w: -w['area']):
        for m in merged:
            if m['n'].dot(w['n']) > 0.999 and abs(m['d'] - w['d']) < 0.03:
                m['a0'] = min(m['a0'], w['a0']); m['a1'] = max(m['a1'], w['a1'])
                m['z0'] = min(m['z0'], w['z0']); m['area'] += w['area']
                break
        else:
            merged.append(dict(w))
    return merged


def upper_walls(body, poly):
    """上の階の外壁と、それぞれの 1 階の面の位置 (ground)。

    1 階の面は**帯のすぐ下で輪切りにした外周 (poly) の辺**から取る。1 階の面を大きさや
    近さで選ぶと、b10 では店先の奥まった面 (-0.65) や窓枠 (-0.05) を拾って外れた
    """
    upper = [m for m in _faces(body, 14.3, 99, 0.15) if m['z0'] < 14.2 and m['area'] > 3]
    edges = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        t = (b - a).normalized(); n = Vector((t.y, -t.x))
        edges.append((n, a.dot(n), min(a.dot(t), b.dot(t)), max(a.dot(t), b.dot(t)), t))
    for m in upper:
        best = None
        for n, d, a0, a1, t in edges:
            if n.dot(m['n']) > 0.995 and 0 <= m['d'] - d < 0.8:
                lo, hi = sorted((a0 * t.dot(m['t']), a1 * t.dot(m['t'])))
                if hi > m['a0'] - 0.5 and lo < m['a1'] + 0.5 and (best is None or m['d'] - d < m['d'] - best):
                    best = d
        m['ground'] = best if best is not None else m['d']
    return upper


def _move(p, walls):
    if p.z < BAND[0] - 1e-3:
        return None
    q = Vector((p.x, p.y))
    cands = []
    for m in walls:
        s = q.dot(m['n']) - m['d']
        a = q.dot(m['t'])
        shift = m['ground'] - m['d']
        if -PICK_IN <= s <= PICK_OUT and m['a0'] - 0.6 <= a <= m['a1'] + 0.6:
            dl = ((shift - s) if s > shift else 0.0) if p.z <= BAND[1] else shift
            cands.append((abs(s), m['n'], dl))
    if not cands:
        return None
    cands.sort(key=lambda c: c[0])
    picked = []
    for c in cands:
        if all(abs(c[1].dot(k[1])) < 0.95 for k in picked):
            picked.append(c)
        if len(picked) == 2:
            break
    if len(picked) == 1:
        n, dl = picked[0][1], picked[0][2]
        return Vector((n.x * dl, n.y * dl, 0))
    (_, n1, d1), (_, n2, d2) = picked
    det = n1.x * n2.y - n1.y * n2.x
    return Vector(((d1 * n2.y - d2 * n1.y) / det, (n1.x * d2 - n2.x * d1) / det, 0))


def outline(body, z=13.0, all_loops=False):  # 窓の上端より上、帯より下の高さで切ること
    """1 階の外周 (z で輪切りにした一番大きな輪)。一直線上の点はまとめる。

    all_loops: 面積 1m² 以上の輪を全部返す (反時計回りに揃えて)。建物に増築を合わせた
    本体 (b18) は段の輪が 2 つある
    """
    bm = bmesh.new(); bm.from_mesh(body.data); bm.transform(body.matrix_world)
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1))
    adj = {}
    key = lambda v: (round(v.co.x, 4), round(v.co.y, 4))
    for e in res['geom_cut']:
        if not isinstance(e, bmesh.types.BMEdge):
            continue
        a, c = key(e.verts[0]), key(e.verts[1])
        if a != c:
            adj.setdefault(a, set()).add(c); adj.setdefault(c, set()).add(a)
    bm.free()
    loops = []; seen = set()
    for start in adj:
        if start in seen:
            continue
        loop = [start]; seen.add(start); prev = None; cur = start
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
        loops.append(loop)
    area = lambda l: 0.5 * sum(l[i][0] * l[(i + 1) % len(l)][1] - l[(i + 1) % len(l)][0] * l[i][1] for i in range(len(l)))
    if all_loops:
        return [_simplify(l if area(l) > 0 else l[::-1]) for l in loops if abs(area(l)) >= 1.0]
    loop = max(loops, key=lambda l: abs(area(l)))
    if area(loop) < 0:
        loop = loop[::-1]
    return _simplify(loop)


def _simplify(loop):
    ps = [Vector(p) for p in loop]
    changed = True
    while changed:
        changed = False; out = []
        for i in range(len(ps)):
            a, b, c = ps[i - 1], ps[i], ps[(i + 1) % len(ps)]
            if (b - a).length < 1e-3:
                changed = True; continue
            if (c - b).length > 1e-3 and abs((b - a).normalized().cross((c - b).normalized())) < 0.002:
                changed = True; continue
            out.append(b)
        ps = out
    return ps


def flush(body_name, attached, poly):
    body = bpy.data.objects[body_name]
    walls = upper_walls(body, poly)
    report = {'walls': [(round(m['d'], 3), round(m['ground'] - m['d'], 3)) for m in walls]}
    for name in [body_name] + list(attached):
        o = bpy.data.objects[name]; Wo = o.matrix_world; inv = Wo.inverted(); moved = 0
        for v in o.data.vertices:
            p = Wo @ v.co; d = _move(p, walls)
            if d is not None and d.length > 1e-6:
                v.co = inv @ (p + d); moved += 1
        o.data.update()
        report[name] = moved
    return report


def cover_band(body_name, poly, decals):
    """帯の高さの壊れた面を消し、外周に沿った平らな壁で覆う (本体に組み込む)"""
    body = bpy.data.objects[body_name]; W = body.matrix_world; inv = W.inverted()
    n = len(poly)

    def dist_outline(q):
        best = 9.0
        for i in range(n):
            a, c = poly[i], poly[(i + 1) % n]; d = c - a
            t = max(0.0, min(1.0, (q - a).dot(d) / d.length_squared))
            best = min(best, (a + d * t - q).length)
        return best

    bm = bmesh.new(); bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv.active
    dels = []
    for f in bm.faces:
        ws = [W @ v.co for v in f.verts]
        if not all(BAND_COVER[0] + 0.01 <= w.z <= BAND[1] + 0.015 for w in ws):
            continue
        if not all(dist_outline(Vector((w.x, w.y))) <= 0.75 for w in ws):
            continue
        if abs((W.to_3x3() @ f.normal).normalized().z) > 0.95 and f.calc_area() > 0.5:
            continue
        dels.append(f)
    bmesh.ops.delete(bm, geom=dels, context='FACES')
    corner = {}
    run = 0.0
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]; d = b - a; L = d.length
        nrm = Vector((d.y, -d.x)).normalized()
        pa, pb = a + nrm * COVER_OUT, b + nrm * COVER_OUT
        vs = []
        for p, z in ((pa, BAND_COVER[0]), (pb, BAND_COVER[0]), (pb, BAND_COVER[1]), (pa, BAND_COVER[1])):
            vs.append(bm.verts.new(inv @ Vector((p.x, p.y, z))))
        f = bm.faces.new(vs); f.material_index = 0
        for l, (u, z) in zip(f.loops, ((run, BAND_COVER[0]), (run + L, BAND_COVER[0]), (run + L, BAND_COVER[1]), (run, BAND_COVER[1]))):
            l[uvl].uv = (u * 0.5, z * 0.5)
        run += L
    # 角の頂点をくっつける (角の汚れが角として読めるように)
    zs = (BAND_COVER[0], BAND_COVER[1])
    cand = [v for v in bm.verts if any(abs((W @ v.co).z - z) < 1e-4 for z in zs)]
    bmesh.ops.remove_doubles(bm, verts=cand, dist=0.003)
    bm.normal_update(); bm.to_mesh(body.data); bm.free(); body.data.update()
    # 覆いの高さのデカールを覆いより手前へ
    segs = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]; d = b - a; L = d.length
        segs.append((a, d / L, L, Vector((d.y, -d.x)).normalized()))
    pushed = 0
    for name in decals:
        o = bpy.data.objects.get(name)
        if not o:
            continue
        Wo = o.matrix_world; oi = Wo.inverted()
        for v in o.data.vertices:
            p = Wo @ v.co
            if not (BAND_COVER[0] - 0.08 <= p.z <= BAND_COVER[1] + 0.1):
                continue
            q = Vector((p.x, p.y)); push = Vector((0, 0))
            for a, t, L, nrm in segs:
                s = (q - a).dot(nrm); u = (q - a).dot(t)
                if -0.02 <= s <= 0.01 and -0.05 <= u <= L + 0.05:
                    push += nrm * (0.004 - max(s, 0.0))
            if push.length > 0:
                v.co = oi @ Vector((p.x + push.x, p.y + push.y, p.z)); pushed += 1
        o.data.update()
    return {'deleted': len(dels), 'decal_pushed': pushed}


if globals().get('FLUSH'):
    _body = FLUSH
    _attached = globals().get('ATTACHED', [])
    _poly = outline(bpy.data.objects[_body], globals().get('OUTLINE_Z', 13.0))
    print('outline', [(round(p.x, 3), round(p.y, 3)) for p in _poly])
    print('flush', flush(_body, _attached, _poly))
    print('cover', cover_band(_body, _poly, [a for a in _attached if a.startswith('vis_decal')]))
