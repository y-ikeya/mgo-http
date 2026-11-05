# BB の 2F の通路の屋根 (本人 2026-11-05「2F には屋根がついてる」)。
#
#   屋根  metal_roof_<k>        床から ROOF_H 上に厚さ ROOF_T の鉄の板。2F の通路ごと (踊り場には付けない)
#   柱    metal_roof_post_<k>   通路の**外**の両脇に POST_STEP おき (通路の上に置くと人が引っ掛かる、2026-11-05 本人
#                               「廊下の外に出していい、柱に当たって止まることがないように」)。外に別の床が続く所は立てない
#
# 前の屋根 (metal_roof_*) は消して作り直す。手で直した屋根があれば、作り直す前に本人に聞く
import bmesh

ROOF_H = 3.0
ROOF_T = 0.2
POST = 0.1          # 0.2 は太かった (本人「もう少し細く」)
POST_STEP = 4.5
# 屋根は 2F の通路だけ。踊り場 (半分の高さ) に付けたら、通路の屋根より 1.8m 低い屋根がぽつんと浮いた
# (2026-11-05 本人「屋根がへん」)
SLABS = ('metal_walk_2F_',)


def _bounds(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return [min(p[i] for p in ps) for i in range(3)], [max(p[i] for p in ps) for i in range(3)]


def _box(bm, lo, hi):
    for v in bmesh.ops.create_cube(bm, size=1.0)['verts']:
        v.co.x = lo[0] if v.co.x < 0 else hi[0]
        v.co.y = lo[1] if v.co.y < 0 else hi[1]
        v.co.z = lo[2] if v.co.z < 0 else hi[2]


WALKABLE = ('metal_walk_2F_', 'metal_landing_', 'concrete_stair_', 'metal_stair_', 'concrete_tower')


def build(bpy, scene):
    from mathutils import Vector
    for o in [o for o in scene.objects if o.name.startswith('metal_roof_')]:
        me = o.data
        bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    made = 0
    for o in [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(SLABS) and 'pillar' not in o.name]:
        lo, hi = _bounds(o)
        top, bottom = hi[2], lo[2]
        key = o.name.split('_', 1)[1]
        along_x = (hi[0] - lo[0]) >= (hi[1] - lo[1])

        def free(x, y):
            """(x, y) の真下に、この床の高さ付近の歩ける面が無いか"""
            hit, _l, _n, _i, obj, _m = scene.ray_cast(dg, Vector((x, y, top + 0.5)), Vector((0, 0, -1)), distance=1.5)
            return not (hit and obj is not o and obj.name.startswith(WALKABLE))

        spots = []
        a0, a1 = (lo[0], hi[0]) if along_x else (lo[1], hi[1])
        n = max(1, round((a1 - a0) / POST_STEP))
        for i in range(n + 1):
            u = min(max(a0 + (a1 - a0) * i / n, a0 + POST / 2), a1 - POST / 2)
            for side in (-1, 1):
                if along_x:
                    x, y = u, (lo[1] - POST / 2) if side < 0 else (hi[1] + POST / 2)
                else:
                    x, y = (lo[0] - POST / 2) if side < 0 else (hi[0] + POST / 2), u
                if free(x, y):
                    spots.append((x, y))

        def new(name, fill):
            me = bpy.data.meshes.new(name)
            bm = bmesh.new()
            fill(bm)
            bm.to_mesh(me)
            bm.free()
            scene.collection.objects.link(bpy.data.objects.new(name, me))

        # 屋根は柱に届くよう、柱の幅だけ外へ広げる
        new(f'metal_roof_{key}', lambda bm: _box(bm, (lo[0] - POST, lo[1] - POST, top + ROOF_H), (hi[0] + POST, hi[1] + POST, top + ROOF_H + ROOF_T)))

        def posts(bm):
            for x, y in spots:
                _box(bm, (x - POST / 2, y - POST / 2, bottom), (x + POST / 2, y + POST / 2, top + ROOF_H))
        if spots:
            # nobox: 両側に柱が並ぶので、外接の箱にされると通路が塞がる (柵で起きた)
            new(f'metal_roof_post_{key}_nobox', posts)
        made += 1
    return made
