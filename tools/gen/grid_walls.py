# 箱の建物の壁を、窓の間と階の境で格子に割る。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/grid_walls.py').read(), {'GRID_WALLS': 'concrete_building5'})
#
# 本人 2026-10-20「concrete_building5 の建物の表面がさ、同じ面なのに光り方が違う、edge が多い」。
#
# 部屋の暗さ (空の見え方) は書き出しで**頂点ごとに**焼く (export_stage.py --bake)。窓を Boolean で
# 掘っただけの 6 面の箱は、壁が窓の角から伸びる細長い三角でできていて、頂点の暗さがその三角の中で
# 引き伸ばされ、平らな壁に斜めの明暗が出た。掘る前の本体を格子に割っておけば、三角は窓のまわりの
# 小さな物になる (b12 は b5style.py で最初から割っている)。
#
# 割る所は掘る箱 (ref_cut_building◯) から読む:
#   縦  隣り合う窓の真ん中 (面ごとの窓の並び)
#   横  上下の窓の真ん中 (階の境)、足元から 0.5m、屋上の 0.05m 下
import bpy, bmesh
from mathutils import Vector

bu = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/board_up.py').read(), bu)


def _mids(values):
    v = sorted(set(round(x, 3) for x in values))
    return [(a + b) / 2 for a, b in zip(v, v[1:]) if b - a > 0.5]


def grid(body_name, cut_name=None):
    body = bpy.data.objects[body_name]
    cut = bpy.data.objects[cut_name or body_name.replace('concrete_', 'ref_cut_')]
    comps = bu['_components'](cut)
    # 窓の箱は薄い向きで面が分かる (y が薄い = 南北の面、x が薄い = 東西の面)
    xs = [(lo.x + hi.x) / 2 for lo, hi, _, _ in comps if hi.y - lo.y < hi.x - lo.x]
    ys = [(lo.y + hi.y) / 2 for lo, hi, _, _ in comps if hi.x - lo.x < hi.y - lo.y]
    rows = sorted({(round(lo.z, 2), round(hi.z, 2)) for lo, hi, _, _ in comps})
    M = body.matrix_world
    bb = [M @ Vector(c) for c in body.bound_box]
    zlo = min(v.z for v in bb)
    zhi = max(v.z for v in bb)
    zs = [zlo + 0.5, zhi - 0.05] + [(a[1] + b[0]) / 2 for a, b in zip(rows, rows[1:]) if b[0] > a[1]]

    bm = bmesh.new()
    bm.from_mesh(body.data)
    Mi = M.inverted()
    planes = [(Vector((x, 0, 0)), Vector((1, 0, 0))) for x in _mids(xs)]
    planes += [(Vector((0, y, 0)), Vector((0, 1, 0))) for y in _mids(ys)]
    planes += [(Vector((0, 0, z)), Vector((0, 0, 1))) for z in sorted(set(round(z, 3) for z in zs))]
    for co, no in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Mi @ co, plane_no=(Mi.to_3x3() @ no).normalized())
    before = len(body.data.polygons)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    return {'faces': (before, len(body.data.polygons)), 'cuts': len(planes)}


if globals().get('GRID_WALLS'):
    print(grid(GRID_WALLS))
