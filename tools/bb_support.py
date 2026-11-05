# BB の 2F を支える柱 (本人の画面 2026-11-05「2F を支える太い柱はこんな感じ」): コンクリートの台座の上に
# 鉄骨の櫓 (4 隅の柱・中ほどの梁・4 面の X の筋交い) が立って、通路の下を受ける。
#
#   台座       concrete_support_<k>_base   1.6m 角、高さ 1.7m。下に一回り広い裾 (0.45m)
#   柱と梁     metal_support_<k>_frame     4 隅の柱 0.18m 角、台座の上と真ん中と上の梁
#   筋交い     vis_metal_support_<k>_brace_noeye   細いので素通り (当たりにすると引っ掛かるだけ)、視線も通す
#
# make_bb.py が読む。開いている blend へは support(scene, ...) をそのまま呼ぶ
import bmesh
import math

BASE = 1.6
BASE_H = 1.7
PLINTH = 0.3          # 裾が台座より広い量 (片側 0.15)
PLINTH_H = 0.45
POST = 0.18
INSET = 0.12          # 柱を台座の縁から内へ
BEAM = 0.14
BRACE = 0.07


def _box(bm, lo, hi):
    g = bmesh.ops.create_cube(bm, size=1.0)['verts']
    for v in g:
        v.co.x = lo[0] if v.co.x < 0 else hi[0]
        v.co.y = lo[1] if v.co.y < 0 else hi[1]
        v.co.z = lo[2] if v.co.z < 0 else hi[2]


def _bar(bm, a, b, t):
    """a → b の細い角材 (太さ t)"""
    import mathutils
    a, b = mathutils.Vector(a), mathutils.Vector(b)
    d = b - a
    length = d.length
    g = bmesh.ops.create_cube(bm, size=1.0)['verts']
    rot = d.to_track_quat('Z', 'Y').to_matrix()
    mid = (a + b) / 2
    for v in g:
        local = mathutils.Vector((v.co.x * t, v.co.y * t, v.co.z * length))
        v.co = mid + rot @ local


def support(bpy, scene, key, cx, cy, floor, top):
    """真ん中 (cx, cy)、床 floor から top (通路の下面) まで"""
    objs = []

    def new(name, build):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        build(bm)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        scene.collection.objects.link(o)
        objs.append(o)

    h = BASE / 2
    p = h + PLINTH / 2

    def base(bm):
        _box(bm, (cx - p, cy - p, floor - 0.05), (cx + p, cy + p, floor + PLINTH_H))
        _box(bm, (cx - h, cy - h, floor), (cx + h, cy + h, floor + BASE_H))
    new(f'concrete_support_{key}_base', base)

    z0 = floor + BASE_H
    q = h - INSET - POST / 2
    corners = [(cx - q, cy - q), (cx + q, cy - q), (cx + q, cy + q), (cx - q, cy + q)]
    zm = (z0 + top) / 2

    def frame(bm):
        for x, y in corners:
            _box(bm, (x - POST / 2, y - POST / 2, z0), (x + POST / 2, y + POST / 2, top))
        for z in (z0 + BEAM / 2, zm, top - BEAM / 2):
            for i in range(4):
                (x1, y1), (x2, y2) = corners[i], corners[(i + 1) % 4]
                _bar(bm, (x1, y1, z), (x2, y2, z), BEAM)
    new(f'metal_support_{key}_frame', frame)

    def brace(bm):
        for i in range(4):
            (x1, y1), (x2, y2) = corners[i], corners[(i + 1) % 4]
            for za, zb in ((z0, zm), (zm, top)):
                _bar(bm, (x1, y1, za), (x2, y2, zb), BRACE)
                _bar(bm, (x2, y2, za), (x1, y1, zb), BRACE)
    new(f'vis_metal_support_{key}_brace_noeye', brace)
    return objs
