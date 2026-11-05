# UU の白いビル (concrete_building_white) の壁を、窓 (tools/white_windows.py の vis_window_white_*) の
# 枠の外寸で凹ませる (2026-11-05 本人「窓とその窓枠くらい引っ込められる？」「全部やってよ」)。
# 窓の側は white_windows.py の RECESS_ALL だけ奥へ下がる。ここで凹ませる深さと同じにしておくこと。
#
# 面ごとに、元の面を消して「外の輪 + 窓の穴」を三角で埋め直す (triangle_fill)。外の輪の点は元のまま
# なので、隣の面との継ぎ目に新しい点ができない (T 字の継ぎ目は隙間が光る)。穴ごとに奥と四方の側を足す。
# 絵は周りと同じく 3.2m で 1 枚を、面の向きで平らに貼る。
#
# **1 回だけ流す。** 流した後の壁にもう一度流すと、凹みの中にさらに穴を開けに行く。やり直すときは
# .blend を流す前に戻す。
#   開いている Blender で: exec(open('tools/white_recess.py').read())
import bpy, bmesh, re
from mathutils import Vector

BUILDING = 'concrete_building_white'
DEPTH = 0.08
SILLS = (5.4, 8.95, 12.5, 16.05)   # white_windows.py と同じ
HALF = 0.6 + 0.14                  # 窓の半幅 + 枠の石
HEIGHT = 1.9 + 0.14                # 窓の高さ + 上の枠の石
S = 3.2                            # 絵 1 枚の大きさ (m)

o = bpy.data.objects[BUILDING]
me = o.data
M = o.matrix_world
Mi = M.inverted()
R = M.to_3x3()
bm = bmesh.new()
bm.from_mesh(me)
uvl = bm.loops.layers.uv.active


def W(v):
    return M @ v.co


def set_uv(f):
    n = R @ f.normal
    for l in f.loops:
        p = W(l.vert)
        if abs(n.x) > 0.7 * n.length:
            l[uvl].uv = (p.y / S, p.z / S)
        elif abs(n.y) > 0.7 * n.length:
            l[uvl].uv = (p.x / S, p.z / S)
        else:
            l[uvl].uv = (p.y / S, p.x / S)


# 窓の一覧 (面, 外の向き, y の範囲, z の範囲)
holes = []
for w in bpy.data.collections['white_windows'].objects:
    m = re.match(r'vis_window_white_(east|west)_(\d)_([\d.]+)_', w.name)
    if not m:
        continue
    side, floor, yc = m.group(1), int(m.group(2)), float(m.group(3))
    z0 = SILLS[floor - 1]
    holes.append((side, +1 if side == 'east' else -1, yc - HALF, yc + HALF, z0, z0 + HEIGHT))


def face_for(d, y0, y1, z0, z1):
    """穴がまるごと入る、その向きの壁の面"""
    for f in bm.faces:
        n = R @ f.normal
        if n.x * d < 0.99 * n.length:
            continue
        ps = [W(v) for v in f.verts]
        if min(p.y for p in ps) < y0 and max(p.y for p in ps) > y1 and min(p.z for p in ps) < z0 and max(p.z for p in ps) > z1:
            return f
    return None


groups = {}
missing = []
for h in holes:
    f = face_for(*h[1:])
    if f is None:
        missing.append(h)
    else:
        groups.setdefault(f, []).append(h)

made = 0
for f, hs in groups.items():
    mat = f.material_index
    n = (R @ f.normal).normalized()
    ps = [W(v) for v in f.verts]
    # 面の x は y で少し傾く。外の輪の点から y → x を引く (両端の点で線を引く)
    a = min(ps, key=lambda p: p.y)
    b = max(ps, key=lambda p: p.y)

    def wx(y):
        return a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)

    outer = list(f.edges)
    bm.faces.remove(f)
    edges = list(outer)
    rings = []
    for side, d, y0, y1, z0, z1 in hs:
        ring = [bm.verts.new(Mi @ Vector((wx(y), y, z))) for y, z in ((y0, z0), (y0, z1), (y1, z1), (y1, z0))]
        rings.append((ring, d))
        for i in range(4):
            edges.append(bm.edges.new((ring[i], ring[(i + 1) % 4])))
    filled = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=Mi.to_3x3() @ n)['geom']
    tris = [g for g in filled if isinstance(g, bmesh.types.BMFace)]
    # 穴の中に置かれた三角を消す (triangle_fill は内側の輪を穴として扱うが、念のため)
    for t in tris:
        c = M @ t.calc_center_median()
        inside = any(y0 < c.y < y1 and z0 < c.z < z1 for _, _, y0, y1, z0, z1 in hs)
        if inside:
            bm.faces.remove(t)
            continue
        t.material_index = mat
        if (R @ t.normal).dot(n) < 0:
            t.normal_flip()
        set_uv(t)
    # 凹み: 奥と四方の側
    for ring, d in rings:
        # 奥は外の向き (d) の逆へ — 壁の中へ
        back = [bm.verts.new(Mi @ (W(v) - Vector((d * DEPTH, 0, 0)))) for v in ring]
        quads = [(back, -d, 'x')]
        for i in range(4):
            quads.append(([ring[i], ring[(i + 1) % 4], back[(i + 1) % 4], back[i]], None, None))
        for vs, want, _ in quads:
            g = bm.faces.new(vs)
            g.material_index = mat
            bm.normal_update()
            c = M @ g.calc_center_median()
            # 外 (d の向き) から見える向きに: 奥は d、側は凹みの中心を向く
            mid = sum((W(v) for v in ring), Vector()) / 4
            to_open = (mid - c)
            to_open.x = 0
            want_dir = Vector((d, 0, 0)) if vs is back else to_open
            if (R @ g.normal).dot(want_dir) < 0:
                g.normal_flip()
            set_uv(g)
        made += 1

bm.normal_update()
bm.to_mesh(me)
bm.free()
me.update()
print('凹ませた窓', made, '/ 面の無かった窓', len(missing), [(h[0], round(h[2] + HALF, 1), h[4]) for h in missing])
print('面', len(me.polygons))
