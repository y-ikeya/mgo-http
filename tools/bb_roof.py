# BB の 2F の通路の屋根 (本人 2026-11-05「2F には屋根がついてる」)。
#
#   屋根  metal_roof_<k>        床から ROOF_H 上に厚さ ROOF_T の鉄の板。通路・踊り場ごと
#   柱    metal_roof_post_<k>   通路の両脇に POST_STEP おき、縁から内へ POST_IN
#
# 前の屋根 (metal_roof_*) は消して作り直す。手で直した屋根があれば、作り直す前に本人に聞く
import bmesh

ROOF_H = 3.0
ROOF_T = 0.2
POST = 0.2
POST_STEP = 4.5
POST_IN = 0.15
SLABS = ('metal_walk_2F_', 'metal_landing_')


def _bounds(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return [min(p[i] for p in ps) for i in range(3)], [max(p[i] for p in ps) for i in range(3)]


def _box(bm, lo, hi):
    for v in bmesh.ops.create_cube(bm, size=1.0)['verts']:
        v.co.x = lo[0] if v.co.x < 0 else hi[0]
        v.co.y = lo[1] if v.co.y < 0 else hi[1]
        v.co.z = lo[2] if v.co.z < 0 else hi[2]


def build(bpy, scene):
    for o in [o for o in scene.objects if o.name.startswith('metal_roof_')]:
        me = o.data
        bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    made = 0
    for o in [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(SLABS) and 'pillar' not in o.name]:
        lo, hi = _bounds(o)
        top = hi[2]
        key = o.name.split('_', 1)[1]

        def new(name, fill):
            me = bpy.data.meshes.new(name)
            bm = bmesh.new()
            fill(bm)
            bm.to_mesh(me)
            bm.free()
            scene.collection.objects.link(bpy.data.objects.new(name, me))

        new(f'metal_roof_{key}', lambda bm: _box(bm, (lo[0], lo[1], top + ROOF_H), (hi[0], hi[1], top + ROOF_H + ROOF_T)))

        def posts(bm):
            along_x = (hi[0] - lo[0]) >= (hi[1] - lo[1])
            a0, a1 = (lo[0], hi[0]) if along_x else (lo[1], hi[1])
            n = max(1, round((a1 - a0) / POST_STEP))
            for i in range(n + 1):
                u = a0 + POST_IN + (a1 - a0 - 2 * POST_IN) * i / n
                for side in ((lo[1] + POST_IN, ) if along_x else (lo[0] + POST_IN, )) + ((hi[1] - POST_IN - POST, ) if along_x else (hi[0] - POST_IN - POST, )):
                    if along_x:
                        x0, y0 = min(max(u - POST / 2, lo[0] + POST_IN), hi[0] - POST_IN - POST), side
                    else:
                        x0, y0 = side, min(max(u - POST / 2, lo[1] + POST_IN), hi[1] - POST_IN - POST)
                    _box(bm, (x0, y0, top), (x0 + POST, y0 + POST, top + ROOF_H))
        new(f'metal_roof_post_{key}', posts)
        made += 1
    return made
